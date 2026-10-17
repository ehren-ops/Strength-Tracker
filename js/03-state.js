// Loaded state: saved data, theme, training modes and deload dates, persistence, backup and restore.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- state ----------
let data = loadSaved() || JSON.parse(JSON.stringify(SEED));
ensureClientIds();
backfillExerciseDefaults();
// The program: which day lists the app runs. Classic is the split (Full Body, Upper, Lower);
// Full Body 2+1 is two full-body days (A, B) and an optional C. Lifts and history are shared, so
// switching (either way) loses nothing. Synced in user_settings.settings.program.
const PROGRAM_KEY = "strength-tracker-program";
const PROGRAMS = {
  classic: { name: "Classic split", short: "Classic", days: CLASSIC_DAYS,
    desc: "Full Body, Upper and Lower days. Each main lift twice a week: heavy (4x5) the first time, volume (3x8) the second. Short core and grip finishers." },
  fullbody: { name: "Full Body 2+1", short: "Full Body 2+1", days: FULLBODY_DAYS,
    desc: "Two full-body days a week (A and B) plus an optional C. Squat and RDL on both days, one heavy (4x5) and one volume (3x8); bench and row heavy on A. Core and grip finishers." },
};
let program = (function(){
  try{ const p = JSON.parse(window.localStorage.getItem(PROGRAM_KEY)); return p && PROGRAMS[p.key] ? p : { key: "classic" }; }catch(e){ return { key: "classic" }; }
})();
function saveProgram(){
  try{ window.localStorage.setItem(PROGRAM_KEY, JSON.stringify(program)); }catch(e){}
}
function programDays(){ return PROGRAMS[program.key].days; }
// The program a date's sessions were logged under (Classic before the first switch). Only used to
// read v107 entries, logged at 4x5 on Full Body 2+1 before entries carried a heavy flag.
function programOn(date){
  const h = (program.history || []).filter(p => p.startedOn <= date).pop();
  return h ? h.key : "classic";
}
// Heavy and volume days for the main lifts (those with targetRepsStrength), on either program:
// heavy is 4 sets of targetRepsStrength (5), volume the usual 3x8. Classic: the first session of a
// lift in a week (Monday on) is heavy, any later one volume. Full Body 2+1: fixed by day, so A and B
// each carry one heavy lower-body lift. Each track progresses from its own sessions.
const HEAVY_SETS = 4;
const HEAVY_DAY = { "Squat": "a", "Bench Press": "a", "Barbell Row": "a", "RDL": "b" };
function liftName(ex){ return Object.keys(data).find(n => data[n] === ex); }
function isHeavyEntry(ex, e){
  if(!ex || !ex.targetRepsStrength || !e) return false;
  if(e.heavy != null) return !!e.heavy;
  return !e.preseason && !!e.date && programOn(e.date) === "fullbody";
}
// Whether the session on this date (today by default) is the heavy one. Never while a preseason or
// in-season target sets the reps, or while Shoulder Rehab holds or pauses the lift. A session
// already logged that day keeps its own call.
function plannedHeavy(name, ex, date){
  if(!ex || !ex.targetRepsStrength || ex.trackBy !== "weight") return false;
  if((modes.preseason && ex.targetRepsPreseason) || (modes.ski && ex.targetRepsSki)) return false;
  if(modes.shoulder && typeof isShoulderHeld === "function" && (isShoulderHeld(name) || isShoulderPaused(name))) return false;
  date = date || todayISO();
  const done = ex.entries.filter(e => e.date === date).pop();
  if(done) return isHeavyEntry(ex, done);
  if(program.key === "fullbody" && HEAVY_DAY[name]){
    // The day on screen when the lift is on it, else its only day, else the next day in the rotation.
    const days = FULLBODY_DAYS.filter(d => DAY_ORDER[d].includes(name));
    const day = days.includes(view) ? view : days.length === 1 ? days[0] : nextProgramDay();
    return HEAVY_DAY[name] === day;
  }
  const wk = weekStartISO(date);
  return !ex.entries.some(e => e.date >= wk && e.date < date);
}
function setProgram(key){
  if(key === program.key || !PROGRAMS[key]) return;
  program = { key, startedOn: todayISO(), history: [...(program.history || []), { key, startedOn: todayISO() }] };
  saveProgram();
  if(view !== "extra" && view !== "overview"){ view = nextProgramDay(); selected = DAY_ORDER[view][0]; }
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  render();
}
// The day the app opens on. Full Body 2+1 follows the rotation: today's session if one is logged,
// otherwise A, then B, then C only if B was this week (C is optional), then A again.
function nextProgramDay(){
  const days = programDays();
  if(program.key !== "fullbody") return days[0];
  const dates = trainingDates(), today = todayISO();
  if(dates[today] && days.includes(dates[today].day)) return dates[today].day;
  const last = Object.keys(dates).filter(d => d < today && days.includes(dates[d].day)).sort().pop();
  if(!last) return "a";
  const lastDay = dates[last].day;
  if(lastDay === "a") return "b";
  if(lastDay === "b") return weekStartISO(last) === weekStartISO(today) ? "c" : "a";
  return "a";
}
function weekStartISO(iso){
  const [y, m, d] = iso.split("-").map(Number), dt = new Date(y, m - 1, d);
  return shiftISO(iso, -((dt.getDay() + 6) % 7)); // Monday
}
let view = programDays()[0];
let selected = DAY_ORDER[view][0];
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth();
let calendarSelectedDate = null;
let calendarExpanded = false;
let lastSessionExpanded = false;
let volumeExpanded = false;
let openHistory = {};
let openStretchItems = {};
// Extra tab: the group last shown and the Mobility routine last picked, remembered on this device.
const EXTRA_GROUP_KEY = "strength-tracker-extra-group";
const MOBILITY_ROUTINE_KEY = "strength-tracker-mobility-routine";
let extraGroup = (function(){ try{ return localStorage.getItem(EXTRA_GROUP_KEY) || "strength"; }catch(e){ return "strength"; } })();
let mobilityRoutine = (function(){ try{ return localStorage.getItem(MOBILITY_ROUTINE_KEY) || ""; }catch(e){ return ""; } })();
function saveExtraPrefs(){
  try{ localStorage.setItem(EXTRA_GROUP_KEY, extraGroup); localStorage.setItem(MOBILITY_ROUTINE_KEY, mobilityRoutine); }catch(e){}
}
let chartQuarterOffset = {};
let editingKey = null;
let deletingKey = null; // history row whose ✕ is armed: the next tap on it deletes
let deleteArmTimer = null;
// Lifts skipped on purpose, by date: { "2026-10-14": { "Bench Press": "injury" } }. A skip counts
// the lift as done for the day and tells the coach why it is missing; history is untouched.
const SKIPS_KEY = "strength-tracker-skips";
let skips = (function(){ try{ return JSON.parse(localStorage.getItem(SKIPS_KEY) || "{}") || {}; }catch(e){ return {}; } })();
function saveSkips(){ try{ localStorage.setItem(SKIPS_KEY, JSON.stringify(skips)); }catch(e){} }
let skipPicking = null; // lift whose skip reasons are showing
let deletingExercise = null;
let editing1RM = null;
// The modifier registry: one row per training modifier, and the only place a modifier is described.
// Everything that lists modifiers reads it: the on/off/persist/sync bookkeeping (toggleMode, the cloud
// merge, the settings row), card badges and the card class (06), planModifiers (06), the note tags and
// graph markers (07), the Overview rows and the coach payload (09). The order here is the order shown.
//   column: the legacy user_settings column (the first six only). Settings sync through the
//           user_settings.settings JSON field, so a new modifier needs no schema change.
//   applies(name, ex): the lifts that carry its badge and note tag while it is on.
//   changesNumbers(name, ex): the lifts whose weight, sets or reps it changes today (planModifiers).
//   tag.kind: "light" (lighter on purpose: diamond) or "block" (a block with its own target: circle).
// What a modifier DOES still lives with its own logic (KNEE_SENSITIVE_EXERCISES, the preseason fields,
// 05b for the shoulder), and its color is the --<key> CSS token in both themes.
const MODE_DEFS = [
  { key: "deload", storageKey: "strength-tracker-deload-mode", column: "deload_mode",
    name: "Deload Week", short: "Deload", emoji: "🔋", badge: "Deload",
    tag: { kind: "light", re: /\bdeload\b/i, label: "Deload" },
    applies: (n, ex) => ex.trackBy !== "duration",
    changesNumbers: () => true,
    desc: "A planned lighter week so joints and tendons catch up: about 10% less weight and a third fewer sets on every lift. Lifts already cut for Knee or Back Care just lose sets. Ends itself after 7 days." },
  { key: "shoulder", storageKey: "strength-tracker-shoulder-mode", column: "shoulder_rehab_mode",
    name: "Shoulder Rehab", short: "Shoulder Rehab", emoji: "🩹", badge: n => isShoulderPaused(n) ? "Paused" : "Shoulder Rehab",
    tag: { kind: "light", re: /\b(shoulder )?rehab\b/i, label: "Rehab" },
    applies: n => isShoulderModified(n),
    changesNumbers: n => isShoulderPaused(n) || isShoulderHeld(n),
    desc: "Adds a daily rehab card to every day and push-ups to Full Body. Pauses flies, incline press, lateral raises and slams; bench drops to 85%, medium grip, short of the chest; curls come back as hammer curls in week 3; rows drop to 85% with a palms-in grip. Pushdowns, legs and riding carry on." },
  { key: "knee", storageKey: "strength-tracker-knee-mode", column: "knee_care_mode",
    name: "Knee Care", short: "Knee Care", emoji: "🦵", badge: "Knee Care",
    tag: { kind: "light", re: /\bknee care\b/i, label: "Knee Care" },
    applies: n => KNEE_SENSITIVE_EXERCISES.has(n) || KNEE_ONLY.has(n),
    changesNumbers: n => KNEE_SENSITIVE_EXERCISES.has(n),
    desc: "Squat, Bulgarian Split Squat and Walking Lunge hold and drop about 10% while your knee settles. Everything else trains as normal." },
  { key: "back", storageKey: "strength-tracker-back-mode", column: "low_back_care_mode",
    name: "Low Back Care", short: "Back Care", emoji: "🩺", badge: "Back Care",
    tag: { kind: "light", re: /\b(low )?back care\b/i, label: "Back Care" },
    applies: n => LOW_BACK_SENSITIVE_EXERCISES.has(n),
    changesNumbers: n => LOW_BACK_SENSITIVE_EXERCISES.has(n),
    desc: "Squat, RDL, Barbell Row, Kettlebell Swings and Hip Thrust (swap to a glute bridge) hold and drop about 10% while your lower back settles. Everything else trains as normal." },
  { key: "preseason", storageKey: "strength-tracker-preseason-mode", column: "preseason_mode",
    name: "Preseason Prep", short: "Preseason", emoji: "🏔️", badge: "Preseason",
    tag: { kind: "block", re: /\bpreseason\b/i, label: "Preseason" },
    applies: (n, ex) => !!ex.preseason,
    changesNumbers: (n, ex) => !!(ex.preseason && ex.targetRepsPreseason),
    desc: "Adds power, lateral, lowering-phase and calf work to your lift days for the 7 to 10 week ramp into ski season. Power work goes first; stop a set when speed drops." },
  { key: "ski", storageKey: "strength-tracker-ski-mode", column: "ski_season_mode",
    name: "Ski Season", short: "Ski", emoji: "🎿", badge: "Ski",
    tag: { kind: "block", re: /\bski( season)?\b/i, label: "Ski" },
    applies: (n, ex) => !!ex.targetRepsSki,
    changesNumbers: (n, ex) => !!ex.targetRepsSki,
    desc: "Squat, Bulgarian Split Squat and Walking Lunge shift to lower reps with a slower lowering phase. Roughly Nov to March." },
];
// The modifiers that are on and touch this lift, in registry order.
function modifiersOn(name, ex){
  return MODE_DEFS.filter(m => modes[m.key] && m.applies(name, ex));
}
const modes = {};
MODE_DEFS.forEach(m => {
  try{ modes[m.key] = window.localStorage.getItem(m.storageKey) === "1"; }
  catch(e){ modes[m.key] = false; }
});
// Display preference only, not training data, so this stays local to the
// device rather than syncing through upsert_settings like the modes above.
const DARK_MODE_KEY = "strength-tracker-dark-mode";
let darkMode = (function(){
  try{ return window.localStorage.getItem(DARK_MODE_KEY) === "1"; }catch(e){ return false; }
})();
function applyTheme(){
  document.documentElement.setAttribute("data-theme", darkMode ? "dark" : "light");
  const meta = document.querySelector('meta[name="color-scheme"]');
  if(meta) meta.setAttribute("content", darkMode ? "dark" : "light");
}
applyTheme();
function toggleDarkMode(){
  darkMode = !darkMode;
  try{ window.localStorage.setItem(DARK_MODE_KEY, darkMode ? "1" : "0"); }catch(e){}
  applyTheme();
  render();
}

// Deload week bookkeeping: when it was last switched on and off, so the
// modifier can show the last deload and when the next one is due, and so
// suggestions can skip the lighter deload sessions once it's over.
const DELOAD_DATES_KEY = "strength-tracker-deload-dates";
const DELOAD_EVERY_DAYS = 35; // a lighter week after roughly every 5 weeks of steady loading
const DELOAD_LENGTH_DAYS = 7;  // switches itself off after a week unless you choose to keep it on
let deloadDates = (function(){
  try{ return JSON.parse(window.localStorage.getItem(DELOAD_DATES_KEY)) || {}; }catch(e){ return {}; }
})();
function saveDeloadDates(){
  try{ window.localStorage.setItem(DELOAD_DATES_KEY, JSON.stringify(deloadDates)); }catch(e){}
}

// Shoulder rehab bookkeeping: the day it was switched on sets the week and
// phase, and stays after it is switched off so returning lifts can ramp back.
const SHOULDER_REHAB_KEY = "strength-tracker-shoulder-rehab";
let shoulderRehab = (function(){
  try{ return JSON.parse(window.localStorage.getItem(SHOULDER_REHAB_KEY)) || {}; }catch(e){ return {}; }
})();
function saveShoulderRehab(){
  try{ window.localStorage.setItem(SHOULDER_REHAB_KEY, JSON.stringify(shoulderRehab)); }catch(e){}
}

// Ski: one setting with two phases, Preseason (the ramp into the season) and In season. They are
// stored as the two modes "preseason" and "ski", which never run together, so everything reading
// modes.preseason / modes.ski keeps working. The phase record dates the block for its week count,
// the week-3 additions and the end-of-block prompt.
const SKI_PHASE_KEY = "strength-tracker-ski-phase";
const PRESEASON_WEEKS = 10;
let skiPhase = (function(){
  try{ return JSON.parse(window.localStorage.getItem(SKI_PHASE_KEY)) || {}; }catch(e){ return {}; }
})();
function saveSkiPhase(){
  try{ window.localStorage.setItem(SKI_PHASE_KEY, JSON.stringify(skiPhase)); }catch(e){}
}
function currentSkiPhase(){ return modes.preseason ? "preseason" : modes.ski ? "season" : "off"; }
// When the current phase began: its record, or for a preseason switched on before records existed,
// the first preseason session in the last four months.
function skiPhaseStart(){
  if(skiPhase.startedOn && skiPhase.phase === currentSkiPhase()) return skiPhase.startedOn;
  if(!modes.preseason) return null;
  const since = shiftISO(todayISO(), -120);
  let first = null;
  Object.entries(data).forEach(([n, ex]) => ex.entries.forEach(e => {
    if(e.date >= since && (e.preseason || PRESEASON_ONLY.has(n)) && (!first || e.date < first)) first = e.date;
  }));
  return first;
}
function preseasonWeek(){
  const start = modes.preseason ? skiPhaseStart() : null;
  return start ? Math.floor(Math.max(0, daysBetween(start, todayISO())) / 7) + 1 : null;
}
function setModeFlag(key, on){
  const def = MODE_DEFS.find(m => m.key === key);
  modes[key] = on;
  try{ window.localStorage.setItem(def.storageKey, on ? "1" : "0"); }catch(e){}
}
// Switching back to a phase left within SKI_RESUME_DAYS picks up its old start date instead of
// restarting the count at today, so a stray tap never resets the preseason week.
const SKI_RESUME_DAYS = 14;
function setSkiPhase(phase){
  const cur = currentSkiPhase();
  if(phase === cur) return;
  const recent = { ...(skiPhase.recent || {}) };
  if(cur !== "off" && skiPhase.startedOn) recent[cur] = { startedOn: skiPhase.startedOn, leftOn: todayISO(), manual: !!skiPhase.manual };
  setModeFlag("preseason", phase === "preseason");
  setModeFlag("ski", phase === "season");
  if(phase === "off") skiPhase = { ...skiPhase, phase: "off", endedOn: todayISO(), snoozeUntil: null, recent };
  else {
    const r = recent[phase], resume = r && r.startedOn && daysBetween(r.leftOn, todayISO()) <= SKI_RESUME_DAYS;
    skiPhase = { phase, startedOn: resume ? r.startedOn : todayISO(), snoozeUntil: null, recent, ...(resume && r.manual ? { manual: true } : {}) };
  }
  saveSkiPhase();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  render();
}
// A preseason can't have started after its own sessions: when preseason lifts (or preseason-tagged
// sets) run back from the start date with no gap of more than SKI_RESUME_DAYS, the start moves back
// to the first of them. Never moves it later, and leaves a date set by hand alone. Runs at startup
// and after each sign-in pull.
const PRESEASON_EVIDENCE = new Set(["Box Jumps", "Trap Bar Jump", "Skater Bound", "Med Ball Slam", "Copenhagen Plank"]);
function repairSkiPhaseStart(){
  if(currentSkiPhase() !== "preseason" || !skiPhase.startedOn || skiPhase.manual) return false;
  const days = [...new Set(Object.entries(data).flatMap(([n, ex]) => ex.entries.filter(e => e.preseason || PRESEASON_EVIDENCE.has(n)).map(e => e.date)))]
    .filter(d => d < skiPhase.startedOn).sort().reverse();
  let start = skiPhase.startedOn;
  for(const d of days){ if(daysBetween(d, start) > SKI_RESUME_DAYS) break; start = d; }
  if(start === skiPhase.startedOn) return false;
  skiPhase = { ...skiPhase, startedOn: start };
  saveSkiPhase();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  return true;
}
// Start dates set by hand on the Overview. A hand-set date is never repaired away.
function setSkiStart(iso){
  if(!iso || iso > todayISO() || currentSkiPhase() === "off") return;
  skiPhase = { ...skiPhase, startedOn: iso, manual: true };
  saveSkiPhase();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  render();
}
function setDeloadDate(which, iso){
  if(!iso || iso > todayISO() || !deloadDates.startedOn) return;
  const d = { ...deloadDates, [which]: iso, manual: true };
  if(which === "startedOn"){
    if(modes.deload) d.plannedEndOn = shiftISO(iso, DELOAD_LENGTH_DAYS);
    if(d.endedOn && d.endedOn < iso) d.endedOn = iso;
  } else if(iso < d.startedOn) return;
  deloadDates = d;
  saveDeloadDates();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  render();
}

// Undo: the Overview switches keep what they replaced for a few seconds, so an accidental tap is
// one tap to take back. Covers Deload, Ski, Knee Care and Low Back Care (Shoulder Rehab also
// edits session notes, so it has none).
const UNDO_MS = 10000;
let undoState = null;
function settingsSnapshot(){
  return JSON.stringify({ modes: Object.fromEntries(MODE_DEFS.map(m => [m.key, !!modes[m.key]])), skiPhase, deloadDates });
}
function userToggleMode(key){
  const snap = settingsSnapshot(), wasOn = !!modes[key];
  toggleMode(key);
  if(key !== "shoulder") offerUndo(`${MODE_DEFS.find(m => m.key === key).name} ${wasOn ? "off" : "on"}`, snap);
}
function userSetSkiPhase(phase){
  if(phase === currentSkiPhase()) return;
  const snap = settingsSnapshot();
  setSkiPhase(phase);
  offerUndo(phase === "off" ? "Ski off" : phase === "preseason" ? "Preseason on" : "In season on", snap);
}
function offerUndo(text, snap){
  clearTimeout(undoState && undoState.timer);
  undoState = { snap, timer: setTimeout(hideUndo, UNDO_MS) };
  let el = document.getElementById("undo-bar");
  if(!el){ el = document.createElement("div"); el.id = "undo-bar"; el.className = "undo-bar"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.innerHTML = `<span>${text}</span><button type="button" onclick="undoSettings()">Undo</button>`;
  el.hidden = false;
}
function hideUndo(){
  const el = document.getElementById("undo-bar");
  if(el) el.hidden = true;
  if(undoState) clearTimeout(undoState.timer);
  undoState = null;
}
function undoSettings(){
  if(!undoState) return;
  const s = JSON.parse(undoState.snap);
  MODE_DEFS.forEach(m => setModeFlag(m.key, !!s.modes[m.key]));
  skiPhase = s.skiPhase; saveSkiPhase();
  deloadDates = s.deloadDates; saveDeloadDates();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  hideUndo();
  render();
}

// The deload record follows what was actually logged. With Deload Week off, a recorded window
// holding no deload sessions (a quick on/off, or an older bad record) is replaced: by the record it
// overwrote when that one is still backed by sessions, or else by the latest run of deload-tagged
// sessions in the log (sessions within a week of each other), or cleared when there are none.
// Runs on switching it off, at startup and after each sign-in pull.
function repairDeloadDates(){
  if(modes.deload || !deloadDates.startedOn || deloadDates.manual) return false;
  const deloadDays = [...new Set(Object.values(data).flatMap(ex => ex.entries.filter(e => e.deload).map(e => e.date)))].sort();
  const backed = r => r && r.startedOn && deloadDays.some(d => d >= r.startedOn && d <= (r.endedOn || r.startedOn));
  if(backed(deloadDates)) return false;
  let fixed = null;
  if(backed(deloadDates.prev)) fixed = deloadDates.prev;
  else if(deloadDays.length){
    let start = deloadDays[deloadDays.length - 1];
    const end = start;
    for(let i = deloadDays.length - 2; i >= 0 && daysBetween(deloadDays[i], start) <= 7; i--) start = deloadDays[i];
    fixed = { startedOn: start, endedOn: end, plannedEndOn: shiftISO(start, DELOAD_LENGTH_DAYS) };
  }
  deloadDates = fixed ? { startedOn: fixed.startedOn, endedOn: fixed.endedOn || fixed.startedOn, plannedEndOn: fixed.plannedEndOn || null } : {};
  saveDeloadDates();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  return true;
}

function toggleMode(key){
  // The two ski phases go through setSkiPhase, which keeps them exclusive and dates the phase.
  if(key === "preseason" || key === "ski") return setSkiPhase(modes[key] ? "off" : key === "preseason" ? "preseason" : "season");
  const def = MODE_DEFS.find(m => m.key === key);
  modes[key] = !modes[key];
  try{ window.localStorage.setItem(def.storageKey, modes[key] ? "1" : "0"); }catch(e){}
  if(key === "deload"){
    // The record it replaces rides along, so a quick on/off with nothing logged can put it back.
    if(modes.deload){
      const { prev: _p, ...last } = deloadDates;
      deloadDates = { startedOn: todayISO(), endedOn: null, plannedEndOn: shiftISO(todayISO(), DELOAD_LENGTH_DAYS), prev: last.startedOn ? last : null };
    } else if(deloadDates.startedOn) deloadDates.endedOn = todayISO();
    saveDeloadDates();
    if(!modes.deload) repairDeloadDates();
  }
  if(key === "shoulder"){
    // Switched back on within a week (or by accident): pick up where it left off.
    if(modes.shoulder && shoulderRehab.startedOn && shoulderRehab.endedOn && daysBetween(shoulderRehab.endedOn, todayISO()) <= 7) shoulderRehab.endedOn = null;
    else if(modes.shoulder){
      const { prev: _p, ...last } = shoulderRehab;
      shoulderRehab = { startedOn: todayISO(), endedOn: null, phase3: false, prev: last.startedOn ? last : null };
    } else {
      shoulderRehab.endedOn = todayISO();
      // On and straight off with nothing logged under it: not a real run, so the last real one stays.
      const touched = [REHAB_NAME, ...SHOULDER_RETURN, ...Object.keys(SHOULDER_CARE_TIP), PUSHUP_NAME]
        .some(n => data[n] && data[n].entries.some(e => e.date >= shoulderRehab.startedOn));
      if(!touched) shoulderRehab = shoulderRehab.prev || {};
    }
    saveShoulderRehab();
    if(modes.shoulder) ensureRehabNotes(); // lifts already logged today get the note too
  }
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  render();
}

// The target a logged set was meant to hit: the preseason target when it was logged with Preseason
// Prep on, otherwise the normal one. Charts and notes judge history with this, not the current mode.
// An accessory's rep range ("10-15" as [10, 15]) while no modifier sets a fixed target instead.
function activeRepRange(ex){
  if(!ex || !ex.repRange) return null;
  if((modes.preseason && ex.targetRepsPreseason) || (modes.ski && ex.targetRepsSki)) return null;
  const m = String(ex.repRange).match(/^(\d+)-(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function entryTargetReps(ex, entry){
  if(entry && entry.preseason && ex.targetRepsPreseason) return ex.targetRepsPreseason;
  if(entry && isHeavyEntry(ex, entry)) return ex.targetRepsStrength;
  const m = ex.repRange && String(ex.repRange).match(/^(\d+)-/);
  return m ? Number(m[1]) : (ex.targetReps || 8);
}
// The reps a session must reach to count as hit: the bottom of an accessory's range, else the target.
function effectiveTargetReps(ex){
  if(modes.preseason && ex.targetRepsPreseason) return ex.targetRepsPreseason;
  if(modes.ski && ex.targetRepsSki) return ex.targetRepsSki;
  if(ex.targetRepsStrength && (ex.heavyPlanned != null ? ex.heavyPlanned : plannedHeavy(liftName(ex), ex))) return ex.targetRepsStrength;
  const range = activeRepRange(ex);
  return range ? range[0] : (ex.targetReps || 8);
}

function loadSaved(){
  try{
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function persist(){
  let ok = true;
  try{ window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){ ok = false; }
  noteLocalSave("data", ok);
  return ok;
}

function ensureClientIds(){
  let changed = false;
  Object.values(data).forEach(ex => {
    ex.entries.forEach(e => { if(!e.clientId){ e.clientId = genId(); changed = true; } });
  });
  if(changed) persist();
}

function backupData(){
  const payload = { exportedAt: new Date().toISOString(), data };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `strength-tracker-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const statusEl = document.getElementById("card-status");
  if(statusEl) statusEl.textContent = "Backup downloaded - save it somewhere safe (Files, email, iCloud).";
}

function restoreData(event){
  const file = event.target.files[0];
  const statusEl = document.getElementById("card-status");
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const parsed = JSON.parse(e.target.result);
      const restored = parsed.data ? parsed.data : parsed; // support raw data or {exportedAt,data} wrapper
      if(typeof restored !== "object") throw new Error("bad shape");
      data = restored;
      ensureClientIds();
      persist();
      reconcileAllToQueue();
      render();
      if(statusEl) statusEl.textContent = "Backup restored successfully.";
    }catch(err){
      if(statusEl) statusEl.textContent = "That file didn't look like a valid backup.";
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

