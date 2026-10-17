// Hold timer for timed lifts (Dead Hang, Side Plank, Wall Sit, Farmer's Carry), and set by set for
// every lift done for reps (Done after each set, then the rest). The top 30% of the
// screen turns into a big clock; swipe it up (or tap the handle) for a slim bar that keeps running.
// When it ends or is stopped, a tap or the close button clears it. A 5 second count-in, the hold counting down, then the lift's
// shortest suggested rest, for every set on its own. Lifts done per side hold each side in turn
// before the rest. Two taps on the clock within 2 seconds stop it, so a bump never does. At the end
// the form holds the sets and seconds; Log is still one tap. Like the rest timer it runs on
// absolute end times, so a phone that sleeps mid-hold catches up when it wakes. The big clock has
// Pause, Skip (to the rest, or through the rest to the next set) and, during a rest, -15 / +15 sec.
// A rest changed that way becomes that lift's rest from then on (restPrefs, synced in settings).
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

const HOLD_COUNT_IN = 5;
const HOLD_STOP_WINDOW = 2000;
let holdCompact = false; // the slim bar instead of the big clock; kept between runs this visit
let holdTimer = null; // { name, sets, secs, rest, steps, idx, endAt, paused: { left }, held: [[sec per side]], intervalId, lastTap, beeped, wake }
const HOLD_REST_STEP = 15;

// A lift's rest as last set on the clock, else the short end of its usual range.
const REST_PREFS_KEY = "strength-tracker-rest-prefs";
let restPrefs = (function(){ try{ return JSON.parse(window.localStorage.getItem(REST_PREFS_KEY)) || {}; }catch(e){ return {}; } })();
function restPrefFor(name, ex){ return restPrefs[name] || restBucketFor(ex).minSec; }
function saveRestPref(name, sec){
  restPrefs[name] = Math.max(15, Math.round(sec / 5) * 5);
  try{ window.localStorage.setItem(REST_PREFS_KEY, JSON.stringify(restPrefs)); }catch(e){}
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  syncHoldButton();
}

function isHoldLift(ex){ return !!ex && ex.unit === "sec" && ex.trackBy !== "duration" && ex.trackBy !== "checklist"; }
// Lifts done for reps run set by set instead: tap Done after each set, the rest counts down, then the
// next set. No count-in; the end of the rest is the cue.
function isSetLift(name, ex){
  return !!ex && !isHoldLift(ex) && (ex.trackBy === "weight" || ex.trackBy === "reps") && !isRecovery(name) && name !== REHAB_NAME;
}
function setPlanFor(name, ex, fromForm){
  const plan = ex.entries.length ? computeSuggestion(ex, name) : null;
  const field = id => fromForm ? Number((document.getElementById(id) || {}).value) : 0;
  const sets = Math.max(1, Math.min(10, field("f-sets") || (plan && plan.sets) || 3));
  const reps = Math.max(1, field("f-reps") || (plan && plan.reps) || effectiveTargetReps(ex) || 8);
  const weight = ex.trackBy === "weight" ? field("f-weight") || (plan && plan.weight) || 0 : 0;
  return { sets, reps, weight };
}
// The clock button at the top right of a card: holds for timed lifts, set by set for the rest. Just
// the icon, so it never crowds the name; its hidden label is what the clock will run.
function timerButtonFor(name, ex){
  const mode = isHoldLift(ex) ? "holds" : isSetLift(name, ex) ? "sets" : null;
  if(!mode) return "";
  const p = mode === "holds" ? holdPlanFor(name, ex) : setPlanFor(name, ex);
  const amount = mode === "holds" ? p.secs : p.reps;
  const what = mode === "holds" ? `${p.sets} holds of ${p.secs} seconds` : `${p.sets} sets of ${p.reps}`;
  return `<button type="button" class="timer-btn" onclick="startHoldTimer('${name.replace(/'/g,"\\'")}')" aria-label="Start the timer, ${what}">${HOLD_ICON}<span class="hold-btn-label sr-only">${p.sets}x${amount}</span></button>`;
}

// The plan on the button: the next progression, else three holds at the target. Starting the clock
// reads the form instead (fromForm), so an edited sets or seconds field wins.
function holdPlanFor(name, ex, fromForm){
  const formSets = fromForm ? Number((document.getElementById("f-sets") || {}).value) : 0;
  const formSecs = fromForm ? Number((document.getElementById("f-reps") || {}).value) : 0;
  const plan = ex.entries.length ? computeSuggestion(ex, name) : null;
  const sets = Math.max(1, Math.min(8, formSets || (plan && plan.sets) || 3));
  const secs = Math.max(5, formSecs || (plan && plan.reps) || effectiveTargetReps(ex) || 30);
  return { sets, secs };
}

// The button shows what the clock will run: the form's sets and seconds as they stand, prefilled or
// edited. Called after every render and on every change to those two fields.
// What the clock will run, in two small lines left of the button: "3 × 8 reps" and "Rest 1:30".
function fmtRest(sec){ return sec < 60 ? `${sec} sec` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }
function timerPlanLines(name, ex, fromForm){
  if(isHoldLift(ex)){ const p = holdPlanFor(name, ex, fromForm); return [`${p.sets} × ${p.secs} sec`, `Rest ${fmtRest(restPrefFor(name, ex))}`]; }
  const p = setPlanFor(name, ex, fromForm);
  return [`${p.sets} × ${p.reps} reps`, `Rest ${fmtRest(restPrefFor(name, ex))}`];
}
function timerPlanHtml(lines){ return `<span class="timer-plan">${lines.filter(Boolean).map(l => `<span>${l}</span>`).join("")}</span>`; }
function timerGroupFor(name, ex){
  const btn = timerButtonFor(name, ex);
  return btn ? `<span class="timer-group">${timerPlanHtml(timerPlanLines(name, ex))}${btn}</span>` : "";
}
function syncHoldButton(){
  const btn = document.querySelector(".timer-btn");
  const ex = selected && data[selected];
  if(!btn || !ex) return;
  const hold = isHoldLift(ex);
  if(!hold && !isSetLift(selected, ex)) return;
  const p = hold ? holdPlanFor(selected, ex, true) : setPlanFor(selected, ex, true);
  const amount = hold ? p.secs : p.reps;
  const label = btn.querySelector(".hold-btn-label");
  if(label) label.textContent = `${p.sets}x${amount}`;
  btn.setAttribute("aria-label", `Start the timer, ${hold ? `${p.sets} holds of ${p.secs} seconds` : `${p.sets} sets of ${p.reps}`}`);
  const plan = btn.parentElement && btn.parentElement.querySelector(".timer-plan");
  if(plan) plan.outerHTML = timerPlanHtml(timerPlanLines(selected, ex, true));
}

// Ready, hold (each side), rest; the next count-in comes out of the rest so the gap is the rest.
function holdSteps(sets, secs, rest, sides){
  const steps = [];
  for(let s = 1; s <= sets; s++){
    sides.forEach((side, i) => {
      steps.push({ kind: "ready", secs: HOLD_COUNT_IN, set: s, side, switching: i > 0 });
      steps.push({ kind: "hold", secs, set: s, side });
    });
    if(s < sets) steps.push({ kind: "rest", secs: Math.max(5, rest - HOLD_COUNT_IN), set: s });
  }
  return steps;
}

// Set by set: each set waits for Done, with the lift's rest between.
function setSteps(sets, rest){
  const steps = [];
  for(let s = 1; s <= sets; s++){
    steps.push({ kind: "set", secs: Infinity, set: s });
    if(s < sets) steps.push({ kind: "rest", secs: rest, set: s });
  }
  return steps;
}
function restStepSecs(t){ return t.mode === "sets" ? t.rest : Math.max(5, t.rest - HOLD_COUNT_IN); }

function startHoldTimer(name){
  const ex = data[name];
  if(!isHoldLift(ex)){ if(isSetLift(name, ex)) startSetTimer(name); return; }
  stopHoldTimer(true);
  clearRestTimer();
  const { sets, secs } = holdPlanFor(name, ex, true);
  const sides = sidesOf(name).reps === "side" ? ["Left side", "Right side"] : sidesOf(name).reps === "leg" ? ["Left leg", "Right leg"] : [null];
  const rest = restPrefFor(name, ex);
  const steps = holdSteps(sets, secs, rest, sides);
  holdTimer = { mode: "holds", name, sets, secs, rest, sides: sides.length, steps, idx: 0, endAt: Date.now() + steps[0].secs * 1000, paused: null,
    held: [], lastTap: 0, beeped: {}, intervalId: setInterval(tickHoldTimer, 200), wake: null };
  beginHoldTimer();
}
function startSetTimer(name){
  const ex = data[name];
  stopHoldTimer(true);
  clearRestTimer();
  const { sets, reps, weight } = setPlanFor(name, ex, true);
  const rest = restPrefFor(name, ex);
  holdTimer = { mode: "sets", name, sets, reps, weight, rest, sides: 1, steps: setSteps(sets, rest), idx: 0, endAt: Infinity, paused: null,
    held: [], lastTap: 0, beeped: {}, intervalId: setInterval(tickHoldTimer, 200), wake: null };
  beginHoldTimer();
}
function beginHoldTimer(){
  holdAudio(); // unlocked by this tap, so later beeps can play
  try{ if(navigator.wakeLock) navigator.wakeLock.request("screen").then(w => { if(holdTimer) holdTimer.wake = w; else w.release(); }).catch(() => {}); }catch(e){}
  holdBuzz(80);
  renderHoldClock();
}

// Time left in the current step, frozen while paused.
function holdLeftMs(t){ return t.paused ? t.paused.left : t.endAt - Date.now(); }

// Moves on to the next step, timed from `from`; false once the last step is done.
function nextHoldStep(t, from){
  const left = t.steps[t.idx];
  if(t.mode === "routine" && left.lastOfItem) markRoutineItem(t, left.item);
  t.idx++;
  if(t.idx >= t.steps.length){ finishHoldTimer(false); return false; }
  const next = t.steps[t.idx];
  t.endAt = from + next.secs * 1000;
  if(next.kind === "hold" || next.kind === "set"){ holdBeep(880, 250); holdBuzz(200); }
  else if(next.kind === "rest"){ holdBeep(520, 400); holdBuzz([200, 100, 200]); if(t.mode !== "routine") recordRestTap(t.name); }
  return true;
}

function tickHoldTimer(){
  if(!holdTimer) return;
  const t = holdTimer;
  if(t.paused) return;
  // Catch up through every step that ended (a phone asleep for a while can pass several).
  while(Date.now() >= t.endAt){
    const done = t.steps[t.idx];
    if(done.kind === "hold") recordHold(done.set, done.secs);
    if(!nextHoldStep(t, t.endAt)) return;
  }
  const step = t.steps[t.idx];
  const left = Math.ceil((t.endAt - Date.now()) / 1000);
  // Short beeps on the last 3 seconds of a count-in and a hold.
  if(left <= 3 && left >= 1 && step.kind !== "rest"){
    const key = t.idx + ":" + left;
    if(!t.beeped[key]){ t.beeped[key] = true; holdBeep(step.kind === "ready" ? 660 : 440, 90); }
  }
  renderHoldClock();
}

function recordHold(set, secs){
  const t = holdTimer;
  if(t.mode === "routine") return; // a routine checks items off instead
  (t.held[set - 1] = t.held[set - 1] || []).push(secs);
}

function toggleHoldPause(){
  const t = holdTimer;
  if(!t || t.finished) return;
  if(t.paused){ t.endAt = Date.now() + t.paused.left; t.paused = null; }
  else t.paused = { left: Math.max(0, t.endAt - Date.now()) };
  renderHoldClock();
}

// Skip: a hold or count-in ends now (the seconds held so far count), a rest jumps to the next set's
// count-in (or straight to the next set, set by set). On a set it is Done: the set counts in full.
function skipHoldStep(){
  const t = holdTimer;
  if(!t || t.finished) return;
  const step = t.steps[t.idx];
  if(step.kind === "hold"){
    const heldSec = Math.floor(step.secs - holdLeftMs(t) / 1000);
    if(heldSec > 0) recordHold(step.set, heldSec);
  }
  if(step.kind === "set") recordHold(step.set, t.reps);
  t.paused = null;
  t.lastTap = 0;
  if(nextHoldStep(t, Date.now())) renderHoldClock();
}

// -15 / +15 sec on a rest: this rest, the ones after it, and the lift's rest from now on.
function adjustHoldRest(delta){
  const t = holdTimer;
  if(!t || t.finished) return;
  const step = t.steps[t.idx];
  if(step.kind !== "rest") return;
  const left = holdLeftMs(t), newLeft = Math.max(5000, left + delta * 1000), applied = (newLeft - left) / 1000;
  if(!applied) return;
  if(t.paused) t.paused.left = newLeft; else t.endAt += applied * 1000;
  step.secs += applied;
  t.rest = Math.max(t.mode === "sets" ? 15 : HOLD_COUNT_IN + 5, t.rest + applied);
  t.steps.forEach((s, i) => { if(i > t.idx && s.kind === "rest") s.secs = t.mode === "routine" ? Math.max(5, s.secs + applied) : restStepSecs(t); });
  saveRestPref(t.name, t.rest);
  renderHoldClock();
}

// Tap the clock once to arm, again within 2 seconds to stop.
function tapHoldClock(){
  if(!holdTimer) return;
  if(holdTimer.finished){ clearHoldTimer(); return; }
  const now = Date.now();
  if(now - holdTimer.lastTap < HOLD_STOP_WINDOW){ stopHoldTimer(false); return; }
  holdTimer.lastTap = now;
  renderHoldClock();
}

function stopHoldTimer(silent){
  if(!holdTimer) return;
  if(silent){ clearHoldTimer(); return; }
  // Stopped mid-hold: the seconds held so far count for that set.
  const step = holdTimer.steps[holdTimer.idx];
  if(step.kind === "hold"){
    const heldSec = Math.floor(step.secs - holdLeftMs(holdTimer) / 1000);
    if(heldSec > 0) recordHold(step.set, heldSec);
  }
  finishHoldTimer(true);
}

// Fill the form with what was held: sets that got a hold, and the shortest one (the app logs the
// lowest set as the reps, so every set counts toward progression only when all of them made it).
function finishHoldTimer(early){
  const t = holdTimer;
  clearInterval(t.intervalId);
  t.finished = true;
  if(t.mode === "routine"){
    const n = t.items.filter(i => t.doneItems.has(i)).length;
    if(!early){ holdBeep(880, 500); holdBuzz([300, 120, 300]); }
    t.summary = `${n}/${t.items.length}`;
    t.result = early ? `Stopped: ${n} of ${t.items.length} checked off` : "Done: all checked off";
    renderHoldClock();
    setTimeout(() => { if(holdTimer === t) clearHoldTimer(); }, early ? 3400 : 2400);
    return;
  }
  const perSet = t.held.filter(h => h && h.length).map(h => Math.min(...h));
  if(perSet.length && selected === t.name){
    const setsEl = document.getElementById("f-sets"), repsEl = document.getElementById("f-reps");
    if(setsEl) setsEl.value = perSet.length;
    if(repsEl) repsEl.value = Math.min(...perSet);
    logFormDirty = true;
    syncHoldButton();
  }
  if(!early){ holdBeep(880, 500); holdBuzz([300, 120, 300]); }
  t.summary = perSet.length ? `${perSet.length}x${Math.min(...perSet)}` : "--";
  t.result = early ? (perSet.length ? `Stopped: ${perSet.length} set${perSet.length === 1 ? "" : "s"} filled in` : "Stopped") : "Done: filled in below, tap Log";
  renderHoldClock();
  setTimeout(() => { if(holdTimer === t) clearHoldTimer(); }, early ? 3400 : 2400);
}

function clearHoldTimer(){
  if(holdTimer){
    clearInterval(holdTimer.intervalId);
    try{ if(holdTimer.wake) holdTimer.wake.release(); }catch(e){}
  }
  holdTimer = null;
  renderHoldClock();
}

function fmtClock(sec){ return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}` : String(sec); }

function renderHoldClock(){
  let el = document.getElementById("hold-clock");
  if(!holdTimer){ if(el) el.hidden = true; return; }
  if(!el){
    el = document.createElement("div");
    el.id = "hold-clock";
    el.className = "hold-clock";
    el.setAttribute("role", "timer");
    el.onclick = e => {
      if(el._swiped){ el._swiped = false; return; }
      const act = e.target.closest("[data-hc]");
      if(act){
        e.stopPropagation();
        const a = act.dataset.hc;
        if(a === "close") clearHoldTimer();
        else if(a === "pause") toggleHoldPause();
        else if(a === "skip") skipHoldStep();
        else if(a === "less") adjustHoldRest(-HOLD_REST_STEP);
        else if(a === "more") adjustHoldRest(HOLD_REST_STEP);
        else toggleHoldCompact();
        return;
      }
      tapHoldClock();
    };
    // Swipe up for the slim bar, down for the big clock.
    el.addEventListener("touchstart", e => { el._y = e.touches[0].clientY; }, { passive: true });
    el.addEventListener("touchend", e => {
      const dy = e.changedTouches[0].clientY - (el._y ?? e.changedTouches[0].clientY);
      if(Math.abs(dy) < 30 || !holdTimer) return;
      el._swiped = true;
      if((dy < 0) !== holdCompact) toggleHoldCompact();
    });
    document.body.appendChild(el);
  }
  el.hidden = false;
  const t = holdTimer, step = t.steps[Math.min(t.idx, t.steps.length - 1)];
  const dots = t.mode === "routine"
    ? t.items.map(i => `<i class="${t.doneItems.has(i) ? "done" : ""}"></i>`).join("")
    : Array.from({ length: t.sets }, (_, i) => `<i class="${(t.held[i] || []).length >= t.sides ? "done" : ""}"></i>`).join("");
  const size = holdCompact ? " compact" : "";
  const handle = `<button type="button" class="hc-handle" data-hc="size" aria-label="${holdCompact ? "Show the big clock" : "Shrink to a bar"}">${holdCompact ? "▾" : "▴"}</button>`;
  if(t.finished){
    paintClock(el, "hold-clock done" + size, t.result, `<div class="hc-phase">${t.result.startsWith("Done") ? "Done" : "Stopped"}</div><div class="hc-time">${t.summary}</div><div class="hc-set">${t.result.replace(/^(Done|Stopped): ?/, "")}</div><div class="hc-dots">${dots}</div><div class="hc-stop">Tap to close</div><button type="button" class="hc-close" data-hc="close" aria-label="Close">✕</button>`);
    return;
  }
  const armed = Date.now() - t.lastTap < HOLD_STOP_WINDOW;
  const stopHint = `<div class="hc-stop${armed ? " armed" : ""}">${armed ? "Tap again to stop" : "Tap twice to stop"}</div>`;
  if(t.mode === "routine"){ renderRoutineClock(el, t, step, dots, handle, stopHint, size); return; }
  if(step.kind === "set"){
    // A set has no clock: the reps to do, the load, and Done.
    const load = t.weight > 0 ? ` · ${t.weight} lb${weightSuffix(t.name)}` : "";
    paintClock(el, `hold-clock set${size}`, `Set ${step.set} of ${t.sets}, ${t.reps} reps`, `<div class="hc-phase">Set ${step.set} of ${t.sets}</div><div class="hc-time hc-reps">${t.reps}<small> reps${repsSuffix(t.name)}</small></div><div class="hc-set">${t.name}${load}</div><div class="hc-dots">${dots}</div><div class="hc-controls"><button type="button" class="hc-btn hc-done" data-hc="skip">${icon("check")}Set done</button></div>${stopHint}${handle}`);
    return;
  }
  const left = Math.max(0, Math.ceil(holdLeftMs(t) / 1000));
  const phase = t.paused ? "Paused" : step.kind === "ready" ? (step.switching ? "Switch sides" : "Get ready") : step.kind === "hold" ? "Hold" : "Rest";
  const setLine = step.kind === "rest" ? `Next: set ${step.set + 1} of ${t.sets}` : `Set ${step.set} of ${t.sets}${step.side ? ` · ${step.side}` : ""}`;
  const pct = Math.min(100, Math.max(0, 100 * (1 - holdLeftMs(t) / (step.secs * 1000))));
  const skipLabel = step.kind === "rest" ? "Next set" : step.kind === "hold" ? (t.idx >= t.steps.length - 1 ? "Finish" : "Rest") : "Start";
  const controls = `<div class="hc-controls">`
    + (step.kind === "rest" ? `<button type="button" class="hc-btn" data-hc="less" aria-label="15 seconds less rest">−15</button>` : "")
    + `<button type="button" class="hc-btn" data-hc="pause">${t.paused ? icon("play") + "Resume" : icon("pause") + "Pause"}</button>`
    + `<button type="button" class="hc-btn" data-hc="skip">${skipLabel}${icon("next")}</button>`
    + (step.kind === "rest" ? `<button type="button" class="hc-btn" data-hc="more" aria-label="15 seconds more rest">+15</button>` : "")
    + `</div>`;
  paintClock(el, `hold-clock ${step.kind}${t.paused ? " paused" : ""}${size}`, `${phase}, ${left} seconds, ${setLine}`, `<div class="hc-phase">${phase}</div><div class="hc-time">${fmtClock(left)}</div><div class="hc-set">${setLine}</div><div class="hc-dots">${dots}</div>${controls}${stopHint}<div class="hc-bar" style="width:${pct}%"></div>${handle}`);
}
// Rebuilds the clock only when its words or buttons change; a tick just updates the time and the
// bar, so a button is never swapped out from under a finger mid-tap.
function paintClock(el, cls, aria, html){
  el.className = cls;
  el.setAttribute("aria-label", aria);
  const timeRe = /<div class="hc-time">([^<]*)<\/div>/, barRe = /width:([\d.]+)%/;
  const key = html.replace(timeRe, "").replace(barRe, "");
  if(key === el._key){
    const tm = html.match(timeRe), bw = html.match(barRe);
    const time = el.querySelector(".hc-time"), bar = el.querySelector(".hc-bar");
    if(tm && time && time.textContent !== tm[1]) time.textContent = tm[1];
    if(bw && bar) bar.style.width = bw[1] + "%";
    return;
  }
  el._key = key;
  el.innerHTML = html;
}
function toggleHoldCompact(){ holdCompact = !holdCompact; renderHoldClock(); }

// Routines (the Mobility card and Shoulder Rehab): each move in turn from its dose. Timed moves
// ("45 sec each side", "5 × 30-45 s") count down per side and per set; rep moves ("10 reps",
// "3 × 12") wait for Done. A short count-in names the next move, rests sit between sets, and each
// move is checked off on the card as it ends. Ranges run at their low end.
const ROUTINE_REST = 30;
function parseDose(dose){
  const d = String(dose || "").toLowerCase().replace(/×/g, "x");
  const sides = /each (side|leg)/.test(d) ? 2 : 1;
  const each = (d.match(/each (side|leg|way|arm)/) || [])[1] || "";
  const range = (a, b) => b ? `${a}-${b}` : String(a);
  let m = d.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?\s*(?:s|sec)\b/);
  if(m) return { sets: +m[1], secs: +m[2], sides };
  m = d.match(/(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?/);
  if(m) return { sets: +m[1], reps: range(m[2], m[3]), sides, each };
  m = d.match(/(\d+)(?:\s*-\s*(\d+))?\s*sec/);
  if(m) return { sets: 1, secs: +m[1], sides };
  m = d.match(/(\d+)(?:\s*-\s*(\d+))?\s*reps?/);
  return { sets: 1, reps: m ? range(m[1], m[2]) : "", sides, each };
}
function routineItemsFor(name){ return name === REHAB_NAME ? REHAB_ITEMS : ((CHECKLIST_ROUTINES[name] || {}).items || []); }
function routineSteps(name, idxs, rest){
  const all = routineItemsFor(name), steps = [];
  idxs.forEach(idx => {
    const it = all[idx], p = parseDose(it.dose), label = it.name, start = steps.length;
    for(let s = 1; s <= p.sets; s++){
      // What follows the dose's comma (a load, "light", a pause) rides with the name on the clock.
      const extra = (String(it.dose).split(",")[1] || "").trim();
      const base = { item: idx, label: extra ? `${label} · ${extra}` : label, set: s, sets: p.sets };
      if(p.secs){
        const sides = p.sides === 2 ? ["Left side", "Right side"] : [null];
        sides.forEach((side, i) => {
          steps.push({ ...base, kind: "ready", secs: HOLD_COUNT_IN, side, switching: i > 0, next: s === 1 && i === 0 });
          steps.push({ ...base, kind: "hold", secs: p.secs, side });
        });
      } else {
        if(s === 1) steps.push({ ...base, kind: "ready", secs: HOLD_COUNT_IN, next: true });
        steps.push({ ...base, kind: "set", secs: Infinity, reps: p.reps, each: p.each });
      }
      if(s < p.sets) steps.push({ ...base, kind: "rest", secs: p.secs ? Math.max(5, rest - HOLD_COUNT_IN) : rest });
    }
    for(let i = steps.length - 1; i >= start; i--) if(steps[i].kind === "hold" || steps[i].kind === "set"){ steps[i].lastOfItem = true; break; }
  });
  return steps;
}
// Plays the moves not yet checked off today (all of them when everything is done).
function startRoutineTimer(name, idxs){
  if(!idxs.length) return;
  stopHoldTimer(true);
  clearRestTimer();
  const entry = data[name] && data[name].entries.find(e => e.date === todayISO());
  const done = new Set(entry ? entry.completedIndices || [] : []);
  const todo = idxs.filter(i => !done.has(i));
  const run = todo.length ? todo : idxs;
  const rest = restPrefs[name] || ROUTINE_REST;
  const steps = routineSteps(name, run, rest);
  holdTimer = { mode: "routine", name, items: idxs, doneItems: new Set([...done].filter(i => idxs.includes(i) && !run.includes(i))), rest, sides: 1, sets: 0,
    steps, idx: 0, endAt: Date.now() + steps[0].secs * 1000, paused: null, held: [], lastTap: 0, beeped: {}, intervalId: setInterval(tickHoldTimer, 200), wake: null };
  beginHoldTimer();
}
function playChecklist(name){ startRoutineTimer(name, routineItemsFor(name).map((_, i) => i)); }
function playRehabGroup(key){
  const g = rehabGroupsToday().find(x => x.key === key);
  if(g) startRoutineTimer(REHAB_NAME, g.idx);
}
function markRoutineItem(t, idx){
  t.doneItems.add(idx);
  const entry = getOrCreateTodayChecklistEntry(t.name);
  if((entry.completedIndices || []).includes(idx)) return;
  entry.completedIndices = [...(entry.completedIndices || []), idx].sort((a, b) => a - b);
  persist();
  enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: t.name, clientId: entry.clientId } });
  render();
}
// The routine's clock button with what it will play: the moves left today, and the rest between
// sets when any move has more than one.
function routineButton(onclick, what, name, idxs){
  const all = routineItemsFor(name), entry = data[name] && data[name].entries.find(e => e.date === todayISO());
  const done = new Set(entry ? entry.completedIndices || [] : []);
  const left = idxs.filter(i => !done.has(i)).length || idxs.length;
  const multi = idxs.some(i => parseDose(all[i].dose).sets > 1);
  const lines = [left < idxs.length ? `${left} of ${idxs.length} moves` : `${idxs.length} moves`, multi ? `Rest ${fmtRest(restPrefs[name] || ROUTINE_REST)}` : ""];
  return `<span class="timer-group">${timerPlanHtml(lines)}<button type="button" class="timer-btn" onclick="${onclick}" aria-label="Play ${what}">${HOLD_ICON}</button></span>`;
}
function renderRoutineClock(el, t, step, dots, handle, stopHint, size){
  const pos = `${t.items.indexOf(step.item) + 1} of ${t.items.length}`;
  const setPart = step.sets > 1 ? ` · set ${step.set} of ${step.sets}` : "";
  const sidePart = step.side ? ` · ${step.side}` : "";
  if(step.kind === "set"){
    paintClock(el, `hold-clock set${size}`, `${step.label}, ${step.reps} reps`, `<div class="hc-phase">Move ${pos}</div><div class="hc-time hc-reps">${step.reps}<small> reps${step.each ? " each " + step.each : ""}</small></div><div class="hc-set">${step.label}${setPart}</div><div class="hc-dots">${dots}</div><div class="hc-controls"><button type="button" class="hc-btn hc-done" data-hc="skip">${icon("check")}Done</button></div>${stopHint}${handle}`);
    return;
  }
  const left = Math.max(0, Math.ceil(holdLeftMs(t) / 1000));
  const phase = t.paused ? "Paused" : step.kind === "ready" ? (step.switching ? "Switch sides" : step.next ? `Move ${pos}` : "Get ready") : step.kind === "hold" ? "Hold" : "Rest";
  const line = step.kind === "rest" ? `Next: set ${step.set + 1} of ${step.sets} · ${step.label}` : step.kind === "ready" && step.next ? `Next: ${step.label}` : `${step.label}${setPart}${sidePart}`;
  const pct = Math.min(100, Math.max(0, 100 * (1 - holdLeftMs(t) / (step.secs * 1000))));
  const skipLabel = step.kind === "rest" ? "Next set" : step.kind === "hold" ? "Next" : "Start";
  const controls = `<div class="hc-controls">`
    + (step.kind === "rest" ? `<button type="button" class="hc-btn" data-hc="less" aria-label="15 seconds less rest">−15</button>` : "")
    + `<button type="button" class="hc-btn" data-hc="pause">${t.paused ? icon("play") + "Resume" : icon("pause") + "Pause"}</button>`
    + `<button type="button" class="hc-btn" data-hc="skip">${skipLabel}${icon("next")}</button>`
    + (step.kind === "rest" ? `<button type="button" class="hc-btn" data-hc="more" aria-label="15 seconds more rest">+15</button>` : "")
    + `</div>`;
  paintClock(el, `hold-clock ${step.kind}${t.paused ? " paused" : ""}${size}`, `${phase}, ${left} seconds, ${line}`, `<div class="hc-phase">${phase}</div><div class="hc-time">${fmtClock(left)}</div><div class="hc-set">${line}</div><div class="hc-dots">${dots}</div>${controls}${stopHint}<div class="hc-bar" style="width:${pct}%"></div>${handle}`);
}

// Sound needs a tap to start on phones; the Start tap creates the context, later beeps reuse it.
let holdAudioCtx = null;
function holdAudio(){
  try{
    if(!holdAudioCtx){ const A = window.AudioContext || window.webkitAudioContext; if(A) holdAudioCtx = new A(); }
    if(holdAudioCtx && holdAudioCtx.state === "suspended") holdAudioCtx.resume();
  }catch(e){ holdAudioCtx = null; }
  return holdAudioCtx;
}
function holdBeep(freq, ms){
  const ctx = holdAudioCtx;
  if(!ctx || document.visibilityState !== "visible") return;
  try{
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + ms / 1000 + 0.02);
  }catch(e){}
}
function holdBuzz(pattern){
  if(document.visibilityState !== "visible") return;
  try{ if(navigator.vibrate) navigator.vibrate(pattern); }catch(e){}
}
