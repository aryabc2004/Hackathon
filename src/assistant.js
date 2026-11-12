// Teacher-side UI for the Insights Agent: chat tab, proactive suggestion cards,
// and approved check-ins that fire automatically while the dashboard is open.
import { local } from './db.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STEP = {
  list_students: '👥 Checked roster', get_breaks: '📋 Read break history', find_patterns: '📈 Looked for patterns',
  activity_effectiveness: '🧘 Compared calming activities', propose_checkin: '🗓️ Proposed a check-in', submit_suggestions: '✅ Wrote suggestions',
};
const CHIPS = [
  'Who needs the most support this week?',
  'What are the biggest triggers in my class?',
  'Which calming activity works best, and for whom?',
  'Is the class making progress compared to last week?',
];

// Light markdown: **bold** and "- " bullets only (content is escaped first).
function md(text) {
  const lines = esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = ''; let inList = false;
  for (const l of lines) {
    if (/^\s*[-•]\s+/.test(l)) { if (!inList) { html += '<ul style="margin:.3em 0 .3em 1.2em;padding:0">'; inList = true; } html += `<li>${l.replace(/^\s*[-•]\s+/, '')}</li>`; }
    else { if (inList) { html += '</ul>'; inList = false; } if (l.trim()) html += `<p style="margin:.35em 0">${l}</p>`; }
  }
  return html + (inList ? '</ul>' : '');
}

function payload(ctx, extra) {
  return {
    ...extra,
    students: [...ctx.students.values()].map(({ id, name, status, profile }) => ({ id, name, status, profile })),
    breaks: [...ctx.breaks.values()].map(({ id, student_id, initiated_by, emotion, reason, size, activity, after, started_at, ended_at }) =>
      ({ id, student_id, initiated_by, emotion, reason, size, activity, after, started_at, ended_at })),
    nowISO: new Date().toISOString(), nowLocal: new Date().toString(), tzOffsetMin: new Date().getTimezoneOffset(),
    timeZone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })(),
  };
}

async function callAgent(body) {
  const res = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json = {}; try { json = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(json.error || `Agent unavailable (${res.status})`); e.status = res.status; e.code = json.code; throw e; }
  return json;
}

const stepChips = (steps = []) => [...new Set(steps)].map((s) => `<span class="pill gray" style="font-size:.78rem">${STEP[s] || s}</span>`).join(' ');
const whenLabel = (d) => d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ============================================================ Check-ins
const ckKey = (code) => `cc_checkins_${code}`;
export const checkins = {
  list(code) { return (local.get(ckKey(code)) || []).filter((c) => c.status === 'scheduled').sort((a, b) => a.at.localeCompare(b.at)); },
  add(code, p) {
    const at = new Date(`${p.date}T${p.time}`);
    if (isNaN(at)) throw new Error('Invalid check-in time');
    const all = local.get(ckKey(code)) || [];
    all.push({ id: crypto.randomUUID(), student_id: p.student_id, student: p.student, at: at.toISOString(), reason: p.reason || p.title || '', status: 'scheduled' });
    local.set(ckKey(code), all); return at;
  },
  set(code, id, status) { local.set(ckKey(code), (local.get(ckKey(code)) || []).map((c) => (c.id === id ? { ...c, status } : c))); },
};

let schedTimer;
export function startScheduler(code, onDue, onChange) {
  clearInterval(schedTimer);
  const tick = () => {
    for (const c of checkins.list(code)) if (new Date(c.at) <= new Date()) { checkins.set(code, c.id, 'done'); onDue(c); onChange?.(); }
  };
  tick(); schedTimer = setInterval(tick, 10000);
}

function renderCheckins(el, ctx) {
  if (!el) return;
  const list = checkins.list(ctx.code);
  el.innerHTML = list.length ? `<h3 style="margin-top:14px">🗓️ Scheduled check-ins</h3>${list.map((c) => `
    <div class="row" style="padding:6px 0;border-bottom:1px dashed var(--line)">
      <span><b>${esc(c.student)}</b> · ${whenLabel(new Date(c.at))}<br><span class="muted" style="font-size:.9rem">${esc(c.reason)}</span></span>
      <span class="spacer"></span><button class="btn ghost small" data-cancel="${c.id}">Cancel</button></div>`).join('')}` : '';
  el.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => { checkins.set(ctx.code, b.dataset.cancel, 'cancelled'); renderCheckins(el, ctx); }));
}

function approveCheckin(ctx, p, el) {
  try { const at = checkins.add(ctx.code, p); ctx.toast(`Check-in scheduled for ${p.student} · ${whenLabel(at)}`); renderCheckins(el, ctx); return true; }
  catch (e) { ctx.toast(e.message); return false; }
}

// ============================================================ Suggestions (Live tab)
const sugg = { code: null, items: null, loading: false, error: null, dismissed: new Set(), timer: null };

export function renderSuggestions(el, ctx, { refresh = false } = {}) {
  if (!el) return;
  if (sugg.code !== ctx.code) Object.assign(sugg, { code: ctx.code, items: null, error: null, dismissed: new Set() });
  if ((refresh || (!sugg.items && !sugg.error)) && !sugg.loading) load(el, ctx);
  draw(el, ctx);
}

export function scheduleSuggestionRefresh(getEl, ctx) {
  if (['no_key', 'rate_limit'].includes(sugg.error?.code)) return; // don't burn quota retrying // no API key: don't keep retrying
  clearTimeout(sugg.timer);
  sugg.timer = setTimeout(() => { const el = getEl(); if (el) renderSuggestions(el, ctx, { refresh: true }); }, 8000);
}

async function load(el, ctx) {
  if (!ctx.breaks.size) { sugg.items = []; return; }
  sugg.loading = true; sugg.error = null; draw(el, ctx);
  try { sugg.items = (await callAgent(payload(ctx, { mode: 'suggest' }))).suggestions || []; }
  catch (e) { sugg.error = e; }
  sugg.loading = false;
  if (el.isConnected) draw(el, ctx);
}

function draw(el, ctx) {
  const items = (sugg.items || []).filter((s, i) => !sugg.dismissed.has(`${s.student_id}|${s.title}|${i}`));
  el.innerHTML = `
    <div class="row"><h3 style="margin:0">🤖 Agent suggestions</h3><span class="spacer"></span>
      <button class="btn ghost small" data-refresh ${sugg.loading ? 'disabled' : ''}>${sugg.loading ? 'Analyzing…' : '↻ Refresh'}</button></div>
    <div style="margin-top:10px">
      ${sugg.loading && !sugg.items ? '<p class="muted">Reviewing this class’s break patterns…</p>' : ''}
      ${sugg.error ? `<p class="muted">${sugg.error.code === 'no_key' ? 'Add <code>GEMINI_API_KEY</code> (free) or <code>ANTHROPIC_API_KEY</code> to .env to enable the AI agent.' : esc(sugg.error.message)}</p>` : ''}
      ${sugg.items && !items.length && !sugg.loading ? '<p class="muted">No suggestions right now.</p>' : ''}
      ${(sugg.items || []).map((s, i) => sugg.dismissed.has(`${s.student_id}|${s.title}|${i}`) ? '' : `
        <div style="padding:10px 0;border-bottom:1px dashed var(--line)">
          <div><span class="pill">${esc(s.student)}</span> <b>${esc(s.title)}</b></div>
          <div style="margin:6px 0">${esc(s.detail)}</div>
          <div class="row">
            ${s.checkin?.date && s.checkin?.time ? `<button class="btn small" data-approve="${i}">✓ Schedule check-in ${esc(s.checkin.time)} ${esc(s.checkin.date)}</button>` : ''}
            <button class="btn ghost small" data-ask="${i}">Ask the agent</button>
            <button class="btn ghost small" data-dismiss="${i}">Dismiss</button></div>
        </div>`).join('')}
      <div data-checkins></div>
    </div>`;
  const ckEl = el.querySelector('[data-checkins]');
  renderCheckins(ckEl, ctx);
  el.querySelector('[data-refresh]').onclick = () => renderSuggestions(el, ctx, { refresh: true });
  const key = (i) => `${sugg.items[i].student_id}|${sugg.items[i].title}|${i}`;
  el.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => { sugg.dismissed.add(key(+b.dataset.dismiss)); draw(el, ctx); }));
  el.querySelectorAll('[data-approve]').forEach((b) => (b.onclick = () => {
    const s = sugg.items[+b.dataset.approve];
    if (approveCheckin(ctx, { ...s.checkin, student_id: s.student_id, student: s.student, reason: s.title }, ckEl)) { sugg.dismissed.add(key(+b.dataset.approve)); draw(el, ctx); }
  }));
  el.querySelectorAll('[data-ask]').forEach((b) => (b.onclick = () => {
    const s = sugg.items[+b.dataset.ask]; ctx.openAssistant(`Tell me more about this for ${s.student}: ${s.title}`);
  }));
}

// ============================================================ Chat (Assistant tab)
const chat = { code: null, messages: [], busy: false };

export function renderAssistant(main, ctx, prefill) {
  if (chat.code !== ctx.code) Object.assign(chat, { code: ctx.code, messages: [] });
  main.innerHTML = `
    <div class="card stack" style="max-width:860px;margin:0 auto">
      <div><h2 style="margin:0">🤖 Insights Agent</h2>
        <p class="muted" style="margin:4px 0 0">Ask about your class. The agent looks through break data with its tools before answering, and suggests check-ins for you to approve.
        It sees first names and break data only.</p></div>
      <div id="log" class="stack" style="max-height:52vh;overflow:auto;padding-right:4px"></div>
      <div class="row" id="chips">${CHIPS.map((c) => `<button class="btn ghost small" data-chip>${esc(c)}</button>`).join('')}</div>
      <div class="row"><input id="q" placeholder="e.g. Why has Maya needed more breaks this week?" style="flex:1" autocomplete="off" />
        <button class="btn" id="send">Ask</button></div>
    </div>`;
  const log = main.querySelector('#log'); const q = main.querySelector('#q');
  const draw = () => {
    log.innerHTML = chat.messages.length ? chat.messages.map((m, i) => m.role === 'user'
      ? `<div style="align-self:flex-end;background:var(--accent-soft);padding:10px 14px;border-radius:14px;max-width:80%;margin-left:auto">${esc(m.content)}</div>`
      : `<div style="background:#fff;border:1px solid var(--line);padding:12px 16px;border-radius:14px">
          ${m.steps?.length ? `<div style="margin-bottom:6px">${stepChips(m.steps)}</div>` : ''}
          ${m.error ? `<p class="muted">${esc(m.content)}</p>` : md(m.content)}
          ${(m.proposals || []).map((p, j) => `<div class="row" style="margin-top:8px;padding:10px;border-radius:12px;background:var(--bg)">
              <span>🗓️ <b>${esc(p.student)}</b> · ${esc(p.date)} ${esc(p.time)}<br><span class="muted" style="font-size:.9rem">${esc(p.reason)}</span></span>
              <span class="spacer"></span>${p.done ? `<span class="pill">${p.done}</span>`
                : `<button class="btn small" data-ok="${i}:${j}">Approve</button><button class="btn ghost small" data-no="${i}:${j}">Dismiss</button>`}</div>`).join('')}
        </div>`).join('') : '<p class="muted center">Pick a question below or type your own.</p>';
    if (chat.busy) log.insertAdjacentHTML('beforeend', '<div class="muted">🤖 Analyzing break data…</div>');
    log.scrollTop = log.scrollHeight;
    log.querySelectorAll('[data-ok],[data-no]').forEach((b) => (b.onclick = () => {
      const [i, j] = (b.dataset.ok || b.dataset.no).split(':').map(Number); const p = chat.messages[i].proposals[j];
      if (b.dataset.ok) { if (approveCheckin(ctx, p)) p.done = 'Scheduled ✓'; } else p.done = 'Dismissed';
      draw();
    }));
  };
  const send = async (text) => {
    text = (text ?? q.value).trim(); if (!text || chat.busy) return;
    q.value = ''; chat.messages.push({ role: 'user', content: text }); chat.busy = true; draw();
    try {
      const out = await callAgent(payload(ctx, { mode: 'chat', messages: chat.messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }));
      chat.messages.push({ role: 'assistant', content: out.reply || '(no answer)', steps: out.steps, proposals: out.proposals });
    } catch (e) {
      chat.messages.push({ role: 'assistant', error: true, content: e.code === 'no_key' ? 'The AI agent is not set up yet: add GEMINI_API_KEY (free, from aistudio.google.com) to .env and to Vercel.' : e.message });
    }
    chat.busy = false; if (main.isConnected) draw();
  };
  main.querySelector('#send').onclick = () => send();
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  main.querySelectorAll('[data-chip]').forEach((b) => (b.onclick = () => send(b.textContent)));
  draw();
  if (prefill) send(prefill); else q.focus();
}