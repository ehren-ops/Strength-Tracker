// AI coach (session and weekly): payloads, trends, exercise order, panels. Deload status and popup, Training Modifiers, the Overview page and the backup card.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- coach analyses (on demand, cached, never re-generated automatically) ----------
// Two kinds from the coach edge function: "session" is the post-workout note for the very next
// session (keyed by session date); "weekly" is the deeper check-in (keyed by the week's last
// day). Synced to the ai_breakdowns table when signed in, which is also where outlive's
// strength-sync reads them from.
const AI_BREAKDOWN_KEY = "strength-tracker-ai-breakdowns";
const AI_CHECKIN_KEY = "strength-tracker-ai-checkins";
function loadCoachCache(key){
  try{ return JSON.parse(window.localStorage.getItem(key)) || {}; }catch(e){ return {}; }
}
let aiBreakdowns = loadCoachCache(AI_BREAKDOWN_KEY);
let aiCheckins = loadCoachCache(AI_CHECKIN_KEY);
function coachStore(kind){ return kind === "weekly" ? aiCheckins : aiBreakdowns; }
function saveCoachStore(kind){
  try{ window.localStorage.setItem(kind === "weekly" ? AI_CHECKIN_KEY : AI_BREAKDOWN_KEY, JSON.stringify(coachStore(kind))); }catch(e){}
}
let coachExpanded = {};
let coachLoading = {};
let coachError = {};

function shiftISO(iso, days){
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}
function compactEntry(e, ex){
  let s = `${e.date} ${formatEntryValue(e, ex)}`;
  if(e.difficulty) s += ` @${e.difficulty}`;
  if(e.pain != null) s += ` pain ${e.pain}/10${e.painArea ? " " + e.painArea : ""}`;
  if(e.note) s += ` "${String(e.note).slice(0, 100)}"`;
  if(e.deload) s += " [deload]";
  else if(prFlags(ex)[ex.entries.indexOf(e)]) s += " [rep PR]";
  return s;
}
function describeSuggestion(ex, name){
  const s = computeSuggestion(ex, name);
  if(!s) return null;
  if(ex.trackBy === "weight"){
    const why = s.shoulderPaused ? "paused for shoulder rehab" : s.shoulderHold ? (name === "Bicep Curl" ? "shoulder rehab: hammer curls only, held" : name === "Barbell Row" ? "shoulder rehab: held at about 85% of pre-rehab weight, palms-in grip" : "shoulder rehab: held at about 85% of pre-rehab weight, medium grip, short range")
      : s.shoulderBuild ? `shoulder rehab phase 3: full range, building back toward ${s.shoulderBuild.fullWeight} lb`
      : s.shoulderReturn ? `back from shoulder rehab, step ${s.shoulderReturn.step} of 3 back to ${s.shoulderReturn.fullWeight} lb`
      : s.deloadWeek ? "deload week" : s.reentry ? `rebuilding after time off, step ${s.reentry.step} of 3 back to ${s.reentry.fullWeight} lb` : s.postDeloadHold ? `first session back from deload, repeating the pre-deload weight (${s.postDeloadHold.why})` : s.noteTarget != null ? "set by last note" : s.noteCue === "up" ? "add weight, note said so" : s.deload ? "deload" : s.careFlags ? "care-mode trim" : s.readyToProgress ? "add weight"
      : s.noteConcern ? "hold, note flagged" : s.noteCue === "hold" ? "hold, note said so" : s.difficultyNote === "hard" ? "hold, last RPE high" : "hold";
    return `${s.weight} lb ${s.sets}x${s.reps} (${why})`;
  }
  if(ex.trackBy === "duration") return `${s.minutes} min`;
  return `${s.sets}x${s.reps}${s.powerHold ? " (power: hold reps, progress height or distance)" : ""}`;
}
// Movement pattern per lift, so the coach can compare push vs pull, squat vs hinge, etc.
const LIFT_PATTERNS = {
  "Bench Press": "push", "Incline DB Press": "push", "Cable Chest Fly": "push", "Tricep Pushdown": "push", "Lateral Raise": "push", "Push-Ups": "push",
  "Barbell Row": "pull", "Cable Lat Pulldown": "pull", "Face Pulls": "pull", "Bicep Curl": "pull", "Dead Hang": "pull",
  "RDL": "hinge", "Hip Thrust": "hinge", "Back Extension": "hinge", "Kettlebell Swings": "hinge",
  "Squat": "squat", "Spanish Squat": "squat",
  "Bulgarian Split Squat": "single-leg", "Walking Lunge": "single-leg", "Lateral Lunge": "single-leg",
  "Box Jumps": "power", "Trap Bar Jump": "power", "Skater Bound": "power", "Med Ball Slam": "power",
  "Standing Calf Raise": "calves", "Seated Calf Raise": "calves",
  "Farmer's Carry": "carry and grip", "Copenhagen Plank": "core", "5-Minute Core Routine": "core",
};

// Pre-computed trend signals, so the model reasons over patterns instead of re-reading raw logs.
// e1RM is Epley (weight x (1 + reps/30)); it puts 135x6 and 135x8 on one scale. Timed holds
// (unit "sec", like Farmer's Carry) log seconds in the reps field, so they get no e1RM and their
// change is reported in seconds instead.
function liftTrend(name, ex, asOf){
  if(ex.trackBy === "checklist" || ex.trackBy === "duration") return null;
  const all = ex.entries.filter(e => e.date <= asOf);
  if(!all.length) return null;
  // Deload Week sessions are planned and light: the trend reads from working sessions only, so a
  // deload never shows up as a drop in estimated 1RM or resets "sessions at this load".
  const es = all.some(e => !e.deload) ? all.filter(e => !e.deload) : all;
  const last = es[es.length - 1];
  const timed = ex.unit === "sec";
  const e1 = e => (!timed && e.weight > 0 && e.reps) ? e.weight * (1 + e.reps / 30) : null;
  const since = shiftISO(asOf, -28);
  const recent = es.filter(e => e.date >= since);
  const base = recent.length > 1 ? recent[0] : null;
  const sessionsRecent = all.filter(e => e.date >= since).length;
  let atLoad = 0;
  const rpeAtLoad = [];
  for(let i = es.length - 1; i >= 0 && es[i].weight === last.weight; i--){
    atLoad++;
    if(es[i].difficulty) rpeAtLoad.unshift(es[i].difficulty);
  }
  const a = base && e1(base), b = e1(last);
  return {
    pattern: LIFT_PATTERNS[name] || "other",
    sessionsLast4Weeks: sessionsRecent,
    e1rmChange4WeeksPct: a && b ? Math.round((b - a) / a * 1000) / 10 : null,
    [timed ? "secondsChange4Weeks" : "repsChange4Weeks"]: base && (timed || !(last.weight > 0)) && base.reps != null && last.reps != null ? last.reps - base.reps : null,
    sessionsAtCurrentLoad: atLoad,
    rpeAtCurrentLoad: rpeAtLoad,
  };
}

// The trend as one short line for the coach payload: same facts, a fraction of the JSON.
// "squat; e1RM +3.2% in 4 wk; 3 sessions at this load, RPE 7 7 8; 6 sessions in 4 wk"
function trendText(t){
  if(!t) return null;
  const bits = [t.pattern];
  if(t.e1rmChange4WeeksPct) bits.push(`e1RM ${t.e1rmChange4WeeksPct > 0 ? "+" : ""}${t.e1rmChange4WeeksPct}% in 4 wk`);
  if(t.repsChange4Weeks) bits.push(`reps ${t.repsChange4Weeks > 0 ? "+" : ""}${t.repsChange4Weeks} in 4 wk`);
  if(t.secondsChange4Weeks) bits.push(`hold ${t.secondsChange4Weeks > 0 ? "+" : ""}${t.secondsChange4Weeks} sec in 4 wk`);
  if(t.sessionsAtCurrentLoad > 1) bits.push(`${t.sessionsAtCurrentLoad} sessions at this load${t.rpeAtCurrentLoad.length ? ", RPE " + t.rpeAtCurrentLoad.join(" ") : ""}`);
  bits.push(`${t.sessionsLast4Weeks} sessions in 4 wk`);
  return bits.join("; ");
}
// Units only when they aren't plain totals, which the coach assumes.
function unitsFor(name){
  const u = sidesText(name);
  return u === "weight total, reps total" ? undefined : u;
}
// Coach payload windows: enough to read a trend and a block, no more.
const COACH_SESSION_HISTORY = 5;   // prior results per lift in the session note
const COACH_WEEKLY_DAYS = 28;      // history per lift in the weekly check-in

function patternSummary(asOf, only){
  const by = {};
  Object.entries(data).forEach(([name, ex]) => {
    const t = liftTrend(name, ex, asOf);
    if(!t || t.e1rmChange4WeeksPct == null || (only && !only.has(t.pattern))) return;
    (by[t.pattern] ||= []).push(`${name} ${t.e1rmChange4WeeksPct > 0 ? "+" : ""}${t.e1rmChange4WeeksPct}%`);
  });
  return Object.fromEntries(Object.entries(by).map(([p, lifts]) => {
    const pcts = lifts.map(l => parseFloat(l.split(" ").pop()));
    return [p, { avgE1rmChange4WeeksPct: Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length * 10) / 10, lifts }];
  }));
}

// The order lifts were actually done in on one date, each with its planned number from the day's
// list (the pill numbering). Lifts usually go in planned order; a lift out of place usually means
// its equipment was busy. Null when any entry that day predates order tracking.
function sessionOrder(date){
  const done = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    ex.entries.forEach(e => { if(e.date === date) done.push({ name, at: e.loggedAt }); });
  });
  if(!done.length || done.some(d => !d.at)) return null;
  done.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  const seen = new Set();
  const lifts = done.filter(d => !seen.has(d.name) && seen.add(d.name)).map(d => d.name);
  const day = guessDayForNames(lifts);
  const planned = day && day !== "extra" ? getDisplayOrder(day) : [];
  const num = n => planned.indexOf(n) + 1;
  const numbered = lifts.filter(n => num(n) > 0);
  const outOfOrder = numbered.filter((n, i) => numbered.slice(i + 1).some(m => num(m) < num(n)) || numbered.slice(0, i).some(m => num(m) > num(n)));
  return {
    logged: lifts.map(n => num(n) ? `${n} (#${num(n)})` : `${n} (extra)`).join(", "),
    outOfOrder,
  };
}

// When each lift was logged on one date, oldest first. Lifts are logged right after their last set,
// so the coach function splits the wearable's heart-rate stream at these times to estimate each
// lift's peak and average HR. Empty when the day predates log times.
function sessionLogTimes(date){
  const logs = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    ex.entries.forEach(e => { if(e.date === date && e.loggedAt) logs.push({ name, at: e.loggedAt }); });
  });
  return logs.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
}
// Everything that marks when a lift's sets ended on one date: each log (with its set count) and
// each rest-timer start. Sent to the coach function to split the heart-rate stream per lift.
function sessionAnchors(date){
  const logs = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    ex.entries.forEach(e => { if(e.date === date && e.loggedAt) logs.push({ name, at: e.loggedAt, kind: "log", sets: e.sets || null }); });
  });
  (restTaps[date] || []).forEach(t => { if(data[t.name]) logs.push({ name: t.name, at: t.at, kind: "rest" }); });
  return logs.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
}
// The latest earlier session of the same day type, for a like-for-like heart-rate comparison.
function previousComparableSession(date){
  const day = guessDayForNames(sessionLogTimes(date).map(l => l.name));
  const dates = new Set();
  Object.values(data).forEach(ex => ex.entries.forEach(e => { if(e.date < date) dates.add(e.date); }));
  const prev = [...dates].sort().reverse().find(d => guessDayForNames(sessionLogTimes(d).map(l => l.name)) === day && sessionLogTimes(d).length >= 2);
  return prev ? { date: prev, logs: sessionAnchors(prev) } : null;
}

// ---------- heart rate per lift, after the fact ----------
// Whoop reaches Strava some time after a session, so the app checks back on its own: on open and
// when it comes back to the foreground, any recent session without heart rate is asked for again
// (at most every 15 minutes). The coach function splits the stream at the log times and returns
// each lift's average and peak; no AI call, so it doesn't count toward the daily limit.
const HR_KEY = "strength-tracker-hr";
const HR_LOG_TIMES_SINCE = "2026-10-02"; // log times before this are sync times, not when a lift ended
const HR_LOOKBACK_DAYS = 10;
const HR_RETRY_MS = 15 * 60 * 1000;
const HR_FINAL = new Set(["ok", "no_log_timeline", "too_few_logs"]);
let hrStore = loadCoachCache(HR_KEY);
let hrBusy = false;
function saveHrStore(){ try{ localStorage.setItem(HR_KEY, JSON.stringify(hrStore)); }catch(e){} }
function hrCandidateDates(){
  const since = [HR_LOG_TIMES_SINCE, shiftISO(todayISO(), -HR_LOOKBACK_DAYS)].sort().pop();
  const dates = new Set();
  Object.values(data).forEach(ex => ex.entries.forEach(e => { if(e.date >= since && e.loggedAt) dates.add(e.date); }));
  const now = Date.now();
  return [...dates].sort().reverse().filter(d => {
    if(sessionLogTimes(d).length < 2) return false;
    const logs = sessionAnchors(d);
    const h = hrStore[d];
    if(!h) return true;
    if(h.logCount !== logs.length) return true; // lifts added since the last check
    if(HR_FINAL.has(h.status)) return false;
    return now - (h.checkedAt || 0) > HR_RETRY_MS;
  }).slice(0, 4);
}
async function refreshHeartRate(){
  if(hrBusy || !currentSession || !currentSession.access_token) return;
  const dates = hrCandidateDates();
  if(!dates.length) return;
  hrBusy = true;
  let gotNew = false;
  try{
    const sessions = Object.fromEntries(dates.map(d => [d, sessionAnchors(d)]));
    const res = await fetch(`${SUPABASE_URL}/functions/v1/coach`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + currentSession.access_token },
      body: JSON.stringify({ mode: "hr", payload: { tz: coachTz(), sessions } }),
    });
    const body = await res.json().catch(() => null);
    if(!res.ok || !body || !body.sessions) return;
    dates.forEach(d => {
      const r = body.sessions[d];
      if(!r) return;
      if(r.status === "ok" && !(hrStore[d] && hrStore[d].status === "ok" && hrStore[d].logCount === sessions[d].length)) gotNew = true;
      hrStore[d] = { ...r, logCount: sessions[d].length, checkedAt: Date.now() };
    });
    saveHrStore();
  }catch(e){
    // Offline or the function is down: try again on the next open.
  }finally{
    hrBusy = false;
  }
  if(gotNew && !logFormDirty) render();
}
// One lift's heart rate on one date, or null.
function hrFor(name, date){
  const h = hrStore[date];
  if(!h || h.status !== "ok" || !Array.isArray(h.lifts)) return null;
  const l = h.lifts.find(x => x.name === name && x.avg != null);
  return l || null;
}
// Lifts are logged right after their first set; the split relies on that habit, with rest-timer
// starts sharpening it when used, so the numbers show without a qualifier.
function hrText(h){ return `HR ${h.avg} avg · ${h.peak} peak`; }
function hrShort(h){ return `HR ${h.avg}/${h.peak}`; }

function coachTz(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }catch(e){ return "UTC"; }
}
function activeModes(){ return Object.fromEntries(MODE_DEFS.map(m => [m.key, !!modes[m.key]])); }

// Lifts skipped on purpose that day, with the reason, so the coach never reads them as missed.
function skippedOn(date){
  return Object.entries(skips[date] || {}).map(([name, reason]) => ({ name, reason }));
}

// Sauna, cold plunge and hot tub sessions between two dates, one line each, with how they sat
// against lifting that day: after the last lift was logged, on a lift day, or a day with no lifting.
function recoveryLog(from, to){
  const lines = [];
  Object.keys(RECOVERY).forEach(name => {
    const ex = data[name];
    if(!ex) return;
    ex.entries.filter(e => e.date >= from && e.date <= to).forEach(e => {
      const lifts = sessionLogTimes(e.date);
      const lastLift = lifts.length ? lifts[lifts.length - 1].at : null;
      const liftDay = Object.entries(data).some(([n, x]) => x.trackBy !== "checklist" && !isRecovery(n) && x.entries.some(l => l.date === e.date));
      const when = !liftDay ? "no lifting that day" : (e.loggedAt && lastLift && e.loggedAt > lastLift) ? "after lifting" : "lift day";
      lines.push({ date: e.date, at: e.loggedAt || "", text: `${e.date} ${name} ${e.minutes} min${e.tempF != null ? ` at ${e.tempF}°F` : ""}, ${when}${e.note ? ` "${String(e.note).slice(0, 80)}"` : ""}` });
    });
  });
  return lines.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.at < b.at ? -1 : 1).map(l => l.text);
}

// Weekly working sets per pattern and the pull-to-push ratio, for the weekly check-in.
function balanceForCoach(){
  const b = weeklyBalance();
  return { thisWeek: b.week, weeklyAverage4Weeks: b.avg, pullToPushRatio4Weeks: b.ratio, targetRatio: b.target };
}

// Program lifts dropped from their last 2+ sessions for no stated reason, for the coach.
function liftsDueForCoach(){
  const due = dueLifts();
  const lifts = Object.entries(due).map(([name, d]) => ({ name, missedSessions: d.missedSessions, lastDone: d.lastDone }));
  return lifts.length ? lifts : null;
}

// One session plus the last few results per lift, so the note can see trends, not just today.
function buildSessionCoachPayload(date){
  const exercises = [];
  let prevDate = null;
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    ex.entries.forEach(e => { if(e.date < date && (!prevDate || e.date > prevDate)) prevDate = e.date; });
    let idx = -1;
    ex.entries.forEach((e, i) => { if(e.date === date) idx = i; });
    if(idx === -1) return;
    exercises.push({
      name,
      today: compactEntry(ex.entries[idx], ex),
      targetReps: ex.trackBy === "weight" ? effectiveTargetReps(ex) : null,
      repRange: activeRepRange(ex) ? ex.repRange : undefined,
      history: ex.entries.slice(Math.max(0, idx - COACH_SESSION_HISTORY), idx).map(e => compactEntry(e, ex)),
      appSuggestion: describeSuggestion(ex, name),
      trend: trendText(liftTrend(name, ex, date)),
      units: unitsFor(name),
    });
  });
  const dayGuess = guessDayForNames(exercises.map(e => e.name));
  const daysSincePrevious = prevDate ? Math.round((new Date(date) - new Date(prevDate)) / 86400000) : null;
  return { date, tz: coachTz(), dayLabel: dayGuess ? DAY_TITLES[dayGuess] : "Session", daysSincePrevious, modes: activeModes(), deload: deloadStatus(), order: sessionOrder(date), logTimes: sessionAnchors(date), compareSession: previousComparableSession(date), exercises, patterns: patternSummary(date, new Set(exercises.map(e => LIFT_PATTERNS[e.name] || "other"))), skipped: skippedOn(date), rehab: rehabCoachBlock(), recovery: recoveryLog(shiftISO(date, -6), date), liftsDue: liftsDueForCoach() };
}

// The past week plus 4 weeks of history per lift: the trend window. The deload status carries the
// block length, so older sessions add tokens without adding a decision.
function buildWeeklyCoachPayload(){
  const weekEnd = todayISO();
  const since = shiftISO(weekEnd, -(COACH_WEEKLY_DAYS - 1));
  const sessionDates = new Set();
  const exercises = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    const recent = ex.entries.filter(e => e.date >= since && e.date <= weekEnd);
    if(!recent.length) return;
    recent.forEach(e => sessionDates.add(e.date));
    exercises.push({ name, units: unitsFor(name), entries: recent.map(e => compactEntry(e, ex)), appSuggestion: describeSuggestion(ex, name), trend: trendText(liftTrend(name, ex, weekEnd)) });
  });
  const orderSince = shiftISO(weekEnd, -6);
  const sessionOrders = Object.fromEntries([...sessionDates].filter(d => d >= orderSince).sort()
    .map(d => [d, sessionOrder(d)]).filter(([, o]) => o));
  const weekLogTimes = Object.fromEntries([...sessionDates].filter(d => d >= shiftISO(weekEnd, -6)).sort()
    .map(d => [d, sessionAnchors(d)]).filter(([, l]) => l.length >= 2));
  const weekSkips = Object.fromEntries(Object.keys(skips).filter(d => d >= shiftISO(weekEnd, -6) && d <= weekEnd).sort().map(d => [d, skippedOn(d)]));
  return { weekStart: shiftISO(weekEnd, -6), weekEnd, tz: coachTz(), skipped: weekSkips, modes: activeModes(), deload: deloadStatus(), sessionDates: [...sessionDates].sort(), sessionOrders, weekLogTimes, exercises, patterns: patternSummary(weekEnd), weeklySets: balanceForCoach(), rehab: rehabCoachBlock(), recovery: recoveryLog(shiftISO(weekEnd, -13), weekEnd), liftsDue: liftsDueForCoach() };
}

async function generateCoach(kind){
  const payload = kind === "weekly" ? buildWeeklyCoachPayload() : buildSessionCoachPayload(getLastSessionDate());
  const key = kind === "weekly" ? payload.weekEnd : payload.date;
  if(!key) return;
  // The coach function only runs for signed-in accounts, so the Anthropic key can't be spent anonymously.
  if(!currentSession || !currentSession.access_token){
    coachError[kind] = "Sign in to use AI coaching (Backup & Restore, bottom of Overview).";
    render();
    return;
  }
  coachLoading[kind] = true;
  coachError[kind] = null;
  render();
  try{
    // The session also lets the function match this account to Outlive for recovery data.
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + currentSession.access_token };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/coach`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: kind, payload }),
    });
    const body = await res.json().catch(() => null);
    if(!res.ok || !body || !body.breakdown) throw new Error((body && body.error) || `request failed (${res.status})`);
    coachStore(kind)[key] = { ...body.breakdown, generatedAt: body.generatedAt || new Date().toISOString() };
    saveCoachStore(kind);
    enqueueOp({ id: genId(), type: "upsert_breakdown", payload: { kind, date: key } });
    coachExpanded[kind + key] = true;
  }catch(e){
    // A fresh deployment (anyone else pulling this repo and standing up their own Supabase
    // project) won't have ANTHROPIC_API_KEY set yet - show setup instructions instead of a
    // "try again" that would fail forever.
    coachError[kind] = e.message === "anthropic_key_not_configured"
      ? "This needs an Anthropic API key configured on your Supabase project. Add ANTHROPIC_API_KEY under Project Settings → Edge Functions → Secrets - see supabase/functions/coach/README.md for details."
      : e.message === "not_signed_in"
      ? "Your sign-in expired. Sign in again under Backup & Restore at the bottom of Overview, then retry."
      : e.message === "daily_limit_reached"
      ? "Daily AI limit reached (10 a day). It resets at midnight."
      : "Couldn't generate this right now - try again in a moment.";
  }finally{
    coachLoading[kind] = false;
    render();
  }
}

function toggleCoachExpanded(id){
  coachExpanded[id] = !coachExpanded[id];
  render();
}

// Breakdowns saved before the coach format had a headline plus four fixed lists.
function normalizeCoach(b){
  if(!b) return null;
  if(Array.isArray(b.sections)) return b;
  return {
    verdict: b.headline || "",
    sections: [["What went well", b.wentWell], ["What didn't go great", b.notGreat], ["How to improve", b.howToImprove], ["Be mindful of next time", b.mindfulNextTime]]
      .filter(([, items]) => items && items.length)
      .map(([title, items]) => ({ title, items })),
  };
}

function renderAiBreakdownList(title, items){
  if(!items || !items.length) return "";
  return `<div style="margin-top:0.5rem;">
    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;color:var(--slate);margin-bottom:0.25rem;">${escapeHtml(String(title))}</div>
    <ul style="margin:0;padding-left:1.1rem;font-size:0.82rem;line-height:1.45;color:var(--ink);">
      ${items.map(i => `<li>${escapeHtml(String(i))}</li>`).join("")}
    </ul>
  </div>`;
}

// The current week's check-in, if one was made in the last 7 days; otherwise the button shows.
function currentCheckinKey(){
  const latest = Object.keys(aiCheckins).sort().pop();
  return latest && latest >= shiftISO(todayISO(), -6) ? latest : null;
}

const COACH_LABELS = { session: "Session Breakdown", weekly: "Weekly Check-in" };
const COACH_SHORT = { session: "Session", weekly: "Weekly" };
function coachKey(kind){ return kind === "weekly" ? currentCheckinKey() : getLastSessionDate(); }

// Header-row button: generates the first time, then opens and closes the panel below.
function onCoachButton(kind){
  const key = coachKey(kind);
  if(key && coachStore(kind)[key]) toggleCoachExpanded(kind + key);
  else generateCoach(kind);
}

function renderCoachButton(kind){
  const key = coachKey(kind);
  const open = key && coachStore(kind)[key] && coachExpanded[kind + key];
  const loading = !!coachLoading[kind];
  return `<button class="ai-btn${open ? " open" : ""}" onclick="onCoachButton('${kind}')" ${loading ? "disabled" : ""}>
    <span class="ai-tag">✨ AI</span>
    <span>${loading ? "Working…" : COACH_SHORT[kind]}</span>
  </button>`;
}

function renderCoachPanel(kind){
  const key = coachKey(kind);
  const cached = key ? normalizeCoach(coachStore(kind)[key]) : null;
  const loading = !!coachLoading[kind];
  const err = coachError[kind] ? `<div style="font-size:0.74rem;color:var(--danger);margin-top:0.4rem;">${escapeHtml(coachError[kind])}</div>` : "";
  if(!cached) return err ? `<div class="ai-panel"><div class="ai-panel-head"><span>✨ AI · ${COACH_LABELS[kind]}</span></div>${err}</div>` : "";

  const id = kind + key;
  const expanded = !!coachExpanded[id];
  const [, m, d] = key.split("-");
  const sub = (kind === "weekly" ? "week ending " : "") + `${Number(m)}/${Number(d)}`;
  let html = `<div class="ai-panel">
    <div class="ai-panel-head" onclick="toggleCoachExpanded('${id}')">
      <span>✨ AI · ${COACH_LABELS[kind]} <span style="opacity:0.7;font-weight:400;">· ${sub}</span></span>
      <span class="ai-toggle">${expanded ? "Hide ▲" : "Show ▼"}</span>
    </div>`;
  if(expanded){
    html += `<div style="margin-top:0.4rem;">
      <p style="font-size:0.85rem;line-height:1.5;color:var(--ink);margin:0;font-weight:600;">${escapeHtml(String(cached.verdict || ""))}</p>
      ${cached.sections.map(s => renderAiBreakdownList(s.title, s.items)).join("")}
      <button class="ai-btn" style="margin-top:0.6rem;" onclick="generateCoach('${kind}')" ${loading ? "disabled" : ""}>
        ${loading ? "Regenerating…" : "↻ Regenerate"}
      </button>
    </div>`;
  }
  html += `${err}</div>`;
  return html;
}

function renderLastSessionBreakdown(){
  const lastDate = getLastSessionDate();
  if(!lastDate) return "";
  const sessionsByDate = getSessionsByDate();
  const names = sessionsByDate[lastDate];
  if(!names || !names.length) return "";

  let html = `<div onclick="toggleLastSessionExpanded()" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:0.78rem;color:var(--slate);margin-top:0.6rem;padding-top:0.5rem;border-top:1px dashed var(--line);">
    <span>${names.length} exercise${names.length===1?'':'s'} logged</span>
    <span style="color:var(--amber);font-weight:600;">${lastSessionExpanded ? 'Hide breakdown ▲' : 'Show breakdown ▼'}</span>
  </div>`;

  if(lastSessionExpanded){
    html += `<div style="margin-top:0.5rem;">`;
    const h = hrStore[lastDate];
    const hrLine = h && h.status === "ok"
      ? `Whoop: ${h.elapsedMin} min · ${h.avgHr} avg · ${h.maxHr} max heart rate`
      : lastDate >= HR_LOG_TIMES_SINCE && sessionLogTimes(lastDate).length >= 2 && currentSession
      ? "Heart rate: waiting for Whoop to sync to Strava"
      : "";
    if(hrLine) html += `<div class="session-hr-summary">${hrLine}</div>`;
    const skippedList = skippedOn(lastDate).filter(sk => !names.includes(sk.name));
    if(skippedList.length) html += `<div class="session-hr-summary">Skipped: ${skippedList.map(sk => `${escapeHtml(sk.name)} (${SKIP_REASONS[sk.reason].toLowerCase()})`).join(", ")}</div>`;
    names.forEach(n => {
      const ex = data[n];
      const entry = ex.entries.slice().reverse().find(e => e.date === lastDate);
      if(entry){
        const hr = hrFor(n, lastDate);
        html += `<div class="session-row">
          <span>${n}${hr ? `<span class="session-hr">${hrText(hr)}</span>` : ""}</span>
          <span class="exact">${formatEntryValue(entry, ex)}</span>
          <span class="exact">${entry.difficulty ?? "-"}</span>
        </div>`;
      }
    });
    html += `</div>`;
  }

  return html;
}

// Last deload and when the next one is due. With no deload on record, the
// clock starts at the first logged session.
function deloadStatus(){
  let firstDate = null;
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    ex.entries.forEach(e => { if(e.date && (!firstDate || e.date < firstDate)) firstDate = e.date; });
  });
  const anchor = modes.deload ? null : (deloadDates.endedOn || firstDate);
  const nextDue = anchor ? shiftISO(anchor, DELOAD_EVERY_DAYS) : null;
  return {
    on: !!modes.deload,
    startedOn: deloadDates.startedOn || null,
    endedOn: deloadDates.endedOn || null,
    nextDue,
    daysUntilDue: nextDue ? daysBetween(todayISO(), nextDue) : null,
  };
}

function fmtShortDate(iso){
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A deload is planned as one week: on day 7 it switches itself off and a popup
// offers to keep it on for another week instead.
function checkDeloadAutoEnd(){
  if(!modes.deload || !deloadDates.plannedEndOn || todayISO() < deloadDates.plannedEndOn) return;
  toggleMode("deload");
  showDeloadEndedModal();
}
function showDeloadEndedModal(){
  const el = document.getElementById("deload-modal");
  if(!el) return;
  el.innerHTML = `<div class="app-modal-card">
    <h3 class="section" style="color:var(--deload-text);">🔋 Deload week complete</h3>
    <p style="font-size:0.85rem;line-height:1.5;margin:0 0 0.8rem;">A week is up, so Deload Week is now off and suggestions pick back up from your pre-deload weights.</p>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end;flex-wrap:wrap;">
      <button class="tool-btn" onclick="keepDeloadOn()">Keep it on another week</button>
      <button class="tool-btn" style="background:var(--deload);color:var(--deload-on-text);border-color:var(--deload);" onclick="closeDeloadModal()">Sounds good</button>
    </div>
  </div>`;
  el.hidden = false;
}
function closeDeloadModal(){
  const el = document.getElementById("deload-modal");
  if(el) el.hidden = true;
}
function keepDeloadOn(){
  const startedOn = deloadDates.startedOn;
  toggleMode("deload");
  deloadDates = { startedOn: startedOn || todayISO(), endedOn: null, plannedEndOn: shiftISO(todayISO(), DELOAD_LENGTH_DAYS) };
  saveDeloadDates();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  closeDeloadModal();
  render();
}

// Overview sections that fold away by tapping their heading, remembered on this device like the
// graph toggle. Folded, the heading carries a one-line summary instead.
const OVERVIEW_COLLAPSED_KEY = "strength-tracker-overview-collapsed";
let overviewCollapsed = (function(){ try{ return JSON.parse(localStorage.getItem(OVERVIEW_COLLAPSED_KEY)) || {}; }catch(e){ return {}; } })();
function toggleOverviewSection(key){
  overviewCollapsed[key] = !overviewCollapsed[key];
  try{ localStorage.setItem(OVERVIEW_COLLAPSED_KEY, JSON.stringify(overviewCollapsed)); }catch(e){}
  render();
}
function collapsibleHead(key, title, summary){
  const closed = !!overviewCollapsed[key];
  return `<button type="button" class="section-toggle${closed ? " closed" : ""}" onclick="toggleOverviewSection('${key}')" aria-expanded="${!closed}">
    <h3 class="section">${title}</h3>${closed && summary ? `<span class="section-summary">${summary}</span>` : ""}</button>`;
}

// One modifier: a title row with its on/off switch, then a short description.
// The hidden label keeps "Name: ON/OFF" readable for screen readers.
function renderModifierRow(key, extraHtml){
  const { emoji, name, desc } = MODE_DEFS.find(m => m.key === key), on = !!modes[key];
  return `<div class="mod-row">
      <div class="mod-head">
        <span class="mod-title">${emoji} ${name}</span>
        <button class="theme-toggle mod-switch${on ? " on" : ""}" style="--mod-color:var(--${key})" onclick="toggleMode('${key}')" aria-pressed="${on}" aria-label="${name}"><span class="knob"></span><span class="sr-only">${name}: ${on ? "ON" : "OFF"}</span></button>
      </div>
      <p class="mod-desc">${desc}</p>
      ${extraHtml || ""}
    </div>`;
}

// Shoulder Rehab: the daily rehab card on every day, flies, incline, lateral raises and slams
// paused, bench and curls held. One status line on or off.
function renderShoulderModifier(){
  let status;
  if(modes.shoulder) status = `${shoulderRehab.startedOn ? `On since ${fmtShortDate(shoulderRehab.startedOn)}` : "On"} · week ${rehabWeek()}, phase ${rehabPhase()}`;
  else if(shoulderRehab.startedOn) status = `Last run: ${fmtShortDate(shoulderRehab.startedOn)} to ${fmtShortDate(shoulderRehab.endedOn || shoulderRehab.startedOn)}. Paused lifts ramp back 85, 92.5, 100%.`;
  else status = `Not started`;
  return renderModifierRow("shoulder", `<div class="shoulder-status">${status}</div>`);
}

// Deload status is always exactly two short lines, so the row stays the same size on or off.
function renderDeloadModifier(){
  const st = deloadStatus();
  let last, next;
  if(st.on){
    last = st.startedOn ? `On since ${fmtShortDate(st.startedOn)} · day ${daysBetween(st.startedOn, todayISO()) + 1}` : "On";
    next = deloadDates.plannedEndOn ? `Switches off ${fmtShortDate(deloadDates.plannedEndOn)} unless you keep it on` : `Switch off when the week is up`;
  } else {
    last = st.startedOn ? `Last deload: ${fmtShortDate(st.startedOn)} to ${fmtShortDate(st.endedOn || st.startedOn)}` : `No deload logged yet`;
    if(!st.nextDue) next = `Next recommended: after ~5 weeks of training`;
    else if(st.daysUntilDue > 0) next = `Next recommended: ${fmtShortDate(st.nextDue)} (in ${st.daysUntilDue} day${st.daysUntilDue === 1 ? "" : "s"})`;
    else if(st.daysUntilDue === 0) next = `Next recommended: today`;
    else next = `Next recommended: ${fmtShortDate(st.nextDue)} · <b>due now</b>`;
  }
  return renderModifierRow("deload", `<div class="deload-status" id="deload-status"><div>${last}</div><div>${next}</div></div>`);
}

// ---------- weekly balance ----------
// Working sets per movement pattern: this week, and the weekly average over 4 weeks. Pulling
// should at least match pressing (1.5 pull sets per press set while rehabbing a shoulder), the
// imbalance behind most shoulder trouble.
const BALANCE_PATTERNS = ["push", "pull", "squat", "hinge", "single-leg", "power", "calves", "carry and grip", "core"];
function setsByPattern(from, to){
  const out = {};
  Object.entries(data).forEach(([name, ex]) => {
    const p = LIFT_PATTERNS[name];
    if(!p || ex.trackBy === "checklist" || ex.trackBy === "duration") return;
    ex.entries.forEach(e => { if(e.date >= from && e.date <= to) out[p] = (out[p] || 0) + (Number(e.sets) || 0); });
  });
  return out;
}
function weeklyBalance(){
  const today = todayISO();
  const week = setsByPattern(shiftISO(today, -6), today);
  const four = setsByPattern(shiftISO(today, -27), today);
  const avg = Object.fromEntries(Object.entries(four).map(([p, n]) => [p, Math.round(n / 4 * 10) / 10]));
  const push = four.push || 0, pull = four.pull || 0;
  const target = modes.shoulder ? 1.5 : 1;
  const ratio = push ? Math.round(pull / push * 10) / 10 : null;
  // Extra pull sets a week that would reach the target at the current pressing volume.
  const short = ratio != null && ratio < target ? Math.ceil((push * target - pull) / 4) : 0;
  return { week, avg, ratio, target, short };
}
function renderBalanceCard(){
  const b = weeklyBalance();
  const rows = BALANCE_PATTERNS.filter(p => b.week[p] || b.avg[p]);
  const ratioTxt = b.ratio == null ? "" : `Pull : push ${b.ratio} : 1`;
  let html = `<div class="card">${collapsibleHead("balance", "Weekly Balance", ratioTxt)}`;
  if(overviewCollapsed.balance) return html + `</div>`;
  if(!rows.length) return html + `<p class="range-note">Sets per movement pattern show here once you log a few sessions.</p></div>`;
  const ok = b.ratio != null && b.ratio >= b.target;
  if(b.ratio != null){
    html += `<p class="bal-ratio ${ok ? "bal-ok" : "bal-low"}"><b>${ratioTxt}</b> over 4 weeks · target ${b.target} : 1${modes.shoulder ? " while rehabbing" : ""}.${ok ? "" : ` About ${b.short} more pull set${b.short === 1 ? "" : "s"} a week would even it out.`}</p>`;
  }
  const max = Math.max(...rows.map(p => Math.max(b.week[p] || 0, b.avg[p] || 0)), 1);
  html += `<div class="bal-head"><span></span><span></span><span>Week · avg</span></div>`;
  rows.forEach(p => {
    const w = b.week[p] || 0, a = b.avg[p] || 0;
    html += `<div class="bal-row"><span class="bal-name">${p}</span>
      <span class="bal-bar"><span style="width:${(w / max * 100).toFixed(0)}%"></span><i style="left:${(a / max * 100).toFixed(0)}%"></i></span>
      <span class="bal-n">${w} · ${a}</span></div>`;
  });
  html += `<p class="range-note">Working sets per pattern. The tick marks the 4-week weekly average.</p></div>`;
  return html;
}

// Change per lift from its first to its latest full session, over everything logged or a recent
// window. Deload sessions are left out, so a planned light week never reads as a drop.
const CHANGE_RANGES = [["2W", 14, "Past 2 weeks"], ["1M", 30, "Past month"], ["3M", 91, "Past 3 months"], ["6M", 182, "Past 6 months"], ["1Y", 365, "Past year"], ["All", null, "Since first logged"]];
const CHANGE_RANGE_KEY = "strength-tracker-change-range";
let changeRange = (function(){ try{ const v = localStorage.getItem(CHANGE_RANGE_KEY); return CHANGE_RANGES.some(r => r[0] === v) ? v : "All"; }catch(e){ return "All"; } })();
function setChangeRange(key){
  changeRange = key;
  try{ localStorage.setItem(CHANGE_RANGE_KEY, key); }catch(e){}
  render();
}
function changeData(days){
  const since = days ? shiftISO(todayISO(), -days) : "";
  return Object.entries(data).map(([name, ex]) => {
    if(ex.trackBy === "checklist" || ex.trackBy === "duration" || isRecovery(name)) return null;
    const pts = ex.entries.filter(e => !e.deload && e.date >= since);
    if(pts.length < 2) return null;
    const f = pts[0], l = pts[pts.length - 1];
    const firstVal = ex.trackBy === "weight" ? f.weight : f.reps;
    const lastVal = ex.trackBy === "weight" ? l.weight : l.reps;
    if(!firstVal) return null;
    return { name, pct: ((lastVal - firstVal) / firstVal) * 100, firstVal, lastVal, trackBy: ex.trackBy, sessions: pts.length };
  }).filter(Boolean).sort((a, b) => b.pct - a.pct);
}

function renderOverview(){
  const app = document.getElementById("app");
  const overviewData = changeData(null);

  const avgPct = overviewData.length ? overviewData.reduce((s,o)=>s+o.pct,0)/overviewData.length : 0;
  const totalSessions = Object.entries(data).reduce((s,[n,ex])=>n === REHAB_NAME || isRecovery(n) ? s : s+ex.entries.length,0);
  const progressing = overviewData.filter(o=>o.pct>0).length;
  const holding = overviewData.filter(o=>o.pct===0).length;
  const declining = overviewData.filter(o=>o.pct<0).length;

  const dayAgg = ["full","upper","lower"].map(day => {
    const names = activeDayOrder(day);
    const relevant = overviewData.filter(o => names.includes(o.name));
    const avg = relevant.length ? relevant.reduce((s,o)=>s+o.pct,0)/relevant.length : null;
    return { day, title: DAY_TITLES[day], avg, count: relevant.length, total: names.length };
  });

  const coachNotes = generateCoachNotes();

  let html = "";
  if(coachNotes){
    html += `<div class="card" style="border-color:var(--amber-light);background:var(--rec-bg);">
      <div class="coach-head">
        <h3 class="section" style="color:var(--amber);">🎯 Coach's Notes</h3>
        ${renderCoachButton("session")}
        ${renderCoachButton("weekly")}
      </div>
      <p style="font-size:0.85rem;line-height:1.5;color:var(--ink);margin:0;">${coachNotes}</p>
      ${renderLastSessionBreakdown()}
      ${renderCoachPanel("session")}
      ${renderCoachPanel("weekly")}
    </div>`;
  }

  html += renderCalendar();

  html += `<div class="card">
    <h3 class="section">Aggregate Progress</h3>
    <div class="ov-grid">
      <div><div class="n" style="color:var(--emerald)">${avgPct>0?'+':''}${avgPct.toFixed(0)}%</div><div class="l">avg change</div></div>
      <div><div class="n">${totalSessions}</div><div class="l">sets logged</div></div>
      <div><div class="n">${overviewData.length}</div><div class="l">lifts tracked</div></div>
    </div>
    <div style="display:flex;gap:0.6rem;font-size:0.72rem;margin-bottom:0.8rem;">
      <span style="color:var(--emerald);font-weight:600;">▲ ${progressing} progressing</span>
      <span style="color:var(--slate);font-weight:600;">● ${holding} holding</span>
      <span style="color:var(--amber);font-weight:600;">▼ ${declining} below first logged</span>
    </div>
    <div style="border-top:1px dashed var(--line);padding-top:0.7rem;">
      <h3 class="section">Net Change by Day</h3>
      <div class="ov-grid">`;
  dayAgg.forEach(d => {
    const color = d.avg===null ? "var(--slate)" : d.avg>0 ? "var(--emerald)" : d.avg<0 ? "var(--amber)" : "var(--slate)";
    html += `<div><div class="n" style="color:${color}">${d.avg===null?'-':(d.avg>0?'+':'')+d.avg.toFixed(0)+'%'}</div><div class="l">${d.title}</div><div style="font-size:0.62rem;color:var(--slate);">${d.count}/${d.total} lifts w/ data</div></div>`;
  });
  html += `</div></div></div>`;

  html += renderBalanceCard();

  html += `<div class="card">`;
  html += `<div onclick="toggleVolumeExpanded()" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
    <h3 class="section" style="margin:0;">Volume Trends by Day</h3>
    <span style="font-size:0.78rem;color:var(--amber);font-weight:600;">${volumeExpanded ? 'Hide ▲' : 'Show ▼'}</span>
  </div>`;
  if(!volumeExpanded){
    html += `<div style="margin-top:0.5rem;">`;
    ["full","upper","lower"].forEach(day => {
      const history = calcDayVolumeHistory(day);
      const latest = history.length ? history[history.length-1].weight : null;
      const prev = history.length > 1 ? history[history.length-2].weight : null;
      const pct = (latest !== null && prev) ? ((latest - prev) / prev) * 100 : null;
      const pctColor = pct === null ? "var(--slate)" : pct > 0 ? "var(--emerald)" : pct < 0 ? "var(--amber)" : "var(--slate)";
      const pctText = pct === null ? "-" : `${pct>0?'+':''}${pct.toFixed(0)}%`;
      html += `<div class="session-row">
        <span>${DAY_TITLES[day]}</span>
        <span class="exact">${latest !== null ? latest.toLocaleString()+" lb" : "-"}</span>
        <span class="exact" style="color:${pctColor};">${pctText}</span>
      </div>`;
    });
    html += `</div>`;
  } else {
    ["full","upper","lower"].forEach(day => {
      const history = calcDayVolumeHistory(day);
      html += `<div style="margin-top:0.9rem;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-weight:600;font-size:0.85rem;">${DAY_TITLES[day]}</span>
          ${history.length ? `<span style="font-family:var(--font-body);font-variant-numeric:tabular-nums;font-size:0.76rem;color:var(--slate);">${history[history.length-1].weight.toLocaleString()} lb last session</span>` : ''}
        </div>`;
      if(history.length){
        html += renderChart({ trackBy:"weight", entries: history }, null, false, "volume:" + day);
      } else {
        html += `<p style="font-size:0.78rem;color:var(--slate);font-style:italic;margin:0.3rem 0 0;">No sessions logged yet.</p>`;
      }
      html += `</div>`;
    });
  }
  html += `</div>`;

  const range = CHANGE_RANGES.find(r => r[0] === changeRange);
  const changeRows = changeData(range[1]);
  const changeAvg = changeRows.length ? Math.round(changeRows.reduce((s, o) => s + o.pct, 0) / changeRows.length) : 0;
  html += `<div class="card">${collapsibleHead("change", "% Change Since First Logged",
    changeRows.length ? `avg ${changeAvg > 0 ? "+" : ""}${changeAvg}% · ${range[0]}` : range[0])}`;
  if(!overviewCollapsed.change){
    html += `<div class="range-row" role="group" aria-label="Range">${CHANGE_RANGES.map(([k, , label]) =>
      `<button type="button" class="range-chip${k === changeRange ? " active" : ""}" onclick="setChangeRange('${k}')" aria-pressed="${k === changeRange}" title="${label}">${k}</button>`).join("")}</div>`;
    html += `<p class="range-note">${range[2]}: first to latest full session${range[1] ? " in the range" : ""}. Deload weeks left out.</p>`;
  }
  if(overviewCollapsed.change){
    // folded: the heading's summary is enough
  } else if(!changeRows.length){
    html += `<p style="font-size:0.85rem;color:var(--slate);font-style:italic;">${range[1] ? "No lift has 2 full sessions in this range yet." : "Need at least 2 sessions on a lift to show change."}</p>`;
  } else {
    changeRows.forEach(o => {
      const color = o.pct>0 ? "var(--emerald)" : o.pct<0 ? "var(--amber)" : "var(--slate)";
      const width = Math.min(Math.abs(o.pct),100);
      const freq = frequencyLabel(data[o.name]);
      html += `<div class="bar-row">
        <div class="top"><span style="font-weight:500;">${o.name}</span><span style="font-family:var(--font-body);font-variant-numeric:tabular-nums;font-size:0.72rem;color:${color};">${o.pct>0?'+':''}${o.pct.toFixed(0)}% · ${o.firstVal}→${o.lastVal}${o.trackBy==='weight'?' lb':' reps'}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${color};"></div></div>
        ${freq ? `<div style="font-size:0.66rem;color:var(--slate);margin-top:0.15rem;">${freq}</div>` : ''}
      </div>`;
    });
  }
  html += `</div>`;

  const modsOn = MODE_DEFS.filter(m => modes[m.key]).map(m => m.short);
  const modRow = m => m.key === "deload" ? renderDeloadModifier() : m.key === "shoulder" ? renderShoulderModifier() : renderModifierRow(m.key);
  html += `<div class="card">
    ${collapsibleHead("modifiers", "Training Modifiers", modsOn.length ? `On: ${modsOn.join(", ")}` : "All off")}
    ${overviewCollapsed.modifiers ? "" : MODE_DEFS.map(modRow).join("")}
  </div>`;

  html += renderBackupSyncCard();

  html += `<p class="save-note">${APP_VERSION} · Last updated ${APP_UPDATED}</p>`;

  app.innerHTML = html;
}

function renderBackupSyncCard(){
  const pending = pendingQueue.length;
  let html = `<div class="card"><h3 class="section">Backup &amp; Restore</h3>`;

  if(currentSession){
    const syncedLabel = fmtSyncTime(lastSyncedAt);
    html += `<p style="font-size:0.72rem;color:var(--slate);margin:0 0 0.2rem;">☁ ${escapeHtml(currentSession.user.email)} · ${pending ? pending + " pending" : "synced"}</p>`;
    html += `<p style="font-size:0.64rem;color:var(--slate);margin:0 0 0.5rem;">Last synced: ${syncedLabel || "never yet"}</p>`;
    html += `<div class="header-tools" style="margin-bottom:0.6rem;">
      <button class="tool-btn" id="sync-now-btn" onclick="manualSync()">↻ Sync now</button>
      <button class="tool-btn" onclick="signOutUser()">Sign out</button>
    </div>`;
  } else {
    html += `<p style="font-size:0.7rem;color:var(--slate);margin:0 0 0.4rem;">Sign in to back up to the cloud (optional - logging works without it).</p>`;
    html += `<div class="form-row" style="margin-top:0;">
      <div class="field"><input type="email" id="auth-email" placeholder="Email"></div>
      <div class="field"><input type="password" id="auth-password" placeholder="Password"></div>
    </div>
    <div class="header-tools" style="margin-bottom:0.6rem;">
      <button class="tool-btn" onclick="handleSignIn()">Sign In</button>
      <button class="tool-btn" onclick="handleSignUp()">Create Account</button>
    </div>`;
  }

  html += `<div class="header-tools" style="padding-top:0.5rem;border-top:1px dashed var(--line);">
    <button class="tool-btn" onclick="backupData()">⬇ Backup data</button>
    <button class="tool-btn" onclick="document.getElementById('restore-input').click()">⬆ Restore backup</button>
    <input type="file" id="restore-input" accept="application/json" style="display:none" onchange="restoreData(event)">
  </div>`;
  html += `<p id="card-status" style="font-size:0.68rem;color:var(--slate);margin-top:0.5rem;"></p>`;

  html += `<div style="border-top:1px dashed var(--line);padding-top:0.7rem;margin-top:0.7rem;">
    <h3 class="section">Appearance</h3>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:0.7rem;">
      <div>
        <div style="font-size:0.85rem;font-weight:600;">Neon Dark Mode</div>
        <div style="font-size:0.68rem;color:var(--slate);margin-top:0.1rem;">80s high-contrast theme, everywhere in the app.</div>
      </div>
      <button class="theme-toggle${darkMode ? ' on' : ''}" onclick="toggleDarkMode()" aria-label="Toggle dark mode" aria-pressed="${darkMode}"><span class="knob"></span></button>
    </div>
  </div>`;

  html += `</div>`;
  return html;
}

