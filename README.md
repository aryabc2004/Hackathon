# 🧭 Calm Compass

**Live demo:** [hackathon-beta-sand.vercel.app](https://hackathon-beta-sand.vercel.app)
→ [Instructor view](https://hackathon-beta-sand.vercel.app/teacher) · [Student view](https://hackathon-beta-sand.vercel.app/kid)

Built at Capital Hacks 5.0 for the Health track.

When an autistic student gets overwhelmed in class, they often can't put into words what's wrong, and the teacher is left guessing. Calm Compass gives that student a way to say "I need a break" and explain why with a few taps, using feelings and reasons they picked themselves. The teacher sees the check-in instantly, guides a calming break, and over time can see what triggers each student and what actually helps.

## Try it in two minutes

1. Open the [instructor view](https://hackathon-beta-sand.vercel.app/teacher) and click **Create demo class**. That gives you three students with four weeks of history.
2. Open the [student view](https://hackathon-beta-sand.vercel.app/kid) on your phone (or in another browser) and sign up with the class code shown on the teacher screen.
3. On the teacher screen, hit **🔒 Start break** on your student. Their screen locks into a calm check-in.
4. Pick a feeling, a reason, and how big it is, then do the breathing exercise. Watch the teacher's live feed update as you tap.
5. Hit **▶ Resume class** to unlock. Then check the **Reports** and **AI Assistant** tabs.

The **⌂ Home** button in the bottom corner takes you back to the student/instructor picker.

## How it works

**Students** start with a short questionnaire: their name, up to four feelings they have most often, and up to four reasons for each one. Their check-ins are built from those answers, so a kid sees *their* words, not a generic list. They can ask for a break anytime, and they can see their own feelings chart.

**Instructors** get a live dashboard of the class. They can start a break (which locks the student's screen), pick a calming activity or let the student choose, and resume class when the student is ready. Reports show triggers, which calming activities work, and whether students are starting to ask for breaks on their own.

**A break** goes like this: the screen locks → "How are you feeling, Maya?" → "Why?" → "How big is the feeling?" → an affirmation and tip written for that exact feeling and reason, plus 90 seconds of calming sounds or guided breathing → "How do you feel now?" The answers save to Supabase and show up on the teacher's screen right away.

## The AI assistant

Teachers can ask questions about their class in plain English, like "Who needs the most support this week?" Instead of guessing, the model looks through the break data with a set of tools (patterns by time and day, which calming activities worked, recent breaks) and answers with real numbers. Little chips under each answer show what it checked.

It also posts up to three suggestions on the Live tab. When it spots a predictable trigger, like a student who always struggles after lunch, it can suggest a calm check-in at that time. Nothing happens unless the teacher approves it.

On the student side, the app pre-selects whichever calming activity has helped that student most for that feeling. That part is simple stats, no AI.

It runs on Gemini's free tier by default. Claude works too if you have API credits.

## Running it yourself

```bash
npm install
npm run dev
```

With no keys set, it runs in **local demo mode**: open `/teacher` and `/kid` as tabs in the same browser and they sync with each other. That's also our backup if the wifi dies during a demo.

To connect the real backend, create a `.env` file next to `package.json`:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3.5-flash-lite
```

- **Supabase:** create a project, then run `supabase/schema.sql` in the SQL Editor. Use the *publishable* key, never the secret one.
- **Gemini:** free key from [aistudio.google.com](https://aistudio.google.com) → Get API key. Don't put `VITE_` in front of it, or it ends up in the browser. `GEMINI_MODEL` is optional; flash-lite is faster and less likely to be overloaded on the free tier.
- **Claude instead:** set `ANTHROPIC_API_KEY` (from console.anthropic.com; it's separate from a Claude Pro subscription). If both keys are set, add `AI_PROVIDER=claude` to use Claude.

Restart `npm run dev` after changing `.env`.

**Deploying:** the repo is connected to Vercel, so every push to `main` redeploys. Add the same variables under Vercel → Settings → Environment Variables, then redeploy once so they take effect.

## Project layout

```
index.html / kid.html / teacher.html   the three pages
src/kid.js        student onboarding, break flow, feelings chart
src/teacher.js    live dashboard, feed, reports
src/assistant.js  AI Assistant chat, suggestions, scheduled check-ins
src/content.js    feelings, reasons, and an affirmation + tip for each pair
src/calm.js       calming sounds and the 90-second breathing animation
src/charts.js     report charts (Chart.js)
src/db.js         Supabase + the local demo fallback
src/demo.js       demo class generator, with patterns for the AI to find
api/_agent.js     the AI agent and its tools (Gemini or Claude)
api/agent.js      Vercel endpoint for the agent
supabase/schema.sql
```

## Choices we made on purpose

- **The student's own words.** Check-ins come from their answers, not a generic list.
- **Breaks aren't punishments.** The lock screen says "You are not in trouble," and students can ask for breaks themselves. Our reports treat more self-requested breaks as progress, because that's what self-regulation looks like.
- **Sensory-friendly.** Muted colors, no sudden sounds (audio fades in), big buttons, and it respects reduced-motion settings.
- **Measure what works.** Every break ends with "How do you feel now?", so teachers can see which calming activity actually helps each student.
- **The AI only helps the teacher.** It never talks to students, and every action it suggests needs a teacher's approval.

## What we'd fix before real classrooms

- The database rules are wide open for the demo. Real use needs logins and per-teacher access (COPPA/FERPA).
- A browser can't truly lock a tablet. It would need iPad Guided Access or Chromebook kiosk mode.
- Scheduled check-ins live in the teacher's browser and only fire while the dashboard is open.

Next up: heart-rate sensors to catch stress without tapping, a weekly summary for parents, and a parent portal.
