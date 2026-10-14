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
// Data-driven table for the four "training modifier" toggles, instead of a
// separate variable/init/toggle/cloud-merge/settings-row block per mode -
// see toggleMode() below, the cloud-settings merge in pullRemoteAndMerge(),
// and the settings row built in runOp()'s upsert_settings handler, which
// all loop over this same list instead of repeating themselves per mode.
// This only unifies that identical on/off/persist/sync bookkeeping - each
// mode's actual EFFECT (what it does while active) still lives entirely
// separately: KNEE_SENSITIVE_EXERCISES/KNEE_CARE_TIP for knee, its back
// equivalents, targetRepsSki/skiTempo for ski, and the preseason* fields
// on individual exercises for preseason.
const MODE_DEFS = [
  { key: "deload", storageKey: "strength-tracker-deload-mode", column: "deload_mode" },
  { key: "ski", storageKey: "strength-tracker-ski-mode", column: "ski_season_mode" },
  { key: "knee", storageKey: "strength-tracker-knee-mode", column: "knee_care_mode" },
  { key: "back", storageKey: "strength-tracker-back-mode", column: "low_back_care_mode" },
  { key: "preseason", storageKey: "strength-tracker-preseason-mode", column: "preseason_mode" },
  { key: "shoulder", storageKey: "strength-tracker-shoulder-mode", column: "shoulder_rehab_mode" },
];
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
function entryTargetReps(ex, entry){
  if(entry && entry.preseason && ex.targetRepsPreseason) return ex.targetRepsPreseason;
  return ex.targetReps || 8;
}
function effectiveTargetReps(ex){
  if(modes.preseason && ex.targetRepsPreseason) return ex.targetRepsPreseason;
  return (modes.ski && ex.targetRepsSki) ? ex.targetRepsSki : (ex.targetReps || 8);
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

