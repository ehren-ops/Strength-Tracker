# coach

Supabase Edge Function behind the two buttons in Coach's Notes:

- **Session Breakdown**: a short post-workout note. A one-line verdict, 2 to 3 insights that
  connect lifts and weeks, and only the lifts whose plan should change next session.
- **Weekly Check-in**: the big-picture strength review. What's moving, what's lagging, imbalances
  and risks, block and deload timing, next week's focus, and at most one bodyweight line.

Both are written as insights, not a readback of logged numbers: the app pre-computes each lift's
movement pattern, 4-week e1RM change, sessions at the current load and RPE at that load, plus a
summary per movement pattern, so the model reasons over trends.

Both are generated only when tapped, cached on the device, and synced to the `ai_breakdowns`
table (`kind` = `session` or `weekly`) when signed in. Model: Claude Sonnet 5.5.

## What it reads

- **Always:** the training summary the app sends (`buildSessionCoachPayload` /
  `buildWeeklyCoachPayload` in `js/09-coach-overview.js`): recent results per lift with RPE and notes, plus the
  app's own next-session suggestion.
- **Optionally, from an Outlive project:** when the caller is signed in and
  `OUTLIVE_SUPABASE_SECRET_KEY` is set, the function finds the Outlive account with the same email
  and reads the goals row (`page_content`, page `coach`, key `goals`), 14 days of Whoop recovery,
  sleep and rides (used only to explain a specific lift result), and the bodyweight trend (weekly
  only). Recovery and nutrition analysis itself lives in Outlive.
- **Per-lift heart rate, through Outlive:** the app sends each lift's log time. The function asks
  Outlive's `strava-hr` function for the wearable's heart-rate stream (Whoop via Strava) over that
  session and splits it at the log times, since each lift is logged right after its last set: one
  window per lift, with its peak and average HR. Session mode also does this for the latest earlier
  session of the same day type, for a like-for-like comparison; weekly mode does it for each
  session that week. Right after a workout the wearable may not have uploaded yet, in which case
  the analysis runs without heart rate.

## Setup after cloning this repo

1. Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com) and set a
   modest monthly spend cap there.
2. In your Supabase project: **Edge Functions → Secrets** → add `ANTHROPIC_API_KEY`.
3. Deploy: `supabase functions deploy coach --no-verify-jwt`.
4. If you're not using project `eixbpujqsectkstkqllz`, point `SUPABASE_URL` in `js/01-sync.js` at your
   own project.
5. Optional Outlive link: add `OUTLIVE_SUPABASE_SECRET_KEY` (a secret API key from the Outlive
   project) and, if needed, `OUTLIVE_SUPABASE_URL`.

Until `ANTHROPIC_API_KEY` is set, tapping a button shows these setup steps instead of a dead-end
"try again" message.

## Security

Only signed-in accounts can run it. `verify_jwt` is off so browser CORS preflights pass, and the
function verifies the caller's Supabase session itself before anything else: no session, no
Anthropic call (`401 not_signed_in`). Logging still works with no account; only the AI buttons need
one. Each account is also capped at 10 calls a day (`429 daily_limit_reached`), resetting at
midnight in the time zone the app sends, counted by `coach_bump()` in the `coach_usage` table
(migrations `20261002030000_coach_usage.sql` and `20261002050000_coach_usage_local_day.sql`), so an account
made through the open sign-up form can't run up the bill. Outlive data is read only for the
caller's own email. A spend cap on the Anthropic key is still a sensible backstop.
