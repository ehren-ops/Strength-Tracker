// AI coach (session and weekly): cached analyses, payloads, trends, exercise order, heart rate per lift, and the coach panels.
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

function compactEntry(e, ex){
  let s = `${e.date} ${formatEntryValue(e, ex)}`;
  if(e.difficulty) s += ` @${e.difficulty}`;
  if(e.pain != null) s += ` pain ${e.pain}/10${e.painArea ? " " + e.painArea : ""}`;
  if(e.note) s += ` "${String(e.note).slice(0, 100)}"`;
  if(ex.targetRepsStrength && e.heavy != null) s += e.heavy ? " [heavy]" : " [volume]";
  if(e.deload) s += " [deload]";
  else {
    const pr = prFlags(ex)[ex.entries.indexOf(e)];
    if(pr) s += pr === "weight" ? " [weight PR]" : " [rep PR]";
  }
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
  "Pallof Press": "core", "Side Plank": "core", "Dead Bug": "core", "Wall Sit": "squat",
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

// Which program is running, so the coach reads the day labels and the optional C day right.
function programForCoach(){
  return { name: PROGRAMS[program.key].name, since: program.startedOn || null, mainLifts: program.key === "fullbody"
    ? "Squat, Bench Press, RDL and Barbell Row: heavy days 4x5 (about 80 to 85% of max), volume days 3x8. Squat and Bench Press and Barbell Row heavy on Day A, RDL heavy on Day B; Squat and RDL volume on the other day."
    : "Squat, Bench Press, RDL and Barbell Row twice a week: the first session of the week heavy (4x5, about 80 to 85% of max), the second volume (3x8). Each progresses on its own.", days: Object.fromEntries(programDays().map(d => [DAY_TITLES[d], activeDayOrder(d)])) };
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
  return { date, tz: coachTz(), program: programForCoach(), dayLabel: dayGuess ? DAY_TITLES[dayGuess] : "Session", daysSincePrevious, modes: activeModes(), deload: deloadStatus(), order: sessionOrder(date), logTimes: sessionAnchors(date), compareSession: previousComparableSession(date), exercises, patterns: patternSummary(date, new Set(exercises.map(e => LIFT_PATTERNS[e.name] || "other"))), skipped: skippedOn(date), rehab: rehabCoachBlock(), recovery: recoveryLog(shiftISO(date, -6), date), liftsDue: liftsDueForCoach() };
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
  return { weekStart: shiftISO(weekEnd, -6), weekEnd, tz: coachTz(), program: programForCoach(), skipped: weekSkips, modes: activeModes(), deload: deloadStatus(), sessionDates: [...sessionDates].sort(), sessionOrders, weekLogTimes, exercises, patterns: patternSummary(weekEnd), weeklySets: balanceForCoach(), rehab: rehabCoachBlock(), recovery: recoveryLog(shiftISO(weekEnd, -13), weekEnd), liftsDue: liftsDueForCoach() };
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
