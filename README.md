# 🧭 Calm Compass

Emotional regulation breaks for autistic students, built from each kid's own words.
Capital Hacks 5.0 · Health track.

**Two portals**
- **Student (`/kid`)**: onboarding questionnaire (name → 4 most common feelings → 4 reasons for each = 16 personal feeling/why pairs → school + class code). Then: "I need a break" button and "My feelings" trends.
- **Instructor (`/teacher`)**: live class view. The instructor can start a break, which locks the kid's screen, and choose calming sounds, the 90-second breathing clip, or let the student choose. Includes a live activity feed, "Resume class" to unlock, and reports with trends.

**Break flow:** screen locks → "How are you feeling, Maya?" (her 4 feelings) → "Why?" (her 4 reasons) → "How big is the feeling?" → affirmation + tip for that exact pair, plus calming audio or breathing for 90 s → "How do you feel now?" → report saved to Supabase and streamed to the instructor → instructor resumes class.

## Run locally (no setup)
```bash
npm install
npm run dev
```
With no Supabase keys set, the app runs in **local demo mode**: open `/teacher` and `/kid` as two tabs in the same browser and they sync with each other. Use this as the backup demo if venue wifi dies.

## Connect Supabase
1. Create a project at supabase.com.
2. In the SQL Editor, paste and run `supabase/schema.sql`. It creates the tables, turns on realtime, and adds demo access rules.
3. Copy `.env.example` to `.env` and fill in values from Project Settings → API:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
4. Run `npm run dev`. The landing page should say "Connected to Supabase". Kid and teacher can now be on different devices; `npm run dev` uses `--host`, so phones on the same wifi can open `http://<your-ip>:5173/kid`.

## Deploy to Vercel
1. Push the repo to GitHub, then go to vercel.com → Add New Project → import it. Vercel detects Vite automatically.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Environment Variables, then deploy.
3. `vercel.json` turns on clean URLs, so `/kid` and `/teacher` work.

## Demo script (about 3 min)
1. **Teacher laptop:** `/teacher` → **Create demo class**. This adds 3 students and 4 weeks of history. Show **Reports**: fewer instructor locks over time, more breaks the students asked for, and the stress trend going down.
2. **Tablet/phone:** `/kid` → do onboarding live as "Maya" with the demo class code (on the teacher screen).
3. Teacher → Maya's card → pick "90-second breathing" → **🔒 Start break**. Maya's screen locks.
4. Maya picks *Frustrated → The work is too hard → Really big*. The teacher feed updates live at each tap.
5. Calming plays with Maya's personal affirmation → "Better" → **▶ Resume class** → back to learning.
6. Show Maya's own "My feelings" page: the student sees their own data too.

## 🤖 AI agent (Gemini free tier, or Claude)
- **Insights Agent** (instructor → *AI Assistant* tab): ask questions in plain English. The model calls tools (`list_students`, `get_breaks`, `find_patterns`, `activity_effectiveness`, `propose_checkin`) over the class's break data before answering. The chips under each answer show which tools it used.
- **Proactive suggestions** (Live tab): the agent reviews the class on load and after each finished break, then posts up to 3 evidence-backed suggestions. **Schedule check-in** sets a calm check-in that automatically starts that student's break at the chosen time while the dashboard is open. A human approves every action.
- **Smart calming pick** (student side, no AI call): pre-selects the calming activity that most often led to "Better" for that student and that feeling.

**Setup (free):** get a key at aistudio.google.com → *Get API key*, add `GEMINI_API_KEY=...` to `.env`, restart `npm run dev`. On Vercel, add the same variable and redeploy. The free tier has per-minute and per-day limits; if you hit one, the app says to wait a minute. Optional `GEMINI_MODEL` (default `gemini-2.5-flash`).
**Claude instead:** set `ANTHROPIC_API_KEY` (console.anthropic.com, paid credits; not included in Claude Pro). If both keys are set, Gemini is used unless `AI_PROVIDER=claude`.
The key stays server-side: `/api/agent` is a Vercel function (`api/agent.js`), and locally the same code runs inside the Vite dev server. **Never** give it a `VITE_` prefix.
**Privacy:** the agent receives first names and break records only (no school, no free text). Gemini's free tier may use prompts to improve Google's products: fine for demo data, not for real students. Before real use, minimize further (pseudonymous IDs) and review your district's data agreements.
**Demo tip:** *Create demo class* builds data with patterns the agent should find: Maya gets overwhelmed by noise after lunch and breathing helps her, Leo gets frustrated with hard work on Tue/Thu mornings and calming sounds help him, Sam feels lonely at lunch or recess. Ask: "Who needs the most support this week?"

## Structure
```
index.html / kid.html / teacher.html   pages (Vite multi-page)
src/content.js   8 feelings × 6 reasons, an affirmation + tip for each pair
src/kid.js       onboarding, lock-screen break flow, student trends
src/teacher.js   live control, feed, reports
src/charts.js    Chart.js reports shared by both portals
src/calm.js      generated calming audio (Web Audio) + 90 s breathing animation
src/db.js        Supabase data layer + local fallback
src/demo.js      demo class generator (with patterns for the agent to find)
src/assistant.js AI Assistant chat, suggestion cards, check-in scheduler
api/_agent.js    LLM tool-use loop (Gemini + Claude) + tools (shared by Vercel + local dev)
api/agent.js     Vercel serverless function: POST /api/agent
supabase/schema.sql
```

## Design choices (good to mention to judges)
- **The kid's own words:** check-in options come from their onboarding answers, not a generic list.
- **Not punitive:** "You are not in trouble." Kids can also ask for breaks themselves, and the reports track the shift from instructor-started to self-requested breaks, which is the self-regulation goal.
- **Sensory-friendly:** muted colors, no sudden sounds (audio fades in), big tap targets, respects reduced-motion settings.
- **Measures what works:** the "How do you feel now?" answer shows which calming activity helps each kid.

## Before real-world use / scaling
- The demo access rules in `schema.sql` let anyone with the anon key read and write. Add Supabase Auth plus per-teacher policies before using real student data (COPPA/FERPA).
- A browser can't truly lock a device. Pair it with iPad Guided Access or Chromebook kiosk mode.
- **Future:** heart-rate sensors (smartwatch) to detect stress automatically instead of tapping, an LLM-written weekly summary for parents, and a parent portal.
