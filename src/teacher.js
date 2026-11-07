import { db, MODE, local } from './db.js';
import { EMOTIONS, SIZES, AFTER, ACTIVITIES } from './content.js';
import { renderReport } from './charts.js';
import { buildDemo } from './demo.js';

const app = document.getElementById('app');
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3500); };
const time = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

let cls = null;
let students = new Map();
let breaks = new Map();
let online = new Set();
let subs = [];
let tab = 'live';
let reportStudent = 'all';
let feed = [];
const seen = new Map(); // break id -> last known row (for feed diffs)

const STEP_LABEL = {
  started: 'starting', emotion: 'picking a feeling', reason: 'picking why', size: 'feeling size',
  calming: 'calming down', done: 'finished', after: 'checking in',
};

// ============================================================ Setup
function renderSetup() {
  app.innerHTML = `
    <main class="wrap stack" style="max-width:560px;padding-top:7vh">
      <div class="center"><div style="font-size:3rem">🧑‍🏫</div><h1>Instructor portal</h1>
        <p class="muted">${MODE === 'local' ? 'Local demo mode (no Supabase keys set).' : 'Connected to Supabase.'}</p></div>
      <div class="card stack">
        <h3>Create a class</h3>
        <input id="tname" placeholder="Your name, e.g. Ms. Rivera" />
        <button class="btn" id="create">Create class</button>
      </div>
      <div class="card stack">
        <h3>Open an existing class</h3>
        <input id="code" placeholder="Class code" style="text-transform:uppercase;letter-spacing:.15em" />
        <button class="btn ghost" id="open">Open</button>
      </div>
      <div class="card stack">
        <h3>Demo</h3>
        <p class="muted" style="margin:0">Creates a class with 3 sample students and 4 weeks of break history so the reports have data.</p>
        <button class="btn ghost" id="demo">Create demo class</button>
      </div>
    </main>`;
  const $ = (s) => app.querySelector(s);
  $('#create').onclick = async () => {
    const n = $('#tname').value.trim(); if (!n) return $('#tname').focus();
    try { start(await db.createClass(n)); } catch (e) { toast(e.message); }
  };
  $('#open').onclick = async () => {
    const c = await db.getClass($('#code').value.trim().toUpperCase());
    c ? start(c) : toast('Class not found');
  };
  $('#demo').onclick = async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Building demo…';
    try { start(await buildDemo(db)); } catch (e) { toast(e.message); ev.target.disabled = false; }
  };
}

// ============================================================ Dashboard
async function start(c) {
  cls = c; local.set('cc_class', { code: c.code });
  students = new Map((await db.listStudents(c.code)).map((s) => [s.id, s]));
  breaks = new Map((await db.listBreaks({ classCode: c.code })).map((b) => [b.id, b]));
  breaks.forEach((b) => seen.set(b.id, b));
  feed = [];
  subs.forEach((u) => u());
  subs = [
    db.subscribeClass(c.code, {
      onStudent: (s) => { students.set(s.id, { ...students.get(s.id), ...s }); refresh(); },
      onBreak: (b) => { const merged = { ...breaks.get(b.id), ...b }; breaks.set(b.id, merged); logBreak(merged); refresh(); },
    }),
    db.watchPresence(c.code, (set) => { online = set; refreshCards(); }),
  ];
  renderShell();
}

function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <span class="brand">🧭 Calm Compass</span>
      <div class="tabs" style="margin-left:12px">
        <button data-tab="live" class="${tab === 'live' ? 'active' : ''}">Live class</button>
        <button data-tab="reports" class="${tab === 'reports' ? 'active' : ''}">Reports</button>
      </div>
      <span class="spacer"></span>
      ${MODE === 'local' ? '<span class="pill gray">local demo</span>' : ''}
      <span class="pill">Class ${esc(cls.code)}</span>
      <span class="muted">${esc(cls.teacher_name)}</span>
      <button class="btn ghost small" id="switch">Switch</button>
    </header>
    <main class="wrap stack" id="main" style="max-width:1200px"></main>`;
  app.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderShell(); }));
  app.querySelector('#switch').onclick = () => { subs.forEach((u) => u()); subs = []; local.del('cc_class'); renderSetup(); };
  tab === 'live' ? renderLive() : renderReports();
}

function renderLive() {
  const main = app.querySelector('#main');
  main.innerHTML = `
    <div class="card row">
      <div><div class="muted">Students join at <b>${location.origin}/kid</b> with code</div>
        <div style="font-size:2.2rem;font-weight:800;letter-spacing:.2em">${esc(cls.code)}</div></div>
      <span class="spacer"></span>
      <div class="muted" id="summary"></div>
    </div>
    <div class="grid students" id="cards"></div>
    <div class="card"><h3>Live activity</h3><div class="feed" id="feed"></div></div>`;
  refreshCards(); refreshFeed();
}

function currentBreak(s) { return s.current_break ? breaks.get(s.current_break) : null; }

function cardHtml(s) {
  const b = currentBreak(s);
  const onBreak = s.status === 'break';
  const e = b?.emotion && EMOTIONS[b.emotion];
  const r = e && b.reason && e.reasons[b.reason];
  const size = b?.size && SIZES.find((x) => x.key === b.size);
  const after = b?.after && AFTER.find((x) => x.key === b.after);
  const today = [...breaks.values()].filter((x) => x.student_id === s.id && new Date(x.started_at).toDateString() === new Date().toDateString());
  return `
    <div class="card student-card ${onBreak ? 'onbreak' : ''}" data-id="${s.id}">
      <div class="row"><span class="dot ${online.has(s.id) ? 'on' : ''}" title="${online.has(s.id) ? 'online' : 'offline'}"></span>
        <b style="font-size:1.15rem">${esc(s.name)}</b><span class="spacer"></span>
        ${onBreak ? `<span class="pill warn">${b?.initiated_by === 'student' ? '🙋' : '🔒'} On break · ${STEP_LABEL[b?.step] || '…'}</span>` : '<span class="pill">📚 Learning</span>'}</div>
      ${s.school ? `<div class="muted" style="margin-top:-6px">${esc(s.school)}</div>` : ''}
      ${onBreak ? `<div style="min-height:48px">
          ${e ? `<div>${e.icon} <b>${e.label}</b>${r ? ` · ${r.label}` : ''}</div>` : '<div class="muted">Waiting for check-in…</div>'}
          ${size ? `<div class="muted">Feeling size: ${size.label}${b.activity ? ` · ${ACTIVITIES[b.activity].label}` : ''}</div>` : ''}
          ${after ? `<div>After: ${after.icon} ${after.label}</div>` : ''}</div>`
        : `<div class="muted" style="min-height:48px">Breaks today: ${today.length}</div>`}
      <div class="stack" style="--gap:8px">
        <select data-act style="padding:.55rem">
          <option value="">Student chooses calming</option>
          ${Object.entries(ACTIVITIES).map(([k, a]) => `<option value="${k}" ${s.activity === k ? 'selected' : ''}>${a.icon} ${a.label}</option>`).join('')}
        </select>
        ${onBreak ? '<button class="btn ok" data-resume style="width:100%">▶ Resume class</button>' : '<button class="btn warn" data-start style="width:100%">🔒 Start break</button>'}
      </div>
    </div>`;
}

function refreshCards() {
  const el = app.querySelector('#cards'); if (!el) return;
  const list = [...students.values()];
  el.innerHTML = list.length ? list.map(cardHtml).join('')
    : '<div class="card muted">No students yet. Have them open the student page and enter the class code.</div>';
  const onB = list.filter((s) => s.status === 'break').length;
  const sum = app.querySelector('#summary');
  if (sum) sum.innerHTML = `${list.filter((s) => online.has(s.id)).length} online · ${onB} on break`;
  el.querySelectorAll('.student-card').forEach((card) => {
    const s = students.get(card.dataset.id);
    const sel = card.querySelector('[data-act]');
    card.querySelector('[data-start]')?.addEventListener('click', () => startBreak(s, sel.value));
    card.querySelector('[data-resume]')?.addEventListener('click', () => resume(s));
    sel.onchange = () => { if (s.status === 'break') db.updateStudent(s.id, { activity: sel.value || null }); };
  });
}

async function startBreak(s, activity) {
  try {
    const b = await db.createBreak({ student_id: s.id, class_code: cls.code, initiated_by: 'instructor' });
    breaks.set(b.id, b);
    await db.updateStudent(s.id, { status: 'break', current_break: b.id, activity: activity || null });
  } catch (e) { toast('Could not start break: ' + e.message); }
}

async function resume(s) {
  try {
    const b = currentBreak(s);
    if (b && !b.ended_at) await db.updateBreak(b.id, { ended_at: new Date().toISOString() });
    await db.updateStudent(s.id, { status: 'learning', current_break: null, activity: null });
  } catch (e) { toast('Could not resume: ' + e.message); }
}

// Feed: describe what changed on a break row
function logBreak(b) {
  const prev = seen.get(b.id) || {};
  seen.set(b.id, b);
  const name = esc(students.get(b.student_id)?.name || 'Student');
  const e = EMOTIONS[b.emotion];
  const add = (msg) => feed.unshift(`<b>${time(new Date().toISOString())}</b> · ${name} ${msg}`);
  if (!prev.id) add(b.initiated_by === 'instructor' ? '🔒 break started by instructor' : '🙋 asked for a break');
  if (b.emotion && b.emotion !== prev.emotion) add(`feels ${e.icon} <b>${e.label}</b>`);
  if (b.reason && b.reason !== prev.reason) add(`because: ${e?.reasons[b.reason]?.label}`);
  if (b.size && b.size !== prev.size) add(`feeling size: ${SIZES.find((x) => x.key === b.size)?.label}`);
  if (b.activity && b.activity !== prev.activity) add(`is doing ${ACTIVITIES[b.activity].icon} ${ACTIVITIES[b.activity].label}`);
  if (b.after && b.after !== prev.after) { const a = AFTER.find((x) => x.key === b.after); add(`feels ${a.icon} <b>${a.label}</b> after the break. Report saved.`); }
  feed = feed.slice(0, 60);
}

function refreshFeed() {
  const el = app.querySelector('#feed'); if (!el) return;
  el.innerHTML = feed.length ? feed.map((f) => `<div>${f}</div>`).join('') : '<div class="muted">Break check-ins will show up here live.</div>';
}

let rTimer;
function refresh() {
  if (tab === 'live') { refreshCards(); refreshFeed(); }
  else { clearTimeout(rTimer); rTimer = setTimeout(drawReport, 400); }
}

// ============================================================ Reports
function renderReports() {
  const main = app.querySelector('#main');
  main.innerHTML = `
    <div class="row">
      <h2 style="margin:0">Reports</h2><span class="spacer"></span>
      <select id="who" style="width:auto">
        <option value="all">All students</option>
        ${[...students.values()].map((s) => `<option value="${s.id}" ${reportStudent === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>
    <div id="report"></div>`;
  main.querySelector('#who').onchange = (e) => { reportStudent = e.target.value; drawReport(); };
  drawReport();
}

function drawReport() {
  const el = app.querySelector('#report'); if (!el) return;
  const list = [...breaks.values()].filter((b) => reportStudent === 'all' || b.student_id === reportStudent)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  renderReport(el, list, { audience: 'teacher', studentsById: reportStudent === 'all' ? Object.fromEntries(students) : {} });
}

// ============================================================ Boot
(async function boot() {
  const saved = local.get('cc_class');
  const c = saved?.code && (await db.getClass(saved.code).catch(() => null));
  c ? start(c) : renderSetup();
})();
