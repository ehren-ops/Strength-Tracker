# workout-breakdown

Supabase Edge Function behind the "Full AI Breakdown" button in Coach's
Notes. Takes a compact summary of one logged session (built client-side
in `buildWorkoutBreakdownPayload` in `index.html`) and returns a
structured Claude-written breakdown: what went well, what didn't, how to
improve, and what to watch next time.

**Strength Tracker is fully self-contained.** The app calls only its own
project's copy of this function (`eixbpujqsectkstkqllz`); nothing about
this feature depends on any other project. A second copy happens to also
be deployed to an unrelated personal project ("outlive") because that
project already had a spare `ANTHROPIC_API_KEY` secret lying around when
this was built - that copy is dead code as far as Strength Tracker is
concerned, never called by anything here, and you can ignore or delete it
without affecting this app at all.

## Setup required after cloning this repo

This function needs an `ANTHROPIC_API_KEY` secret on **your own** Supabase
project before the button will work:

1. Get a key at [console.anthropic.com](https://console.anthropic.com)
   (set a modest monthly spend cap there - see "Security" below).
2. In your Supabase project: **Project Settings → Edge Functions → Secrets**
   → add `ANTHROPIC_API_KEY`.
3. Deploy this function: `supabase functions deploy workout-breakdown`
   (Supabase CLI), or paste `index.ts`'s contents into a new Edge Function
   via the dashboard.
4. Update the fetch URL in `index.html`'s `generateFullAiBreakdown()` to
   point at your own project if you're not using
   `eixbpujqsectkstkqllz` (search for `/functions/v1/workout-breakdown`).

Until the secret is set, the button still works end to end - clicking it
shows setup instructions pointing back at this file, instead of a dead-end
"try again" message, so a fresh clone fails loudly and helpfully rather
than silently.

## Security

`verify_jwt: false` (unauthenticated) is deliberate: Strength Tracker
explicitly supports logging with no account at all, so there's often no
Supabase session to attach a JWT to. The real abuse guard is a modest
monthly spend cap set on the Anthropic API key itself, not a
request-level check here - the function never reads any database table,
so the only thing an abusive caller could do is spend API budget on junk
input, which a spend cap bounds.
