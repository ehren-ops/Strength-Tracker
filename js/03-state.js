// Loaded state: saved data, theme, training modes and deload dates, persistence, backup and restore.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- state ----------
let data = loadSaved() || JSON.parse(JSON.stringify(SEED));
ensureClientIds();
backfillExerciseDefaults();
let view = "full";
let selected = DAY_ORDER.full[0];
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
    desc: "Adds a daily rehab card to every day and push-ups to Upper and Full Body. Pauses flies, incline press, lateral raises and slams; bench drops to 85%, medium grip, short of the chest; curls come back as hammer curls in week 3; rows drop to 85% with a palms-in grip. Pushdowns, legs and riding carry on." },
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

// The deload record follows what was actually logged. With Deload Week off, a recorded window
// holding no deload sessions (a quick on/off, or an older bad record) is replaced: by the record it
// overwrote when that one is still backed by sessions, or else by the latest run of deload-tagged
// sessions in the log (sessions within a week of each other), or cleared when there are none.
// Runs on switching it off, at startup and after each sign-in pull.
function repairDeloadDates(){
  if(modes.deload || !deloadDates.startedOn) return false;
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
  const m = ex.repRange && String(ex.repRange).match(/^(\d+)-/);
  return m ? Number(m[1]) : (ex.targetReps || 8);
}
// The reps a session must reach to count as hit: the bottom of an accessory's range, else the target.
function effectiveTargetReps(ex){
  if(modes.preseason && ex.targetRepsPreseason) return ex.targetRepsPreseason;
  if(modes.ski && ex.targetRepsSki) return ex.targetRepsSki;
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

