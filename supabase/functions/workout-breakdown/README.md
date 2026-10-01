# workout-breakdown

Supabase Edge Function behind the "Full AI Breakdown" button in Coach's
Notes. Takes a compact summary of one logged session (built client-side
in `buildWorkoutBreakdownPayload` in `index.html`) and returns a
structured Claude-written breakdown: what went well, what didn't, how to
improve, and what to watch next time.

## Deployment

Currently deployed identically to two Supabase projects:

- **Strength Tracker** (`eixbpujqsectkstkqllz`) - the one the app actually
  calls (`${SUPABASE_URL}/functions/v1/workout-breakdown` in `index.html`).
  **Needs its own `ANTHROPIC_API_KEY` secret set** (Project Settings ->
  Edge Functions -> Secrets) before this works - it was not copied over
  automatically, and nothing in this repo can set it for you.
- **outlive** (`szsgxlbvleviuzobhuty`) - already has `ANTHROPIC_API_KEY`
  configured from its own `ai-insights` function, so this copy works as
  soon as it's deployed. Not currently called by anything; it exists as a
  ready fallback.

Both are `verify_jwt: false` (unauthenticated) on purpose: Strength
Tracker explicitly supports logging with no account at all, so there's
often no Supabase session to attach a JWT to. The real abuse guard is a
modest monthly spend cap set on the Anthropic API key itself, not a
request-level check here - the function never reads any database table,
so the only thing an abusive caller could do is spend API budget on junk
input, which a spend cap bounds.

To redeploy after an edit, push this file's contents to both projects
(dashboard "Edge Functions" -> workout-breakdown -> edit, or the Supabase
CLI: `supabase functions deploy workout-breakdown --project-ref <ref>`
for each of the two project refs above).
