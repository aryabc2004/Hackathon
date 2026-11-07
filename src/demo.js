// Builds a demo class with 3 students and ~4 weeks of break history.
// The story it tells: over time, fewer instructor-initiated breaks, more self-requested
// breaks, smaller feelings, and more "felt better" check-ins.
import { EMOTIONS } from './content.js';

const PROFILES = [
  { name: 'Maya', school: 'Sutter Middle School', emotions: {
    frustrated: ['too_hard', 'change', 'waiting', 'not_understood'],
    overwhelmed: ['noise_lots', 'too_much', 'instructions', 'bright'],
    angry: ['interrupted', 'unfair', 'noise', 'lost_game'],
    worried: ['whats_next', 'in_trouble', 'homework', 'friends'] } },
  { name: 'Leo', school: 'Sutter Middle School', emotions: {
    angry: ['unfair', 'teased', 'touched', 'interrupted'],
    frustrated: ['too_hard', 'cant_do', 'waiting', 'broken'],
    sad: ['left_out', 'mistake', 'tired', 'no_reason'],
    fearful: ['loud_sudden', 'new_thing', 'crowd', 'test'] } },
  { name: 'Sam', school: 'Sutter Middle School', emotions: {
    sad: ['left_out', 'miss_someone', 'tired', 'mistake'],
    lonely: ['no_one_play', 'different', 'lunch', 'ignored'],
    fearful: ['test', 'crowd', 'new_thing', 'something_bad'],
    overwhelmed: ['noise_lots', 'busy_day', 'clothes', 'too_much'] } },
];

const rand = (a) => a[Math.floor(Math.random() * a.length)];
const weighted = (pairs) => { let r = Math.random() * pairs.reduce((s, [, w]) => s + w, 0); for (const [v, w] of pairs) if ((r -= w) <= 0) return v; return pairs[0][0]; };

export async function buildDemo(db) {
  const cls = await db.createClass('Ms. Rivera (demo)');
  const rows = [];
  for (const p of PROFILES) {
    const s = await db.createStudent({
      class_code: cls.code, name: p.name, school: p.school,
      profile: { emotions: Object.entries(p.emotions).map(([key, reasons]) => ({ key, reasons })) },
    });
    const keys = Object.keys(p.emotions);
    for (let d = 27; d >= 1; d--) {
      const day = new Date(); day.setDate(day.getDate() - d);
      if (day.getDay() === 0 || day.getDay() === 6) continue; // school days only
      const progress = 1 - d / 27; // 0 = 4 weeks ago, 1 = yesterday
      const n = weighted([[0, 1 + progress * 2], [1, 3], [2, 2.5 - progress * 1.5], [3, 1.2 - progress]]);
      for (let i = 0; i < n; i++) {
        const start = new Date(day); start.setHours(8 + Math.floor(Math.random() * 6), Math.floor(Math.random() * 60), 0, 0);
        const end = new Date(start.getTime() + (3 + Math.random() * 6) * 60000);
        const emotion = weighted(keys.map((k, j) => [k, 4 - j]));
        rows.push({
          student_id: s.id, class_code: cls.code,
          initiated_by: Math.random() < 0.75 - progress * 0.5 ? 'instructor' : 'student',
          step: 'done', emotion, reason: rand(p.emotions[emotion]),
          size: weighted([[3, 2.2 - progress * 1.6], [2, 2], [1, 0.6 + progress * 1.8]]),
          activity: rand(['audio', 'breathe']),
          after: weighted([['better', 1.5 + progress * 2.5], ['same', 1.2], ['worse', 0.7 - progress * 0.5]]),
          started_at: start.toISOString(), ended_at: end.toISOString(),
        });
      }
    }
  }
  if (!rows.every((r) => EMOTIONS[r.emotion]?.reasons[r.reason])) throw new Error('demo data mismatch');
  await db.insertBreaks(rows);
  return cls;
}
