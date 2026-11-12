// Calm Compass Insights Agent: an LLM (Gemini or Claude) with tool use over the class's break data.
// Files in /api starting with "_" are not routes on Vercel; this is shared by
// api/agent.js (Vercel) and the Vite dev middleware (local).
import { EMOTIONS, ACTIVITIES } from '../src/content.js';

const MAX_STEPS = 8;
const DAY = 86400000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------- data helpers
const label = (e, r) => {
  const em = EMOTIONS[e];
  return { emotion: em?.label ?? e ?? null, reason: (em && r && em.reasons[r]?.label) || r || null };
};
// Teacher-local date parts, DST-correct (the server itself runs in UTC on Vercel).
function loc(iso, ctx) {
  const d = new Date(iso);
  if (ctx.timeZone) {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ctx.timeZone, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
        .formatToParts(d).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour, time: `${p.hour}:${p.minute}`, weekday: p.weekday };
    } catch {}
  }
  const s = new Date(d.getTime() - ctx.tzOffsetMin * 60000); // fallback: fixed offset
  return { date: s.toISOString().slice(0, 10), hour: s.getUTCHours(), time: s.toISOString().slice(11, 16), weekday: WEEKDAYS[s.getUTCDay()] };
}
const block = (h) => (h < 10 ? 'early morning (before 10)' : h < 12 ? 'late morning (10-12)' : h < 14 ? 'after lunch (12-2)' : 'afternoon (after 2)');

function scope(ctx, { student_id, days = 28 } = {}) {
  const cutoff = ctx.now - days * DAY;
  return ctx.breaks.filter((b) => (!student_id || b.student_id === student_id) && new Date(b.started_at) >= cutoff);
}
const pct = (n, d) => (d ? Math.round((100 * n) / d) : null);
const tally = (rows, f) => rows.reduce((m, r) => { const k = f(r); if (k != null) m[k] = (m[k] || 0) + 1; return m; }, {});
const top = (obj, n = 5) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
const avg = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : null);

// ---------------------------------------------------------------- tools
const TOOLS = [
  {
    name: 'list_students',
    description: 'List students in the class with their ids and the feelings they chose during onboarding.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_breaks',
    description: 'Get recent break sessions (most recent first). Each break: date, weekday, time, who started it (instructor lock or student request), emotion, reason, feeling size 1-3, calming activity, how they felt after.',
    input_schema: { type: 'object', properties: {
      student_id: { type: 'string', description: 'Omit for the whole class' },
      days: { type: 'integer', description: 'Look-back window in days (default 14)' },
      limit: { type: 'integer', description: 'Max rows (default 40)' },
    } },
  },
  {
    name: 'find_patterns',
    description: 'Aggregate patterns: breaks by time of day and weekday, top emotion→reason pairs, instructor-started vs student-requested, and this week vs last week (count, avg feeling size, % felt better).',
    input_schema: { type: 'object', properties: {
      student_id: { type: 'string', description: 'Omit for the whole class' },
      days: { type: 'integer', description: 'Look-back window in days (default 28)' },
    } },
  },
  {
    name: 'activity_effectiveness',
    description: 'Which calming activity (calming sounds vs 90-second breathing) most often led to "Better", overall and per emotion.',
    input_schema: { type: 'object', properties: {
      student_id: { type: 'string', description: 'Omit for the whole class' },
      days: { type: 'integer', description: 'Default 28' },
    } },
  },
  {
    name: 'propose_checkin',
    description: 'Propose a proactive calm check-in break for a student at a specific date/time. This does NOT schedule it; the teacher sees an Approve button. Use when the data shows a predictable trigger time.',
    input_schema: { type: 'object', required: ['student_id', 'date', 'time', 'reason'], properties: {
      student_id: { type: 'string' },
      date: { type: 'string', description: 'YYYY-MM-DD (school day, today or later)' },
      time: { type: 'string', description: '24h HH:MM local time' },
      reason: { type: 'string', description: 'One short sentence citing the pattern' },
    } },
  },
];

const SUGGEST_TOOL = {
  name: 'submit_suggestions',
  description: 'Submit the final list of suggestions for the teacher dashboard. Call exactly once, at the end.',
  input_schema: { type: 'object', required: ['suggestions'], properties: { suggestions: { type: 'array', maxItems: 3, items: {
    type: 'object', required: ['student_id', 'title', 'detail'], properties: {
      student_id: { type: 'string' },
      title: { type: 'string', description: 'Max ~10 words' },
      detail: { type: 'string', description: '1-2 sentences with the evidence (numbers) and one concrete classroom action' },
      checkin: { type: 'object', description: 'Optional proposed check-in', properties: { date: { type: 'string' }, time: { type: 'string' } } },
    } } } } },
};

function runTool(name, input, ctx) {
  const nameOf = (id) => ctx.students.find((s) => s.id === id)?.name ?? 'Unknown';
  switch (name) {
    case 'list_students':
      return ctx.students.map((s) => ({ id: s.id, name: s.name, status: s.status,
        feelings: (s.profile?.emotions || []).map((e) => EMOTIONS[e.key]?.label ?? e.key) }));

    case 'get_breaks': {
      const rows = scope(ctx, { student_id: input.student_id, days: input.days ?? 14 }).slice().reverse().slice(0, input.limit ?? 40);
      return rows.map((b) => {
        const d = loc(b.started_at, ctx); const l = label(b.emotion, b.reason);
        return { student: nameOf(b.student_id), date: d.date, weekday: d.weekday,
          time: d.time, started_by: b.initiated_by, ...l, size: b.size ?? null,
          activity: ACTIVITIES[b.activity]?.label ?? null, after: b.after ?? null,
          minutes: b.ended_at ? Math.round((new Date(b.ended_at) - new Date(b.started_at)) / 60000) : null };
      });
    }

    case 'find_patterns': {
      const rows = scope(ctx, input);
      const week = (from, to) => rows.filter((b) => { const t = new Date(b.started_at); return t >= ctx.now - from * DAY && t < ctx.now - to * DAY; });
      const summary = (rs) => ({ breaks: rs.length, instructor_started: rs.filter((b) => b.initiated_by === 'instructor').length,
        student_requested: rs.filter((b) => b.initiated_by === 'student').length,
        avg_feeling_size: avg(rs.filter((b) => b.size).map((b) => b.size)),
        felt_better_pct: pct(rs.filter((b) => b.after === 'better').length, rs.filter((b) => b.after).length) });
      return {
        scope: input.student_id ? nameOf(input.student_id) : 'whole class', days: input.days ?? 28,
        overall: summary(rows),
        this_week: summary(week(7, 0)), last_week: summary(week(14, 7)),
        by_time_of_day: tally(rows, (b) => block(loc(b.started_at, ctx).hour)),
        by_weekday: tally(rows, (b) => loc(b.started_at, ctx).weekday),
        top_emotion_reason_pairs: top(tally(rows, (b) => b.emotion && b.reason && `${label(b.emotion, b.reason).emotion} → ${label(b.emotion, b.reason).reason}`)),
        per_student: input.student_id ? undefined : top(tally(rows, (b) => nameOf(b.student_id)), 10),
      };
    }

    case 'activity_effectiveness': {
      const rows = scope(ctx, input).filter((b) => b.activity && b.after);
      const stat = (rs) => Object.fromEntries(Object.keys(ACTIVITIES).map((a) => {
        const x = rs.filter((b) => b.activity === a);
        return [ACTIVITIES[a].label, { sessions: x.length, felt_better_pct: pct(x.filter((b) => b.after === 'better').length, x.length) }];
      }));
      const byEmotion = {};
      for (const e of new Set(rows.map((b) => b.emotion))) byEmotion[EMOTIONS[e]?.label ?? e] = stat(rows.filter((b) => b.emotion === e));
      return { scope: input.student_id ? nameOf(input.student_id) : 'whole class', overall: stat(rows), by_emotion: byEmotion };
    }

    case 'propose_checkin': {
      if (!ctx.students.some((s) => s.id === input.student_id)) return { error: 'unknown student_id' };
      const p = { id: `p${ctx.proposals.length + 1}`, student_id: input.student_id, student: nameOf(input.student_id),
        date: input.date, time: input.time, reason: input.reason };
      ctx.proposals.push(p);
      return { ok: true, note: 'Shown to the teacher with an Approve button. Mention it briefly in your reply.' };
    }

    case 'submit_suggestions':
      ctx.suggestions = (input.suggestions || []).filter((s) => ctx.students.some((x) => x.id === s.student_id))
        .map((s) => ({ ...s, student: nameOf(s.student_id) }));
      return { ok: true };

    default:
      return { error: `unknown tool ${name}` };
  }
}

// ---------------------------------------------------------------- prompts
const SYSTEM = (nowLocal) => `You are the Calm Compass Insights Agent, an assistant for a teacher of autistic students.
Calm Compass records "breaks": a student (or the teacher, via a screen lock) starts a break, the student picks how they feel and why, how big the feeling is (1-3), does a calming activity, then says if they feel better.
The teacher's local date/time is ${nowLocal}.

How to work:
- Always call tools to get evidence before answering. Never invent numbers.
- Be concise: 3-6 short sentences or a few bullets. Lead with the answer. Cite specific numbers.
- Focus on changing the environment and routines (noise, transitions, lunch, schedule previews, seating), not on "fixing" the child. Use neutral, respectful, neurodiversity-affirming language.
- A rise in student-requested breaks is GOOD (self-advocacy); a drop in instructor-started breaks is progress.
- You are not a clinician. Do not diagnose. If something looks concerning (many "still upset" outcomes), suggest the teacher loop in the family or school support staff.
- If a predictable trigger time appears, you may call propose_checkin; the teacher must approve it.
- Plain text with simple "- " bullets and **bold**; no headings or tables.`;

const SUGGEST_PROMPT = 'Review the whole class for the last 2-4 weeks. Find up to 3 of the most useful, specific, evidence-backed suggestions (a pattern + one concrete action). Include a proposed check-in date/time only when there is a clear time-of-day pattern; use a school day today or later. Then call submit_suggestions once.';

// ---------------------------------------------------------------- providers
// Each provider runs the same tool loop; only the message format differs.
// AI_PROVIDER=gemini|claude picks one; otherwise whichever key is set is used (Gemini first: it has a free tier).
export function pickProvider(env = {}) {
  const want = (env.AI_PROVIDER || '').toLowerCase();
  const provider = want || (env.GEMINI_API_KEY ? 'gemini' : env.ANTHROPIC_API_KEY ? 'claude' : 'gemini');
  const key = provider === 'claude' ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY;
  const model = provider === 'claude' ? (env.ANTHROPIC_MODEL || 'claude-sonnet-5-5') : (env.GEMINI_MODEL || 'gemini-3.8-flash');
  return { provider, key, model };
}

async function claudeLoop({ anthropic, model, system, tools, convo, onCalls }) {
  const messages = convo.map((m) => ({ role: m.role, content: m.content }));
  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await anthropic.messages.create({ model, max_tokens: 1200, system, tools, messages });
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((c) => c.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      return res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    }
    const outs = onCalls(calls.map((c) => ({ name: c.name, input: c.input || {} })));
    messages.push({ role: 'user', content: calls.map((c, k) => ({ type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(outs[k]) })) });
    if (outs.stop) return '';
  }
  return null;
}

async function geminiLoop({ gemini, model, system, tools, convo, onCalls }) {
  const contents = convo.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const config = {
    systemInstruction: system,
    tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }],
  };
  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await gemini.models.generateContent({ model, contents, config });
    const calls = res.functionCalls || [];
    if (!calls.length) return (res.text || '').trim();
    // Send the model's turn back unchanged (it can carry thought signatures newer models require).
    contents.push(res.candidates?.[0]?.content || { role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
    const outs = onCalls(calls.map((c) => ({ name: c.name, input: c.args || {} })));
    contents.push({ role: 'user', parts: calls.map((c, k) => ({ functionResponse: { id: c.id, name: c.name, response: { result: outs[k] } } })) });
    if (outs.stop) return '';
  }
  return null;
}

// ---------------------------------------------------------------- main
export async function runAgent({ mode = 'chat', messages = [], students = [], breaks = [], nowLocal, nowISO, tzOffsetMin = 0, timeZone }, env = {}, clients = {}) {
  const { provider, key, model } = pickProvider(env);
  const client = clients[provider];
  if (!client && !key) {
    const err = new Error(provider === 'claude' ? 'ANTHROPIC_API_KEY is not set' : 'GEMINI_API_KEY is not set'); err.status = 503; throw err;
  }
  const ctx = { students, breaks: [...breaks].sort((a, b) => a.started_at.localeCompare(b.started_at)),
    now: nowISO ? new Date(nowISO).getTime() : Date.now(), tzOffsetMin: +tzOffsetMin || 0, timeZone, proposals: [], suggestions: null };

  const tools = mode === 'suggest' ? [...TOOLS.filter((t) => t.name !== 'propose_checkin'), SUGGEST_TOOL] : TOOLS;
  const convo = mode === 'suggest'
    ? [{ role: 'user', content: SUGGEST_PROMPT }]
    : messages.filter((m) => m.content && (m.role === 'user' || m.role === 'assistant')).slice(-10)
        .reduce((out, m) => { // merge consecutive same-role turns so roles alternate
          const last = out[out.length - 1];
          if (last?.role === m.role) last.content += `\n\n${m.content}`; else out.push({ role: m.role, content: String(m.content) });
          return out;
        }, []).filter((m, i, arr) => i > 0 || m.role === 'user' || arr.length === 1);
  const steps = [];

  // Runs a batch of tool calls; flags .stop once suggestions are submitted.
  const onCalls = (calls) => {
    const outs = calls.map(({ name, input }) => {
      steps.push(name);
      try { return runTool(name, input, ctx); } catch (e) { return { error: e.message }; }
    });
    if (mode === 'suggest' && ctx.suggestions) outs.stop = true;
    return outs;
  };

  const args = { model, system: SYSTEM(nowLocal || new Date().toString()), tools, convo, onCalls };
  let reply;
  if (provider === 'claude') {
    const anthropic = client || new (await import('@anthropic-ai/sdk')).default({ apiKey: key });
    reply = await claudeLoop({ ...args, anthropic });
  } else {
    const gemini = client || new (await import('@google/genai')).GoogleGenAI({ apiKey: key });
    reply = await geminiLoop({ ...args, gemini });
  }
  if (reply === null) reply = 'I ran out of steps while analyzing. Try a more specific question.';
  if (mode === 'suggest') reply = '';
  return { reply, steps, proposals: ctx.proposals, suggestions: ctx.suggestions, provider };
}

// Shared request handler (Vercel function + Vite dev middleware)
export async function handleAgentRequest(body, env) {
  try {
    return { status: 200, json: await runAgent(body || {}, env) };
  } catch (e) {
    console.error('[agent]', e);
    const status = e.status === 503 ? 503 : e.status === 429 ? 429 : 500;
    const msg = status === 503 ? e.message
      : status === 429 ? 'The AI is getting too many requests (free-tier limit). Wait a minute and try again.'
      : `Agent error: ${e.message}`;
    return { status, json: { error: msg } };
  }
}