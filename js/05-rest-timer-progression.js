// Rest timer, volume and recovery readiness, and the progression engine (computeSuggestion with its deload, care and equipment caps).
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- rest timer ----------
// In memory only (a countdown restored after a reload would be stale). Tracked by an absolute
// endAt, not a decrementing counter: browsers suspend intervals in the background, so remaining
// time is always recomputed from the clock, and visibilitychange catches a rest that ended away.
let restTimer = null; // { exerciseName, choices, choiceIndex, endAt, phase: "running"|"done", intervalId, revertedFromDone }
let lastRestTimerChoiceIndex = null; // save the choice index when timer ends, to allow revert on tap

function restTimerChoicesFor(name){
  const bucket = restBucketFor(data[name]);
  if(bucket.choices) return bucket.choices;
  // First choice: 60 sec unless exercise recommends lower
  const firstChoice = bucket.minSec < 60 ? bucket.minSec : 60;
  const raw = [firstChoice];
  // Add 90 if it fits in the range and isn't already there
  if(90 > firstChoice && 90 <= bucket.maxSec) raw.push(90);
  // Add maxSec if it's not already there
  if(bucket.maxSec > firstChoice && bucket.maxSec !== (raw[raw.length - 1] || firstChoice)) raw.push(bucket.maxSec);
  return raw.filter((sec, i) => raw.indexOf(sec) === i);
}

// Pressing Start Rest again on the same lift steps through 60 / 90 / the upper limit, then one
// more press clears it, so an accidental tap needs no separate cancel.
// Each rest-timer start marks the end of a set of that lift. Kept per day so the heart-rate split
// can pin each lift's sets no matter whether it was logged after its first set or its last.
const REST_TAPS_KEY = "strength-tracker-rest-taps";
let restTaps = (function(){ try{ return JSON.parse(localStorage.getItem(REST_TAPS_KEY) || "{}") || {}; }catch(e){ return {}; } })();
function recordRestTap(name){
  const d = todayISO();
  (restTaps[d] = restTaps[d] || []).push({ name, at: new Date().toISOString() });
  const keep = shiftISO(d, -30);
  Object.keys(restTaps).forEach(k => { if(k < keep) delete restTaps[k]; });
  try{ localStorage.setItem(REST_TAPS_KEY, JSON.stringify(restTaps)); }catch(e){}
}
function startRestTimer(name){
  if(restTimer && restTimer.exerciseName === name && restTimer.phase === "running"){
    advanceRestTimer();
    return;
  }
  clearRestTimer();
  recordRestTap(name);
  const bucket = restBucketFor(data[name]);
  restTimer = {
    exerciseName: name,
    choices: restTimerChoicesFor(name),
    choiceIndex: -1, // -1 = the plain recommended default, before any manual override
    endAt: Date.now() + bucket.minSec * 1000,
    phase: "running",
    intervalId: setInterval(tickRestTimer, 1000),
  };
  renderRestTimerBadge();
}

function tickRestTimer(){
  checkRestTimerCompletion();
}

// The only place a running timer turns "done": safe from both the interval and visibilitychange,
// since the vibrate fires once and the phase check stops a second caller.
function checkRestTimerCompletion(){
  if(!restTimer || restTimer.phase !== "running") return;
  if(Date.now() >= restTimer.endAt){
    lastRestTimerChoiceIndex = restTimer.choiceIndex;
    restTimer.revertedFromDone = false;
    restTimer.phase = "done";
    clearInterval(restTimer.intervalId);
    notifyRestOver();
  }
  renderRestTimerBadge();
}

// In-app only: a buzz where the browser supports it (Android; iOS Safari has no Vibration
// API), plus the badge turning red. A system banner was tried, but a home-screen web app
// can't fire one while closed without a push server, so it only ever showed up on return.
function notifyRestOver(){
  if(document.visibilityState !== "visible") return;
  try{ if(navigator.vibrate) navigator.vibrate([200, 100, 200]); }catch(e){}
}

// Shared by the floating badge tap and by re-pressing "Start Rest" while
// already running: advance to the next 60/90/upper-limit choice, or - once
// the cycle is exhausted - remove the timer outright.
function advanceRestTimer(){
  if(!restTimer) return;
  const nextIndex = restTimer.choiceIndex + 1;
  if(nextIndex >= restTimer.choices.length){
    clearRestTimer();
    return;
  }
  restTimer.choiceIndex = nextIndex;
  restTimer.endAt = Date.now() + restTimer.choices[nextIndex] * 1000;
  restTimer.phase = "running";
  renderRestTimerBadge();
}

// Tapping the finished (red) badge: first tap reverts to the previous timer value,
// second tap clears it. Tapping a running badge advances/cancels via the same logic the main button uses.
function handleRestTimerBadgeTap(){
  if(!restTimer) return;
  if(restTimer.phase === "done"){
    if(!restTimer.revertedFromDone && lastRestTimerChoiceIndex != null){
      // First tap: restart with the SAME duration that just finished,
      // not a shorter/earlier one - "prior timer countdown time" means
      // the one that had been counting down, not a step back in the cycle.
      const idx = lastRestTimerChoiceIndex;
      const durationSec = idx === -1
        ? restBucketFor(data[restTimer.exerciseName]).minSec
        : restTimer.choices[idx];
      if(durationSec != null){
        restTimer.choiceIndex = idx;
        restTimer.endAt = Date.now() + durationSec * 1000;
        restTimer.phase = "running";
        restTimer.revertedFromDone = true;
        if(restTimer.intervalId) clearInterval(restTimer.intervalId);
        restTimer.intervalId = setInterval(tickRestTimer, 1000);
        renderRestTimerBadge();
        return;
      }
    }
    // Second tap or no valid revert: clear it
    clearRestTimer();
    return;
  }
  if(restTimer.revertedFromDone){
    // User tapped while in reverted state (running but came from done),
    // so the next tap should clear instead of advancing
    clearRestTimer();
    return;
  }
  advanceRestTimer();
}

function clearRestTimer(){
  if(restTimer && restTimer.intervalId) clearInterval(restTimer.intervalId);
  restTimer = null;
  renderRestTimerBadge();
}

// Updates only the fixed badge element directly, deliberately bypassing
// the app's normal full render() - re-rendering the whole page every
// second would blow away focus/cursor position in whatever field the
// user is mid-typing into while resting.
function renderRestTimerBadge(){
  const el = document.getElementById("rest-timer-badge");
  if(!el) return;
  if(!restTimer){
    el.hidden = true;
    el.className = "rest-timer-badge";
    el.textContent = "";
    return;
  }
  el.hidden = false;
  if(restTimer.phase === "done"){
    el.className = "rest-timer-badge done";
    el.textContent = "Rest over";
  } else {
    const remainingSec = Math.max(0, Math.ceil((restTimer.endAt - Date.now()) / 1000));
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    el.className = "rest-timer-badge running";
    el.textContent = `${m}:${String(s).padStart(2, "0")}`;
  }
}

function calcVolume(entry, ex){
  return ex.trackBy === "weight" ? entry.weight * entry.sets * entry.reps : 0;
}

function calcDayVolumeHistory(day){
  const names = DAY_ORDER[day];
  const byDate = {};
  names.forEach(name => {
    const ex = data[name];
    if(!ex) return;
    ex.entries.forEach(e => {
      if(!e.date) return;
      byDate[e.date] = (byDate[e.date] || 0) + calcVolume(e, ex);
    });
  });
  return Object.keys(byDate).sort().map((date, i) => ({
    label: "S" + (i + 1), date, confirmed: true, weight: Math.round(byDate[date]), sets: 1, reps: 1, note: "",
  }));
}

function frequencyLabel(ex){
  if(ex.entries.length < 2) return null;
  const dates = ex.entries.map(e => new Date(e.date + "T00:00:00")).filter(d => !isNaN(d)).sort((a,b) => a-b);
  if(dates.length < 2) return null;
  let totalGap = 0;
  for(let i = 1; i < dates.length; i++) totalGap += (dates[i] - dates[i-1]) / 86400000;
  const avgGap = totalGap / (dates.length - 1);
  return `${ex.entries.length}x logged, ~every ${avgGap.toFixed(1)}d`;
}

function computeRecoveryReadiness(){
  const lastDate = getLastSessionDate();
  if(!lastDate) return null;
  const daysSince = Math.max(0, daysBetween(lastDate, todayISO()));

  // Average difficulty across the most recent few logged sets, across all exercises
  const allEntries = [];
  // Shoulder Rehab stores its 0-10 pain score in difficulty; that is not effort, so it stays out.
  Object.entries(data).forEach(([n, ex]) => n !== REHAB_NAME && ex.entries.forEach(e => { if(e.difficulty) allEntries.push({ date: e.date, difficulty: e.difficulty }); }));
  allEntries.sort((a,b) => (a.date < b.date ? 1 : -1));
  const recentDiff = allEntries.slice(0, 5);
  const avgDifficulty = recentDiff.length ? recentDiff.reduce((s,e)=>s+e.difficulty,0)/recentDiff.length : null;

  // ~3 days rested reaches full readiness on its own; only a genuinely hard
  // recent stretch (avg difficulty above 7) pulls it back down, and only
  // modestly - this isn't meant to demand a week off for one tough session.
  let readiness = daysSince * 3.5;
  if(avgDifficulty !== null && avgDifficulty > 7) readiness -= (avgDifficulty - 7) * 0.8;
  readiness = Math.max(0, Math.min(10, Math.round(readiness)));

  const neededRestDays = Math.min(3, Math.max(0, Math.ceil((6 - readiness) / 3.5)));
  return { readiness, daysSince, avgDifficulty, neededRestDays, lastDate };
}


// Heaviest load the gym has for a lift (EXERCISE_DEFAULTS maxWeight). Once a
// progression would pass it, progress by reps up to MAX_WEIGHT_REP_CAP, then
// point at a harder variation instead of a heavier weight.
const MAX_WEIGHT_REP_CAP = 20;
function capAtMaxWeight(sug, ex, name, last){
  const maxW = (EXERCISE_DEFAULTS[name] || {}).maxWeight;
  if(!sug || ex.trackBy !== "weight" || !maxW || !last || sug.weight == null) return sug;
  if(sug.weight <= maxW && !(sug.readyToProgress && last.weight >= maxW)) return sug;
  const atRepCap = (last.reps || 0) >= MAX_WEIGHT_REP_CAP;
  const reps = sug.readyToProgress && !atRepCap ? Math.min((last.reps || 0) + 2, MAX_WEIGHT_REP_CAP) : (last.reps || sug.reps);
  return { ...sug, weight: maxW, reps, atMaxWeight: true, atRepCap: atRepCap && sug.readyToProgress };
}

// A weight written into last session's note for next time: "Dial to 50!", "Good to move up to
// 180", "Good for 150 next", "Ok for 15 lbs", "next 155", "try 52.5". Only phrasings that point at
// the next session count; a number tagged as seconds, minutes, reps, sets or percent never does,
// and it has to be a plausible load for this lift (half to double the last weight, or up to 100 lb
// on a lift last done at bodyweight), so "60 sec intervals" can't turn into 60 lb.
const NOTE_NUM = String.raw`(\d+(?:\.\d+)?)\b(?!\s*(?:sec|s\b|seconds|min|mins|minutes|reps?|sets?|x\b|%))`;
const NOTE_WEIGHT_PATTERNS = [
  new RegExp(String.raw`\b(?:dial|drop|go|move|bump|jump|step|come|increase|decrease|reduce|cut|switch|try|use|start|stay|hold|stick|load)(?:\s+(?:it\s+)?(?:up|down|back))?\s+(?:to|at|with)\s+` + NOTE_NUM, "i"),
  new RegExp(String.raw`\b(?:good|ok|okay|ready|fine)\s+(?:for|with|at)\s+` + NOTE_NUM, "i"),
  new RegExp(String.raw`\b(\d+(?:\.\d+)?)\s*(?:lbs?|pounds)?\s+next\b`, "i"),
  new RegExp(String.raw`\bnext\b\s*:?\s*(?:time\s+|session\s+)?(?:at\s+|try\s+)?` + NOTE_NUM, "i"),
  new RegExp(String.raw`\btry\s+` + NOTE_NUM, "i"),
];
// Note cues for the next session. "easy day" is a recovery choice, not a sign the load is light.
const NOTE_UP_CUES = /\b(?:move|moving|go|going|bump)\s+(?:it\s+)?up\b|room for more|\btoo (?:easy|light)\b|\beasy\b(?!\s+day)|\bstarting light\b|\bfelt light\b/i;
const NOTE_HOLD_CUES = /\b(?:stay|hold|stick)\b|fell apart|maxing out|\bmissed\b|\bfailed\b|\btired\b|poor balance|\bdeload\b/i;

// Reads the last two notes as a coach would and returns one short line of guidance, in its own
// words rather than quoting yours: what the notes say about pain, grip, balance, fatigue, how hard
// it was, or setup. Notes with nothing to act on (a weight, "straight bar") give nothing.
const NOTE_THEMES = [
  { key: "pain", re: /\b(pain|pail|hurt|ache|aching|sore|tender|tweak)/i,
    say: n => { const part = (n.match(/\b(knee|shoulder|back|elbow|wrist|hip|hamstring|ankle|neck)\b/i) || [])[1];
      return part ? `Watch the ${part.toLowerCase()}; back off if it sharpens.` : "Something flared; back off if it sharpens."; } },
  { key: "grip", re: /\bgrip\b/i,
    say: n => /help|better|fixed|stagger|mixed|over\/under|strap|chalk/i.test(n) ? "The grip change is working; keep it." : "Grip gives out first; try straps or a staggered grip." },
  { key: "balance", re: /balance|wobbl|stabil/i, say: () => "Balance limits it; slow the lowering and use the mirror." },
  { key: "fatigue", re: /\btired|fatigue|end of|out of order|\bafter\b/i, say: () => "Fatigue showed late; rest a little longer before this one." },
  { key: "grind", re: /heavy|grind|fell apart|maxing|hard to|tough|struggl|deload/i, say: () => "Last sets were a grind; own this load before adding." },
  { key: "setup", re: /setup|set up|technique|\bform\b/i,
    say: n => /good|solid|clean/i.test(n) ? "Technique is dialed; the load can follow." : "Setup was the sticking point; set up slower." },
  { key: "strong", re: /\beasy\b(?!\s+day)|\blight\b|move up|moving up|felt good|strong|solid|room for more/i, say: () => "It moved well last time." },
];
// budget: characters left for it in the tile's two guidance lines after the call itself.
function noteInsights(entries){
  // Deload Week sessions are planned and lighter (and their notes start with "Deload"), so the read
  // comes from regular sessions, the same ones the next suggestion is built from.
  const notes = entries.filter(e => !e.deload).slice(-3).reverse().map(e => e.note).filter(Boolean).slice(0, 2);
  const out = [], seen = new Set();
  notes.forEach(n => NOTE_THEMES.forEach(t => {
    if(seen.has(t.key) || !t.re.test(n)) return;
    seen.add(t.key);
    // A strength read next to a warning is noise; keep the warning.
    if(t.key === "strong" && out.length) return;
    out.push(t.say(n));
  }));
  return out;
}

function noteTargetWeight(note, lastWeight){
  if(!note) return null;
  for(const re of NOTE_WEIGHT_PATTERNS){
    const m = String(note).match(re);
    if(!m) continue;
    const n = Number(m[1]);
    const plausible = lastWeight > 0 ? (n >= lastWeight * 0.5 && n <= lastWeight * 2) : (n > 0 && n <= 100);
    if(plausible) return n;
  }
  return null;
}
// The note's number replaces the automatic progression, including a miss-streak drop. With Knee
// or Back Care trimming the lift, the note can only take it lower, never back up.
function applyNoteTarget(core, ex, last){
  if(!core || !last || ex.trackBy !== "weight") return core;
  const w = noteTargetWeight(last.note, last.weight);
  if(w == null) return core;
  if(core.careFlags && core.careFlags.length) return w < core.weight ? { ...core, weight: w, noteTarget: w, noteText: last.note } : core;
  return { ...core, weight: w, deload: false, readyToProgress: w > last.weight, noteTarget: w, noteText: last.note };
}

// A note holds the next weight up only for pain words ("tender", "sore", ...), never when negated
// ("no pain", "not sore", "less tender"). "Heavy" is what RPE is for, and grip has its own tip, so neither stops a
// lift that hit its reps from moving up.
const HOLD_WORDS = ["tender", "pain", "sore", "ache", "hurt"];
function noteConcernWord(note){
  const n = String(note || "").toLowerCase();
  return HOLD_WORDS.find(w => new RegExp(String.raw`\b${w}`).test(n) && !new RegExp(String.raw`\b(?:no|not|less|without|zero)\s+(?:\w+\s+)?${w}`).test(n)) || null;
}

// Coming back, two rules on top of the normal progression (Deload Week, when on, overrides both):
// - Time off: a gap of BREAK_DAYS or more since the last session restarts at ~90% of the last
//   working weight, then 95%, then the full weight, one session each, while targets are hit.
// - After a deload: the first session back repeats the pre-deload weight unless that session was
//   clean (reps hit, RPE 7 or less, no concern in the note); pressing lifts always repeat once.
const BREAK_DAYS = 14;
const REENTRY_STEPS = [0.9, 0.95, 1];
const roundLoad = w => Math.round(w / 2.5) * 2.5;
// Time off means no training at all, not one lift skipped: any logged session of any lift in
// between breaks it. A lift done every couple of weeks never counts as coming back from a break.
function trainedBetween(a, b){
  return Object.entries(data).some(([n, x]) => n !== REHAB_NAME && !isRecovery(n) && x.entries.some(e => e.date > a && e.date < b));
}
function lastTrainingDate(){
  let d = "";
  Object.entries(data).forEach(([n, x]) => { if(n !== REHAB_NAME && !isRecovery(n)) x.entries.forEach(e => { if(e.date > d) d = e.date; }); });
  return d;
}
function applyReturn(core, ex, name, baseline){
  if(!core || ex.trackBy !== "weight" || !baseline.length) return core;
  const all = ex.entries;
  const last = all[all.length - 1];
  const careHeld = core.careFlags && core.careFlags.length;
  // Time off now: the next session is the first back.
  const lastAny = lastTrainingDate();
  const off = lastAny ? daysBetween(lastAny, todayISO()) : 0;
  if(off >= BREAK_DAYS){
    // A main lift starting a new track restarts from its converted weight, not the other track's.
    const pre = core.trackStart ? { weight: core.weight } : baseline[baseline.length - 1];
    if(!(pre.weight > 0)) return core;
    const weight = Math.min(core.weight, roundLoad(pre.weight * REENTRY_STEPS[0]));
    return { ...core, weight, reps: effectiveTargetReps(ex), readyToProgress: false, reentry: { step: 1, daysOff: off, fullWeight: pre.weight } };
  }
  // Back from time off already: keep climbing the ramp while each session hits its target.
  let gapAt = -1;
  for(let i = all.length - 1; i > 0 && i >= all.length - REENTRY_STEPS.length + 1; i--){
    if(daysBetween(all[i - 1].date, all[i].date) >= BREAK_DAYS && !trainedBetween(all[i - 1].date, all[i].date)){ gapAt = i; break; }
  }
  if(gapAt > 0 && !careHeld && core.noteTarget == null && !core.trackStart){
    const before = all.slice(0, gapAt).filter(e => !e.deload), since = all.slice(gapAt);
    const pre = before[before.length - 1];
    const step = since.length + 1; // the session being planned
    const allHit = since.every(e => e.reps >= effectiveTargetReps(ex));
    if(pre && pre.weight > 0 && step <= REENTRY_STEPS.length && allHit){
      const ramp = roundLoad(pre.weight * REENTRY_STEPS[step - 1]);
      if(ramp > core.weight) return { ...core, weight: ramp, readyToProgress: true, reentry: { step, fullWeight: pre.weight } };
    }
  }
  // First session back from a deload: back to the pre-deload weight, and the next step up only when
  // that last full session was clean (every rep, RPE 7 or easier, no concern in its note). Pressing
  // lifts always repeat it once, for the shoulders. A weight set in that note still wins.
  if(last.deload && !modes.deload && core.noteTarget == null && !core.trackStart){
    const pre = baseline[baseline.length - 1];
    const flagged = noteConcernWord(pre.note);
    const why = LIFT_PATTERNS[name] === "push" ? "pressing repeats it once"
      : pre.reps < effectiveTargetReps(ex) ? "missed reps last full session"
      : pre.difficulty >= 8 ? `last full session was RPE ${pre.difficulty}`
      : flagged ? `last note flagged ${flagged}` : null;
    if(why && core.weight > pre.weight) return { ...core, weight: pre.weight, readyToProgress: false, postDeloadHold: { why } };
  }
  return core;
}

// A main lift's first session on a track it has never done (its first heavy day, or its first
// volume day after only heavy ones) works out from the last working set's estimated max. Moving to
// heavier, lower-rep sets it starts a little under (95%), so it lands around RPE 7 to 8.
function startTrack(ex, last){
  const target = effectiveTargetReps(ex), lastTarget = entryTargetReps(ex, last);
  const weight = roundLoad(last.weight * (1 + last.reps / 30) / (1 + target / 30) * (target < lastTarget ? 0.95 : 1));
  return { weight, sets: ex.heavyPlanned ? HEAVY_SETS : 3, reps: target, hitTarget: false, readyToProgress: false,
    streak: 0, requiredStreak: ex.conservative ? 2 : 1, difficultyNote: null, noteConcern: null, deload: false,
    trackStart: { from: last.weight, fromReps: last.reps } };
}

// Joint check: pain above 3 of 10 on the last session (deload or not) holds the load; 6 or more
// drops it about 10%. Lifts without weight hold their reps instead.
const PAIN_HOLD_ABOVE = 3, PAIN_DROP_AT = 6;
// For a main lift the pain is read from its last session either way, and the load held is this
// track's own last weight.
function applyPain(s, ex, full){
  const hurt = (full || ex).entries[(full || ex).entries.length - 1];
  const last = ex.entries[ex.entries.length - 1] || hurt;
  if(!s || !hurt || !(hurt.pain > PAIN_HOLD_ABOVE) || ex.trackBy === "duration") return s;
  const hold = { pain: hurt.pain, area: hurt.painArea || "", drop: hurt.pain >= PAIN_DROP_AT, from: last.weight };
  if(ex.trackBy !== "weight" || !(last.weight > 0)) return { ...s, reps: Math.min(s.reps, hurt.reps), readyToProgress: false, painHold: hold };
  const cap = hold.drop ? roundLoad(last.weight * 0.9) : last.weight;
  return { ...s, weight: Math.min(s.weight, cap), readyToProgress: false, painHold: hold };
}
// The full suggestion: the core progression, then the note target, the equipment cap, the comeback
// rules, Shoulder Rehab and the joint check, with Deload Week last (about 10% lighter, a third
// fewer sets; a lift already cut keeps its weight and only loses sets). Deload-week sessions are
// skipped here, so progression resumes from the pre-deload weights. A main lift plans from the
// sessions on today's track (heavy or volume) only.
function computeSuggestion(full, name){
  if(!full.entries.length || isRecovery(name)) return null;
  let ex = full, fresh = false;
  if(full.targetRepsStrength && full.trackBy === "weight"){
    const heavy = plannedHeavy(name, full);
    const track = full.entries.filter(e => isHeavyEntry(full, e) === heavy);
    fresh = !track.some(e => !e.deload) && full.entries.some(e => !e.deload && e.weight > 0);
    ex = { ...full, entries: fresh ? full.entries : track, heavyPlanned: heavy };
  }
  // Deload Week sessions are skipped, except one done heavier than the regular session before it:
  // that load is real and the plan builds from it, at the regular session's sets.
  let regular = null;
  const baseline = ex.entries.filter(e => {
    if(!e.deload){ regular = e; return true; }
    return !!(regular && e.weight > regular.weight);
  });
  const baseEntries = baseline.length ? baseline : ex.entries;
  const lastBaseEntry = baseEntries[baseEntries.length - 1];
  const start = fresh ? startTrack(ex, lastBaseEntry) : computeSuggestionCore(baseline.length ? { ...ex, entries: baseline } : ex, name);
  let core = applyPain(applyShoulder(applyReturn(capAtMaxWeight(fresh ? start : applyNoteTarget(start, ex, lastBaseEntry), ex, name, lastBaseEntry), ex, name, baseline), ex, name, baseline), ex, full);
  if(core && lastBaseEntry && lastBaseEntry.deload && regular && regular.sets) core = { ...core, sets: regular.sets };
  if(core && ex.heavyPlanned != null) core = { ...core, heavy: ex.heavyPlanned, sets: ex.heavyPlanned ? HEAVY_SETS : core.sets };
  if(!modes.deload || !core || ex.trackBy === "duration") return core;
  const lastBase = lastBaseEntry;
  const sets = Math.max(2, Math.round(((core.trackStart ? core.sets : lastBase.sets) || core.sets || 3) * 2 / 3));
  if(ex.trackBy !== "weight") return { ...core, sets, reps: lastBase.reps, deloadWeek: true };
  const alreadyReduced = !!(core.careFlags && core.careFlags.length) || !!core.shoulderHold || !!(core.painHold && core.painHold.drop) || core.deload || (core.noteTarget != null && core.noteTarget < lastBase.weight);
  const weight = alreadyReduced ? core.weight : Math.round(((core.trackStart ? core.weight : lastBase.weight) * 0.9) / 2.5) * 2.5;
  return { ...core, weight, sets, reps: ex.heavyPlanned != null ? core.reps : (ex.targetReps || core.reps), readyToProgress: false, deloadWeek: true, deloadKeptReduction: alreadyReduced };
}

function computeSuggestionCore(ex, name){
  if(!ex.entries.length) return null;
  const last = ex.entries[ex.entries.length-1];
  const targetReps = effectiveTargetReps(ex);
  const increment = ex.increment || 5;

  if(ex.trackBy === "weight"){
    // Consecutive-hit streak at the current weight, most recent first -
    // stops at the first missed rep target OR the first different weight.
    // An old miss must not permanently block progression once you're back
    // to hitting the target consistently at this same weight.
    let streak = 0;
    for(let i = ex.entries.length - 1; i >= 0; i--){
      const e = ex.entries[i];
      if(e.weight !== last.weight || e.reps < targetReps) break;
      streak++;
    }

    // Separately: how many *consecutive* misses at this same weight, most
    // recent first - stops at the first hit or the first different weight.
    let missStreak = 0;
    for(let i = ex.entries.length - 1; i >= 0; i--){
      const e = ex.entries[i];
      if(e.weight === last.weight && e.reps < targetReps) missStreak++;
      else break;
    }

    // Deload check takes priority over everything else: 3+ straight misses
    // at the same weight means grinding harder isn't working - drop the load.
    if(missStreak >= 3){
      const deloadWeight = Math.round((last.weight * 0.85) / 2.5) * 2.5;
      return {
        weight: deloadWeight,
        sets: last.sets,
        reps: targetReps,
        hitTarget: false,
        readyToProgress: false,
        streak, requiredStreak: ex.conservative ? 2 : 1,
        difficultyNote: null,
        noteConcern: null,
        deload: true,
        missStreak,
      };
    }

    // Knee/back care modes are a standing safety flag, not a per-session
    // read - while active on a flagged exercise, always hold and proactively
    // trim load rather than waiting for a miss streak like a normal deload.
    const careFlags = [];
    if(modes.knee && KNEE_SENSITIVE_EXERCISES.has(name)) careFlags.push("knee");
    if(modes.back && LOW_BACK_SENSITIVE_EXERCISES.has(name)) careFlags.push("back");
    if(careFlags.length){
      // About 10% under the heaviest load of the last 6 weeks, and never under the last log: a lift
      // already trimmed holds there instead of dropping another 10% every session.
      const recentPeak = Math.max(...ex.entries.filter(e => e.date >= shiftISO(last.date, -42)).map(e => e.weight || 0));
      const careWeight = Math.min(last.weight, roundLoad(recentPeak * 0.9));
      return {
        weight: careWeight,
        sets: last.sets,
        reps: targetReps,
        hitTarget: last.reps >= targetReps,
        readyToProgress: false,
        streak, requiredStreak: ex.conservative ? 2 : 1,
        difficultyNote: null,
        noteConcern: null,
        deload: false,
        careFlags,
      };
    }

    const requiredStreak = ex.conservative ? 2 : 1;
    const hitTarget = last.reps >= targetReps;
    let readyToProgress = streak >= requiredStreak;
    // Rep range: weight goes up once every set reaches the top, or once a session reaches the middle
    // of the range at RPE 7 or easier (reps to spare). Conservative lifts want two of those in a row.
    const range = activeRepRange(ex);
    const mid = range ? Math.ceil((range[0] + range[1]) / 2) : null;
    let rangeEarly = false, refit = null;
    if(range){
      const earned = e => e.reps >= range[1] || (e.reps >= mid && e.difficulty > 0 && e.difficulty <= 7);
      let earnedStreak = 0;
      for(let i = ex.entries.length - 1; i >= 0; i--){
        const e = ex.entries[i];
        if(e.weight !== last.weight || !earned(e)) break;
        earnedStreak++;
      }
      readyToProgress = earnedStreak >= requiredStreak;
      rangeEarly = readyToProgress && last.reps < range[1];
      // Well under the bottom of the range: asking for twice the reps at the same weight makes no
      // sense, so the weight comes down to one that lands at the bottom (from the estimated max). It
      // reads the typical set, so one short set in 5/8/8 doesn't count as a 5-rep session.
      const by = Array.isArray(last.repsBySet) && last.repsBySet.length ? [...last.repsBySet].sort((a, b) => a - b) : null;
      const typical = by ? by[Math.floor(by.length / 2)] : last.reps;
      if(typical < range[0] - 2 && last.weight > 0){
        const fit = roundLoad(last.weight * (1 + typical / 30) / (1 + range[0] / 30));
        if(fit < last.weight) refit = { from: last.weight, fromReps: typical };
        if(refit) return { weight: fit, sets: last.sets, reps: range[0], range, mid, hitTarget: false, readyToProgress: false,
          streak: 0, requiredStreak, difficultyNote: null, noteConcern: null, noteText: last.note || null, deload: false, refit };
      }
    }
    let difficultyNote = null;

    if(last.difficulty){
      if(last.difficulty >= 9 && readyToProgress){
        readyToProgress = false;
        difficultyNote = "hard";
      } else if(last.difficulty <= 4 && hitTarget && !readyToProgress){
        readyToProgress = true;
        difficultyNote = "easy";
      }
    }

    // A pain word in the prior session's note holds progression the same way a brutal RPE does,
    // even if the numbers alone said "go".
    const noteConcern = noteConcernWord(last.note) ? last.note : null;
    if(noteConcern && readyToProgress) readyToProgress = false;

    // Plain-language cues in the last note steer the call too: "stay", "hold", "fell apart",
    // "tired" hold the weight; "move up", "easy", "starting light" add it once the target reps
    // were hit and the RPE wasn't brutal. A concern word or an explicit weight in the note wins.
    let noteCue = null;
    if(last.note && !noteConcern && !last.deload){
      if(NOTE_HOLD_CUES.test(last.note)){
        if(readyToProgress){ readyToProgress = false; noteCue = "hold"; }
      } else if(NOTE_UP_CUES.test(last.note) && hitTarget && !readyToProgress && difficultyNote !== "hard"){
        readyToProgress = true; noteCue = "up";
      }
    }

    // Inside a range and not adding weight yet: two more reps after a session at RPE 7 or easier,
    // one at RPE 8 (or unrated), the same reps at 9 or 10.
    const repStep = !last.difficulty || last.difficulty === 8 ? 1 : last.difficulty <= 7 ? 2 : 0;
    return {
      weight: readyToProgress ? last.weight + increment : last.weight,
      sets: last.sets,
      reps: !range ? targetReps : readyToProgress ? range[0] : hitTarget ? Math.min(range[1], Math.max(range[0], last.reps + repStep)) : range[0],
      range,
      mid,
      rangeEarly,
      hitTarget,
      readyToProgress,
      streak,
      requiredStreak,
      difficultyNote,
      noteConcern,
      noteCue,
      noteText: last.note || null,
      deload: false,
    };
  }

  if(ex.trackBy === "duration"){
    let minutes = last.minutes;
    let note = "hold";
    if(last.difficulty){
      if(last.difficulty <= 5){ minutes = last.minutes + 5; note = "easy"; }
      else if(last.difficulty >= 8){ minutes = Math.max(10, last.minutes - 5); note = "hard"; }
    }
    return { minutes, difficultyNote: note };
  }

  // Jumps and bounds train speed and landing quality: reps stay at the target and progress comes
  // from a higher box or a longer bound, never from more reps.
  if(ex.preseasonPower) return { reps: targetReps, sets: last.sets, hitTarget: true, powerHold: true };
  return { reps: last.reps + 2, sets: last.sets, hitTarget: true };
}

function allDayNames(){
  return [...Object.keys(DAY_ORDER).flatMap(k => DAY_ORDER[k]), ...Object.values(FINISHERS).flat(), ...Object.values(SKI_FINISHERS).flat()];
}

