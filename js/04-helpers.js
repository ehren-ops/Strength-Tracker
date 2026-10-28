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

const SKIP_REASONS = { injury: "Injury", equipment: "Equipment", time: "Time", other: "Other" };
function skipReason(name, date){ return (skips[date || todayISO()] || {})[name] || null; }

function isLoggedToday(name){
  if(name === MOBILITY_NAME) return MOBILITY_ROUTINES.some(([n]) => isLoggedToday(n));
  const ex = data[name];
  if(!ex) return false;
  const entry = ex.entries.find(e => e.date === todayISO());
  if(!entry) return false;
  if(name === REHAB_NAME) return rehabDoneToday();
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

// Workout-complete celebration: a full-screen moment with CSS confetti (plain divs, no library).
// Held long enough to see between sets; a tap anywhere closes it early.
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
  if(!programDays().includes(day)) return;
  // Only the day's main lifts count. Preseason-only extras (jumps, bounds,
  // Lateral Lunge, Seated Calf Raise and the rest of PRESEASON_ONLY) are
  // optional, so skipping one never blocks the popup, with Preseason Prep on or
  // off. Ski, care and deload modes change prescriptions, never this list.
  const coreList = DAY_ORDER[day].filter(name => !PRESEASON_ONLY.has(name) || isYearRound(day, name));
  if(!coreList.every(name => isLoggedToday(name) || skipReason(name) || isShoulderPaused(name))) return;
  const today = todayISO();
  if(celebratedToday[day] === today) return;
  celebratedToday[day] = today;
  try{ window.localStorage.setItem(CELEBRATED_KEY, JSON.stringify(celebratedToday)); }catch(e){}
  showCelebration(`${DAY_TITLES[day]} complete - nice work!`);
  if(currentSession) flushQueue();
}

function daysBetween(dateStrA, dateStrB){
  // Compares two "YYYY-MM-DD" local calendar dates as pure integer day counts,
  // sidestepping local/UTC parsing mismatches entirely.
  const [ay,am,ad] = dateStrA.split("-").map(Number);
  const [by,bm,bd] = dateStrB.split("-").map(Number);
  return Math.round((Date.UTC(by,bm-1,bd) - Date.UTC(ay,am-1,ad)) / 86400000);
}

// Plate-loaded machines with no bar (Hip Thrust) set barWeight: 0 in EXERCISE_DEFAULTS.
function barWeightFor(name){
  const b = (EXERCISE_DEFAULTS[name] || {}).barWeight;
  return b != null ? b : BAR_WEIGHT;
}
function calcPlates(totalWeight, bar){
  const perSide = (totalWeight - (bar != null ? bar : BAR_WEIGHT)) / 2;
  if(perSide <= 0) return { perSide:0, plates:[], unreachable:false };
  let remaining = Math.round(perSide*100)/100;
  const plates = [];
  for(const p of PLATE_SET){
    const count = Math.floor(remaining/p + 1e-9);
    if(count > 0){ plates.push({plate:p,count}); remaining = Math.round((remaining-count*p)*100)/100; }
  }
  return { perSide, plates, unreachable: remaining > 0.01 };
}
function platesLabel(totalWeight, equipment, bar){
  if(equipment !== "barbell") return null;
  const { perSide, plates, unreachable } = calcPlates(totalWeight, bar);
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

// Per-set reps on an entry: when they differ, the count is the sets and the lowest is the reps, so
// progression only counts a session where every set hit the target. Equal reps store nothing extra.
function applyPerSet(entry, reps){
  if(!reps || !reps.length){ delete entry.repsBySet; return entry; }
  entry.sets = reps.length;
  entry.reps = Math.min(...reps);
  if(reps.every(r => r === reps[0])) delete entry.repsBySet;
  else entry.repsBySet = reps;
  return entry;
}
// Sets and reps as logged: "3x8", or each set's reps when they differed ("8/8/6").
function setsText(e, ex){
  return e.repsBySet && e.repsBySet.length > 1 ? e.repsBySet.join("/") + (ex.unit === "sec" ? " sec" : "") : repLabel(e.sets, e.reps, ex.unit);
}
// Records. A session is a PR when it goes heavier than ever ("weight"), or matches the heaviest
// weight ever with more reps ("reps"). More reps at a lighter weight never counts. Lifts without
// weight compare reps (or seconds) alone. Deload sessions never count, and the first log is no PR.
function prFlags(ex){
  if(ex.trackBy === "duration" || ex.trackBy === "checklist") return ex.entries.map(() => false);
  let topW = null, topR = 0, any = false;
  return ex.entries.map(e => {
    if(e.deload || !(e.reps > 0)) return false;
    const w = ex.trackBy === "weight" ? Number(e.weight) || 0 : 0;
    let pr = false;
    if(any){
      if(w > topW) pr = "weight";
      else if(w === topW && e.reps > topR) pr = "reps";
    }
    if(!any || w > topW){ topW = w; topR = e.reps; }
    else if(w === topW) topR = Math.max(topR, e.reps);
    any = true;
    return pr;
  });
}
// The PR in a few words for the card footer: "Heaviest yet: 145 lb x 5", "Most reps at 50 lb: 14".
function prText(e, ex, kind){
  const unit = ex.unit === "sec" ? "sec" : "reps";
  if(kind === "weight") return `Heaviest yet: ${e.weight} lb x ${e.reps}`;
  if(ex.trackBy === "weight" && e.weight > 0) return `Most reps at ${e.weight} lb: ${e.reps}`;
  return ex.unit === "sec" ? `Longest hold: ${e.reps} sec` : `Most ${unit} yet: ${e.reps}`;
}
// The record to beat at a weight: the session with the most reps at that weight or heavier.
function repRecord(ex, weight){
  const loaded = ex.trackBy === "weight" && weight > 0;
  let best = null;
  ex.entries.forEach(e => {
    if(e.deload || !(e.reps > 0) || (loaded && !(e.weight >= weight))) return;
    if(!best || e.reps >= best.reps) best = e;
  });
  return best;
}

// Cardio with distance: any two of time, distance and pace give the third. Bike and walk use
// minutes, miles and mph; the rower uses minutes, meters and the split (seconds per 500 m).
function solveCardio(t, d, p, rowing){
  const r = (v, n) => Math.round(v * 10 ** n) / 10 ** n;
  if(rowing){
    if(t && d && !p) p = r(t * 60 * 500 / d, 1);
    else if(t && p && !d) d = Math.round(t * 60 / p * 500);
    else if(d && p && !t) t = r(d / 500 * p / 60, 1);
  } else {
    if(t && d && !p) p = r(d / (t / 60), 1);
    else if(t && p && !d) d = r(p * t / 60, 2);
    else if(d && p && !t) t = r(d / p * 60, 1);
  }
  return { minutes: t || null, distance: d || null, speed: p || null };
}
// A 500 m split typed as "2:05", "2:05.3", "2.05" or plain seconds ("125"), in seconds.
function parseSplit(v){
  const s = String(v == null ? "" : v).trim();
  let m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if(m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(\d)\.(\d{2})$/);
  if(m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(s);
  return s && n >= 60 ? n : null;
}
function fmtSplit(sec){
  if(!(sec > 0)) return "";
  const t = Math.round(sec * 10) / 10, m = Math.floor(t / 60), r = Math.round((t - m * 60) * 10) / 10;
  return `${m}:${r < 10 ? "0" : ""}${Number.isInteger(r) ? r : r.toFixed(1)}`;
}
// Concept2's watts for a split: 2.80 / (seconds per meter)^3.
function rowWatts(split){ return split > 0 ? Math.round(2.8 / Math.pow(split / 500, 3)) : null; }
// The pace of a cardio entry, logged or worked out from time and distance.
function cardioPace(e, ex){
  const has = v => v != null && v !== "";
  if(has(e.speed)) return { value: Number(e.speed), calc: false };
  if(!(ex.trackSpeed && has(e.distance) && e.minutes)) return null;
  return { value: solveCardio(Number(e.minutes), Number(e.distance), null, !!ex.rowing).speed, calc: true };
}

function formatEntryValue(e, ex){
  if(ex.trackBy === "weight") return `${e.weight} lb ${setsText(e, ex)}`;
  if(ex.trackBy === "duration"){
    let s = `${e.minutes} min`;
    if(e.distance != null && e.distance !== "") s += `, ${e.distance} ${ex.rowing ? "m" : "mi"}`;
    const pace = cardioPace(e, ex);
    if(pace) s += ex.rowing ? ` @ ${pace.calc ? "~" : ""}${fmtSplit(pace.value)} /500m, ${rowWatts(pace.value)} W` : ` @ ${pace.calc ? "~" : ""}${pace.value} mph`;
    if(e.spm != null && e.spm !== "") s += `, ${e.spm} spm`;
    if(e.incline != null && e.incline !== "") s += ` @ ${e.incline}% incline`;
    if(e.tempF != null && e.tempF !== "") s += ` at ${e.tempF}°F`;
    return s;
  }
  return setsText(e, ex);
}
function niceTicks(values, forceStep){
  const nums = values.filter(v => v !== null && v !== undefined);
  if(!nums.length) return { lo:0, hi:10, step:2 };
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  // A clean round step (1, 2, 5, 10, 20...) aiming for about 5 gridlines.
  const roundStep = () => {
    const roughStep = range / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const norm = roughStep / magnitude;
    return (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * magnitude;
  };
  let step;
  if(forceStep){
    // Whole units (minutes, reps, seconds): never finer than forceStep, but never 20 crowded labels
    // either (a treadmill at 15 to 38 min reads 15, 20, 25 ... not every minute).
    step = Math.max(forceStep, roundStep());
  } else if(range <= 100){
    // normal per-lift weight tracking: keep to the 2.5/5/10lb grain plates actually move in
    step = range <= 20 ? 2.5 : range <= 60 ? 5 : 10;
  } else {
    // larger-magnitude series (e.g. total session volume in the thousands)
    step = roundStep();
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
// Outline icons in place of emoji (the modifiers alone keep theirs, in MODE_DEFS): 16px grid, drawn
// in the text color, sized to the text.
const ICON_PATHS = {
  cloud: '<path d="M4.6 12.5h6.9a2.8 2.8 0 0 0 .3-5.6 4 4 0 0 0-7.6.9 2.4 2.4 0 0 0 .4 4.7z"/>',
  warn: '<path d="M8 2.2 14.3 13.4H1.7z"/><path d="M8 6.6v3.2M8 11.6v.1"/>',
  spark: '<path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8 6.6 6.6z"/>',
  target: '<circle cx="8" cy="8" r="6.2"/><circle cx="8" cy="8" r="3.4"/><circle cx="8" cy="8" r=".8"/>',
  down: '<path d="M8 2v8.5M4.6 7.2 8 10.5l3.4-3.3M2.5 13.5h11"/>',
  up: '<path d="M8 10.5V2M4.6 5.3 8 2l3.4 3.3M2.5 13.5h11"/>',
  pause: '<path d="M5.5 3.5v9M10.5 3.5v9"/>',
  play: '<path d="M5 3.2 12.6 8 5 12.8z"/>',
  next: '<path d="M3.2 3.4 9.4 8l-6.2 4.6zM12.6 3.4v9.2"/>',
  check: '<path d="M3 8.6l3.2 3.1L13 4.6"/>',
};
function icon(key){ return ICON_PATHS[key] ? `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICON_PATHS[key]}</svg>` : ""; }

function restBucketFor(ex){
  // Main lifts: start at 90 sec and stretch to 3 min when the sets are heavy (the button steps up).
  const name = Object.keys(data).find(k => data[k] === ex);
  if(name && COMPOUND_LIFTS.has(name)) return { minSec: 90, maxSec: 180, label: "90 sec–3 min", choices: [120, 180] };
  const tr = effectiveTargetReps(ex);
  if(tr <= 6) return { minSec: 150, maxSec: 180, label: "2.5–3 min" };
  if(tr <= 10) return { minSec: 90, maxSec: 90, label: "90 sec" };
  if(tr <= 15) return { minSec: 60, maxSec: 75, label: "60–75 sec" };
  return { minSec: 45, maxSec: 60, label: "45–60 sec" };
}
function restTimeFor(ex){
  return restBucketFor(ex).label;
}

function shiftISO(iso, days){
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}

// How a session went against what was asked of it: the plan the Next tile showed when it was
// logged, or for sessions logged before plans were saved, the lift's previous regular session (its
// sets, up to 3; the bottom of a rep range or the target reps; a bodyweight or timed lift's previous
// reps). target is the reps a modifier asked for that day (Preseason: 5), or the lift's own.
function sessionVerdict(ex, i, target){
  const e = ex.entries[i];
  const prev = ex.entries.slice(0, i).reverse().find(p => !p.deload);
  const plan = e.plan || null;
  const range = activeRepRange(ex);
  const sets = plan && plan.sets ? plan.sets : prev ? Math.min(3, prev.sets || 3) : 3;
  const reps = plan && plan.reps ? plan.reps
    : ex.trackBy === "weight" ? (range ? range[0] : target)
    : prev && prev.reps > 0 ? Math.min(prev.reps, target) : target;
  const under = (e.sets || 0) < sets;
  const missed = !under && (e.reps || 0) < reps;
  const fullSets = plan && plan.sets ? plan.sets : isHeavyEntry(ex, e) ? HEAVY_SETS : 3;
  const extra = !under && !missed && ((e.reps || 0) > reps || (e.sets || 0) > fullSets);
  return { under, missed, extra, sets, reps };
}
