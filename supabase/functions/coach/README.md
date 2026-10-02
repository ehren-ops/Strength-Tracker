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
  `buildWeeklyCoachPayload` in `index.html`): recent results per lift with RPE and notes, plus the
  app's own next-session suggestion.
- **Optionally, from an Outlive project:** when the caller is signed in and
  `OUTLIVE_SUPABASE_SECRET_KEY` is set, the function finds the Outlive account with the same email
  and reads the goals row (`page_content`, page `coach`, key `goals`), 14 days of Whoop recovery,
  sleep and rides (used only to explain a specific lift result), and the bodyweight trend (weekly
  only). Recovery and nutrition analysis itself lives in Outlive.

## Setup after cloning this repo

1. Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com) and set a
   modest monthly spend cap there.
2. In your Supabase project: **Edge Functions → Secrets** → add `ANTHROPIC_API_KEY`.
3. Deploy: `supabase functions deploy coach --no-verify-jwt`.
4. If you're not using project `eixbpujqsectkstkqllz`, point `SUPABASE_URL` in `index.html` at your
   own project.
5. Optional Outlive link: add `OUTLIVE_SUPABASE_SECRET_KEY` (a secret API key from the Outlive
   project) and, if needed, `OUTLIVE_SUPABASE_URL`.

Until `ANTHROPIC_API_KEY` is set, tapping a button shows these setup steps instead of a dead-end
"try again" message.

## Security

`verify_jwt` is off on purpose: the app supports logging with no account, so there's often no JWT.
A signed-in caller's token is verified inside the function before any Outlive data is read, and
only that person's own rows are read. The abuse guard for anonymous calls is the spend cap on the
Anthropic key.
