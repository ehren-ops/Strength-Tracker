// Strength Tracker coach: two on-demand, strength-focused analyses from one function.
//   mode "session": post-workout note. A verdict, 2-3 insights, and only the lifts to change next time.
//   mode "weekly":  weekly check-in. What's moving, what's lagging, imbalances, block and deload,
//                   next week's focus, and at most one bodyweight line.
// POST {mode, payload} -> {breakdown: {verdict, sections: [{title, items}]}, generatedAt, context}
//
// payload is built client-side from the app's own log (buildSessionCoachPayload and
// buildWeeklyCoachPayload in index.html). When the caller is signed in and this project has
// OUTLIVE_SUPABASE_SECRET_KEY set, the function also reads that person's goals and phases, recent
// recovery and rides (used only to explain a lift result), and the bodyweight trend (weekly only)
// from the Outlive project, matched by email (the mirror image of Outlive's strength-sync). Outlive
// itself owns recovery and nutrition analysis. Without the link it still runs on training data
// alone; `context` in the response says which.
//
// Unauthenticated on purpose (verify_jwt: false): the app works with no account at all. The abuse
// guard is a spend cap on the Anthropic key. Requires ANTHROPIC_API_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@0.129.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.5";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const MODEL = "claude-sonnet-5-5";
const OUTLIVE_URL = Deno.env.get("OUTLIVE_SUPABASE_URL") ?? "https://szsgxlbvleviuzobhuty.supabase.co";
const MAX_PAYLOAD_CHARS = 80_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
function shiftDate(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const num = (v: unknown) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const round = (v: number | null, dp = 0) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp);
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// ---------- who is calling ----------
async function callerEmail(req: Request): Promise<string | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const st = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data } = await st.auth.getUser(jwt);
  return data?.user?.email?.toLowerCase() ?? null;
}

// ---------- Outlive context ----------
type Row = Record<string, unknown>;

function localDay(ts: unknown, tz: string) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(String(ts))); }
  catch (_e) { return String(ts).slice(0, 10); }
}

// One row per date, preferring Whoop when a day has several sources.
function byDate(rows: Row[] | null, key: string) {
  const m = new Map<string, Row>();
  for (const r of rows ?? []) {
    const d = String(r[key]);
    const prev = m.get(d);
    if (!prev || (r.source === "whoop" && prev.source !== "whoop")) m.set(d, r);
  }
  return m;
}

function activityLabel(a: Row) {
  const t = String(a.activity_type ?? "");
  const m = t.match(/\(([^)]+)\)\s*$/);
  const kind = m ? m[1] : t;
  const mins = round(num(a.duration_min));
  const hr = round(num(a.avg_hr));
  return `${kind} ${mins}min${hr ? " hr" + hr : ""}`;
}

async function outliveContext(email: string, mode: "session" | "weekly", end: string, tz: string) {
  const key = Deno.env.get("OUTLIVE_SUPABASE_SECRET_KEY")?.trim();
  if (!key) return { status: "outlive_not_configured", data: null };
  const ol = createClient(OUTLIVE_URL, key, { auth: { persistSession: false } });

  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data, error } = await ol.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { status: "outlive_lookup_failed", data: null };
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) userId = match.id;
    if (data.users.length < 200) break;
  }
  if (!userId) return { status: "no_outlive_account", data: null };

  const from = shiftDate(end, -14);
  const weekly = mode === "weekly";
  const none = Promise.resolve({ data: null as Row[] | null });
  const [hrv, sleep, strain, workouts, body, goals] = await Promise.all([
    ol.from("hrv").select("recorded_date, hrv_ms, resting_hr, recovery_score, source").eq("user_id", userId).gte("recorded_date", from).lte("recorded_date", end),
    ol.from("sleep").select("sleep_date, total_sleep_min, sleep_need_min, source").eq("user_id", userId).gte("sleep_date", from).lte("sleep_date", end),
    ol.from("daily_strain").select("cycle_date, strain, source").eq("user_id", userId).gte("cycle_date", from).lte("cycle_date", end),
    ol.from("workouts").select("start_time, activity_type, duration_min, avg_hr").eq("user_id", userId).gte("start_time", from).lt("start_time", shiftDate(end, 2)),
    weekly ? ol.from("daily_body").select("metric_date, weight_lb").eq("user_id", userId).gte("metric_date", shiftDate(end, -35)).lte("metric_date", end).not("weight_lb", "is", null) : none,
    ol.from("page_content").select("value").eq("user_id", userId).eq("page", "coach").eq("key", "goals").maybeSingle(),
  ]);

  const hrvBy = byDate(hrv.data as Row[], "recorded_date");
  const sleepBy = byDate(sleep.data as Row[], "sleep_date");
  const strainBy = byDate(strain.data as Row[], "cycle_date");
  const actBy = new Map<string, string[]>();
  for (const a of (workouts.data as Row[]) ?? []) {
    if ((num(a.duration_min) ?? 0) < 15) continue;
    const d = localDay(a.start_time, tz);
    if (d < from || d > end) continue;
    actBy.set(d, [...(actBy.get(d) ?? []), activityLabel(a)]);
  }

  // One compact line per day: cheaper and easier for the model than nested objects.
  const recoveryDays: string[] = [];
  for (let d = from; d <= end; d = shiftDate(d, 1)) {
    const h = hrvBy.get(d), s = sleepBy.get(d), st = strainBy.get(d), acts = actBy.get(d);
    if (!h && !s && !st && !acts) continue;
    const sleepH = round(num(s?.total_sleep_min) != null ? num(s?.total_sleep_min)! / 60 : null, 1);
    const needH = round(num(s?.sleep_need_min) != null ? num(s?.sleep_need_min)! / 60 : null, 1);
    const parts = [d];
    if (h) parts.push(`recovery ${round(num(h.recovery_score)) ?? "?"}% hrv ${round(num(h.hrv_ms)) ?? "?"} rhr ${round(num(h.resting_hr)) ?? "?"}`);
    if (s) parts.push(`sleep ${sleepH ?? "?"}h of ${needH ?? "?"}h need`);
    if (st) parts.push(`strain ${round(num(st.strain), 1)}`);
    if (acts) parts.push(acts.join(", "));
    recoveryDays.push(parts.join(" | "));
  }
  const data: Row = {
    goals: goals.data?.value ?? null,
    recoveryDays,
  };

  if (weekly) {
    const weights = ((body.data as Row[]) ?? []).map((r) => ({ d: String(r.metric_date), w: num(r.weight_lb) }));
    const windowAvg = (lo: number, hi: number) =>
      round(avg(weights.filter((x) => x.d > shiftDate(end, -hi) && x.d <= shiftDate(end, -lo)).map((x) => x.w)), 1);
    data.bodyweight = { avg7: windowAvg(0, 7), avg4WeeksAgo: windowAvg(28, 35) };
  }
  return { status: "outlive_ok", data };
}

// ---------- prompts and output shapes ----------
const PRINCIPLES = `Your value is synthesis the athlete cannot see on the log screen. They already see every weight, set, rep and RPE they logged, so never hand those back. Every bullet must be an insight: a pattern across sessions, a comparison between lifts or movement patterns, a likely cause, or a decision. Numbers appear only as brief evidence for the insight, never as the point.
Bad: "Bench Press: 170 lb 3x8 at RPE 7."
Good: "Pressing is outrunning pulling: bench is up about 17% in 4 weeks while rows and pulldowns have sat still for 3."

Look for:
- Divergence between movement patterns (push vs pull, squat vs hinge, upper vs lower, compounds vs accessories). Use the "patterns" summary and each lift's "trend".
- Stalled vs unpushed: several sessions at one load with RPE 7 or below is unpushed, not stalled. Rising RPE at the same load is real fatigue. Falling e1RM while related lifts climb points to a shared limiter (grip, a joint, fatigue from earlier exercises).
- Notes that cluster by body region or keep repeating across weeks.
- Progressions that jumped too far, and lifts that matter most for the current training phase and goal.
- Recovery data, when present, is only an explainer: use it only when it explains a specific lift result (for example a hard set the day after a long ride or a short night). Never summarize recovery, sleep or HRV trends on their own; another app covers that.

Rules:
- Short bullets, under 28 words. Lead with the finding.
- Use only the data given. Never invent a reading, weight or date.
- No generic advice (warm up, hydrate, sleep more, listen to your body).
- No medical diagnosis. If pain notes recur, say to get it checked by a physio or doctor.
- Never use em dashes. Use commas, periods or colons instead.`;

const SESSION_SYSTEM = `You are the athlete's strength coach writing a short note right after a lifting session. Think about how this session fits the last several weeks before writing.

Input is JSON: each lift done today with today's result, its last 8 results (date, weight and sets x reps, RPE after @, note in quotes), the app's own next-session suggestion and a pre-computed "trend" (movement pattern, 4-week e1RM change, sessions at the current load, RPE at that load); a "patterns" summary across all lifts; active training modes. When available, an "outlive" block adds goals and training phases plus 14 days of recovery lines.

${PRINCIPLES}

Write:
- verdict: one sentence, the so-what of this session in the context of the last few weeks and the current phase.
- insights: 2 to 3 bullets, the most important things you see. Connect lifts and weeks. Today's session should be the lens, but the insight can reach across the whole program.
- nextSession: 2 to 4 bullets, only lifts whose plan should change or that need a deliberate decision, written "Lift: action. Why." The app already shows its default next weight for every lift, so skip lifts where you agree with it unless the reason matters.`;

const WEEKLY_SYSTEM = `You are the athlete's strength coach writing the weekly check-in. It is the big-picture strength review: how the program is moving as a whole, where it is lopsided, and what to prioritize next week. Think it through across all lifts and weeks before writing.

Input is JSON: the week (weekStart to weekEnd), session dates, up to 6 weeks of history per lift (date, weight and sets x reps, RPE after @, note in quotes), the app's next-session suggestion and a pre-computed "trend" per lift, and a "patterns" summary. When available, an "outlive" block adds goals and training phases, 14 days of recovery lines, and a bodyweight trend.

${PRINCIPLES}

Write:
- verdict: one or two sentences on where the program stands this week, in the context of the goal and phase.
- moving: 1 to 3 bullets on what is progressing well and why it is working.
- lagging: 1 to 3 bullets on what is stalled, regressing or unpushed, and the likely reason.
- risks: 1 to 3 bullets on imbalances, recurring pain or limiters (grip, a joint, exercise order) that could stall progress.
- block: 1 to 2 bullets on the training block: weeks of steady loading since the last lighter week, whether a deload is due and why, and what should shift for the coming phase.
- nextWeek: 3 to 4 bullets of priorities for next week, written as focus points, not a full workout list.
- bodyweight: one short sentence only if bodyweight changes the strength picture (for example strength rising while weight drops means relative strength is up). Otherwise an empty string.`;

const SessionOut = z.object({
  verdict: z.string(),
  insights: z.array(z.string()),
  nextSession: z.array(z.string()),
});
const WeeklyOut = z.object({
  verdict: z.string(),
  moving: z.array(z.string()),
  lagging: z.array(z.string()),
  risks: z.array(z.string()),
  block: z.array(z.string()),
  nextWeek: z.array(z.string()),
  bodyweight: z.string(),
});

function toSections(mode: "session" | "weekly", out: Record<string, unknown>) {
  const titles: [string, string][] = mode === "session"
    ? [["insights", "What I'm seeing"], ["nextSession", "Next session"]]
    : [["moving", "What's moving"], ["lagging", "What's lagging"], ["risks", "Imbalances and risks"], ["block", "Block and deload"], ["nextWeek", "Next week's focus"], ["bodyweight", "Bodyweight"]];
  return {
    verdict: String(out.verdict ?? ""),
    sections: titles
      .map(([k, title]) => {
        const v = out[k];
        const items = Array.isArray(v) ? v : typeof v === "string" && v.trim() ? [v.trim()] : [];
        return { title, items };
      })
      .filter((s) => s.items.length),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch (_e) { return json({ error: "body_must_be_json" }, 400); }
    const mode = body.mode === "weekly" ? "weekly" : "session";
    const payload = body.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== "object") return json({ error: "missing_payload" }, 400);
    if (JSON.stringify(payload).length > MAX_PAYLOAD_CHARS) return json({ error: "payload_too_large" }, 413);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "anthropic_key_not_configured" }, 500);

    const end = isDate(payload.weekEnd) ? payload.weekEnd : isDate(payload.date) ? payload.date : new Date().toISOString().slice(0, 10);
    const tz = typeof payload.tz === "string" ? payload.tz : "UTC";

    let context: { status: string; data: Row | null } = { status: "signed_out", data: null };
    const email = await callerEmail(req).catch(() => null);
    if (email) {
      context = await outliveContext(email, mode, end, tz).catch((e) => {
        console.error("outlive context failed:", e);
        return { status: "outlive_error", data: null };
      });
    }

    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: mode === "weekly" ? WEEKLY_SYSTEM : SESSION_SYSTEM,
      messages: [{ role: "user", content: "Data (JSON):\n" + JSON.stringify({ ...payload, outlive: context.data }) }],
      output_config: {
        effort: mode === "weekly" ? "high" : "medium",
        format: betaZodOutputFormat(mode === "weekly" ? WeeklyOut : SessionOut),
      },
      // On a safety-classifier decline, the API reruns the request on Anthropic's recommended
      // fallback model within the same call instead of returning a refusal.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason === "refusal") {
      console.error("coach refused:", JSON.stringify(response.stop_details ?? null));
      return json({ error: "breakdown_refused" }, 422);
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      console.error("coach unparseable, stop_reason:", response.stop_reason);
      return json({ error: "could_not_parse_breakdown", stop_reason: response.stop_reason }, 502);
    }

    console.log("coach", mode, context.status, "usage", JSON.stringify(response.usage));
    return json({
      breakdown: toSections(mode, response.parsed_output as Record<string, unknown>),
      generatedAt: new Date().toISOString(),
      context: context.status,
    });
  } catch (e) {
    console.error("coach", e);
    return json({ error: "internal", detail: String(e instanceof Error ? e.message : e) }, 500);
  }
});
