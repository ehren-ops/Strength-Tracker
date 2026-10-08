// Strength Tracker coach: two on-demand, strength-focused analyses from one function.
//   mode "session": post-workout note. A verdict, 2-3 insights, and only the lifts to change next time.
//   mode "weekly":  weekly check-in. What's moving, what's lagging, imbalances, block and deload,
//                   next week's focus, and at most one bodyweight line.
// POST {mode, payload} -> {breakdown: {verdict, sections: [{title, items}]}, generatedAt, context}
//   mode "hr":      no model call and no daily cap. payload {tz, sessions: {date: [{name, at}]}} ->
//                   {sessions: {date: {status, elapsedMin, avgHr, maxHr, lifts: [{name, at, min, avg, peak}]}}}
//                   for the app to show per-lift heart rate once Whoop has synced to Strava.
//
// payload is built client-side from the app's own log (buildSessionCoachPayload and
// buildWeeklyCoachPayload in js/09-coach-overview.js). When the caller is signed in and this project has
// OUTLIVE_SUPABASE_SECRET_KEY set, the function also reads that person's goals and phases, recent
// recovery and rides (used only to explain a lift result), and the bodyweight trend (weekly only)
// from the Outlive project, matched by email (the mirror image of Outlive's strength-sync). Outlive
// itself owns recovery and nutrition analysis. Without the link it still runs on training data
// alone; `context` in the response says which.
//
// Signed-in callers only. verify_jwt stays false so CORS preflights pass, and the function checks
// the caller's Supabase session itself: no session, no Anthropic call. Each account is also capped
// at DAILY_CALL_CAP calls per day, resetting at midnight in the time zone the app sends
// (coach_bump in the database), so an account made through the open sign-up form can't run up the
// Anthropic bill. Requires ANTHROPIC_API_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@0.129.0";
import { betaZodOutputFormat } from "npm:@anthropic-ai/sdk@0.129.0/helpers/beta/zod";
import { z } from "npm:zod@4.6.5";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const MODEL = "claude-sonnet-5-5";
const OUTLIVE_URL = Deno.env.get("OUTLIVE_SUPABASE_URL") ?? "https://szsgxlbvleviuzobhuty.supabase.co";
const MAX_PAYLOAD_CHARS = 80_000;
const DAILY_CALL_CAP = 10;

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
function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

async function caller(req: Request): Promise<{ id: string; email: string | null } | null> {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data } = await serviceClient().auth.getUser(jwt);
  const u = data?.user;
  return u ? { id: u.id, email: u.email?.toLowerCase() ?? null } : null;
}

// ---------- Outlive context ----------
type Row = Record<string, unknown>;

// A time zone the runtime knows, else UTC. It comes from the caller, so it is checked before use.
function validTz(tz: unknown) {
  if (typeof tz !== "string") return "UTC";
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch (_e) { return "UTC"; }
}

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

// ---------- heart rate per lift ----------
// The wearable's heart-rate stream (Whoop via Strava, fetched by Outlive's strava-hr function) is
// split into one window per lift using anchors the app sends: when each lift was logged, plus each
// rest-timer start (a set of that lift just ended). The athlete logs a lift right after its first
// set, so a lift's earliest anchor marks the end of its first set and its other sets follow. Each
// split between lifts therefore falls just before the next lift's first set: at the lowest heart
// rate in the few minutes before its earliest anchor, where the switch (rest, setup, walking over)
// lets HR bottom out. A lift with only its log is marked logOnly for the model.
type Log = { name: string; at: string; kind?: string; sets?: number };
const HR_MAX_SESSIONS = 4; // per hr-only request: each session is two Strava calls

function clock(ms: number, tz: string) {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms)); }
  catch (_e) { return new Date(ms).toISOString().slice(11, 16); }
}

async function hrStream(start: number, end: number) {
  const key = Deno.env.get("OUTLIVE_SUPABASE_SECRET_KEY")?.trim();
  if (!key) return null;
  const resp = await fetch(`${OUTLIVE_URL}/functions/v1/strava-hr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ start: new Date(start).toISOString(), end: new Date(end).toISOString() }),
  });
  if (!resp.ok) { console.error("strava-hr", resp.status, await resp.text()); return null; }
  return await resp.json() as { activity: Row | null; samples: [number, number][] };
}

type Lift = { name: string; log: number | null; anchors: number[]; sets: number };
// Group anchors by lift, in the order the lifts were logged (a lift with only rest taps goes by its
// first tap). Anchors within 30 s of each other are one set end (a tap and a log for the same set).
function liftsFromAnchors(ls: Log[]): Lift[] {
  const by = new Map<string, Lift>();
  for (const l of ls) {
    const t = Date.parse(l.at);
    const cur = by.get(l.name) ?? { name: l.name, log: null, anchors: [], sets: 0 };
    if (l.kind !== "rest") { cur.log = cur.log == null ? t : Math.max(cur.log, t); cur.sets = Math.max(cur.sets, Number(l.sets) || 0); }
    if (!cur.anchors.some((x) => Math.abs(x - t) < 30_000)) cur.anchors.push(t);
    by.set(l.name, cur);
  }
  const lifts = [...by.values()];
  lifts.forEach((x) => x.anchors.sort((p, q) => p - q));
  return lifts.sort((x, y) => (x.log ?? x.anchors[0]) - (y.log ?? y.anchors[0]));
}

async function sessionHeartRate(logs: unknown, tz: string) {
  if (!Array.isArray(logs) || logs.length < 2) return null;
  const valid = (logs as Log[]).filter((l) => l && typeof l.name === "string" && Number.isFinite(Date.parse(l.at)))
    .sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  // Keep the main block of the session: a lift logged hours later (cardio entered the next
  // morning, say) would stretch the window past anything the wearable recorded together.
  const clusters: Log[][] = [];
  for (const l of valid) {
    const cur = clusters[clusters.length - 1];
    if (cur && Date.parse(l.at) - Date.parse(cur[cur.length - 1].at) <= 90 * 60_000) cur.push(l);
    else clusters.push([l]);
  }
  const block = clusters.sort((x, y) => y.length - x.length)[0] ?? [];
  const lifts = liftsFromAnchors(block);
  if (lifts.length < 2) return null;
  const all = block.map((l) => Date.parse(l.at));
  const first = Math.min(...all), last = Math.max(...all);
  // Sets imported in bulk share one timestamp: not a real timeline, so no per-lift split.
  if (lifts.length >= 3 && last - first < 5 * 60_000) return { status: "no_log_timeline" };
  const res = await hrStream(first - 75 * 60_000, last + 20 * 60_000).catch((e) => { console.error("strava-hr", e); return null; });
  if (!res) return { status: "hr_unavailable" };
  if (!res.activity || !res.samples?.length) return { status: "not_uploaded_yet" };
  const actStart = Date.parse(String(res.activity.startTime));
  const actEnd = actStart + (num(res.activity.elapsedSec) ?? 0) * 1000;
  const samples = res.samples.map(([t, h]) => [t * 1000, h] as [number, number]);
  // 20-second average, so one noisy reading doesn't pick the split.
  const smoothAt = (i: number) => {
    const t = samples[i][0];
    let sum = 0, n = 0;
    for (let j = i; j >= 0 && t - samples[j][0] <= 10_000; j--) { sum += samples[j][1]; n++; }
    for (let j = i + 1; j < samples.length && samples[j][0] - t <= 10_000; j++) { sum += samples[j][1]; n++; }
    return sum / n;
  };
  const lowestBetween = (a: number, b: number) => {
    let best: [number, number] | null = null;
    samples.forEach(([t], i) => { if (t > a && t < b) { const h = smoothAt(i); if (!best || h < best[1]) best = [t, h]; } });
    return best ? best[0] : (a + b) / 2;
  };
  // Lift B's first set ends at its earliest anchor; it started a set's length before that, and the
  // switch from the lift before sits in the few minutes ahead of it.
  const SWITCH_LOOKBACK = 4 * 60_000, SET_LEAD = 30_000;
  const splitBefore = (firstB: number, notBefore: number) => {
    const a = Math.max(notBefore, firstB - SWITCH_LOOKBACK), b = firstB - SET_LEAD;
    return b > a ? lowestBetween(a, b) : Math.max(notBefore, (notBefore + firstB) / 2);
  };
  const bounds: number[] = [];
  for (let i = 0; i < lifts.length - 1; i++) {
    const A = lifts[i], B = lifts[i + 1];
    // A's own set ends (its anchors) stay on A's side, plus a moment for its heart rate to peak.
    bounds.push(splitBefore(B.anchors[0], A.anchors[A.anchors.length - 1] + 40_000));
  }
  const per = lifts.map((l, i) => {
    // The first lift starts just before its first set, so warm-up and arrival stay out.
    const from = i ? bounds[i - 1] : splitBefore(l.anchors[0], actStart);
    const to = i < lifts.length - 1 ? bounds[i] : Math.min(actEnd || Infinity, l.anchors[l.anchors.length - 1] + 15 * 60_000);
    const w = samples.filter(([t]) => t > from && t <= to).map(([, h]) => h);
    const min = Math.round((to - from) / 60_000);
    const logOnly = l.anchors.length < 2;
    const at = new Date(l.log ?? l.anchors[l.anchors.length - 1]).toISOString();
    return w.length < 3
      ? { name: l.name, at, min, avg: null, peak: null, logOnly }
      : { name: l.name, at, min, avg: Math.round(w.reduce((x, y) => x + y, 0) / w.length), peak: Math.max(...w), logOnly };
  });
  const a = res.activity;
  const elapsedMin = round(num(a.elapsedSec) != null ? num(a.elapsedSec)! / 60 : null);
  return {
    status: "ok",
    session: `${elapsedMin} min, avg ${round(num(a.avgHr))}, max ${round(num(a.maxHr))}`,
    lifts: per.map((x) => x.avg == null
      ? `${x.name}: no heart rate in its window`
      : `${x.name} ${clock(Date.parse(x.at), tz)} (${x.min} min): peak ${x.peak}, avg ${x.avg}${x.logOnly ? " (log time only)" : ""}`),
    // Numbers for the app's own display (history rows, the post-workout breakdown); the prompt
    // only sees the text lines above.
    numbers: { elapsedMin, avgHr: round(num(a.avgHr)), maxHr: round(num(a.maxHr)), lifts: per },
  };
}

// The model reads the text lines; the numbers block is for the app.
function textOnly(h: Row) { const { numbers: _n, ...rest } = h; return rest; }

// ---------- prompts and output shapes ----------
const PRINCIPLES = `Your value is synthesis the athlete cannot see on the log screen. They already see every weight, set, rep and RPE they logged, so never hand those back. Every bullet must be an insight: a pattern across sessions, a comparison between lifts or movement patterns, a likely cause, or a decision. Numbers appear only as brief evidence for the insight, never as the point.
Bad: "Bench Press: 170 lb 3x8 at RPE 7."
Good: "Pressing is outrunning pulling: bench is up about 17% in 4 weeks while rows and pulldowns have sat still for 3."

Look for:
- Divergence between movement patterns (push vs pull, squat vs hinge, upper vs lower, compounds vs accessories). Use the "patterns" summary and each lift's "trend".
- Stalled vs unpushed: several sessions at one load with RPE 7 or below is unpushed, not stalled. Rising RPE at the same load is real fatigue. Falling e1RM while related lifts climb points to a shared limiter (grip, a joint, fatigue from earlier exercises).
- Exercise order: lifts are normally done in their numbered order (#1 first). A lift done out of its planned place usually means its equipment was busy, not a choice, so never criticize the swap itself. Do use it to explain a result: a lift done later than planned was done more fatigued, one done earlier, fresher. Recommend changing the program order only when a pattern across sessions shows the order is holding back a priority lift, and then say the numbered order should change.
- Notes that cluster by body region or keep repeating across weeks.
- Progressions that jumped too far, and lifts that matter most for the current training phase and goal.
- Heart rate, when "heartRate" has status "ok": each lift's peak and average come from the wearable stream split between lifts using when each lift was logged and when its rest timer was started, so the window holds that lift's sets and rests. The athlete logs each lift right after its first set, so each window runs from just before that lift's first set to just before the next lift's. A lift marked "(log time only)" relies on that habit alone (no rest-timer starts); the split is consistent session to session, so compare the same lift across sessions, but treat one odd reading as possible mislogging before building a conclusion on it. Treat it as effort evidence and compare like for like: the same lift at a similar load against the comparison session (lower HR at the same or heavier load means better conditioning; higher means fatigue, heat or shorter rests). Accessories pushing HR as high as the main lifts suggest rests too short or circuit pacing. High RPE with modest HR points to a local muscular limit, not cardio. Cite HR only when it changes a conclusion. If heartRate is missing or its status is not "ok", ignore it and never mention heart rate.
- Recovery data, when present, is only an explainer: use it only when it explains a specific lift result (for example a hard set the day after a long ride or a short night). Never summarize recovery, sleep or HRV trends on their own; another app covers that.

Rules:
- Short bullets, under 28 words. Lead with the finding.
- Use only the data given. Never invent a reading, weight or date.
- No generic advice (warm up, hydrate, sleep more, listen to your body).
- No medical diagnosis. If pain notes recur, say to get it checked by a physio or doctor.
- Never use em dashes. Use commas, periods or colons instead.`;

const SESSION_SYSTEM = `You are the athlete's strength coach writing a short note right after a lifting session. Think about how this session fits the last several weeks before writing.

Input is JSON: each lift done today with today's result, its last 8 results (date, weight and sets x reps, RPE after @, note in quotes), the app's own next-session suggestion and a pre-computed "trend" (movement pattern, 4-week e1RM change, sessions at the current load, RPE at that load); a "patterns" summary across all lifts; active training modes; a "deload" status (whether a deload week is on, the last one, the next due date); "order" (the lifts in the order they were logged today, each with its planned number, plus any done out of order; null if unknown); "heartRate" (today's session and, under "compare", the latest earlier session of the same day type: per-lift peak and average HR with each lift's log time and window length). Results tagged [deload] were intentionally light, never a regression. When available, an "outlive" block adds goals and training phases plus 14 days of recovery lines.

${PRINCIPLES}

Write:
- verdict: one sentence, the so-what of this session in the context of the last few weeks and the current phase.
- insights: 2 to 3 bullets, the most important things you see. Connect lifts and weeks. Today's session should be the lens, but the insight can reach across the whole program.
- nextSession: 2 to 4 bullets, only lifts whose plan should change or that need a deliberate decision, written "Lift: action. Why." The app already shows its default next weight for every lift, so skip lifts where you agree with it unless the reason matters.`;

const WEEKLY_SYSTEM = `You are the athlete's strength coach writing the weekly check-in. It is the big-picture strength review: how the program is moving as a whole, where it is lopsided, and what to prioritize next week. Think it through across all lifts and weeks before writing.

Input is JSON: the week (weekStart to weekEnd), session dates, up to 6 weeks of history per lift (date, weight and sets x reps, RPE after @, note in quotes), the app's next-session suggestion and a pre-computed "trend" per lift, a "patterns" summary, a "deload" status (on or off, the last deload, the next due date), "sessionOrders" (for sessions in the last 14 days, the lifts in logged order with planned numbers and any done out of order), and "heartRate" (per-lift peak and average HR for this week's sessions, by date). Results tagged [deload] were intentionally light, never a regression. When available, an "outlive" block adds goals and training phases, 14 days of recovery lines, and a bodyweight trend.

${PRINCIPLES}

Write:
- verdict: one or two sentences on where the program stands this week, in the context of the goal and phase.
- moving: 1 to 3 bullets on what is progressing well and why it is working.
- lagging: 1 to 3 bullets on what is stalled, regressing or unpushed, and the likely reason.
- risks: 1 to 3 bullets on imbalances, recurring pain or limiters (grip, a joint, exercise order) that could stall progress.
- block: 1 to 2 bullets on the training block: weeks of steady loading since the last deload (use the deload status), whether a deload is due and why, and what should shift for the coming phase. If a deload week is on, say what to watch for coming out of it.
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

    // Heart rate only: per-lift numbers for sessions the app hasn't filled in yet. No model call,
    // so it doesn't count toward the daily AI cap; it still needs a signed-in account.
    if (body.mode === "hr") {
      const who = await caller(req).catch(() => null);
      if (!who) return json({ error: "not_signed_in" }, 401);
      const tz = validTz(payload.tz);
      const sessions = (payload.sessions && typeof payload.sessions === "object") ? payload.sessions as Record<string, unknown> : {};
      const dates = Object.keys(sessions).filter(isDate).sort().slice(-HR_MAX_SESSIONS);
      const results = await Promise.all(dates.map((d) => sessionHeartRate(sessions[d], tz)));
      const out = Object.fromEntries(dates.map((d, i) => {
        const r = results[i] as Row | null;
        return [d, !r ? { status: "too_few_logs" } : r.status === "ok" ? { status: "ok", ...(r.numbers as Row) } : { status: r.status }];
      }));
      console.log("coach hr", JSON.stringify(Object.fromEntries(Object.entries(out).map(([d, v]) => [d, (v as Row).status]))));
      return json({ sessions: out });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "anthropic_key_not_configured" }, 500);

    const tz = validTz(payload.tz);
    const who = await caller(req).catch(() => null);
    if (!who) return json({ error: "not_signed_in" }, 401);
    // The day is counted in the caller's own time zone, so the cap resets at their midnight.
    const { data: calls, error: capErr } = await serviceClient().rpc("coach_bump", { p_user: who.id, p_day: localDay(new Date().toISOString(), tz) });
    if (capErr) {
      console.error("coach_bump failed:", capErr.message);
      return json({ error: "usage_check_failed" }, 503);
    }
    if (Number(calls) > DAILY_CALL_CAP) return json({ error: "daily_limit_reached", cap: DAILY_CALL_CAP }, 429);

    const end = isDate(payload.weekEnd) ? payload.weekEnd : isDate(payload.date) ? payload.date : new Date().toISOString().slice(0, 10);

    let context: { status: string; data: Row | null } = { status: "no_email", data: null };
    if (who.email) {
      context = await outliveContext(who.email, mode, end, tz).catch((e) => {
        console.error("outlive context failed:", e);
        return { status: "outlive_error", data: null };
      });
    }

    // Per-lift heart rate, fetched in parallel. The raw log times stay out of the prompt.
    const { logTimes, compareSession, weekLogTimes, ...forModel } = payload as Record<string, any>;
    let heartRate: Row | null = null;
    if (mode === "session") {
      const [today, compare] = await Promise.all([
        sessionHeartRate(logTimes, tz),
        compareSession?.logs ? sessionHeartRate(compareSession.logs, tz) : Promise.resolve(null),
      ]);
      if (today) heartRate = { ...textOnly(today), compare: compare && compareSession?.date ? { date: compareSession.date, ...textOnly(compare) } : null };
    } else if (weekLogTimes && typeof weekLogTimes === "object") {
      const dates = Object.keys(weekLogTimes).filter(isDate).sort().slice(-5);
      const byDate = await Promise.all(dates.map((d) => sessionHeartRate(weekLogTimes[d], tz)));
      heartRate = Object.fromEntries(dates.map((d, i) => [d, byDate[i] && textOnly(byDate[i])]).filter(([, h]) => h));
    }

    const client = new Anthropic({ apiKey });
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: mode === "weekly" ? WEEKLY_SYSTEM : SESSION_SYSTEM,
      messages: [{ role: "user", content: "Data (JSON):\n" + JSON.stringify({ ...forModel, heartRate, outlive: context.data }) }],
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

    console.log("coach", mode, context.status, "hr", JSON.stringify(heartRate && (heartRate.status ?? Object.keys(heartRate).length)), "usage", JSON.stringify(response.usage));
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
