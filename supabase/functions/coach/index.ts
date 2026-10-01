// Strength Tracker coach: two on-demand analyses from one function.
//   mode "session": short post-workout note, only about the very next session.
//   mode "weekly":  the deeper weekly check-in, still in bullets.
// POST {mode, payload} -> {breakdown: {verdict, sections: [{title, items}]}, generatedAt, context}
//
// payload is built client-side from the app's own log (buildSessionCoachPayload and
// buildWeeklyCoachPayload in index.html). When the caller is signed in and this project has
// OUTLIVE_SUPABASE_SECRET_KEY set, the function also reads that person's recovery, sleep, strain,
// rides, weight, meals and goals from the Outlive project, matched by email (the mirror image of
// Outlive's strength-sync). Without either it still runs on training data alone; `context` in the
// response says which.
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

  const days = mode === "weekly" ? 42 : 30;
  const from = shiftDate(end, -days);
  const weekly = mode === "weekly";
  const none = Promise.resolve({ data: null as Row[] | null });
  const [hrv, sleep, strain, workouts, body, meals, goals] = await Promise.all([
    ol.from("hrv").select("recorded_date, hrv_ms, resting_hr, recovery_score, source").eq("user_id", userId).gte("recorded_date", from).lte("recorded_date", end),
    ol.from("sleep").select("sleep_date, total_sleep_min, sleep_need_min, source").eq("user_id", userId).gte("sleep_date", from).lte("sleep_date", end),
    ol.from("daily_strain").select("cycle_date, strain, source").eq("user_id", userId).gte("cycle_date", from).lte("cycle_date", end),
    ol.from("workouts").select("start_time, activity_type, duration_min, avg_hr").eq("user_id", userId).gte("start_time", from).lt("start_time", shiftDate(end, 2)),
    weekly ? ol.from("daily_body").select("metric_date, weight_lb, body_fat_pct").eq("user_id", userId).gte("metric_date", from).lte("metric_date", end).not("weight_lb", "is", null) : none,
    weekly ? ol.from("meals").select("logged_at, calories, protein_g").eq("user_id", userId).gte("logged_at", shiftDate(end, -15)).lt("logged_at", shiftDate(end, 2)) : none,
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
  const hrvSeries: { d: string; v: number | null; rhr: number | null; sleepH: number | null; needH: number | null }[] = [];
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
    hrvSeries.push({ d, v: num(h?.hrv_ms), rhr: num(h?.resting_hr), sleepH, needH });
  }
  const last7 = hrvSeries.filter((x) => x.d > shiftDate(end, -7));
  const last30 = hrvSeries.filter((x) => x.d > shiftDate(end, -30));
  const averages = {
    hrv30: round(avg(last30.map((x) => x.v))), hrv7: round(avg(last7.map((x) => x.v))),
    rhr30: round(avg(last30.map((x) => x.rhr)), 1), rhr7: round(avg(last7.map((x) => x.rhr)), 1),
    sleepH7: round(avg(last7.map((x) => x.sleepH)), 1), sleepNeedH7: round(avg(last7.map((x) => x.needH)), 1),
  };

  const data: Row = {
    goals: goals.data?.value ?? null,
    recoveryDays,
    recoveryAverages: averages,
  };

  if (weekly) {
    const weights = ((body.data as Row[]) ?? []).map((r) => ({ d: String(r.metric_date), w: num(r.weight_lb), bf: num(r.body_fat_pct) }));
    weights.sort((a, b) => (a.d < b.d ? -1 : 1));
    const windowAvg = (lo: number, hi: number) =>
      round(avg(weights.filter((x) => x.d > shiftDate(end, -hi) && x.d <= shiftDate(end, -lo)).map((x) => x.w)), 1);
    const avgNow = windowAvg(0, 7), avgPrev = windowAvg(7, 14), avg4wAgo = windowAvg(28, 35);
    const g = (goals.data?.value ?? {}) as { weight?: { targetLb?: number; by?: string } };
    let neededPerWeek: number | null = null;
    if (avgNow != null && g.weight?.targetLb && isDate(g.weight.by)) {
      const weeksLeft = (new Date(g.weight.by + "T00:00:00Z").getTime() - new Date(end + "T00:00:00Z").getTime()) / 604800000;
      if (weeksLeft > 0) neededPerWeek = round((avgNow - g.weight.targetLb) / weeksLeft, 2);
    }
    data.weight = {
      weighIns: weights.map((x) => `${x.d} ${x.w}${x.bf != null ? ` (bf ${x.bf}%)` : ""}`),
      avg7: avgNow, avgPrior7: avgPrev, avg4WeeksAgo: avg4wAgo,
      changePerWeek: avgNow != null && avgPrev != null ? round(avgNow - avgPrev, 1) : null,
      lossNeededPerWeekForGoal: neededPerWeek,
    };

    const dayTotals = new Map<string, { kcal: number; protein: number; entries: number }>();
    for (const m of (meals.data as Row[]) ?? []) {
      const d = localDay(m.logged_at, tz);
      if (d < shiftDate(end, -13) || d > end) continue;
      const t = dayTotals.get(d) ?? { kcal: 0, protein: 0, entries: 0 };
      t.kcal += num(m.calories) ?? 0;
      t.protein += num(m.protein_g) ?? 0;
      t.entries += 1;
      dayTotals.set(d, t);
    }
    const days14 = [...dayTotals.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    const week = days14.filter(([d]) => d > shiftDate(end, -7));
    data.nutrition = {
      days: days14.map(([d, t]) => `${d} ${Math.round(t.kcal)} kcal, ${Math.round(t.protein)} g protein, ${t.entries} entries`),
      last7: {
        daysLogged: week.length,
        avgKcal: round(avg(week.map(([, t]) => t.kcal))),
        avgProtein: round(avg(week.map(([, t]) => t.protein))),
      },
    };
  }
  return { status: "outlive_ok", data };
}

// ---------- prompts and output shapes ----------
const SESSION_SYSTEM = `You are the athlete's strength coach. Right after a lifting session they tap a button for your post-workout note. Its only job: what to change and watch for in the very next session. A separate weekly check-in covers the big picture, so stay narrow.

Input is JSON: each exercise in the session with today's result, its last 8 results (date, weight and sets x reps, RPE after @, note in quotes) and the app's own next-session suggestion; active training modes; days since the previous session. When available, an "outlive" block adds goals and training phases, daily recovery lines (Whoop recovery %, HRV, resting HR, sleep vs need, day strain, rides and other workouts) and 30-day vs 7-day averages.

Write:
- verdict: one or two sentences. The so-what of this session, in light of the goal and current phase.
- recovery: up to 3 bullets linking recovery, sleep, strain or rides to how this session went or how hard the next one should be. Cite specific numbers and dates. Look for patterns, such as hard or failed sets that follow low recovery, short sleep or big ride days. Empty list when there is no recovery data or nothing notable.
- howToImprove: 3 to 5 bullets, one per lift that needs a decision, written "Lift: target. Reason." with a concrete weight and sets x reps. The app suggestion is the default; override it only with a stated reason (RPE, a note, pain, recovery, phase). Favor the lifts that matter most for the current phase.
- mindfulNextTime: 1 to 3 bullets, most important first. Recurring pain or injury notes (name the dates), a recovery rule for the next session (for example, repeat weights instead of adding when recovery is under 35% or sleep under 5 hours), fueling only if it plausibly affected this session.

Rules:
- Each bullet under 25 words. No intro, no filler.
- Never restate a number without saying what it means for the next session.
- Skip accessories that are on track. Skip generic advice such as warming up, hydrating or sleeping more.
- Use only the data given. Never invent a reading, weight or date.
- No medical diagnosis. If pain recurs, say to get it checked by a physio or doctor.
- Never use em dashes. Use commas, periods or colons instead.`;

const WEEKLY_SYSTEM = `You are the athlete's strength and conditioning coach writing the weekly check-in they request once a week. It is the holistic review: training, recovery, body composition, fueling and where they are in the plan. Go deep, but always in short bullets, never paragraphs. The post-workout note already handles next-session tweaks, so think in weeks and phases.

Input is JSON: the week (weekStart to weekEnd), session dates, and up to 6 weeks of history per lift (date, weight and sets x reps, RPE after @, note in quotes) with the app's next-session suggestion. When available, an "outlive" block adds goals (weight target and date, calorie and protein targets, training phases with their focus), daily recovery lines (Whoop recovery %, HRV, resting HR, sleep vs need, strain, rides and other workouts) with 30-day vs 7-day averages, weigh-ins with 7-day averages and the loss per week the goal needs, and daily logged calories and protein.

Write:
- verdict: one or two sentences on the week, in light of the goal and phase.
- training: 3 to 5 bullets. Progress by movement pattern (push, pull, hinge, squat and single-leg, power), push vs pull balance, stalls, and the lifts that matter most for the current phase.
- recovery: 2 to 4 bullets. HRV and resting HR this week vs the 30-day baseline, sleep vs need, how rides and lifts stacked, and any link between low recovery and hard or failed sets.
- bodyComp: 2 to 4 bullets. 7-day average weight vs the goal pace (loss per week needed vs actual), average calories and protein vs targets, and how many days protein was hit. When days look incomplete (few entries, very low totals), call it a logging gap rather than real intake.
- phase: 1 to 3 bullets. Where they are in the plan and what should shift soon (such as the move into ski prep), plus a deload call: count the weeks of steady loading since the last lighter week and say when a deload is due, especially if HRV is trending down or pain notes are piling up.
- nextWeek: 3 to 5 bullets. A concrete plan: which days to lift relative to big rides, priority lifts with targets, one nutrition fix, one recovery rule.

Rules:
- Each bullet under 30 words. Lead with the finding, then the action.
- Never restate a number without saying what it means. No generic advice.
- Use only the data given. Never invent a reading, weight or date. If an area has no data, give one bullet saying what is missing.
- No medical diagnosis. If pain recurs, say to get it checked by a physio or doctor.
- Never use em dashes. Use commas, periods or colons instead.`;

const SessionOut = z.object({
  verdict: z.string(),
  recovery: z.array(z.string()),
  howToImprove: z.array(z.string()),
  mindfulNextTime: z.array(z.string()),
});
const WeeklyOut = z.object({
  verdict: z.string(),
  training: z.array(z.string()),
  recovery: z.array(z.string()),
  bodyComp: z.array(z.string()),
  phase: z.array(z.string()),
  nextWeek: z.array(z.string()),
});

function toSections(mode: "session" | "weekly", out: Record<string, unknown>) {
  const titles: [string, string][] = mode === "session"
    ? [["recovery", "Recovery context"], ["howToImprove", "How to improve next session"], ["mindfulNextTime", "Be mindful of"]]
    : [["training", "Training"], ["recovery", "Recovery"], ["bodyComp", "Body comp and fuel"], ["phase", "Phase and deload"], ["nextWeek", "Next week"]];
  return {
    verdict: String(out.verdict ?? ""),
    sections: titles
      .map(([k, title]) => ({ title, items: (out[k] as string[] | undefined) ?? [] }))
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
      max_tokens: mode === "weekly" ? 12000 : 8000,
      system: mode === "weekly" ? WEEKLY_SYSTEM : SESSION_SYSTEM,
      messages: [{ role: "user", content: "Data (JSON):\n" + JSON.stringify({ ...payload, outlive: context.data }) }],
      output_config: {
        effort: mode === "weekly" ? "medium" : "low",
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
