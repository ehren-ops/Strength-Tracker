// App constants and cloud sync: Supabase client, the offline-first op queue, sync status, row mapping, pull and merge, sign-in.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

const STORAGE_KEY = "strength-tracker-v1";
const BAR_WEIGHT = 45;
const PLATE_SET = [45, 35, 25, 10, 5, 2.5];

// ---------- cloud sync (Supabase) ----------
// The anon key below is meant to be public in client-side code; access is
// controlled by Row Level Security policies scoped to auth.uid(), not by
// keeping this key secret.
const SUPABASE_URL = "https://eixbpujqsectkstkqllz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVpeGJwdWpxc2VjdGtzdGtxbGx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzMTU3MTIsImV4cCI6MjEwMzg5MTcxMn0.ffwg5ndobPUCK3-4FEFzQEeVd0c2ZgZkRvc1gR9w-8w";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const QUEUE_KEY = "strength-tracker-pending-ops-v1";
const LAST_SYNC_KEY = "strength-tracker-last-synced";
const SYNC_USER_KEY = "strength-tracker-sync-user"; // the account this device's "synced" marks belong to

let currentSession = null;
let pendingQueue = loadQueue();
let exerciseIdCache = {};
let flushing = false;
let didReconcileThisSession = false;
let lastSyncedAt = (function(){
  try{ return window.localStorage.getItem(LAST_SYNC_KEY); }catch(e){ return null; }
})();

function fmtSyncTime(iso){
  if(!iso) return null;
  const d = new Date(iso);
  if(isNaN(d)) return null;
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric"}) + " at " + d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
}

function genId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function loadQueue(){
  try{
    const raw = window.localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  }catch(e){ return []; }
}
// Set when the phone refuses a local save (storage full, or blocked in private browsing). Every
// write site used to swallow that silently, so a logged set or a pending sync op could vanish on
// the next reload. The sync status shows it until a save succeeds again.
const localSaveFailed = { data: false, queue: false };
function noteLocalSave(which, ok){
  if(localSaveFailed[which] === !ok) return;
  localSaveFailed[which] = !ok;
  renderSyncStatus();
}
function saveQueue(){
  let ok = true;
  try{ window.localStorage.setItem(QUEUE_KEY, JSON.stringify(pendingQueue)); }catch(e){ ok = false; }
  noteLocalSave("queue", ok);
}

// Every entry change that syncs passes through here, so this is where it gets its edit time: the
// newest edit of an entry wins when two devices disagree (see pullRemoteAndMerge). A bulk re-upload
// passes keepTime so it doesn't make every old entry look freshly edited.
function enqueueOp(op){
  if(op.type === "upsert_entry" && !op.payload.keepTime){
    const ex = data[op.payload.exerciseName], e = ex && ex.entries.find(x => x.clientId === op.payload.clientId);
    if(e) e.updatedAt = new Date().toISOString();
  }
  pendingQueue.push(op);
  saveQueue();
  renderSyncStatus();
  flushQueue();
}

// Shown only when there's something to know: signed out, offline, syncing, or stuck. Reaching
// "Synced" from any other state flashes it briefly, then it fades; steady-state synced stays hidden.
const SYNC_FLASH_MS = 2500;
let lastSyncState = null;
let syncFlashTimer = null;
function renderSyncStatus(){
  const el = document.getElementById("sync-status");
  if(!el) return;
  let state, text, ic = "cloud";
  if(localSaveFailed.data || localSaveFailed.queue){
    state = "storage"; ic = "warn";
    text = currentSession
      ? "Couldn't save on this phone (storage full?) - tap to back up to the cloud now"
      : "Couldn't save on this phone (storage full?) - sign in to back up";
  } else if(!currentSession){
    state = "signed-out";
    text = "Not signed in - logging locally";
  } else if(typeof navigator !== "undefined" && navigator.onLine === false){
    state = "offline";
    text = pendingQueue.length ? `Offline - ${pendingQueue.length} pending` : "Offline";
  } else if(pendingQueue.length){
    state = lastFlushHadFailures ? "failing" : "syncing";
    if(lastFlushHadFailures) ic = "warn";
    text = lastFlushHadFailures
      ? `${pendingQueue.length} pending - having trouble syncing, tap to retry`
      : `Syncing… ${pendingQueue.length} pending`;
  } else {
    state = "synced";
    text = "Synced";
  }
  // Can run while the scripts are still loading (a backfill at startup), before icon() exists. The
  // text is always the app's own, never user input.
  el.innerHTML = `${typeof icon === "function" ? icon(ic) + " " : ""}${text}`;
  el.title = text;
  el.classList.toggle("warn", state === "failing" || state === "offline" || state === "storage");
  if(state === "synced"){
    if(lastSyncState !== null && lastSyncState !== "synced"){
      el.classList.add("show");
      clearTimeout(syncFlashTimer);
      syncFlashTimer = setTimeout(() => el.classList.remove("show"), SYNC_FLASH_MS);
    } else if(lastSyncState === null){
      el.classList.remove("show");
    }
  } else {
    clearTimeout(syncFlashTimer);
    el.classList.add("show");
  }
  lastSyncState = state;
}
function onSyncStatusTap(){
  if(lastSyncState === "failing" || lastSyncState === "offline" || lastSyncState === "storage") manualSync();
}

function exerciseToRow(ex){
  return {
    track_by: ex.trackBy,
    day: ex.day || null,
    equipment: ex.equipment || null,
    conservative: !!ex.conservative,
    target_reps: ex.targetReps ?? null,
    target_reps_ski: ex.targetRepsSki ?? null,
    ski_tempo: ex.skiTempo || null,
    increment: ex.increment ?? null,
    unit: ex.unit || null,
    actual_1rm: ex.actual1RM ?? null,
    track_distance: !!ex.trackDistance,
    track_incline: !!ex.trackIncline,
    track_speed: !!ex.trackSpeed,
  };
}
function rowToExercise(row){
  const ex = { trackBy: row.track_by, entries: [] };
  if(row.day) ex.day = row.day;
  if(row.equipment) ex.equipment = row.equipment;
  if(row.conservative) ex.conservative = true;
  if(row.target_reps != null) ex.targetReps = row.target_reps;
  if(row.target_reps_ski != null) ex.targetRepsSki = row.target_reps_ski;
  if(row.ski_tempo) ex.skiTempo = row.ski_tempo;
  if(row.increment != null) ex.increment = row.increment;
  if(row.unit) ex.unit = row.unit;
  if(row.actual_1rm != null) ex.actual1RM = row.actual_1rm;
  if(row.track_distance) ex.trackDistance = true;
  if(row.track_incline) ex.trackIncline = true;
  if(row.track_speed) ex.trackSpeed = true;
  return ex;
}
function entryToRow(entry, exerciseId, userId){
  return {
    exercise_id: exerciseId,
    user_id: userId,
    client_id: entry.clientId,
    entry_date: entry.date,
    confirmed: entry.confirmed !== false,
    weight: entry.weight ?? null,
    sets: entry.sets ?? null,
    reps: entry.reps ?? null,
    minutes: entry.minutes ?? null,
    distance: entry.distance ?? null,
    incline: entry.incline ?? null,
    speed: entry.speed ?? null,
    difficulty: entry.difficulty ?? null,
    note: entry.note || "",
    completed_indices: entry.completedIndices ?? null,
    temp_f: entry.tempF ?? null,
    reps_by_set: entry.repsBySet ?? null,
    pain: entry.pain ?? null,
    spm: entry.spm ?? null,
    pain_area: entry.painArea ?? null,
    // The device's edit time, so the newest edit wins across devices. Undefined keeps the server's.
    updated_at: entry.updatedAt || undefined,
    deload: !!entry.deload,
    preseason: !!entry.preseason,
    // Main lifts: heavy (4x5) or volume (3x8). Null on everything else and on older entries.
    heavy: entry.heavy ?? null,
    // undefined (dropped from the request) rather than null for entries logged before this
    // existed, so an edit never wipes the time the server backfilled.
    logged_at: entry.loggedAt || undefined,
  };
}
function rowToEntry(row){
  return {
    clientId: row.client_id,
    date: row.entry_date,
    confirmed: row.confirmed,
    weight: row.weight,
    sets: row.sets,
    reps: row.reps,
    minutes: row.minutes,
    distance: row.distance,
    incline: row.incline,
    speed: row.speed,
    difficulty: row.difficulty,
    note: row.note || "",
    completedIndices: row.completed_indices || undefined,
    tempF: row.temp_f ?? undefined,
    repsBySet: row.reps_by_set || undefined,
    pain: row.pain ?? undefined,
    spm: row.spm ?? undefined,
    painArea: row.pain_area || undefined,
    deload: row.deload || undefined,
    preseason: row.preseason || undefined,
    heavy: row.heavy ?? undefined,
    loggedAt: row.logged_at || undefined,
    updatedAt: row.updated_at || undefined,
    synced: true,
  };
}

async function ensureExerciseId(name){
  if(exerciseIdCache[name]) return exerciseIdCache[name];
  const userId = currentSession.user.id;
  const { data: row, error } = await supabaseClient.from("exercises").select("id").eq("user_id", userId).eq("name", name).maybeSingle();
  if(error){ console.error(error); return null; }
  if(row){ exerciseIdCache[name] = row.id; return row.id; }
  // No row yet for this exercise (e.g. a preset added to the app after the
  // account's exercises were first pushed up). Create it now instead of
  // leaving every entry for it permanently unable to resolve an exercise_id -
  // that used to strand the whole sync queue behind it forever.
  const ex = data[name];
  if(!ex) return null;
  const { data: created, error: createErr } = await supabaseClient.from("exercises")
    .upsert({ ...exerciseToRow(ex), name, user_id: userId }, { onConflict: "user_id,name" })
    .select("id").single();
  if(createErr){ console.error(createErr); return null; }
  exerciseIdCache[name] = created.id;
  return created.id;
}

async function runOp(op){
  const userId = currentSession.user.id;
  if(op.type === "upsert_exercise"){
    const ex = data[op.payload.name];
    if(!ex) return true;
    const { data: saved, error } = await supabaseClient.from("exercises")
      .upsert({ ...exerciseToRow(ex), name: op.payload.name, user_id: userId }, { onConflict: "user_id,name" })
      .select("id").single();
    if(error) throw error;
    exerciseIdCache[op.payload.name] = saved.id;
    return true;
  }
  if(op.type === "upsert_entry"){
    const ex = data[op.payload.exerciseName];
    const entry = ex && ex.entries.find(e => e.clientId === op.payload.clientId);
    if(!entry) return true;
    const exerciseId = await ensureExerciseId(op.payload.exerciseName);
    if(!exerciseId) return false;
    const { error } = await supabaseClient.from("entries").upsert(entryToRow(entry, exerciseId, userId), { onConflict: "user_id,client_id" });
    if(error) throw error;
    entry.synced = true;
    return true;
  }
  if(op.type === "upsert_skip"){
    const reason = (skips[op.payload.date] || {})[op.payload.name];
    if(!reason) return true; // undone before it synced
    const { error } = await supabaseClient.from("skips").upsert({
      user_id: userId, skip_date: op.payload.date, exercise_name: op.payload.name, reason,
    }, { onConflict: "user_id,skip_date,exercise_name" });
    if(error) throw error;
    return true;
  }
  if(op.type === "delete_skip"){
    const { error } = await supabaseClient.from("skips").delete().eq("user_id", userId).eq("skip_date", op.payload.date).eq("exercise_name", op.payload.name);
    if(error) throw error;
    return true;
  }
  if(op.type === "delete_entry"){
    const { error } = await supabaseClient.from("entries").delete().eq("user_id", userId).eq("client_id", op.payload.clientId);
    if(error) throw error;
    return true;
  }
  if(op.type === "delete_exercise"){
    const { error } = await supabaseClient.from("exercises").delete().eq("user_id", userId).eq("name", op.payload.name);
    if(error) throw error;
    delete exerciseIdCache[op.payload.name];
    return true;
  }
  if(op.type === "upsert_settings"){
    const { prev: _p, ...deloadRecord } = deloadDates, { prev: _r, ...rehabRecord } = shoulderRehab;
    const { error } = await supabaseClient.from("user_settings").upsert({
      user_id: userId,
      // The JSON field is the source of truth; the per-mode columns are kept for older app versions.
      settings: { modes: Object.fromEntries(MODE_DEFS.map(m => [m.key, !!modes[m.key]])), deload: deloadRecord, shoulderRehab: rehabRecord, ski: skiPhase, program: { key: program.key, startedOn: program.startedOn || null, history: program.history || [], recent: program.recent || {} }, rest: typeof restPrefs !== "undefined" ? restPrefs : {}, kept: typeof keptLifts !== "undefined" ? keptLifts : {} },
      ...Object.fromEntries(MODE_DEFS.filter(m => m.column).map(m => [m.column, modes[m.key]])),
      deload_started_on: deloadDates.startedOn || null,
      deload_ended_on: deloadDates.endedOn || null,
      deload_planned_end_on: deloadDates.plannedEndOn || null,
      shoulder_rehab_started_on: shoulderRehab.startedOn || null,
      shoulder_rehab_ended_on: shoulderRehab.endedOn || null,
      shoulder_rehab_phase3: !!shoulderRehab.phase3,
    }, { onConflict: "user_id" });
    if(error) throw error;
    return true;
  }
  if(op.type === "upsert_breakdown"){
    const kind = op.payload.kind || "session";
    const b = coachStore(kind)[op.payload.date];
    if(!b) return true;
    const { generatedAt, ...breakdown } = b;
    const { error } = await supabaseClient.from("ai_breakdowns").upsert({
      user_id: userId,
      kind,
      session_date: op.payload.date,
      breakdown,
      generated_at: generatedAt || new Date().toISOString(),
    }, { onConflict: "user_id,kind,session_date" });
    if(error) throw error;
    return true;
  }
  return true;
}

// Kept across flush attempts (not reset per-call) so the sync status line
// can tell "still working through the queue" apart from "stuck on
// something that keeps failing," instead of just showing "Syncing..."
// forever with no way to tell the two apart.
let lastFlushHadFailures = false;

async function flushQueue(){
  if(flushing) return { attempted: false, reason: "busy" };
  if(!currentSession) return { attempted: false, reason: "signed-out" };
  if(typeof navigator !== "undefined" && navigator.onLine === false) return { attempted: false, reason: "offline" };
  flushing = true;
  let succeeded = 0, failed = 0;
  try{
    // Attempt every op currently queued exactly once per pass, instead of
    // stopping at the first failure - a single op that can never succeed
    // (e.g. referencing something that no longer exists) used to jam every
    // other op behind it in the queue forever.
    const snapshot = pendingQueue.slice();
    const remaining = [];
    for(const op of snapshot){
      let ok;
      try{ ok = await runOp(op); }catch(e){ console.error("sync op failed", op, e); ok = false; }
      if(ok){ succeeded++; } else { failed++; remaining.push(op); }
    }
    pendingQueue = remaining;
    saveQueue();
  } finally {
    flushing = false;
  }
  lastFlushHadFailures = failed > 0;
  let becameFullySynced = false;
  if(pendingQueue.length === 0){
    lastSyncedAt = new Date().toISOString();
    try{ window.localStorage.setItem(LAST_SYNC_KEY, lastSyncedAt); }catch(e){}
    becameFullySynced = true;
  }
  renderSyncStatus();
  if((succeeded || becameFullySynced) && view === "overview") render();
  return { attempted: true, succeeded, failed, remaining: pendingQueue.length };
}

// Explicit press-the-button feedback for "Sync now", so it's never a
// silent no-op: shows a busy state while in flight, then flashes either a
// success or a "still stuck" confirmation instead of leaving the button
// looking exactly the same whether it worked or not.
async function manualSync(){
  const originalText = "↻ Sync now";
  const btnBefore = document.getElementById("sync-now-btn");
  if(btnBefore){
    btnBefore.disabled = true;
    btnBefore.textContent = "Syncing…";
    btnBefore.classList.remove("sync-btn-ok", "sync-btn-err");
  }
  const result = await flushQueue();
  // flushQueue() may have called render() internally (it does whenever
  // anything actually synced), which replaces the whole card's markup - so
  // the button element from before the await may already be detached.
  // Re-fetch it fresh rather than flashing feedback nobody will ever see.
  const btn = document.getElementById("sync-now-btn");
  if(!btn) return;
  btn.disabled = false;
  if(!result.attempted){
    const label = result.reason === "offline" ? "You're offline" : result.reason === "signed-out" ? "Not signed in" : "Already syncing";
    flashSyncButton(btn, label, false, originalText);
    return;
  }
  if(result.remaining === 0){
    flashSyncButton(btn, "✓ Synced", true, originalText);
  } else {
    flashSyncButton(btn, `${result.remaining} still stuck`, false, originalText);
  }
}
function flashSyncButton(btn, text, success, originalText){
  btn.textContent = text;
  btn.classList.toggle("sync-btn-ok", success);
  btn.classList.toggle("sync-btn-err", !success);
  if(window.__syncBtnFlashTimer) clearTimeout(window.__syncBtnFlashTimer);
  window.__syncBtnFlashTimer = setTimeout(() => {
    btn.textContent = originalText;
    btn.classList.remove("sync-btn-ok", "sync-btn-err");
  }, 2600);
}

// Every row of a table for this user, a page at a time: a plain select stops at the server's
// 1000-row cap, which would silently drop the oldest history.
async function fetchAllRows(table, userId){
  const rows = [];
  for(let from = 0; ; from += 1000){
    const { data: page, error } = await supabaseClient.from(table).select("*").eq("user_id", userId).order("id").range(from, from + 999);
    if(error) return { data: null, error };
    rows.push(...(page || []));
    if(!page || page.length < 1000) return { data: rows, error: null };
  }
}

// Merging the cloud into this device, entry by entry (clientId):
//   only in the cloud: added here, unless a delete of it is still waiting to sync;
//   on both: the newer edit wins (updatedAt), unless this device has an edit still waiting to sync;
//   only here: kept, unless it had synced before (so the cloud dropped it: deleted on another
//   device) and nothing about it is waiting to sync. Never when the cloud returned no entries,
//   and only when this device last synced with the same account.
async function pullRemoteAndMerge(){
  const userId = currentSession.user.id;
  const { data: exRows, error: exErr } = await supabaseClient.from("exercises").select("*").eq("user_id", userId);
  if(exErr){ console.error(exErr); return; }
  const { data: entryRows, error: enErr } = await fetchAllRows("entries", userId);
  if(enErr){ console.error(enErr); return; }

  const entriesByExerciseId = {};
  (entryRows || []).forEach(r => { (entriesByExerciseId[r.exercise_id] ||= []).push(r); });
  const pending = new Set(pendingQueue.filter(o => o.payload && o.payload.clientId).map(o => o.payload.clientId));
  const remoteIds = new Set((entryRows || []).map(r => r.client_id));
  // Deletions only carry over between syncs of the same account: never on a device's first sync
  // with this version, and never when the phone switches accounts.
  let sameAccount = false;
  try{ sameAccount = window.localStorage.getItem(SYNC_USER_KEY) === userId; window.localStorage.setItem(SYNC_USER_KEY, userId); }catch(e){}
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  (exRows || []).forEach(row => {
    exerciseIdCache[row.name] = row.id;
    const remoteEntries = (entriesByExerciseId[row.id] || []).map(rowToEntry).filter(e => !pending.has(e.clientId));
    if(!data[row.name]){
      const ex = rowToExercise(row);
      ex.entries = remoteEntries.sort(byDate);
      ex.entries.forEach((e,i) => { e.label = "S" + (i+1); });
      data[row.name] = ex;
      return;
    }
    const ex = data[row.name];
    const local = new Map(ex.entries.map(e => [e.clientId, e]));
    remoteEntries.forEach(r => {
      const e = local.get(r.clientId);
      if(!e){ ex.entries.push(r); return; }
      if(r.updatedAt && (!e.updatedAt || Date.parse(r.updatedAt) > Date.parse(e.updatedAt))) Object.assign(e, r);
      else { if(!e.loggedAt && r.loggedAt) e.loggedAt = r.loggedAt; e.synced = true; }
    });
    if(sameAccount && remoteIds.size) ex.entries = ex.entries.filter(e => !(e.synced && !remoteIds.has(e.clientId) && !pending.has(e.clientId)));
    ex.entries.sort(byDate);
    ex.entries.forEach((e,i) => { e.label = "S" + (i+1); });
  });

  backfillExerciseDefaults(); // lifts first seen in the cloud pick up their app defaults (units, tips)

  const { data: settingsRow } = await supabaseClient.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  // Settings come from the JSON field, falling back to the old per-mode columns for rows written
  // before it existed. A device only adopts them where it has nothing of its own.
  const saved = (settingsRow && settingsRow.settings) || {};
  const savedModes = saved.modes || {};
  MODE_DEFS.forEach(m => {
    let unset = false;
    try{ unset = window.localStorage.getItem(m.storageKey) === null; }catch(e){}
    if(settingsRow && unset){
      modes[m.key] = m.key in savedModes ? !!savedModes[m.key] : !!(m.column && settingsRow[m.column]);
      try{ window.localStorage.setItem(m.storageKey, modes[m.key] ? "1" : "0"); }catch(e){}
    }
  });
  const savedDeload = saved.deload && saved.deload.startedOn ? saved.deload
    : settingsRow && settingsRow.deload_started_on ? { startedOn: settingsRow.deload_started_on, endedOn: settingsRow.deload_ended_on, plannedEndOn: settingsRow.deload_planned_end_on } : null;
  if(savedDeload && !deloadDates.startedOn){
    deloadDates = { startedOn: savedDeload.startedOn, endedOn: savedDeload.endedOn || null, plannedEndOn: savedDeload.plannedEndOn || null };
    saveDeloadDates();
  }
  const savedRehab = saved.shoulderRehab && saved.shoulderRehab.startedOn ? saved.shoulderRehab
    : settingsRow && settingsRow.shoulder_rehab_started_on ? { startedOn: settingsRow.shoulder_rehab_started_on, endedOn: settingsRow.shoulder_rehab_ended_on, phase3: settingsRow.shoulder_rehab_phase3 } : null;
  // A device that never chose a program adopts the one chosen elsewhere.
  if(saved.program && PROGRAMS[saved.program.key] && !program.startedOn && saved.program.key !== program.key){
    program = { key: saved.program.key, startedOn: saved.program.startedOn || null, history: saved.program.history || [] };
    saveProgram();
  }
  // Lifts kept on a day elsewhere: adopted when this device has kept none.
  if(saved.kept && typeof saved.kept === "object" && !Object.keys(keptLifts).length && Object.keys(saved.kept).length){
    keptLifts = saved.kept;
    saveKept();
  }
  // Rests set on the hold clock elsewhere fill in lifts this device has no rest for.
  if(saved.rest && typeof saved.rest === "object"){
    let added = false;
    Object.entries(saved.rest).forEach(([n, sec]) => { if(restPrefs[n] == null && sec > 0){ restPrefs[n] = sec; added = true; } });
    if(added) try{ window.localStorage.setItem(REST_PREFS_KEY, JSON.stringify(restPrefs)); }catch(e){}
  }
  if(saved.ski && saved.ski.phase && !skiPhase.phase){
    skiPhase = saved.ski;
    saveSkiPhase();
  }
  if(savedRehab && !shoulderRehab.startedOn){
    shoulderRehab = { startedOn: savedRehab.startedOn, endedOn: savedRehab.endedOn || null, phase3: !!savedRehab.phase3 };
    saveShoulderRehab();
  }

  // Skips from other devices: added where this one has none for that lift and day.
  const { data: skipRows, error: skErr } = await supabaseClient.from("skips").select("*").eq("user_id", userId);
  if(skErr) console.error(skErr);
  (skipRows || []).forEach(r => {
    const day = (skips[r.skip_date] = skips[r.skip_date] || {});
    if(!day[r.exercise_name]) day[r.exercise_name] = r.reason;
  });
  if((skipRows || []).length) saveSkips();

  const { data: breakdownRows, error: bdErr } = await supabaseClient.from("ai_breakdowns").select("*").eq("user_id", userId);
  if(bdErr) console.error(bdErr);
  (breakdownRows || []).forEach(r => {
    const store = coachStore(r.kind || "session");
    const local = store[r.session_date];
    if(!local || (local.generatedAt || "") < r.generated_at){
      store[r.session_date] = { ...r.breakdown, generatedAt: r.generated_at };
    }
  });
  saveCoachStore("session");
  saveCoachStore("weekly");

  persist();
  render();
  checkDeloadAutoEnd();
  checkSkiPhasePrompt();
}

function reconcileAllToQueue(){
  Object.keys(data).forEach(name => {
    enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name } });
  });
  Object.entries(data).forEach(([name, ex]) => {
    ex.entries.forEach(entry => {
      enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: name, clientId: entry.clientId, keepTime: true } });
    });
  });
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  Object.entries(skips).forEach(([date, byName]) => Object.keys(byName).forEach(name => {
    enqueueOp({ id: genId(), type: "upsert_skip", payload: { date, name } });
  }));
  ["session", "weekly"].forEach(kind => {
    Object.keys(coachStore(kind)).forEach(date => {
      enqueueOp({ id: genId(), type: "upsert_breakdown", payload: { kind, date } });
    });
  });
}

async function syncOnSignIn(){
  await pullRemoteAndMerge();
  if(!didReconcileThisSession){
    didReconcileThisSession = true;
    reconcileAllToQueue();
  }
  flushQueue();
}

async function handleSignIn(){
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const statusEl = document.getElementById("card-status");
  if(!email || !password){ if(statusEl) statusEl.textContent = "Enter email and password."; return; }
  if(statusEl) statusEl.textContent = "Signing in…";
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if(error && statusEl) statusEl.textContent = error.message;
}
async function handleSignUp(){
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const statusEl = document.getElementById("card-status");
  if(!email || !password){ if(statusEl) statusEl.textContent = "Enter email and password."; return; }
  if(password.length < 6){ if(statusEl) statusEl.textContent = "Password must be at least 6 characters."; return; }
  if(statusEl) statusEl.textContent = "Creating account…";
  const { data: signUpData, error } = await supabaseClient.auth.signUp({ email, password });
  if(error){ if(statusEl) statusEl.textContent = error.message; return; }
  if(statusEl) statusEl.textContent = signUpData.session ? "Account created and signed in." : "Check your email to confirm your account, then sign in.";
}
async function signOutUser(){
  await supabaseClient.auth.signOut();
}

