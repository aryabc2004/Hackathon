// Calming activities: generated ambient audio (Web Audio, no files needed) and a
// 90-second guided breathing animation. Both are slow, soft and predictable.

export const CALM_SECONDS = 90;

// Soft major-chord pad with slow "breathing" volume + quiet brown noise.
export function startAmbientAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { stop() {} };
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 4); // gentle fade-in, never sudden

  // Slow swell, ~one cycle per 10 s (matches the breathing pace)
  const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.1; lfoGain.gain.value = 0.05;
  lfo.connect(lfoGain).connect(master.gain); lfo.start();

  const lowpass = ctx.createBiquadFilter(); lowpass.type = 'lowpass'; lowpass.frequency.value = 900;
  lowpass.connect(master);
  const oscs = [220, 277.18, 329.63, 440].map((f, i) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o.detune.value = (i - 1.5) * 4;
    g.gain.value = i === 3 ? 0.08 : 0.25;
    o.connect(g).connect(lowpass); o.start(); return o;
  });

  // Brown noise (like soft wind/ocean)
  const len = ctx.sampleRate * 4; const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3; }
  const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
  const ng = ctx.createGain(); ng.gain.value = 0.25; noise.connect(ng).connect(lowpass); noise.start();

  return {
    stop() {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
        setTimeout(() => { [...oscs, lfo, noise].forEach((n) => n.stop()); ctx.close(); }, 2200);
      } catch {}
    },
  };
}

// Renders a breathing circle into `el` for CALM_SECONDS. In 4 s · hold 2 s · out 6 s.
// Returns { done: Promise, stop() }.
export function runBreathing(el, color, { label = true } = {}) {
  el.innerHTML = `
    <div class="breath-wrap">
      <div class="breath-ring"><div class="breath-circle" style="background:${color}"></div></div>
      ${label ? '<p class="breath-text" aria-live="polite">Get comfy…</p>' : ''}
      <p class="breath-timer"></p>
    </div>`;
  const circle = el.querySelector('.breath-circle');
  const text = el.querySelector('.breath-text');
  const timer = el.querySelector('.breath-timer');
  const phases = [['Breathe in…', 4000, 1], ['Hold…', 2000, 1], ['Breathe out…', 6000, 0.45]];
  let stopped = false; let t0 = performance.now(); let phaseTimer; let tick;
  let resolve; const done = new Promise((r) => (resolve = r));

  const runPhase = (i) => {
    if (stopped) return;
    const [msg, ms, scale] = phases[i % phases.length];
    if (text) text.textContent = msg;
    circle.style.transition = `transform ${ms}ms ease-in-out`;
    circle.style.transform = `scale(${scale})`;
    phaseTimer = setTimeout(() => runPhase(i + 1), ms);
  };
  circle.style.transform = 'scale(0.45)';
  requestAnimationFrame(() => runPhase(0));

  const update = () => {
    const left = Math.max(0, CALM_SECONDS - Math.floor((performance.now() - t0) / 1000));
    timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (left <= 0) finish();
  };
  tick = setInterval(update, 250); update();

  function finish() {
    if (stopped) return; stopped = true;
    clearTimeout(phaseTimer); clearInterval(tick);
    if (text) text.textContent = 'Nice job. 💙';
    circle.style.transform = 'scale(0.7)';
    resolve();
  }
  return { done, stop: finish };
}
