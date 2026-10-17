// Hold timer for timed lifts (Dead Hang, Side Plank, Wall Sit, Farmer's Carry): the top 30% of the
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
}

function isHoldLift(ex){ return !!ex && ex.unit === "sec" && ex.trackBy !== "duration" && ex.trackBy !== "checklist"; }

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
function syncHoldButton(){
  const btn = document.querySelector(".hold-action-btn");
  if(!btn || !selected || !isHoldLift(data[selected])) return;
  const { sets, secs } = holdPlanFor(selected, data[selected], true);
  const label = btn.querySelector(".hold-btn-label");
  if(label) label.textContent = `${sets}x${secs}`;
  btn.setAttribute("aria-label", `Start hold timer, ${sets} holds of ${secs} seconds`);
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

function startHoldTimer(name){
  const ex = data[name];
  if(!isHoldLift(ex)) return;
  stopHoldTimer(true);
  clearRestTimer();
  const { sets, secs } = holdPlanFor(name, ex, true);
  const sides = sidesOf(name).reps === "side" ? ["Left side", "Right side"] : sidesOf(name).reps === "leg" ? ["Left leg", "Right leg"] : [null];
  const rest = restPrefFor(name, ex);
  const steps = holdSteps(sets, secs, rest, sides);
  holdTimer = { name, sets, secs, rest, sides: sides.length, steps, idx: 0, endAt: Date.now() + steps[0].secs * 1000, paused: null,
    held: [], lastTap: 0, beeped: {}, intervalId: setInterval(tickHoldTimer, 200), wake: null };
  holdAudio(); // unlocked by this tap, so later beeps can play
  try{ if(navigator.wakeLock) navigator.wakeLock.request("screen").then(w => { if(holdTimer) holdTimer.wake = w; else w.release(); }).catch(() => {}); }catch(e){}
  holdBuzz(80);
  renderHoldClock();
}

// Time left in the current step, frozen while paused.
function holdLeftMs(t){ return t.paused ? t.paused.left : t.endAt - Date.now(); }

// Moves on to the next step, timed from `from`; false once the last step is done.
function nextHoldStep(t, from){
  t.idx++;
  if(t.idx >= t.steps.length){ finishHoldTimer(false); return false; }
  const next = t.steps[t.idx];
  t.endAt = from + next.secs * 1000;
  if(next.kind === "hold"){ holdBeep(880, 250); holdBuzz(200); }
  else if(next.kind === "rest"){ holdBeep(520, 400); holdBuzz([200, 100, 200]); recordRestTap(t.name); }
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
// count-in.
function skipHoldStep(){
  const t = holdTimer;
  if(!t || t.finished) return;
  const step = t.steps[t.idx];
  if(step.kind === "hold"){
    const heldSec = Math.floor(step.secs - holdLeftMs(t) / 1000);
    if(heldSec > 0) recordHold(step.set, heldSec);
  }
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
  t.rest = Math.max(HOLD_COUNT_IN + 5, t.rest + applied);
  t.steps.forEach((s, i) => { if(i > t.idx && s.kind === "rest") s.secs = Math.max(5, t.rest - HOLD_COUNT_IN); });
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
  const dots = Array.from({ length: t.sets }, (_, i) => `<i class="${(t.held[i] || []).length >= t.sides ? "done" : ""}"></i>`).join("");
  const size = holdCompact ? " compact" : "";
  const handle = `<button type="button" class="hc-handle" data-hc="size" aria-label="${holdCompact ? "Show the big clock" : "Shrink to a bar"}">${holdCompact ? "▾" : "▴"}</button>`;
  if(t.finished){
    el.className = "hold-clock done" + size;
    el.innerHTML = `<div class="hc-phase">${t.result.startsWith("Done") ? "Done" : "Stopped"}</div><div class="hc-time">${t.summary}</div><div class="hc-set">${t.result.replace(/^(Done|Stopped): ?/, "")}</div><div class="hc-dots">${dots}</div><div class="hc-stop">Tap to close</div><button type="button" class="hc-close" data-hc="close" aria-label="Close">✕</button>`;
    return;
  }
  const left = Math.max(0, Math.ceil(holdLeftMs(t) / 1000));
  const phase = t.paused ? "Paused" : step.kind === "ready" ? (step.switching ? "Switch sides" : "Get ready") : step.kind === "hold" ? "Hold" : "Rest";
  const setLine = step.kind === "rest" ? `Next: set ${step.set + 1} of ${t.sets}` : `Set ${step.set} of ${t.sets}${step.side ? ` · ${step.side}` : ""}`;
  const armed = Date.now() - t.lastTap < HOLD_STOP_WINDOW;
  const pct = Math.min(100, Math.max(0, 100 * (1 - holdLeftMs(t) / (step.secs * 1000))));
  const skipLabel = step.kind === "rest" ? "Next set" : step.kind === "hold" ? (t.idx >= t.steps.length - 1 ? "Finish" : "Rest") : "Start";
  const controls = `<div class="hc-controls">`
    + (step.kind === "rest" ? `<button type="button" class="hc-btn" data-hc="less" aria-label="15 seconds less rest">−15</button>` : "")
    + `<button type="button" class="hc-btn" data-hc="pause">${t.paused ? "▶ Resume" : "❚❚ Pause"}</button>`
    + `<button type="button" class="hc-btn" data-hc="skip">${skipLabel} ⏭</button>`
    + (step.kind === "rest" ? `<button type="button" class="hc-btn" data-hc="more" aria-label="15 seconds more rest">+15</button>` : "")
    + `</div>`;
  el.className = `hold-clock ${step.kind}${t.paused ? " paused" : ""}${size}`;
  el.setAttribute("aria-label", `${phase}, ${left} seconds, ${setLine}`);
  el.innerHTML = `<div class="hc-phase">${phase}</div><div class="hc-time">${fmtClock(left)}</div><div class="hc-set">${setLine}</div><div class="hc-dots">${dots}</div>${controls}<div class="hc-stop${armed ? " armed" : ""}">${armed ? "Tap again to stop" : "Tap twice to stop"}</div><div class="hc-bar" style="width:${pct}%"></div>${handle}`;
}
function toggleHoldCompact(){ holdCompact = !holdCompact; renderHoldClock(); }

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
