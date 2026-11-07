import { db, MODE, local } from './db.js';
import { EMOTIONS, SIZES, AFTER, ACTIVITIES, pair } from './content.js';
import { startAmbientAudio, runBreathing } from './calm.js';
import { renderReport } from './charts.js';

const app = document.getElementById('app');
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 3500); };

let student = null;
let cls = null;
let subs = [];
let brk = null;       // the break currently on screen
let overlay = null;
let calm = { audio: null, breathing: null };

// ============================================================ Onboarding questionnaire
const ob = { name: '', emotions: [], reasons: {}, idx: 0 };

function shell(inner, step, total) {
  app.innerHTML = `
    <main class="wrap stack" style="max-width:820px;padding-top:5vh">
      ${step ? `<div class="progress"><div style="width:${(100 * step) / total}%"></div></div>` : ''}
      ${inner}
    </main>`;
}

function renderName() {
  shell(`
    <div class="card stack center">
      <div style="font-size:3rem">👋</div>
      <h1>What's your name?</h1>
      <input id="name" placeholder="Type your name" value="${esc(ob.name)}" autocomplete="off" style="max-width:380px;margin:16px auto 0;display:block;text-align:center;font-size:1.3rem" />
      <button class="btn" id="next">Next →</button>
    </div>`, 1, 7);
  const input = app.querySelector('#name');
  input.focus();
  const go = () => { ob.name = input.value.trim(); if (ob.name) renderEmotions(); else input.focus(); };
  app.querySelector('#next').onclick = go;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

function renderEmotions() {
  shell(`
    <div class="stack">
      <div class="center">
        <h1>Hi ${esc(ob.name)}, just a few questions left. Hang tight!</h1>
        <p class="muted" style="font-size:1.15rem">Which feelings do you have the most? Tap <b>up to 4</b>.</p>
      </div>
      <div class="choices">
        ${Object.entries(EMOTIONS).map(([k, e]) => `
          <button class="tile ${ob.emotions.includes(k) ? 'selected' : ''}" data-k="${k}" aria-pressed="${ob.emotions.includes(k)}">
            <span class="emoji">${e.icon}</span>${e.label}</button>`).join('')}
      </div>
      <div class="row"><button class="btn ghost" id="back">← Back</button><span class="spacer"></span>
        <span class="muted" id="count">${ob.emotions.length} / 4</span>
        <button class="btn" id="next" ${ob.emotions.length ? '' : 'disabled'}>Next →</button></div>
    </div>`, 2, 7);
  app.querySelectorAll('.tile').forEach((t) => (t.onclick = () => {
    const k = t.dataset.k;
    if (ob.emotions.includes(k)) ob.emotions = ob.emotions.filter((x) => x !== k);
    else if (ob.emotions.length < 4) ob.emotions.push(k);
    else return toast('You can pick up to 4. Tap one to unpick it.');
    renderEmotions();
  }));
  app.querySelector('#back').onclick = renderName;
  app.querySelector('#next').onclick = () => { ob.idx = 0; renderReasons(); };
}

function renderReasons() {
  const k = ob.emotions[ob.idx];
  const e = EMOTIONS[k];
  const picked = ob.reasons[k] || [];
  shell(`
    <div class="stack">
      <div class="center">
        <div style="font-size:3rem">${e.icon}</div>
        <h1>What makes you feel ${e.label.toLowerCase()}?</h1>
        <p class="muted" style="font-size:1.15rem">Tap <b>up to 4</b> that happen to you the most.</p>
      </div>
      <div class="choices">
        ${Object.entries(e.reasons).map(([rk, r]) => `
          <button class="tile small ${picked.includes(rk) ? 'selected' : ''}" data-k="${rk}" aria-pressed="${picked.includes(rk)}">
            <span class="emoji">${r.icon}</span>${r.label}</button>`).join('')}
      </div>
      <div class="row"><button class="btn ghost" id="back">← Back</button><span class="spacer"></span>
        <span class="muted">${picked.length} / 4</span>
        <button class="btn" id="next" ${picked.length ? '' : 'disabled'}>Next →</button></div>
    </div>`, 3 + (ob.idx * 3) / ob.emotions.length, 7);
  app.querySelectorAll('.tile').forEach((t) => (t.onclick = () => {
    const rk = t.dataset.k; const cur = ob.reasons[k] || [];
    if (cur.includes(rk)) ob.reasons[k] = cur.filter((x) => x !== rk);
    else if (cur.length < 4) ob.reasons[k] = [...cur, rk];
    else return toast('You can pick up to 4. Tap one to unpick it.');
    renderReasons();
  }));
  app.querySelector('#back').onclick = () => (ob.idx ? (ob.idx--, renderReasons()) : renderEmotions());
  app.querySelector('#next').onclick = () => (ob.idx < ob.emotions.length - 1 ? (ob.idx++, renderReasons()) : renderSettings());
}

function renderSettings() {
  shell(`
    <div class="card stack" style="max-width:520px;margin:0 auto">
      <div class="center"><div style="font-size:3rem">🏫</div><h1>Last step!</h1>
        <p class="muted">A grown-up can help with this part.</p></div>
      <label>School name<input id="school" placeholder="e.g. Sutter Middle School" /></label>
      <label>Class code (from your teacher)<input id="code" placeholder="e.g. K7Q2M" style="text-transform:uppercase;letter-spacing:.15em" /></label>
      <p id="err" class="hidden" style="color:#b35c3a"></p>
      <div class="row"><button class="btn ghost" id="back">← Back</button><span class="spacer"></span><button class="btn" id="finish">Finish</button></div>
    </div>`, 6, 7);
  const err = app.querySelector('#err');
  app.querySelector('#back').onclick = () => { ob.idx = ob.emotions.length - 1; renderReasons(); };
  app.querySelector('#finish').onclick = async (ev) => {
    const code = app.querySelector('#code').value.trim().toUpperCase();
    const school = app.querySelector('#school').value.trim();
    if (!code) { err.textContent = 'Please type the class code.'; err.classList.remove('hidden'); return; }
    ev.target.disabled = true;
    try {
      cls = await db.getClass(code);
      if (!cls) throw new Error('We could not find that class code. Check with your teacher.');
      student = await db.createStudent({
        class_code: code, name: ob.name, school,
        profile: { emotions: ob.emotions.map((k) => ({ key: k, reasons: ob.reasons[k] })) },
      });
      local.set('cc_student', { id: student.id });
      connect();
      renderDone();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); ev.target.disabled = false; }
  };
}

function renderDone() {
  shell(`
    <div class="stack">
      <div class="center"><div style="font-size:3rem">🎉</div>
        <h1>That's great, ${esc(student.name)}!</h1>
        <p class="muted" style="font-size:1.15rem">Here is your very own calm-down app, made from your answers.</p></div>
      <div class="charts">
        ${student.profile.emotions.map(({ key, reasons }) => { const e = EMOTIONS[key]; return `
          <div class="card" style="background:${e.soft};border-color:${e.soft}">
            <h3>${e.icon} ${e.label}</h3>
            ${reasons.map((r) => `<div style="padding:4px 0">${e.reasons[r].icon} ${e.reasons[r].label}</div>`).join('')}
          </div>`; }).join('')}
      </div>
      <div class="center"><button class="btn" id="go">Let's go →</button></div>
    </div>`, 7, 7);
  app.querySelector('#go').onclick = renderHome;
}

// ============================================================ Home
async function renderHome() {
  if (brk) return; // break overlay is on top; home refreshes after
  app.innerHTML = `
    <header class="topbar">
      <span class="brand">🧭 Calm Compass</span><span class="spacer"></span>
      <span class="pill gray">Class ${esc(student.class_code)}</span>
      ${MODE === 'local' ? '<span class="pill gray">local demo</span>' : ''}
    </header>
    <main class="wrap stack">
      <div class="card center stack" style="padding:36px">
        <h1>Hi ${esc(student.name)}! 📚</h1>
        <p class="muted" style="font-size:1.15rem">It's learning time. If your feelings get big, you can take a break anytime.</p>
        <button class="btn" id="brk" style="font-size:1.3rem;padding:1.1rem 2.2rem">🙋 I need a break</button>
      </div>
      <h2>My feelings</h2>
      <div id="report"></div>
      <p class="center"><button class="btn ghost small" id="switch">Not ${esc(student.name)}? Switch student</button></p>
    </main>`;
  app.querySelector('#brk').onclick = requestBreak;
  app.querySelector('#switch').onclick = () => {
    if (!confirm('Switch student on this device?')) return;
    local.del('cc_student'); subs.forEach((u) => u()); subs = []; student = null; Object.assign(ob, { name: '', emotions: [], reasons: {}, idx: 0 }); renderName();
  };
  try { renderReport(app.querySelector('#report'), await db.listBreaks({ studentId: student.id }), { audience: 'kid' }); }
  catch (e) { console.error(e); }
}

// ============================================================ Realtime
function connect() {
  subs.forEach((u) => u());
  subs = [
    db.announce(student.class_code, student.id),
    db.subscribeStudent(student.id, onStudentChange),
  ];
}

async function onStudentChange(row) {
  if (!row) return;
  student = { ...student, ...row };
  if (row.status === 'break' && row.current_break && brk?.id !== row.current_break) {
    const all = await db.listBreaks({ studentId: student.id });
    openBreak(all.find((b) => b.id === row.current_break) || { id: row.current_break, initiated_by: 'instructor' });
  } else if (row.status === 'learning' && brk) {
    closeBreak();
    toast('Welcome back to class 💙');
  }
}

async function requestBreak() {
  try {
    const b = await db.createBreak({ student_id: student.id, class_code: student.class_code, initiated_by: 'student' });
    openBreak(b);
    await db.updateStudent(student.id, { status: 'break', current_break: b.id, activity: null });
  } catch (e) { toast('Could not start a break: ' + e.message); }
}

// ============================================================ Break flow (lock screen)
function openBreak(b) {
  brk = { ...b };
  overlay?.remove();
  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  document.body.append(overlay);
  document.body.style.overflow = 'hidden';
  stepStart();
}

function closeBreak() {
  stopCalm();
  overlay?.remove(); overlay = null; brk = null;
  document.body.style.overflow = '';
  renderHome();
}

function stopCalm() {
  calm.audio?.stop(); calm.breathing?.stop();
  calm = { audio: null, breathing: null };
}

const save = (patch) => db.updateBreak(brk.id, patch).catch((e) => console.error(e));

function frame(inner, { color } = {}) {
  overlay.style.background = color || 'var(--bg)';
  overlay.innerHTML = `
    <div class="inner stack">
      <div class="row"><span class="lock-badge">${brk.initiated_by === 'instructor' ? '🔒 Break time' : '🌿 Your break'}</span></div>
      ${inner}
    </div>`;
}

const tiles = (items, cls = '') => `<div class="choices ${cls}">${items.map((i) =>
  `<button class="tile" data-k="${i.key}"><span class="emoji">${i.icon}</span>${esc(i.label)}</button>`).join('')}</div>`;
const onTile = (fn) => overlay.querySelectorAll('.tile').forEach((t) => (t.onclick = () => fn(t.dataset.k)));

function stepStart() {
  const byTeacher = brk.initiated_by === 'instructor';
  frame(`
    <div class="card center stack" style="padding:40px">
      <div style="font-size:3.5rem">💙</div>
      <h1>${byTeacher ? `Let's take a calm break, ${esc(student.name)}.` : `Great job asking for a break, ${esc(student.name)}!`}</h1>
      <p class="muted" style="font-size:1.15rem">${byTeacher ? 'You are not in trouble. ' : ''}Let's check in with your feelings.</p>
      <button class="btn" id="ok" style="font-size:1.2rem">Okay</button>
    </div>`);
  overlay.querySelector('#ok').onclick = stepEmotion;
}

function stepEmotion() {
  save({ step: 'emotion' });
  frame(`
    <h1 class="center">How are you feeling, ${esc(student.name)}?</h1>
    ${tiles(student.profile.emotions.map(({ key }) => ({ key, ...EMOTIONS[key] })), 'two')}`);
  onTile((k) => { brk.emotion = k; save({ emotion: k, step: 'reason' }); stepReason(); });
}

function stepReason() {
  const e = EMOTIONS[brk.emotion];
  const mine = student.profile.emotions.find((x) => x.key === brk.emotion).reasons;
  frame(`
    <h1 class="center">Why are you feeling ${e.label.toLowerCase()}, ${esc(student.name)}?</h1>
    ${tiles(mine.map((rk) => ({ key: rk, ...e.reasons[rk] })), 'two')}`, { color: e.soft });
  onTile((k) => { brk.reason = k; save({ reason: k, step: 'size' }); stepSize(); });
}

function stepSize() {
  const e = EMOTIONS[brk.emotion];
  frame(`<h1 class="center">How big is the feeling?</h1>${tiles(SIZES.map((s) => ({ ...s, key: String(s.key) })))}`, { color: e.soft });
  onTile((k) => { brk.size = +k; save({ size: +k, step: 'calming' }); stepCalming(); });
}

function stepCalming() {
  const pick = student.activity; // instructor may have chosen one
  if (pick) return runCalming(pick);
  const e = EMOTIONS[brk.emotion];
  frame(`<h1 class="center">What would help you feel calm?</h1>
    ${tiles(Object.entries(ACTIVITIES).map(([key, a]) => ({ key, ...a })), 'two')}`, { color: e.soft });
  onTile(runCalming);
}

function runCalming(activity) {
  brk.activity = activity;
  save({ activity, step: 'calming' });
  const { emotion: e, reason: r } = pair(brk.emotion, brk.reason);
  frame(`
    <div class="affirm" style="background:#fff;border-left:8px solid ${e.color}">
      ${e.icon} ${r.affirm}
      <div class="tip">💡 ${r.tip}</div>
    </div>
    <div class="card center">
      <p class="muted" style="margin:0">${activity === 'audio' ? '🎧 Listen to the calm sounds and watch the circle.' : '🫧 Breathe with the circle.'}</p>
      <div id="calm"></div>
      <button class="btn ghost small" id="done">I'm done</button>
    </div>`, { color: e.soft });
  stopCalm();
  if (activity === 'audio') calm.audio = startAmbientAudio();
  calm.breathing = runBreathing(overlay.querySelector('#calm'), e.color, { label: activity === 'breathe' });
  // Only this calming session may advance this break (guards against stale timers).
  const session = calm.breathing; const breakId = brk.id; let finished = false;
  const finish = () => {
    if (finished || !brk || brk.id !== breakId || calm.breathing !== session) return;
    finished = true; stopCalm(); stepAfter();
  };
  overlay.querySelector('#done').onclick = finish;
  session.done.then(() => setTimeout(finish, 1500));
}

function stepAfter() {
  const e = EMOTIONS[brk.emotion];
  frame(`<h1 class="center">How do you feel now, ${esc(student.name)}?</h1>${tiles(AFTER)}`, { color: e.soft });
  onTile(async (k) => {
    brk.after = k;
    await save({ after: k, step: 'done', ended_at: new Date().toISOString() });
    stepDone();
  });
}

function stepDone() {
  const { emotion: e, reason: r } = pair(brk.emotion, brk.reason);
  const self = brk.initiated_by === 'student';
  const msg = {
    better: 'You did it! Taking a break helped your body feel calmer.',
    same: 'That\'s okay. Feelings can take time. You can take another break if you need it.',
    worse: 'Thank you for telling us. Your teacher will check in with you.',
  }[brk.after];
  frame(`
    <div class="card center stack" style="padding:36px">
      <div style="font-size:3.5rem">🌟</div>
      <h1>Great job, ${esc(student.name)}!</h1>
      <p style="font-size:1.15rem">${msg}</p>
      <div class="affirm" style="background:#fff;border-left:8px solid ${e.color};text-align:left">${e.icon} ${r.affirm}</div>
      ${self ? '<button class="btn" id="back" style="font-size:1.1rem">Go back to class</button>'
             : '<p class="muted">🔒 Your teacher will start class again soon.</p>'}
    </div>`, { color: e.soft });
  overlay.querySelector('#back')?.addEventListener('click', async () => {
    await db.updateStudent(student.id, { status: 'learning', current_break: null, activity: null });
    closeBreak();
  });
}

// ============================================================ Boot
(async function boot() {
  const me = local.get('cc_student');
  if (!me?.id) return renderName();
  try {
    student = await db.getStudent(me.id);
    if (!student) { local.del('cc_student'); return renderName(); }
    connect();
    await renderHome();
    if (student.status === 'break' && student.current_break) {
      const all = await db.listBreaks({ studentId: student.id });
      const b = all.find((x) => x.id === student.current_break);
      if (b) openBreak(b);
    }
  } catch (e) {
    app.innerHTML = `<main class="wrap"><div class="card">Could not connect: ${esc(e.message)}</div></main>`;
  }
})();