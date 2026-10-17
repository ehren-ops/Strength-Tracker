// Exercise library: the "+" at the end of a day's pill row opens every strength exercise in the app,
// grouped by movement, with a search box. Picking one adds it to today's row as an unnumbered pill
// for today only; "Keep on this day" on its card makes it part of that day for good (synced in
// user_settings.settings.kept). Either way it never counts toward finishing the day. A custom
// exercise can still be added by name at the bottom.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

const LIBRARY_GROUPS = [
  ["squat", "Squat"], ["hinge", "Hinge"], ["single-leg", "Single leg"], ["push", "Push"], ["pull", "Pull"],
  ["core", "Core"], ["carry and grip", "Carry and grip"], ["power", "Power"], ["calves", "Calves"], ["other", "Other"],
];
const LIBRARY_EQUIPMENT = {
  "Squat": "Barbell", "Bench Press": "Barbell", "RDL": "Barbell", "Barbell Row": "Barbell", "Hip Thrust": "Barbell",
  "Incline DB Press": "Dumbbells", "Bicep Curl": "Dumbbells", "Lateral Raise": "Dumbbells", "Bulgarian Split Squat": "Dumbbells",
  "Walking Lunge": "Dumbbells", "Lateral Lunge": "Dumbbell", "Farmer's Carry": "Dumbbells",
  "Cable Chest Fly": "Cable", "Cable Lat Pulldown": "Cable", "Face Pulls": "Cable", "Tricep Pushdown": "Cable", "Pallof Press": "Cable or band",
  "Kettlebell Swings": "Kettlebell", "Back Extension": "Back extension bench", "Standing Calf Raise": "Machine", "Seated Calf Raise": "Machine",
  "Box Jumps": "Box", "Trap Bar Jump": "Trap bar", "Med Ball Slam": "Med ball", "Dead Hang": "Pull-up bar", "Spanish Squat": "Band",
  "Copenhagen Plank": "Bench", "Push-Ups": "Bodyweight", "Skater Bound": "Bodyweight", "Side Plank": "Bodyweight",
  "Dead Bug": "Bodyweight", "Wall Sit": "Bodyweight",
};

// Today's picks, by day: kept on this phone only and cleared each new day.
const PICKS_KEY = "strength-tracker-day-picks", KEPT_KEY = "strength-tracker-kept-lifts";
let dayPicks = (function(){ try{ const p = JSON.parse(window.localStorage.getItem(PICKS_KEY)); return p && p.date ? p : { date: "", byDay: {} }; }catch(e){ return { date: "", byDay: {} }; } })();
let keptLifts = (function(){ try{ return JSON.parse(window.localStorage.getItem(KEPT_KEY)) || {}; }catch(e){ return {}; } })();
function savePicks(){ try{ window.localStorage.setItem(PICKS_KEY, JSON.stringify(dayPicks)); }catch(e){} }
function saveKept(){ try{ window.localStorage.setItem(KEPT_KEY, JSON.stringify(keptLifts)); }catch(e){} }
function todayPicks(){
  if(dayPicks.date !== todayISO()){ dayPicks = { date: todayISO(), byDay: {} }; savePicks(); }
  return dayPicks.byDay;
}
// The lifts added to a day: kept ones first, then today's picks.
function addedLifts(day){
  return [...new Set([...(keptLifts[day] || []), ...(todayPicks()[day] || [])])];
}
function isKept(day, name){ return (keptLifts[day] || []).includes(name); }

// Every strength exercise: the program's days (both programs), finishers, Extra's strength work, the
// care bridges, and custom exercises. No cardio, routines or recovery.
function libraryNames(){
  const names = new Set([
    ...[...CLASSIC_DAYS, ...FULLBODY_DAYS].flatMap(d => DAY_ORDER[d]),
    ...Object.values(FINISHERS).flat(), ...Object.values(SKI_FINISHERS).flat(),
    ...DAY_ORDER.extra.filter(n => EXTRA_CATEGORY[n] === "strength" || EXTRA_CATEGORY[n] === "core"),
    ...KNEE_ONLY, PUSHUP_NAME, ...Object.keys(data),
  ]);
  return [...names].filter(n => {
    if(n === REHAB_NAME || n === MOBILITY_NAME || isRecovery(n) || isMobilityRoutine(n)) return false;
    const ex = data[n] || newExerciseShell(n);
    return ex.trackBy !== "duration" && ex.trackBy !== "checklist";
  });
}
function libraryMeta(name){
  const ex = data[name];
  const days = programDays().filter(d => DAY_ORDER[d].includes(name) || finishersFor(d).includes(name) || isKept(d, name)).map(d => DAY_TITLES[d]);
  if(!days.length && DAY_ORDER.extra.includes(name)) days.push("Extra");
  const last = ex && ex.entries.length ? ex.entries[ex.entries.length - 1].date : null;
  const lastText = !last ? "Not logged yet" : last === todayISO() ? "Done today" : `Last ${fmtShortDate(last)}`;
  return [LIBRARY_EQUIPMENT[name] || ((ex || {}).trackBy === "reps" ? "Bodyweight" : ""), days.join(", "), lastText].filter(Boolean).join(" · ");
}

function openLibrary(){
  let el = document.getElementById("library");
  if(!el){ el = document.createElement("div"); el.id = "library"; el.className = "library"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Exercise library"); document.body.appendChild(el); }
  const onRow = new Set(currentRowNames(view));
  const groups = {};
  libraryNames().forEach(n => { const g = LIFT_PATTERNS[n] || "other"; (groups[g] = groups[g] || []).push(n); });
  const sections = LIBRARY_GROUPS.filter(([k]) => groups[k]).map(([k, label]) => `<section class="lib-group"><h3 class="section">${label}</h3>${groups[k].sort((a, b) => a.localeCompare(b)).map(n =>
    `<button type="button" class="lib-row${onRow.has(n) ? " on-row" : ""}" data-name="${escapeHtml(n)}" onclick="pickLift(this.dataset.name)"><span class="lib-name">${escapeHtml(n)}</span><span class="lib-meta">${onRow.has(n) ? "On today's row · " : ""}${escapeHtml(libraryMeta(n))}</span></button>`).join("")}</section>`).join("");
  el.innerHTML = `<div class="lib-head"><h2 class="ex-name">Exercises</h2><button type="button" class="lib-close" onclick="closeLibrary()" aria-label="Close">✕</button></div>
    <input type="search" class="lib-search" placeholder="Search exercises" oninput="filterLibrary(this.value)" aria-label="Search exercises">
    <div class="lib-list">${sections}<p class="lib-empty" hidden>No match. Add it as a custom exercise below.</p></div>
    <div class="lib-custom"><input id="lib-new-name" placeholder="Custom exercise name"><button type="button" class="tool-btn" onclick="addCustomFromLibrary()">Add</button></div>`;
  el.hidden = false;
  document.body.classList.add("library-open");
}
function closeLibrary(){
  const el = document.getElementById("library");
  if(el) el.hidden = true;
  document.body.classList.remove("library-open");
}
// Filters in place, so the search box keeps its focus and the keyboard stays up.
function filterLibrary(q){
  const el = document.getElementById("library");
  const needle = q.trim().toLowerCase();
  let shown = 0;
  el.querySelectorAll(".lib-group").forEach(g => {
    let any = false;
    g.querySelectorAll(".lib-row").forEach(r => { const hit = !needle || r.dataset.name.toLowerCase().includes(needle); r.hidden = !hit; if(hit) any = true; });
    g.hidden = !any;
    if(any) shown++;
  });
  el.querySelector(".lib-empty").hidden = shown > 0;
  const custom = document.getElementById("lib-new-name");
  if(custom && !shown) custom.value = q.trim();
}
// What a day's row shows now, before any additions.
function currentRowNames(day){
  return [...activeDayOrder(day), ...finishersFor(day), ...addedLifts(day)];
}
function pickLift(name){
  const day = view;
  if(!currentRowNames(day).includes(name)){
    const picks = todayPicks();
    picks[day] = [...(picks[day] || []), name];
    savePicks();
  }
  selected = name;
  closeLibrary();
  render();
}
function keepLift(name){
  const day = view;
  keptLifts[day] = [...new Set([...(keptLifts[day] || []), name])];
  saveKept();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  render();
}
function removeAddedLift(name){
  const day = view, picks = todayPicks();
  picks[day] = (picks[day] || []).filter(n => n !== name);
  savePicks();
  if(isKept(day, name)){
    keptLifts[day] = keptLifts[day].filter(n => n !== name);
    if(!keptLifts[day].length) delete keptLifts[day];
    saveKept();
    enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  }
  if(selected === name) selected = activeDayOrder(day)[0];
  render();
}
function addCustomFromLibrary(){
  const input = document.getElementById("lib-new-name");
  const name = (input.value || "").trim();
  if(!name) return;
  if(data[name] || libraryNames().includes(name)){ pickLift(name); return; }
  data[name] = Object.assign(newExerciseShell(name), { day: view });
  selected = name;
  persist();
  enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name } });
  closeLibrary();
  render();
}
// The line on an added lift's card: today only (keep it, or take it off) or kept (take it off).
function addedLiftTip(name){
  if(!programDays().includes(view) || !addedLifts(view).includes(name)) return "";
  const q = escapeHtml(name).replace(/'/g, "\\'");
  return isKept(view, name)
    ? `<div class="added-tip"><b>Added</b> Kept on ${DAY_TITLES[view]}. <button type="button" class="date-edit-link" onclick="removeAddedLift('${q}')">Remove</button></div>`
    : `<div class="added-tip"><b>Added</b> Today only. <button type="button" class="date-edit-link" onclick="keepLift('${q}')">Keep on ${DAY_TITLES[view]}</button> · <button type="button" class="date-edit-link" onclick="removeAddedLift('${q}')">Remove</button></div>`;
}
