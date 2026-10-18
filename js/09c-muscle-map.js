// Muscle Map on the Overview: front and back figures shaded by each muscle's working sets over the
// last 7 days (the same window as Weekly Balance), or by how hard it was worked in the last two days.
// A lift's main muscles get its full sets, helper muscles half. Tap a muscle (on the body or in the
// list) to see the lifts behind its number; tap its name in the panel to close it.
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

// The figures: one body outline, then each muscle's shapes. Everything is drawn for the left half
// (x < 60) and mirrored, so both sides always match. Shapes carry no fill of their own; the muscle's
// group sets it by class (mm-b0..4 for sets, mm-hard / mm-recovering / mm-ready).
const mirror = s => s + `<g transform="matrix(-1 0 0 1 120 0)">${s}</g>`;
// Stretches a shape sideways (x' = a*x + b) to fit the broad-shouldered build.
const widen = (a, b, s) => `<g transform="matrix(${a} 0 0 1 ${b} 0)">${s}</g>`;
const BODY_HALF = "M60 4 C52.5 4 49 9.5 49.2 17 C49.3 22 50.5 27 53.5 30 L53 36 C48 39 42 40 37 41 C30 42 26.5 46.5 26.2 53 C25.5 60 24.8 68 24.8 76 C24.6 80 23.8 84 23 88 C21 96 20.3 104 21 112 L21.6 118 C20 124 20.5 131 23 134.5 C25.8 136 28 132.5 28 127.5 C28 123.5 27.5 120.5 27.8 117 C29 108 30.5 98 32 90 C33.2 84 33.8 78 34.6 72 C35.2 66 35.8 61 37 56.5 L37.6 57.5 C38.4 65 39.6 74 41 82 C41.8 88 41.6 95 41 101 C40.2 107 39.4 113 39.4 120 C38.2 137 39.2 155 42.6 172 C43 178 40 186 40 196 C40 206 42.8 216 44.4 226 L44.8 234 C43.8 239 43 242 45.5 243.5 C49 244.5 54 244 55 242 C55.5 240 54.5 236 54 232 C54.4 222 55.4 212 55.6 200 C55.8 192 54.2 186 54.6 178 C55 172 56.6 165 57 155 C57.5 145 58.5 138 60 134";
// The center strip covers the hairline seam where the two filled halves meet.
const BODY_SHAPES = `<g class="mm-skin">${mirror(`<path d="${BODY_HALF} Z"/>`)}<rect x="59" y="6" width="2" height="127"/></g><g class="mm-outline">${mirror(`<path d="${BODY_HALF}"/>`)}</g>`;
const SIDE_DELTS = mirror(widen(1, -2.6, `<path d="M30.5 48 C29 52 28.5 57 29 62 C30.5 63 31.6 60 31.8 55 C31.8 51.5 31.4 49 30.5 48 Z"/>`));
const FOREARMS = mirror(widen(1.06, -2.85, `<path d="M25 90 C23 98 23 108 24.5 114 C25.5 116 27.5 116 28 113 C29.5 105 31 97 31.5 91 C30 88 26.5 87.5 25 90 Z"/>`));
const FRONT_DETAIL = mirror(`<path d="M45 41.5 C50 42.3 55 42.6 59 41.8"/>`);
const BACK_DETAIL = mirror(`<path d="M59.4 40 V112"/>`);
const FRONT_MUSCLES = [
  ["sideDelts", SIDE_DELTS],
  ["frontDelts", mirror(widen(1.238, -10, `<path d="M40 43 C35 44 31.5 48 31.5 55 C33 60 35.5 62 37.5 62 C37.8 56 38.8 49.5 42 45.5 Z"/>`))],
  ["chest", mirror(widen(1.078, -4.62, `<path d="M59.3 44 C52 42.5 45 43.5 41.5 46.5 C40 51 40.5 56 43 60 C47 63.5 53 64.5 59.3 63 Z"/>`))],
  ["biceps", mirror(widen(1.25, -10.25, `<path d="M31.5 64 C29.5 69 29 76 30.5 82 C31.5 85 33.5 85 34 81 C35 75 35 69 33.5 64 C33 62 32 62 31.5 64 Z"/>`))],
  ["forearms", FOREARMS],
  ["obliques", mirror(`<path d="M42 66 C45 67 49 68 52 69 L52.5 96 C49 99 45 101 41.5 101 C41.8 95 42 88 41.2 82 C40.7 76 41 70 42 66 Z"/>`)],
  ["abs", mirror(`<rect x="53.5" y="67" width="5.8" height="7.6" rx="2"/><rect x="53.4" y="76.6" width="5.9" height="7.6" rx="2"/><rect x="53.6" y="86.2" width="5.7" height="7.6" rx="2"/><path d="M54 95.8 H59.3 V110 C57 109 55 105 54 100 Z"/>`)],
  ["adductors", mirror(`<path d="M56 128 C58 131 58.4 136 58.2 142 C57.6 150 56.4 156 55 160 C54.5 150 54.5 140 54 132 C54.2 129 55 127.5 56 128 Z"/>`)],
  ["quads", mirror(widen(1.067, -3.7, `<path d="M42 124 C40.5 136 41 152 44.5 166 C46 171 50 172.5 52.5 169 C55 160 55.5 146 54 134 C52.5 127 48.5 122 42 124 Z"/><path class="mm-cut" d="M47.5 129 C46.2 145 47 158 49.5 168"/>`))],
  ["calves", mirror(`<path d="M54 186 C55.5 192 55.4 200 54 207 C52.6 206 52 198 52.5 190 C52.8 188 53.3 186.5 54 186 Z"/>`)],
];
const BACK_MUSCLES = [
  ["upperBack", mirror(widen(1.13, -7.7, `<path d="M59.3 31 C57 33 54 36 50 39 C46 41.5 42 42.5 40 43.5 C45 46 50 50 54 57 C56.5 63 58.3 71 59.3 77 Z"/>`))],
  ["sideDelts", SIDE_DELTS],
  ["rearDelts", mirror(widen(1.238, -10, `<path d="M40 44 C35 45 31.8 48.5 31.5 55 C33 59 36 60 38.5 58 C38.5 53 40 48.5 42 46 Z"/>`))],
  ["lats", mirror(widen(1.101, -5.86, `<path d="M43 60 C47 61 51 64 54 70 C56 78 57.5 88 58 96 C54 96 49 93 45.5 88 C42 83 41 75 41.2 68 C41.2 64 41.8 61 43 60 Z"/>`))],
  ["triceps", mirror(widen(1.25, -10.25, `<path d="M31 62 C29 68 28.5 76 30 83 C31.5 87 34.5 86 35 81 C35.5 75 35.5 68 34 63 C33.2 60.5 31.8 60.5 31 62 Z"/>`))],
  ["forearms", FOREARMS],
  ["lowerBack", mirror(`<path d="M54.5 82 C56.5 82 58.3 83 59.3 84 V113 C57 113 55 111 54 108 C53.5 99 53.8 90 54.5 82 Z"/>`)],
  ["glutes", mirror(widen(0.951, 2.91, `<path d="M59.3 116 C59.3 128 57 136 50 137 C43 137 39 131 39 124 C39.5 117 44 113 50 113 C54 113 57.5 114 59.3 116 Z"/>`))],
  ["hamstrings", mirror(widen(1.067, -3.7, `<path d="M41.5 140 C40.5 152 42 164 45.5 172 C47.5 175 50 175 51.5 172 C54.5 162 55.5 150 55 141 C52 139.5 45 139 41.5 140 Z"/><path class="mm-cut" d="M48.5 142 C48.2 152 48.4 162 48.8 171"/>`))],
  ["calves", mirror(`<path d="M43 184 C41 191 41.5 200 44 208 C45.5 211 47.5 211 48 207 C48.5 200 48.5 192 47.5 185 C46.5 182 44 182 43 184 Z"/><path d="M49.5 185 C49 193 49.5 201 50.5 207 C51.5 211 53.5 210 54.5 206 C55.5 199 55 191 53 185 C52 182.5 50 182.5 49.5 185 Z"/>`)],
];
// Two or three lifts per muscle that the app doesn't have, shown under its own lifts and tagged
// "Not in app". Any that later join the app drop off this list on their own.
const MUSCLE_IDEAS = {
  quads: ["Front Squat", "Leg Press", "Leg Extension"],
  glutes: ["Step-Up", "Cable Pull-Through", "Cable Kickback"],
  hamstrings: ["Nordic Curl", "Lying Leg Curl", "Good Morning"],
  adductors: ["Cossack Squat", "Sumo Squat", "Adductor Machine"],
  lowerBack: ["Good Morning", "Reverse Hyper", "Superman Hold"],
  calves: ["Single-Leg Calf Raise", "Donkey Calf Raise", "Jump Rope"],
  chest: ["Dumbbell Bench Press", "Dips", "Pec Deck"],
  frontDelts: ["Overhead Press", "Arnold Press", "Front Raise"],
  sideDelts: ["Cable Lateral Raise", "Machine Lateral Raise", "Lean-Away Lateral Raise"],
  triceps: ["Overhead Triceps Extension", "Close-Grip Bench Press", "Dips"],
  upperBack: ["Chest-Supported Row", "Seated Cable Row", "Shrugs"],
  lats: ["Pull-Up", "Single-Arm Dumbbell Row", "Straight-Arm Pulldown"],
  rearDelts: ["Rear Delt Row", "Y-Raise", "Prone T-Raise"],
  biceps: ["Chin-Up", "Incline Dumbbell Curl", "Preacher Curl"],
  forearms: ["Wrist Curl", "Reverse Curl", "Plate Pinch"],
  abs: ["Hanging Knee Raise", "Ab Wheel Rollout", "Cable Crunch"],
  obliques: ["Suitcase Carry", "Cable Woodchop", "Hanging Oblique Raise"],
};
function muscleIdeas(k){
  const have = new Set([...Object.keys(LIFT_MUSCLES), ...Object.keys(data), ...(typeof libraryNames === "function" ? libraryNames() : [])]);
  return (MUSCLE_IDEAS[k] || []).filter(n => !have.has(n)).slice(0, 3);
}
function muscleClass(w, k){ return muscleMode === "recovery" ? "mm-" + muscleRecovery(w, k).state : "mm-b" + muscleBand(w.sets[k]); }
function muscleFigure(w, side, shapes){
  return `<figure class="mm-fig"><svg viewBox="0 0 120 248" role="img" aria-label="${side} of the body">
    ${BODY_SHAPES}<g class="mm-detail-line">${side === "Front" ? FRONT_DETAIL : BACK_DETAIL}</g>
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
    const k = musclePick, n = w.sets[k], r = muscleRecovery(w, k), ideas = muscleIdeas(k);
    const pct = v => Math.min(v / 25, 1) * 100;
    html += `<div class="mm-detail">
      <button type="button" class="mm-detail-head" onclick="pickMuscle('${k}')" aria-label="Close ${MUSCLE_NAME[k]}"><h4>${MUSCLE_NAME[k]}</h4><span>${rec ? r.when : MUSCLE_BAND_WORDS[muscleBand(n)]}</span></button>
      <div class="mm-big"><b>${fmtSets(n)}</b> sets in 7 days</div>
      <div class="mm-bar"><span class="mm-band" style="left:${pct(MUSCLE_TARGET[0])}%;width:${pct(MUSCLE_TARGET[1]) - pct(MUSCLE_TARGET[0])}%"></span><span class="mm-fill ${muscleClass(w, k)}" style="width:${pct(n)}%"></span>
        <i style="left:${pct(MUSCLE_TARGET[0])}%">${MUSCLE_TARGET[0]}</i><i style="left:${pct(MUSCLE_TARGET[1])}%">${MUSCLE_TARGET[1]}</i></div>
      ${w.lifts[k].map(([lift, s]) => `<div class="mm-lift"><span>${escapeHtml(lift)}</span><b>${fmtSets(s)}</b></div>`).join("")}
      <p class="mm-foot">${n ? (w.recent[k] ? `${fmtSets(w.recent[k])} sets in the last 2 days.` : "None in the last 2 days.") : zeroMuscleReason(k) || "No sets in 7 days."}</p>
      ${ideas.length ? `<p class="mm-ideas-head">Others that work it</p>${ideas.map(n => `<div class="mm-lift mm-idea"><span>${escapeHtml(n)}</span><i class="mm-tag">Not in app</i></div>`).join("")}` : ""}
    </div>`;
  } else {
    html += muscleNotes(w, muscleMode).map(([lead, text]) => `<p class="mm-note"><b>${lead}</b>${text ? " " + text : ""}</p>`).join("");
  }
  html += `<div class="mm-list">${MUSCLES.map(([k, name]) => `<button type="button" class="${musclePick === k ? "on" : ""}" aria-pressed="${musclePick === k}" onclick="pickMuscle('${k}')"><i class="mm-sw ${muscleClass(w, k)}"></i><span>${name}</span><b>${rec ? muscleRecovery(w, k).short : fmtSets(w.sets[k])}</b></button>`).join("")}</div>
    <p class="range-note mm-key">Tap a muscle for its lifts. Helpers count half a set.</p></div>`;
  return html;
}
