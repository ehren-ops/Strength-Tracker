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

function enqueueOp(op){
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
  let state;
  if(localSaveFailed.data || localSaveFailed.queue){
    state = "storage";
    el.textContent = currentSession
      ? "⚠ Couldn't save on this phone (storage full?) - tap to back up to the cloud now"
      : "⚠ Couldn't save on this phone (storage full?) - sign in to back up";
  } else if(!currentSession){
    state = "signed-out";
    el.textContent = "☁ Not signed in - logging locally";
  } else if(typeof navigator !== "undefined" && navigator.onLine === false){
    state = "offline";
    el.textContent = pendingQueue.length ? `☁ Offline - ${pendingQueue.length} pending` : "☁ Offline";
  } else if(pendingQueue.length){
    state = lastFlushHadFailures ? "failing" : "syncing";
    el.textContent = lastFlushHadFailures
      ? `⚠ ${pendingQueue.length} pending - having trouble syncing, tap to retry`
      : `☁ Syncing… ${pendingQueue.length} pending`;
  } else {
    state = "synced";
    el.textContent = "☁ Synced";
  }
  el.title = el.textContent;
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
    deload: !!entry.deload,
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
    deload: row.deload || undefined,
    loggedAt: row.logged_at || undefined,
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
    const { error } = await supabaseClient.from("user_settings").upsert({
      user_id: userId,
      ...Object.fromEntries(MODE_DEFS.map(m => [m.column, modes[m.key]])),
      deload_started_on: deloadDates.startedOn || null,
      deload_ended_on: deloadDates.endedOn || null,
      deload_planned_end_on: deloadDates.plannedEndOn || null,
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
    const label = result.reason === "offline" ? "⚠ You're offline" : result.reason === "signed-out" ? "⚠ Not signed in" : "⚠ Already syncing";
    flashSyncButton(btn, label, false, originalText);
    return;
  }
  if(result.remaining === 0){
    flashSyncButton(btn, "✓ Synced", true, originalText);
  } else {
    flashSyncButton(btn, `⚠ ${result.remaining} still stuck`, false, originalText);
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

async function pullRemoteAndMerge(){
  const userId = currentSession.user.id;
  const { data: exRows, error: exErr } = await supabaseClient.from("exercises").select("*").eq("user_id", userId);
  if(exErr){ console.error(exErr); return; }
  const { data: entryRows, error: enErr } = await supabaseClient.from("entries").select("*").eq("user_id", userId);
  if(enErr){ console.error(enErr); return; }

  const entriesByExerciseId = {};
  (entryRows || []).forEach(r => { (entriesByExerciseId[r.exercise_id] ||= []).push(r); });

  (exRows || []).forEach(row => {
    exerciseIdCache[row.name] = row.id;
    const remoteEntries = (entriesByExerciseId[row.id] || []).map(rowToEntry);
    if(!data[row.name]){
      const ex = rowToExercise(row);
      ex.entries = remoteEntries.sort((a,b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      ex.entries.forEach((e,i) => { e.label = "S" + (i+1); });
      data[row.name] = ex;
    } else {
      const existingIds = new Set(data[row.name].entries.map(e => e.clientId).filter(Boolean));
      remoteEntries.forEach(e => { if(!existingIds.has(e.clientId)) data[row.name].entries.push(e); });
      // Entries logged before order tracking pick up the server's backfilled log time.
      const remoteAt = new Map(remoteEntries.map(e => [e.clientId, e.loggedAt]));
      data[row.name].entries.forEach(e => { if(!e.loggedAt && remoteAt.get(e.clientId)) e.loggedAt = remoteAt.get(e.clientId); });
      data[row.name].entries.sort((a,b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      data[row.name].entries.forEach((e,i) => { e.label = "S" + (i+1); });
    }
  });

  const { data: settingsRow } = await supabaseClient.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  MODE_DEFS.forEach(m => {
    let unset = false;
    try{ unset = window.localStorage.getItem(m.storageKey) === null; }catch(e){}
    if(settingsRow && unset){
      modes[m.key] = !!settingsRow[m.column];
      try{ window.localStorage.setItem(m.storageKey, modes[m.key] ? "1" : "0"); }catch(e){}
    }
  });
  if(settingsRow && !deloadDates.startedOn && settingsRow.deload_started_on){
    deloadDates = { startedOn: settingsRow.deload_started_on, endedOn: settingsRow.deload_ended_on || null, plannedEndOn: settingsRow.deload_planned_end_on || null };
    saveDeloadDates();
  }

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
}

function reconcileAllToQueue(){
  Object.keys(data).forEach(name => {
    enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name } });
  });
  Object.entries(data).forEach(([name, ex]) => {
    ex.entries.forEach(entry => {
      enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: name, clientId: entry.clientId } });
    });
  });
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
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

