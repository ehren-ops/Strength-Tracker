// Shared helpers: dates, workout-complete celebration, plate math, formatting, 1RM estimate, rest lengths.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- helpers ----------
function fmtDate(iso){
  if(!iso) return "-";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
}
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function isLoggedToday(name){
  const ex = data[name];
  if(!ex) return false;
  const entry = ex.entries.find(e => e.date === todayISO());
  if(!entry) return false;
  if(ex.trackBy === "checklist"){
    const routine = CHECKLIST_ROUTINES[name];
    const total = routine ? routine.items.length : 0;
    return total > 0 && (entry.completedIndices || []).length >= total;
  }
  return true;
}

// Purely a "don't show the banner twice today" UX flag, not real workout
// data, so it's local-only and never synced.
const CELEBRATED_KEY = "strength-tracker-celebrated";
let celebratedToday = (function(){
  try{ return JSON.parse(window.localStorage.getItem(CELEBRATED_KEY)) || {}; }catch(e){ return {}; }
})();

const CONFETTI_COLORS = ['#FFC107','#FF5252','#40C4FF','#69F0AE','#E040FB','#FFFFFF'];
function spawnConfetti(container, count){
  const frag = document.createDocumentFragment();
  for(let i = 0; i < count; i++){
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = (Math.random() * 100) + "%";
    piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDuration = (2.2 + Math.random() * 1.6) + "s";
    piece.style.animationDelay = (Math.random() * 0.5) + "s";
    frag.appendChild(piece);
  }
  container.appendChild(frag);
}

// Full-screen takeover rather than a thin top banner: this is a "you're
// done for the day" moment, not a routine status toast, so it earns
// briefly blocking the whole screen. Confetti pieces are plain divs with a
// CSS fall animation rather than a canvas - cheap enough for ~60 pieces and
// needs no library. Held fully visible for 3s, then fades out over 0.6s to
// match the CSS transition, and the DOM is cleared after so old confetti
// can't linger under the next celebration.
// Held long enough to actually see between sets; a tap anywhere closes it early.
const CELEBRATION_HOLD_MS = 7000;
function dismissCelebration(){
  const el = document.getElementById("celebration-banner");
  if(!el || el.hidden) return;
  clearTimeout(window.__celebrationTimer);
  clearTimeout(window.__celebrationFadeTimer);
  el.classList.add("fade-out");
  window.__celebrationFadeTimer = setTimeout(() => {
    el.hidden = true;
    el.innerHTML = "";
    el.classList.remove("fade-out");
  }, 650);
}
function showCelebration(msg){
  const el = document.getElementById("celebration-banner");
  if(!el) return;
  if(window.__celebrationTimer) clearTimeout(window.__celebrationTimer);
  if(window.__celebrationFadeTimer) clearTimeout(window.__celebrationFadeTimer);
  el.innerHTML = "";
  el.classList.remove("fade-out");
  const messageEl = document.createElement("div");
  messageEl.className = "celebration-message";
  messageEl.textContent = msg;
  el.appendChild(messageEl);
  const hintEl = document.createElement("div");
  hintEl.className = "celebration-hint";
  hintEl.textContent = "Tap to close";
  el.appendChild(hintEl);
  spawnConfetti(el, 60);
  el.onclick = dismissCelebration;
  el.hidden = false;
  window.__celebrationTimer = setTimeout(dismissCelebration, CELEBRATION_HOLD_MS);
}

// Only the numbered, built-in exercises for full/upper/lower count as "core" -
// custom exercises the user adds later (lateral raises, etc.) don't gate this,
// and Extra/Off-Day isn't a "core workout" to begin with (its pills are never
// numbered), so it's excluded entirely.
function checkCoreWorkoutComplete(day){
  if(day !== "full" && day !== "upper" && day !== "lower") return;
  // Only the day's main lifts count. Preseason-only extras (jumps, bounds,
  // Lateral Lunge, Seated Calf Raise and the rest of PRESEASON_ONLY) are
  // optional, so skipping one never blocks the popup, with Preseason Prep on or
  // off. Ski, care and deload modes change prescriptions, never this list.
  const coreList = DAY_ORDER[day].filter(name => !PRESEASON_ONLY.has(name));
  if(!coreList.every(name => isLoggedToday(name))) return;
  const today = todayISO();
  if(celebratedToday[day] === today) return;
  celebratedToday[day] = today;
  try{ window.localStorage.setItem(CELEBRATED_KEY, JSON.stringify(celebratedToday)); }catch(e){}
  showCelebration(`🎉 ${DAY_TITLES[day]} complete - nice work!`);
  if(currentSession) flushQueue();
}

function daysBetween(dateStrA, dateStrB){
  // Compares two "YYYY-MM-DD" local calendar dates as pure integer day counts,
  // sidestepping local/UTC parsing mismatches entirely.
  const [ay,am,ad] = dateStrA.split("-").map(Number);
  const [by,bm,bd] = dateStrB.split("-").map(Number);
  return Math.round((Date.UTC(by,bm-1,bd) - Date.UTC(ay,am-1,ad)) / 86400000);
}

function calcPlates(totalWeight){
  const perSide = (totalWeight - BAR_WEIGHT) / 2;
  if(perSide <= 0) return { perSide:0, plates:[], unreachable:false };
  let remaining = Math.round(perSide*100)/100;
  const plates = [];
  for(const p of PLATE_SET){
    const count = Math.floor(remaining/p + 1e-9);
    if(count > 0){ plates.push({plate:p,count}); remaining = Math.round((remaining-count*p)*100)/100; }
  }
  return { perSide, plates, unreachable: remaining > 0.01 };
}
function platesLabel(totalWeight, equipment){
  if(equipment !== "barbell") return null;
  const { perSide, plates, unreachable } = calcPlates(totalWeight);
  if(perSide === 0) return `No plates needed`;
  const parts = plates.map(p => `${p.count}×${p.plate}`).join(" + ");
  return `${parts} per side${unreachable ? " - closest with standard plates" : ""}`;
}
// Labels that say whether a number is per hand, per side, per leg or total (EXERCISE_SIDES).
function sidesOf(name){
  const s = EXERCISE_SIDES[name] || {};
  return { weight: s.weight || "total", reps: s.reps || "total" };
}
function weightSuffix(name){ const w = sidesOf(name).weight; return w === "total" ? " total" : "/" + w; }
function repsSuffix(name){ const r = sidesOf(name).reps; return r === "total" ? "" : r === "steps" ? " steps" : "/" + r; }
function weightFieldLabel(name){ const w = sidesOf(name).weight; return w === "total" ? "Lb total" : "Lb / " + w; }
function repsFieldLabel(name, unit){
  const r = sidesOf(name).reps; const base = unit === "sec" ? "Seconds" : "Reps";
  return r === "total" ? base : r === "steps" ? "Steps total" : `${base} / ${r}`;
}
function repsWord(name){ return sidesOf(name).reps === "steps" ? "steps" : "reps"; }
function sidesText(name){
  const s = sidesOf(name), words = { hand: "each hand", side: "each side", leg: "each leg", steps: "total steps, both legs counted", total: "total" };
  return `weight ${words[s.weight]}, reps ${words[s.reps]}`;
}

// The last full working session: a Deload Week session is planned and light, so where a lift
// stands (current weight, since first, Est. 1RM, the trend) comes from the session before it.
function lastWorking(ex){
  for(let i = ex.entries.length - 1; i >= 0; i--) if(!ex.entries[i].deload) return ex.entries[i];
  return ex.entries[ex.entries.length - 1] || null;
}

function repLabel(sets, reps, unit){
  return unit === "sec" ? `${sets}x${reps}sec` : `${sets}x${reps}`;
}

function formatEntryValue(e, ex){
  if(ex.trackBy === "weight") return `${e.weight}lbs ${repLabel(e.sets, e.reps, ex.unit)}`;
  if(ex.trackBy === "duration"){
    let s = `${e.minutes} min`;
    if(e.distance != null && e.distance !== "") s += `, ${e.distance} mi`;
    let speed = (e.speed != null && e.speed !== "") ? e.speed : null;
    let speedIsCalculated = false;
    if(speed == null && ex.trackSpeed && e.distance != null && e.distance !== "" && e.minutes){
      speed = Math.round((e.distance / (e.minutes / 60)) * 10) / 10;
      speedIsCalculated = true;
    }
    if(speed != null) s += ` @ ${speedIsCalculated ? "~" : ""}${speed} mph`;
    if(e.incline != null && e.incline !== "") s += ` @ ${e.incline}% incline`;
    return s;
  }
  return repLabel(e.sets, e.reps, ex.unit);
}
function niceTicks(values, forceStep){
  const nums = values.filter(v => v !== null && v !== undefined);
  if(!nums.length) return { lo:0, hi:10, step:2 };
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  let step;
  if(forceStep){
    step = forceStep;
  } else if(range <= 100){
    // normal per-lift weight tracking: keep to the 2.5/5/10lb grain plates actually move in
    step = range <= 20 ? 2.5 : range <= 60 ? 5 : 10;
  } else {
    // larger-magnitude series (e.g. total session volume in the thousands):
    // pick a clean round step aiming for ~5 gridlines instead of a fixed lb grain
    const roughStep = range / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const norm = roughStep / magnitude;
    const niceNorm = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    step = niceNorm * magnitude;
  }
  const lo = Math.floor(min/step)*step;
  const hi = Math.ceil(max/step)*step === lo ? lo + step : Math.ceil(max/step)*step;
  return { lo, hi, step };
}

function ticksBetween(lo, hi, step){
  const out = [];
  const safeStep = step > 0 ? step : 1;
  const maxTicks = 20; // defensive cap, should never actually be hit with niceTicks' logic
  for(let v = lo, i = 0; v <= hi + 1e-9 && i < maxTicks; v += safeStep, i++){
    out.push(Math.round(v * 100) / 100);
  }
  return out;
}

function estimate1RM(weight, reps){
  // Epley formula - rough estimate, not a substitute for an actual tested max
  return Math.round(weight * (1 + reps / 30));
}

// Single source of truth for both the human-readable rest range shown in
// the "Next:" recommendation and the numeric seconds the rest timer uses -
// keeping these as two independently-edited copies is exactly the kind of
// drift that let a stale weight number survive a text-only fix earlier.
function restBucketFor(ex){
  const tr = effectiveTargetReps(ex);
  if(tr <= 6) return { minSec: 150, maxSec: 180, label: "2.5–3 min" };
  if(tr <= 10) return { minSec: 90, maxSec: 90, label: "90 sec" };
  if(tr <= 15) return { minSec: 60, maxSec: 75, label: "60–75 sec" };
  return { minSec: 45, maxSec: 60, label: "45–60 sec" };
}
function restTimeFor(ex){
  return restBucketFor(ex).label;
}

