// Reports + trend charts shared by instructor and student views.
import { Chart, registerables } from 'chart.js';
import { EMOTIONS, SIZES, AFTER, ACTIVITIES } from './content.js';

Chart.register(...registerables);
Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
Chart.defaults.color = '#6b7a80';

const live = new Map(); // container -> charts, so re-renders don't leak canvases

export function summarize(breaks) {
  const done = breaks.filter((b) => b.emotion);
  const count = (f) => done.reduce((m, b) => { const k = f(b); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const withAfter = done.filter((b) => b.after);
  const durations = breaks.filter((b) => b.ended_at).map((b) => (new Date(b.ended_at) - new Date(b.started_at)) / 1000);
  return {
    total: breaks.length,
    byInstructor: breaks.filter((b) => b.initiated_by === 'instructor').length,
    bySelf: breaks.filter((b) => b.initiated_by === 'student').length,
    emotions: count((b) => b.emotion),
    pairs: count((b) => b.reason && `${b.emotion}|${b.reason}`),
    after: count((b) => b.after),
    betterPct: withAfter.length ? Math.round((100 * withAfter.filter((b) => b.after === 'better').length) / withAfter.length) : null,
    avgSize: done.filter((b) => b.size).length
      ? (done.reduce((s, b) => s + (b.size || 0), 0) / done.filter((b) => b.size).length).toFixed(1) : null,
    avgMinutes: durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length / 60).toFixed(1) : null,
  };
}

const dayKey = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function byDay(breaks) {
  const days = new Map();
  for (const b of breaks) {
    const k = dayKey(b.started_at);
    if (!days.has(k)) days.set(k, { instructor: 0, student: 0, sizes: [] });
    const d = days.get(k);
    d[b.initiated_by === 'instructor' ? 'instructor' : 'student']++;
    if (b.size) d.sizes.push(b.size);
  }
  return days;
}

// audience: 'teacher' | 'kid'
export function renderReport(container, breaks, { audience = 'teacher', studentsById = {}, showTable = true } = {}) {
  (live.get(container) || []).forEach((c) => c.destroy());
  const s = summarize(breaks);
  const kid = audience === 'kid';

  if (!breaks.length) {
    container.innerHTML = `<div class="card center muted">${kid ? 'No breaks yet. Your feelings chart will show up here.' : 'No break sessions yet.'}</div>`;
    live.set(container, []); return;
  }

  const topPairs = Object.entries(s.pairs).sort((a, b) => b[1] - a[1]).slice(0, 6);
  container.innerHTML = `
    <div class="stats">
      <div class="stat"><span class="muted">${kid ? 'Breaks taken' : 'Total breaks'}</span><b>${s.total}</b></div>
      ${kid ? '' : `<div class="stat"><span class="muted">Started by instructor (lock)</span><b>${s.byInstructor}</b></div>`}
      <div class="stat"><span class="muted">${kid ? 'Breaks I asked for' : 'Asked for by student'}</span><b>${s.bySelf}</b></div>
      <div class="stat"><span class="muted">${kid ? 'Felt better after' : 'Felt better after'}</span><b>${s.betterPct ?? '–'}${s.betterPct != null ? '%' : ''}</b></div>
      ${kid ? '' : `<div class="stat"><span class="muted">Avg feeling size (1–3)</span><b>${s.avgSize ?? '–'}</b></div>
      <div class="stat"><span class="muted">Avg break length</span><b>${s.avgMinutes ?? '–'} min</b></div>`}
    </div>
    <div class="charts" style="margin-top:16px">
      <div class="card"><h3>${kid ? 'Feelings I had most' : 'Emotions'}</h3><div class="chart-box"><canvas data-c="emo"></canvas></div></div>
      <div class="card"><h3>${kid ? 'How breaks helped' : 'After the break'}</h3><div class="chart-box"><canvas data-c="after"></canvas></div></div>
      <div class="card"><h3>${kid ? 'Breaks each day' : 'Breaks per day'}</h3><div class="chart-box"><canvas data-c="days"></canvas></div></div>
      <div class="card"><h3>${kid ? 'How big my feelings were' : 'Stress trend (weekly avg feeling size)'}</h3><div class="chart-box"><canvas data-c="size"></canvas></div></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>${kid ? 'My most common reasons' : 'Top emotion → reason pairs'}</h3>
      <table><tbody>${topPairs.map(([k, n]) => {
        const [e, r] = k.split('|'); const em = EMOTIONS[e]; const re = em?.reasons[r];
        return `<tr><td>${em?.icon ?? ''} ${em?.label ?? e}</td><td>${re?.icon ?? ''} ${re?.label ?? r}</td><td style="text-align:right"><b>${n}</b></td></tr>`;
      }).join('')}</tbody></table>
    </div>
    ${showTable && !kid ? `<div class="card" style="margin-top:16px;overflow:auto">
      <h3>Recent sessions <span class="muted" style="font-weight:400;font-size:.9rem">(latest ${Math.min(30, breaks.length)} of ${breaks.length})</span></h3>
      <table><thead><tr><th>When</th>${Object.keys(studentsById).length > 1 ? '<th>Student</th>' : ''}<th>Started by</th><th>Feeling</th><th>Why</th><th>Size</th><th>Calming</th><th>After</th><th>Length</th></tr></thead>
      <tbody>${[...breaks].reverse().slice(0, 30).map((b) => {
        const em = EMOTIONS[b.emotion]; const re = em?.reasons[b.reason];
        const len = b.ended_at ? `${Math.max(1, Math.round((new Date(b.ended_at) - new Date(b.started_at)) / 60000))} min` : '<span class="pill warn">live</span>';
        return `<tr><td>${new Date(b.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
          ${Object.keys(studentsById).length > 1 ? `<td>${studentsById[b.student_id]?.name ?? '–'}</td>` : ''}
          <td>${b.initiated_by === 'instructor' ? '🔒 Instructor' : '🙋 Student'}</td>
          <td>${em ? `${em.icon} ${em.label}` : '–'}</td><td>${re ? re.label : '–'}</td>
          <td>${SIZES.find((x) => x.key === b.size)?.label ?? '–'}</td>
          <td>${ACTIVITIES[b.activity]?.label ?? '–'}</td>
          <td>${AFTER.find((x) => x.key === b.after)?.icon ?? '–'} ${AFTER.find((x) => x.key === b.after)?.label ?? ''}</td>
          <td>${len}</td></tr>`;
      }).join('')}</tbody></table></div>` : ''}`;

  const cv = (k) => container.querySelector(`[data-c="${k}"]`);
  const base = { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false } } };
  const charts = [];

  const emoKeys = Object.keys(s.emotions);
  charts.push(new Chart(cv('emo'), {
    type: 'bar',
    data: { labels: emoKeys.map((k) => `${EMOTIONS[k]?.icon ?? ''} ${EMOTIONS[k]?.label ?? k}`),
      datasets: [{ data: emoKeys.map((k) => s.emotions[k]), backgroundColor: emoKeys.map((k) => EMOTIONS[k]?.color ?? '#999'), borderRadius: 8 }] },
    options: { ...base, scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
  }));

  charts.push(new Chart(cv('after'), {
    type: 'doughnut',
    data: { labels: AFTER.map((a) => `${a.icon} ${a.label}`),
      datasets: [{ data: AFTER.map((a) => s.after[a.key] || 0), backgroundColor: ['#6f9f7c', '#c9c5bb', '#d9826b'], borderWidth: 0 }] },
    options: { ...base, cutout: '60%', plugins: { legend: { display: true, position: 'bottom' } } },
  }));

  const days = byDay(breaks);
  charts.push(new Chart(cv('days'), {
    type: 'bar',
    data: { labels: [...days.keys()], datasets: [
      { label: kid ? 'Teacher break' : 'Instructor (lock)', data: [...days.values()].map((d) => d.instructor), backgroundColor: '#d6a35c', borderRadius: 6 },
      { label: kid ? 'I asked' : 'Student asked', data: [...days.values()].map((d) => d.student), backgroundColor: '#5b8a8c', borderRadius: 6 },
    ] },
    options: { ...base, plugins: { legend: { display: true, position: 'bottom' } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } } },
  }));

  // Weekly average feeling size: smoother than daily, shows the trend clearly
  const weeks = new Map();
  for (const b of breaks) {
    if (!b.size) continue;
    const d = new Date(b.started_at); d.setDate(d.getDate() - d.getDay()); // week starts Sunday
    const k = 'Wk of ' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (!weeks.has(k)) weeks.set(k, { sizes: [] });
    weeks.get(k).sizes.push(b.size);
  }
  const sizeDays = [...weeks.entries()];
  charts.push(new Chart(cv('size'), {
    type: 'line',
    data: { labels: sizeDays.map(([k]) => k),
      datasets: [{ data: sizeDays.map(([, d]) => +(d.sizes.reduce((a, b) => a + b, 0) / d.sizes.length).toFixed(2)),
        borderColor: '#9a87c0', backgroundColor: 'rgba(154,135,192,.15)', fill: true, tension: .35, pointRadius: 3 }] },
    options: { ...base, scales: { y: { min: 1, max: 3, ticks: { stepSize: 1, callback: (v) => SIZES.find((x) => x.key === v)?.label ?? '' } }, x: { grid: { display: false } } } },
  }));

  live.set(container, charts);
}
