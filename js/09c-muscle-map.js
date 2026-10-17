// Muscle Map on the Overview: front and back figures shaded by each muscle's working sets over the
// last 7 days (the same window as Weekly Balance), or by how hard it was worked in the last two days.
// A lift's main muscles get its full sets, helper muscles half. Tap a muscle (on the body or in the
// list) to see the lifts behind its number.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

const MUSCLES = [
  ["quads", "Quads"], ["glutes", "Glutes"], ["hamstrings", "Hamstrings"], ["adductors", "Adductors"],
  ["lowerBack", "Lower back"], ["calves", "Calves"], ["chest", "Chest"], ["frontDelts", "Front delts"],
  ["sideDelts", "Side delts"], ["triceps", "Triceps"], ["upperBack", "Upper back"], ["lats", "Lats"],
  ["rearDelts", "Rear delts"], ["biceps", "Biceps"], ["forearms", "Forearms"], ["abs", "Abs"], ["obliques", "Obliques"],
];
const MUSCLE_NAME = Object.fromEntries(MUSCLES);
// p: main muscles (full sets), h: helpers (half). A routine logged without sets counts as `sets`.
const LIFT_MUSCLES = {
  "Squat": { p: ["quads"], h: ["glutes", "adductors"] },
  "Bench Press": { p: ["chest"], h: ["frontDelts", "triceps"] },
  "Incline DB Press": { p: ["chest"], h: ["frontDelts", "triceps"] },
  "Push-Ups": { p: ["chest"], h: ["frontDelts", "triceps"] },
  "Cable Chest Fly": { p: ["chest"] },
  "Tricep Pushdown": { p: ["triceps"] },
  "Lateral Raise": { p: ["sideDelts"] },
  "RDL": { p: ["hamstrings"], h: ["glutes", "lowerBack"] },
  "Back Extension": { p: ["lowerBack"], h: ["glutes", "hamstrings"] },
  "Hip Thrust": { p: ["glutes"], h: ["hamstrings"] },
  "Kettlebell Swings": { p: ["glutes"], h: ["hamstrings", "lowerBack"] },
  "Barbell Row": { p: ["upperBack"], h: ["lats", "rearDelts", "biceps"] },
  "Cable Lat Pulldown": { p: ["lats"], h: ["biceps"] },
  "Face Pulls": { p: ["rearDelts"], h: ["upperBack"] },
  "Bicep Curl": { p: ["biceps"], h: ["forearms"] },
  "Dead Hang": { p: ["forearms"], h: ["lats"] },
  "Farmer's Carry": { p: ["forearms"], h: ["upperBack", "obliques"] },
  "Bulgarian Split Squat": { p: ["quads"], h: ["glutes"] },
  "Walking Lunge": { p: ["quads"], h: ["glutes"] },
  "Lateral Lunge": { p: ["adductors"], h: ["glutes", "quads"] },
  "Spanish Squat": { p: ["quads"] },
  "Wall Sit": { p: ["quads"] },
  "Copenhagen Plank": { p: ["adductors"], h: ["obliques"] },
  "Standing Calf Raise": { p: ["calves"] },
  "Seated Calf Raise": { p: ["calves"] },
  "Box Jumps": { h: ["quads", "glutes", "calves"] },
  "Trap Bar Jump": { h: ["quads", "glutes"] },
  "Skater Bound": { h: ["glutes", "adductors"] },
  "Med Ball Slam": { h: ["lats", "abs"] },
  "Pallof Press": { p: ["obliques"], h: ["abs"] },
  "Side Plank": { p: ["obliques"] },
  "Dead Bug": { p: ["abs"] },
  "5-Minute Core Routine": { p: ["abs"], h: ["obliques"], sets: 2 },
};
const MUSCLE_TARGET = [10, 20]; // working sets a muscle a week
const MUSCLE_SMALL = new Set(["forearms", "abs", "obliques"]); // left out of "lowest so far"

// Sets per muscle over the 7 days ending asOf, with the lifts behind each number, the sets from the
// last two days (asOf and the day before) and the latest day of that recent work.
function muscleWeek(asOf){
  const to = asOf || todayISO(), from = shiftISO(to, -6), recentFrom = shiftISO(to, -1);
  const sets = {}, recent = {}, recentLast = {}, lifts = {}, dates = new Set();
  let total = 0;
  MUSCLES.forEach(([k]) => { sets[k] = 0; recent[k] = 0; lifts[k] = {}; });
  Object.entries(data).forEach(([name, ex]) => {
    const map = LIFT_MUSCLES[name];
    if(!map) return;
    ex.entries.forEach(e => {
      if(e.date < from || e.date > to || e.confirmed === false) return;
      const n = map.sets || Number(e.sets) || 0;
      if(!n) return;
      dates.add(e.date);
      total += n;
      [[map.p || [], 1], [map.h || [], 0.5]].forEach(([keys, share]) => keys.forEach(k => {
        sets[k] += n * share;
        lifts[k][name] = (lifts[k][name] || 0) + n * share;
        if(e.date >= recentFrom){ recent[k] += n * share; if(!recentLast[k] || e.date > recentLast[k]) recentLast[k] = e.date; }
      }));
    });
  });
  const from_ = Object.fromEntries(MUSCLES.map(([k]) => [k, Object.entries(lifts[k]).sort((a, b) => b[1] - a[1])]));
  return { from, to, sets, recent, recentLast, lifts: from_, sessions: dates.size, total };
}
// Recovery from the last two days: 5+ sets worked hard (about two days), 2+ recovering (a day).
// The list in Recovery shows the day each muscle is ready again; the 10 to 20 target shows on a muscle's bar.
function muscleRecovery(w, k){
  const n = w.recent[k];
  const state = n >= 5 ? "hard" : n >= 2 ? "recovering" : "ready";
  if(state === "ready") return { state, when: "Ready now", short: "Ready" };
  const ready = shiftISO(w.recentLast[k], state === "hard" ? 2 : 1);
  const today = w.to;
  const [y, m, d] = ready.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  const when = ready <= today ? "Ready today" : ready === shiftISO(today, 1) ? "Ready tomorrow"
    : "Ready " + day.toLocaleDateString("en-US", { weekday: "long" });
  // The list's short word: the day it is ready again (the swatch already shows how hard).
  const short = ready <= today ? "Today" : day.toLocaleDateString("en-US", { weekday: "short" });
  return { state, when, ready, short };
}
function muscleBand(n){ return n <= 0 ? 0 : n < 6 ? 1 : n < MUSCLE_TARGET[0] ? 2 : n <= MUSCLE_TARGET[1] ? 3 : 4; }
const MUSCLE_BAND_WORDS = ["None this week", "Light", "Building", "In range", "Above range"];
const fmtSets = n => String(Math.round(n * 10) / 10);
const joinNames = keys => { const s = keys.map(k => MUSCLE_NAME[k].toLowerCase()); return s.length > 1 ? s.slice(0, -1).join(", ") + " and " + s[s.length - 1] : s[0]; };

// The muscle's own reason for zero sets: the lift that trains it, paused or not on a day.
function zeroMuscleReason(k){
  const lift = Object.keys(LIFT_MUSCLES).find(n => (LIFT_MUSCLES[n].p || []).includes(k));
  if(!lift) return "";
  if(typeof isShoulderPaused === "function" && isShoulderPaused(lift)) return `Rehab pauses ${lift}.`;
  return `${lift} covers them.`;
}
function muscleNotes(w, mode){
  const notes = [];
  if(mode === "recovery"){
    // Grouped by when each muscle is ready, soonest first.
    const by = {};
    MUSCLES.forEach(([k]) => { const r = muscleRecovery(w, k); (by[r.when] = by[r.when] || { ready: r.ready, keys: [] }).keys.push(k); });
    const groups = Object.entries(by).sort((a, b) => (a[1].ready || "").localeCompare(b[1].ready || ""));
    if(groups.length === 1 && by["Ready now"]) return [["Everything is ready.", ""]];
    return groups.map(([when, g]) => [when + ":", joinNames(g.keys) + "."]);
  }
  if(!w.total) return [["No lifts in the last 7 days.", "Each muscle fills in by its sets."]];
  const ranked = MUSCLES.map(([k]) => k).filter(k => w.sets[k] > 0).sort((a, b) => w.sets[b] - w.sets[a]);
  const top = ranked[0];
  notes.push([`${MUSCLE_NAME[top]} ${fmtSets(w.sets[top])}:`, `the most this week, from ${w.lifts[top].length} lift${w.lifts[top].length === 1 ? "" : "s"}.`]);
  const zero = MUSCLES.map(([k]) => k).filter(k => !w.sets[k]);
  if(zero.length === 1) notes.push([`${MUSCLE_NAME[zero[0]]} 0:`, (zeroMuscleReason(zero[0]) || "no sets this week.").replace(/^Rehab/, "rehab")]);
  else if(zero.length) notes.push(["No sets:", `${joinNames(zero)}.`]);
  const low = ranked.filter(k => !MUSCLE_SMALL.has(k) && w.sets[k] < MUSCLE_TARGET[0]).slice(-2).reverse();
  if(low.length) notes.push(["Lowest:", low.map(k => `${MUSCLE_NAME[k].toLowerCase()} ${fmtSets(w.sets[k])}`).join(", ") + "."]);
  return notes;
}

const MUSCLE_MODE_KEY = "strength-tracker-muscle-mode";
let muscleMode = (function(){ try{ return localStorage.getItem(MUSCLE_MODE_KEY) === "recovery" ? "recovery" : "sets"; }catch(e){ return "sets"; } })();
let musclePick = null;
function setMuscleMode(mode){
  muscleMode = mode;
  try{ localStorage.setItem(MUSCLE_MODE_KEY, mode); }catch(e){}
  render();
}
function pickMuscle(k){ musclePick = musclePick === k ? null : k; render(); }

// The figures: a neutral body, then each muscle's shapes. Shapes carry no fill of their own; the
// muscle's group sets it by class (mm-b0..4 for sets, mm-hard / mm-recovering / mm-ready).
const BODY_SHAPES = `<circle cx="60" cy="16" r="10.5"/><rect x="54.5" y="25" width="11" height="10" rx="3"/>
  <path d="M37 38 Q60 31 83 38 L87 60 Q85 92 79 114 L78 124 L42 124 L41 114 Q35 92 33 60 Z"/><path d="M42 116 L78 116 L81 136 L39 136 Z"/>
  <ellipse cx="30" cy="70" rx="7.5" ry="22" transform="rotate(8 30 70)"/><ellipse cx="90" cy="70" rx="7.5" ry="22" transform="rotate(-8 90 70)"/>
  <ellipse cx="24.5" cy="107" rx="6" ry="18" transform="rotate(8 24.5 107)"/><ellipse cx="95.5" cy="107" rx="6" ry="18" transform="rotate(-8 95.5 107)"/>
  <circle cx="21.5" cy="130" r="4.5"/><circle cx="98.5" cy="130" r="4.5"/>
  <ellipse cx="49.5" cy="154" rx="11.5" ry="30"/><ellipse cx="70.5" cy="154" rx="11.5" ry="30"/>
  <ellipse cx="48.5" cy="206" rx="7.5" ry="24"/><ellipse cx="71.5" cy="206" rx="7.5" ry="24"/>
  <ellipse cx="47.5" cy="233" rx="6.5" ry="3.5"/><ellipse cx="72.5" cy="233" rx="6.5" ry="3.5"/>`;
const SIDE_DELTS = `<ellipse cx="30.5" cy="50" rx="3.8" ry="7.5" transform="rotate(15 30.5 50)"/><ellipse cx="89.5" cy="50" rx="3.8" ry="7.5" transform="rotate(-15 89.5 50)"/>`;
const FOREARMS = `<ellipse cx="24.5" cy="105" rx="4.5" ry="13.5" transform="rotate(8 24.5 105)"/><ellipse cx="95.5" cy="105" rx="4.5" ry="13.5" transform="rotate(-8 95.5 105)"/>`;
const FRONT_MUSCLES = [
  ["sideDelts", SIDE_DELTS],
  ["frontDelts", `<ellipse cx="37.5" cy="45" rx="6.5" ry="7.5"/><ellipse cx="82.5" cy="45" rx="6.5" ry="7.5"/>`],
  ["chest", `<path d="M42 44 Q50 39.5 59 42 L59 62 Q50 66 42.5 60 Q39.5 52 42 44 Z"/><path d="M78 44 Q70 39.5 61 42 L61 62 Q70 66 77.5 60 Q80.5 52 78 44 Z"/>`],
  ["biceps", `<ellipse cx="30" cy="71" rx="5" ry="12" transform="rotate(8 30 71)"/><ellipse cx="90" cy="71" rx="5" ry="12" transform="rotate(-8 90 71)"/>`],
  ["forearms", FOREARMS],
  ["obliques", `<path d="M43 66 Q48 68 50 71 L50 108 Q46 104 44.5 96 Q42 80 43 66 Z"/><path d="M77 66 Q72 68 70 71 L70 108 Q74 104 75.5 96 Q78 80 77 66 Z"/>`],
  ["abs", `<rect x="52" y="67" width="16" height="44" rx="5"/><path class="mm-cut" d="M60 69 V109 M53 78.5 H67 M53 89.5 H67 M53 100.5 H67"/>`],
  ["adductors", `<path d="M55 132 Q59 134 59 140 L57.5 164 Q54 151 53 138 Z"/><path d="M65 132 Q61 134 61 140 L62.5 164 Q66 151 67 138 Z"/>`],
  ["quads", `<ellipse cx="48" cy="155" rx="8" ry="24" transform="rotate(4 48 155)"/><ellipse cx="72" cy="155" rx="8" ry="24" transform="rotate(-4 72 155)"/>`],
  ["calves", `<ellipse cx="45.5" cy="203" rx="3.2" ry="13"/><ellipse cx="74.5" cy="203" rx="3.2" ry="13"/>`],
];
const BACK_MUSCLES = [
  ["upperBack", `<path d="M52 29 L68 29 L80 42 L72 70 L60 81 L48 70 L40 42 Z"/>`],
  ["sideDelts", SIDE_DELTS],
  ["rearDelts", `<ellipse cx="37" cy="46" rx="6.5" ry="7.5"/><ellipse cx="83" cy="46" rx="6.5" ry="7.5"/>`],
  ["lats", `<path d="M42 56 Q47 58 52 72 L56 99 Q48 97 44 86 Q40 70 42 56 Z"/><path d="M78 56 Q73 58 68 72 L64 99 Q72 97 76 86 Q80 70 78 56 Z"/>`],
  ["triceps", `<ellipse cx="30" cy="71" rx="5.5" ry="12.5" transform="rotate(8 30 71)"/><ellipse cx="90" cy="71" rx="5.5" ry="12.5" transform="rotate(-8 90 71)"/>`],
  ["forearms", FOREARMS],
  ["lowerBack", `<rect x="53.5" y="84" width="6" height="29" rx="2.8"/><rect x="60.5" y="84" width="6" height="29" rx="2.8"/>`],
  ["glutes", `<ellipse cx="51" cy="127" rx="9.5" ry="9"/><ellipse cx="69" cy="127" rx="9.5" ry="9"/>`],
  ["hamstrings", `<ellipse cx="49.5" cy="160" rx="8" ry="21"/><ellipse cx="70.5" cy="160" rx="8" ry="21"/>`],
  ["calves", `<ellipse cx="48.5" cy="201" rx="6.5" ry="15"/><ellipse cx="71.5" cy="201" rx="6.5" ry="15"/>`],
];
function muscleClass(w, k){ return muscleMode === "recovery" ? "mm-" + muscleRecovery(w, k).state : "mm-b" + muscleBand(w.sets[k]); }
function muscleFigure(w, side, shapes){
  return `<figure class="mm-fig"><svg viewBox="0 0 120 250" role="img" aria-label="${side} of the body">
    <g class="mm-body">${BODY_SHAPES}</g>
    ${shapes.map(([k, s]) => `<g class="mm-m ${muscleClass(w, k)}${musclePick === k ? " mm-on" : ""}" onclick="pickMuscle('${k}')">${s}</g>`).join("")}
  </svg><figcaption>${side}</figcaption></figure>`;
}

function renderMuscleCard(){
  const w = muscleWeek();
  const ranked = MUSCLES.map(([k]) => k).filter(k => w.sets[k] > 0).sort((a, b) => w.sets[b] - w.sets[a]);
  const summary = ranked.length ? `Most: ${MUSCLE_NAME[ranked[0]]} ${fmtSets(w.sets[ranked[0]])}` : "";
  let html = `<div class="card mm-card">${collapsibleHead("muscles", "Muscle Map", summary)}`;
  if(overviewCollapsed.muscles) return html + `</div>`;
  const rec = muscleMode === "recovery";
  html += `<p class="mm-sub">Last 7 days · ${w.sessions} session${w.sessions === 1 ? "" : "s"} · ${fmtSets(w.total)} sets</p>
    <div class="mm-seg" role="group" aria-label="Shade by">
      <button type="button" class="${rec ? "" : "on"}" aria-pressed="${!rec}" onclick="setMuscleMode('sets')">Sets</button>
      <button type="button" class="${rec ? "on" : ""}" aria-pressed="${rec}" onclick="setMuscleMode('recovery')">Recovery</button>
    </div>
    <div class="mm-figs">${muscleFigure(w, "Front", FRONT_MUSCLES)}${muscleFigure(w, "Back", BACK_MUSCLES)}</div>`;
  const legend = rec ? [["mm-hard", "Worked hard"], ["mm-recovering", "Recovering"], ["mm-ready", "Ready"]]
    : [["mm-b0", "0"], ["mm-b1", "1-5"], ["mm-b2", "6-9"], ["mm-b3", "10-20"], ["mm-b4", "20+"]];
  html += `<div class="mm-legend">${rec ? "" : "<b>Sets</b>"}${legend.map(([c, l]) => `<span><i class="mm-sw ${c}"></i>${l}</span>`).join("")}</div>`;
  if(musclePick && MUSCLE_NAME[musclePick]){
    const k = musclePick, n = w.sets[k], r = muscleRecovery(w, k);
    const pct = v => Math.min(v / 25, 1) * 100;
    html += `<div class="mm-detail">
      <div class="mm-detail-head"><h4>${MUSCLE_NAME[k]}</h4><span>${rec ? r.when : MUSCLE_BAND_WORDS[muscleBand(n)]}</span></div>
      <div class="mm-big"><b>${fmtSets(n)}</b> sets in 7 days</div>
      <div class="mm-bar"><span class="mm-band" style="left:${pct(MUSCLE_TARGET[0])}%;width:${pct(MUSCLE_TARGET[1]) - pct(MUSCLE_TARGET[0])}%"></span><span class="mm-fill ${muscleClass(w, k)}" style="width:${pct(n)}%"></span>
        <i style="left:${pct(MUSCLE_TARGET[0])}%">${MUSCLE_TARGET[0]}</i><i style="left:${pct(MUSCLE_TARGET[1])}%">${MUSCLE_TARGET[1]}</i></div>
      ${w.lifts[k].map(([lift, s]) => `<div class="mm-lift"><span>${escapeHtml(lift)}</span><b>${fmtSets(s)}</b></div>`).join("")}
      <p class="mm-foot">${n ? (w.recent[k] ? `${fmtSets(w.recent[k])} sets in the last 2 days.` : "None in the last 2 days.") : zeroMuscleReason(k) || "No sets in 7 days."}</p>
    </div>`;
  } else {
    html += muscleNotes(w, muscleMode).map(([lead, text]) => `<p class="mm-note"><b>${lead}</b>${text ? " " + text : ""}</p>`).join("");
  }
  html += `<div class="mm-list">${MUSCLES.map(([k, name]) => `<button type="button" class="${musclePick === k ? "on" : ""}" aria-pressed="${musclePick === k}" onclick="pickMuscle('${k}')"><i class="mm-sw ${muscleClass(w, k)}"></i><span>${name}</span><b>${rec ? muscleRecovery(w, k).short : fmtSets(w.sets[k])}</b></button>`).join("")}</div>
    <p class="range-note mm-key">Tap a muscle for its lifts. Helpers count half a set.</p></div>`;
  return html;
}
