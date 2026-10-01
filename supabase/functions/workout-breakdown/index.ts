// Strength Tracker - full AI breakdown of the most recently logged session.
// POST {session: object} -> {breakdown: {...}, generatedAt}
//
// session is built client-side from the app's own local data (see
// buildWorkoutBreakdownPayload in index.html) - this function never reads
// any database table, so it has no dependency on which Supabase project's
// auth a caller happens to hold. That's also why it's unauthenticated
// (verify_jwt: false): Strength Tracker explicitly supports fully
// offline/no-account use (see README "logging works without it"), and an
// anonymous caller has no Supabase JWT to present. The real abuse guard is
// a modest monthly spend cap set on the Anthropic API key itself, not a
// request-level check here.
//
// Cost: one Claude Sonnet 5.5 call at low effort, a couple thousand tokens
// in and a few hundred out (a cent or two). The client only calls this when
// the user explicitly taps "Full AI Breakdown," and caches the result
// locally afterward, so a single click is a single call - never re-run
// automatically on reload or re-render.
//
// Requires ANTHROPIC_API_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@0.129.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.5";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MODEL = "claude-sonnet-5-5";
const MAX_SESSION_CHARS = 40_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const Breakdown = z.object({
  headline: z.string(),
  wentWell: z.array(z.string()),
  notGreat: z.array(z.string()),
  howToImprove: z.array(z.string()),
  mindfulNextTime: z.array(z.string()),
});

const SYSTEM = `You write a one-time, on-demand "full AI breakdown" of a single strength-training session inside Strength Tracker, a personal lifting log. The person taps a button to request this after a specific session; it is not a running commentary and is never regenerated automatically, so make it worth the read.

You get a JSON summary of that one session, built from the app's own local data: each exercise logged that day (its value, whether it hit its rep target, difficulty/RPE, any note, and a short recent-history trend), plus which training modifiers (ski season, knee care, low back care, preseason prep) were active.

Write four short lists, each 2-4 items, each item one or two sentences:
- wentWell: what actually went right this session - lifts that progressed cleanly, good RPE management, consistency, anything genuinely solid. Be specific with names and numbers from the data.
- notGreat: real misses or concerns - missed rep targets, a worrying note, an RPE that was too high or too low for the intent, anything that stalled.
- howToImprove: concrete, actionable adjustments tied to what's actually in the data - not generic lifting advice.
- mindfulNextTime: forward-looking flags for the very next session on these same lifts - what to watch, hold, or check in on.
Also write headline: one or two sentences summarizing the session's overall character.

Rules:
- Use only numbers and facts in the summary. Never invent a reading, a weight, or a date.
- If a list genuinely has nothing to say (e.g. a flawless session with no concerns), it's fine for notGreat or mindfulNextTime to contain a single item saying so, rather than inventing a concern.
- Be specific: exercise names, numbers, units. Round sensibly.
- Voice: plain, direct, like a good coach who actually read the log. Short sentences. Never use em dashes - use commas, periods, or parentheses instead. No filler openers, no hype, no "it's worth noting," "delve," "crucial," "journey," "game-changer," "in conclusion." No medical diagnoses; if something seems to warrant a doctor or PT, say to mention it at a checkup rather than diagnosing it.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch (_e) { return json({ error: "body_must_be_json" }, 400); }
    const session = body.session;
    if (!session || typeof session !== "object") return json({ error: "missing_session" }, 400);
    const sessionText = JSON.stringify(session);
    if (sessionText.length > MAX_SESSION_CHARS) return json({ error: "session_too_large", chars: sessionText.length }, 413);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "anthropic_key_not_configured" }, 500);

    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      messages: [{ role: "user", content: "Session summary (JSON):\n" + sessionText }],
      output_config: { effort: "low", format: betaZodOutputFormat(Breakdown) },
      // On a safety-classifier decline, the API reruns the request on Anthropic's recommended
      // fallback model within the same call instead of returning a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") {
      console.error("breakdown refused:", JSON.stringify(response.stop_details ?? null));
      return json({ error: "breakdown_refused" }, 422);
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      console.error("breakdown unparseable, stop_reason:", response.stop_reason);
      return json({ error: "could_not_parse_breakdown", stop_reason: response.stop_reason }, 502);
    }

    console.log("breakdown usage", JSON.stringify(response.usage));
    return json({ breakdown: response.parsed_output, generatedAt: new Date().toISOString() });
  } catch (e) {
    console.error("workout-breakdown", e);
    return json({ error: "internal", detail: String(e instanceof Error ? e.message : e) }, 500);
  }
});
