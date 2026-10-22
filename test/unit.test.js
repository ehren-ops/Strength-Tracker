// Unit tests for the progression math and helpers: the app's scripts loaded straight into Node with
// a stubbed browser, so each rule is checked in milliseconds without starting Chromium.
// Run: node unit.test.js (also part of npm test, before the Playwright suite).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// A stand-in for any DOM object: every property and call returns another stand-in.
function anything(){
  const fn = function(){};
  return new Proxy(fn, {
    get: (t, k) => k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : anything(),
    set: () => true,
    apply: () => anything(),
  });
}
function loadApp(){
  const store = new Map();
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const ctx = { console, Date, Math, JSON, Intl, setTimeout, clearTimeout, setInterval, clearInterval, URL, crypto: require("crypto").webcrypto };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.localStorage = localStorage;
  ctx.document = anything();
  ctx.navigator = { onLine: true, userAgent: "node" };
  ctx.location = { search: "", hash: "" };
  ctx.addEventListener = () => {};
  ctx.matchMedia = () => ({ matches: false, addEventListener(){} });
  ctx.requestAnimationFrame = f => setTimeout(f, 0);
  ctx.supabase = { createClient: () => anything() };
  vm.createContext(ctx);
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const files = [...html.matchAll(/<script src="(js\/[^"?]+)/g)].map(m => m[1]).filter(f => !/init\.js$/.test(f));
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f }));
  return ctx;
}

const app = loadApp();
const run = code => vm.runInContext(code, app);
let passed = 0;
const failures = [];
function test(name, fn){
  try{ fn(); passed++; }
  catch(e){ failures.push(`${name}: ${e.message}`); }
}
function eq(actual, expected, what){
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if(a !== b) throw new Error(`${what || "value"}: expected ${b}, got ${a}`);
}
// Fresh state for each test: no modifiers, no rehab or deload records, an empty log. Main lifts plan
// a volume day so the result never depends on the weekday (Classic runs heavy on the week's first
// session); the heavy-day tests put the real rule back with heavyDays().
run(`var __plannedHeavy = plannedHeavy;`);
function reset(){
  run(`data = {}; MODE_DEFS.forEach(m => { modes[m.key] = false; }); shoulderRehab = {}; deloadDates = {}; skips = {}; plannedHeavy = () => false;`);
}
const heavyDays = () => run(`plannedHeavy = __plannedHeavy;`);
// A lift with sessions [daysAgo, weight, reps, extra fields] at 3 sets and RPE 7.
function lift(name, rows){
  run(`data[${JSON.stringify(name)}] = Object.assign(newExerciseShell(${JSON.stringify(name)}), { entries: ${JSON.stringify(rows)}.map((r, i) => Object.assign({ clientId: "u" + i, date: shiftISO(todayISO(), -r[0]), weight: r[1], sets: 3, reps: r[2], difficulty: 7 }, r[3] || {})) });`);
}
const suggest = name => run(`computeSuggestion(data[${JSON.stringify(name)}], ${JSON.stringify(name)})`);

test("barbell lift adds weight after hitting its reps", () => {
  reset(); lift("Squat", [[7, 175, 8], [3, 175, 8]]);
  eq(suggest("Squat").weight, 180, "squat");
});
test("a missed session holds the weight", () => {
  reset(); lift("Squat", [[7, 175, 8], [3, 175, 6]]);
  eq(suggest("Squat").weight, 175, "squat");
});
test("three straight misses drop about 15%", () => {
  reset(); lift("Squat", [[9, 175, 6], [6, 175, 6], [3, 175, 6]]);
  const s = suggest("Squat");
  eq([s.weight, s.deload], [150, true], "squat");
});
test("rep range: inside the range, two more reps at RPE 7, one at RPE 8, none at 9", () => {
  reset(); lift("Cable Chest Fly", [[3, 50, 12]]);
  const s = suggest("Cable Chest Fly");
  eq([s.weight, s.reps, s.readyToProgress], [50, 14, false], "fly at RPE 7");
  lift("Cable Chest Fly", [[3, 50, 12, { difficulty: 8 }]]);
  eq(suggest("Cable Chest Fly").reps, 13, "RPE 8");
  lift("Cable Chest Fly", [[3, 50, 12, { difficulty: 9 }]]);
  eq(suggest("Cable Chest Fly").reps, 12, "RPE 9");
});
test("rep range: the middle of the range at RPE 7 or easier adds weight (twice in a row when conservative)", () => {
  reset(); lift("Cable Chest Fly", [[3, 50, 13]]);
  const s = suggest("Cable Chest Fly");
  eq([s.weight, s.reps, s.readyToProgress, s.rangeEarly], [55, 10, true, true], "fly");
  lift("Cable Chest Fly", [[3, 50, 13, { difficulty: 8 }]]);
  eq(suggest("Cable Chest Fly").weight, 50, "not at RPE 8");
  lift("Cable Chest Fly", [[3, 50, 13]]); run(`data["Cable Chest Fly"].conservative = true;`);
  eq(suggest("Cable Chest Fly").weight, 50, "conservative wants two");
  lift("Cable Chest Fly", [[6, 50, 13], [3, 50, 14]]); run(`data["Cable Chest Fly"].conservative = true;`);
  eq(suggest("Cable Chest Fly").weight, 55, "conservative after two");
});
test("rep range: well under the bottom refits the weight instead of doubling the reps", () => {
  reset(); lift("Cable Chest Fly", [[3, 60, 5]]);
  const s = suggest("Cable Chest Fly");
  eq([s.weight, s.reps, !!s.refit], [52.5, 10, true], "fly");
  lift("Cable Chest Fly", [[3, 60, 5, { repsBySet: [5, 8, 8] }]]);
  eq([suggest("Cable Chest Fly").weight, !!suggest("Cable Chest Fly").refit], [60, false], "one short set in 5/8/8 is not a 5-rep session");
});
test("notes: grip and heavy never hold a lift that hit its reps; pain words do unless negated", () => {
  reset(); lift("Squat", [[3, 180, 8, { note: "Staggered grip, heavy but good" }]]);
  eq(suggest("Squat").weight, 185, "grip and heavy");
  lift("Squat", [[3, 180, 8, { note: "no pain at all" }]]);
  eq(suggest("Squat").weight, 185, "no pain");
  lift("Squat", [[3, 180, 8, { note: "shoulder less tender" }]]);
  eq(suggest("Squat").weight, 185, "less tender");
  lift("Squat", [[3, 180, 8, { note: "knee a bit sore" }]]);
  eq(suggest("Squat").weight, 180, "sore holds");
});
test("Knee Care trims about 10% once, then holds instead of dropping every session", () => {
  reset(); run(`modes.knee = true;`);
  lift("Bulgarian Split Squat", [[9, 50, 8]]);
  eq(suggest("Bulgarian Split Squat").weight, 45, "first trim");
  lift("Bulgarian Split Squat", [[9, 50, 8], [5, 45, 8], [2, 45, 8]]);
  eq(suggest("Bulgarian Split Squat").weight, 45, "holds after the trim");
});
test("a Deload Week session done heavier than the regular one counts", () => {
  reset(); lift("Standing Calf Raise", [[9, 0, 22], [2, 35, 20, { deload: true, sets: 2, note: "Deload" }]]);
  const s = suggest("Standing Calf Raise");
  eq([s.weight, s.sets, s.reps], [40, 3, 12], "calf");
});
test("Shoulder Rehab: the first session starts at 85%, then the load follows the log and two clean sessions add 5 lb", () => {
  reset(); run(`modes.shoulder = true; shoulderRehab = { startedOn: shiftISO(todayISO(), -8), endedOn: null, phase3: false };`);
  lift("Bench Press", [[12, 170, 8]]);
  let s = suggest("Bench Press");
  eq([s.weight, !!s.shoulderHold.first], [145, true], "first session");
  lift("Bench Press", [[12, 170, 8], [6, 155, 8]]);
  s = suggest("Bench Press");
  eq([s.weight, s.shoulderHold.streak], [155, 1], "never below a weight that is holding");
  lift("Bench Press", [[12, 170, 8], [6, 155, 8], [3, 155, 8]]);
  s = suggest("Bench Press");
  eq([s.weight, s.reps, s.readyToProgress], [160, 8, true], "two clean sessions add 5 lb");
  lift("Bench Press", [[12, 170, 8], [6, 170, 8], [3, 170, 8]]);
  s = suggest("Bench Press");
  eq([s.weight, s.shoulderHold.atFull], [170, true], "never above the pre-rehab weight");
  lift("Bench Press", [[12, 170, 8], [6, 155, 8], [3, 155, 8, { difficulty: 9 }]]);
  eq(suggest("Bench Press").weight, 155, "an RPE 9 session is not clean");
});
test("rep range: top of the range adds weight and resets reps", () => {
  reset(); lift("Cable Chest Fly", [[3, 50, 15]]);
  const s = suggest("Cable Chest Fly");
  eq([s.weight, s.reps, s.readyToProgress], [55, 10, true], "fly");
});
test("rep range: below the bottom holds and rebuilds", () => {
  reset(); lift("Cable Chest Fly", [[3, 50, 9]]);
  eq([suggest("Cable Chest Fly").weight, suggest("Cable Chest Fly").reps], [50, 10], "fly");
});
test("preseason rep target overrides a rep range", () => {
  reset(); run(`modes.preseason = true;`);
  eq(run(`activeRepRange(Object.assign(newExerciseShell("Cable Chest Fly"), { targetRepsPreseason: 6 }))`), null, "range");
});
test("joint check: pain 4-5 holds the load, 6+ drops about 10%", () => {
  reset(); lift("Squat", [[7, 175, 8], [3, 180, 8, { pain: 5, painArea: "knee" }]]);
  let s = suggest("Squat");
  eq([s.weight, !!s.painHold, s.painHold.drop], [180, true, false], "pain 5");
  run(`data["Squat"].entries[1].pain = 7;`);
  s = suggest("Squat");
  eq([s.weight, s.painHold.drop], [162.5, true], "pain 7");
});
test("joint check: 3 or less changes nothing", () => {
  reset(); lift("Squat", [[7, 175, 8], [3, 175, 8, { pain: 3 }]]);
  eq([suggest("Squat").weight, !!suggest("Squat").painHold], [180, false], "pain 3");
});
test("deload week: about 10% lighter and a third fewer sets", () => {
  reset(); lift("Squat", [[3, 180, 8]]); run(`modes.deload = true;`);
  const s = suggest("Squat");
  eq([s.weight, s.sets, s.deloadWeek], [162.5, 2, true], "deload");
});
test("first session after a deload: pressing repeats its weight", () => {
  reset(); lift("Bench Press", [[9, 170, 8], [2, 152.5, 8, { deload: true }]]);
  const s = suggest("Bench Press");
  eq([s.weight, !!s.postDeloadHold], [170, true], "bench");
});
test("after 14+ days off, lifts restart near 90%", () => {
  reset(); lift("Hip Thrust", [[27, 170, 8], [20, 180, 8]]);
  const s = suggest("Hip Thrust");
  eq([s.weight, s.reentry && s.reentry.step], [162.5, 1], "hip thrust");
});
test("shoulder rehab holds Barbell Row at 85% of its pre-rehab weight", () => {
  reset(); lift("Barbell Row", [[14, 135, 8], [9, 135, 8]]);
  run(`modes.shoulder = true; shoulderRehab = { startedOn: shiftISO(todayISO(), -2), endedOn: null, phase3: false };`);
  const s = suggest("Barbell Row");
  eq([s.weight, !!s.shoulderHold], [115, true], "row");
});
test("shoulder rehab pauses the fly", () => {
  reset(); lift("Cable Chest Fly", [[5, 50, 12]]);
  run(`modes.shoulder = true; shoulderRehab = { startedOn: shiftISO(todayISO(), -2), endedOn: null };`);
  eq(!!suggest("Cable Chest Fly").shoulderPaused, true, "paused");
});
test("PRs: heavier than ever, or more reps at the top weight; never more reps at a lighter weight", () => {
  reset(); lift("Cable Chest Fly", [[20, 50, 12], [15, 55, 10], [12, 50, 15], [10, 55, 11], [5, 55, 11], [3, 60, 14, { deload: true }], [0, 60, 8]]);
  eq(run(`prFlags(data["Cable Chest Fly"])`), [false, "weight", false, "reps", false, false, "weight"], "flags");
  eq(run(`prText(data["Cable Chest Fly"].entries[3], data["Cable Chest Fly"], "reps")`), "Most reps at 55 lb: 11", "reps text");
  eq(run(`prText(data["Cable Chest Fly"].entries[6], data["Cable Chest Fly"], "weight")`), "Heaviest yet: 60 lb x 8", "weight text");
  eq(run(`repRecord(data["Cable Chest Fly"], 50).reps`), 15, "record at 50");
  eq(run(`repRecord(data["Cable Chest Fly"], 55).weight`), 55, "record at 55");
});
test("Next tile change in words: heavier, lighter, more reps, longer holds, same", () => {
  reset(); lift("Back Extension", [[7, 25, 10]]); lift("Dead Hang", [[7, 0, 40]]);
  const be = `data["Back Extension"]`, dh = `data["Dead Hang"]`;
  eq(run(`stepText(${be}, { weight: 25, reps: 11 }, ${be}.entries[0])`), "same weight, 1 more rep", "rep");
  eq(run(`stepText(${be}, { weight: 30, reps: 10 }, ${be}.entries[0])`), "5 lb heavier", "heavier");
  eq(run(`stepText(${be}, { weight: 20, reps: 10 }, ${be}.entries[0])`), "5 lb lighter", "lighter");
  eq(run(`stepText(${be}, { weight: 25, reps: 10 }, ${be}.entries[0])`), "same weight", "same");
  eq(run(`stepText(${dh}, { reps: 45 }, ${dh}.entries[0])`), "5 sec longer", "hold");
});
test("hold timer: count-in, each side, rest between sets, none after the last", () => {
  reset();
  const steps = run(`holdSteps(2, 30, 45, ["Left side", "Right side"]).map(s => s.kind + s.secs + (s.side ? s.side[0] : ""))`);
  eq(steps, ["ready5L", "hold30L", "ready5R", "hold30R", "rest40", "ready5L", "hold30L", "ready5R", "hold30R"], "steps");
  eq(run(`[isHoldLift(EXERCISE_DEFAULTS["Dead Hang"]), isHoldLift(EXERCISE_DEFAULTS["Back Extension"])]`), [true, false], "which lifts");
});
test("reps per set: logs the lowest set and keeps the list only when sets differ", () => {
  eq(run(`applyPerSet({}, [8, 8, 6])`), { sets: 3, reps: 6, repsBySet: [8, 8, 6] }, "uneven");
  eq(run(`applyPerSet({}, [8, 8, 8])`), { sets: 3, reps: 8 }, "even");
});
test("trend line for the coach is one short sentence", () => {
  const t = { pattern: "squat", e1rmChange4WeeksPct: 3.2, sessionsAtCurrentLoad: 3, rpeAtCurrentLoad: [7, 7, 8], sessionsLast4Weeks: 6 };
  eq(run(`trendText(${JSON.stringify(t)})`), "squat; e1RM +3.2% in 4 wk; 3 sessions at this load, RPE 7 7 8; 6 sessions in 4 wk", "trend");
});
test("day lists: about 7 lifts each, Back Extension on Full and Upper, Lat Pulldown on Full", () => {
  reset();
  eq(run(`activeDayOrder("full")`), ["Squat", "Bench Press", "RDL", "Barbell Row", "Cable Lat Pulldown", "Face Pulls", "Back Extension"], "full");
  eq(run(`activeDayOrder("upper")`), ["Bench Press", "Barbell Row", "Incline DB Press", "Push-Ups", "Face Pulls", "Bicep Curl", "Tricep Pushdown", "Back Extension"], "upper");
  eq(run(`[activeDayOrder("lower").includes("Lateral Lunge"), extraList("strength").includes("Cable Chest Fly"), finishersFor("full"), finishersFor("upper"), finishersFor("lower")]`), [true, true, ["Pallof Press", "Farmer's Carry"], ["Dead Hang"], ["Side Plank"]], "Lateral Lunge year-round on Lower, fly on Extra, finishers");
});
test("ski phases are exclusive and preseason adds its week-3 lifts in week 3", () => {
  reset(); run(`skiPhase = {}; setSkiPhase("preseason");`);
  eq(run(`[modes.preseason, modes.ski, preseasonWeek(), activeDayOrder("lower").includes("Trap Bar Jump")]`), [true, false, 1, false], "week 1");
  run(`skiPhase.startedOn = shiftISO(todayISO(), -14);`);
  eq(run(`[preseasonWeek(), activeDayOrder("lower").includes("Trap Bar Jump")]`), [3, true], "week 3");
  run(`setSkiPhase("season");`);
  eq(run(`[modes.preseason, modes.ski]`), [false, true], "in season");
  eq(run(`[getDisplayOrder("lower")[0], activeDayOrder("lower").filter(n => PRESEASON_ONLY.has(n))]`), ["Box Jumps", ["Lateral Lunge", "Box Jumps"]], "box jumps stay in season, first");
  eq(run(`finishersFor("lower")`), ["Side Plank", "Wall Sit"], "wall sit on Lower with Ski on");
});
test("cardio: any two of time, distance and pace give the third (bike and rower)", () => {
  eq(run(`solveCardio(30, 6, null, false)`), { minutes: 30, distance: 6, speed: 12 }, "bike speed");
  eq(run(`solveCardio(30, null, 12, false)`), { minutes: 30, distance: 6, speed: 12 }, "bike distance");
  eq(run(`solveCardio(null, 6, 12, false)`), { minutes: 30, distance: 6, speed: 12 }, "bike minutes");
  eq(run(`solveCardio(20, 5000, null, true)`), { minutes: 20, distance: 5000, speed: 120 }, "row split");
  eq(run(`solveCardio(20, null, 120, true)`), { minutes: 20, distance: 5000, speed: 120 }, "row meters");
  eq(run(`solveCardio(null, 5000, 120, true)`), { minutes: 20, distance: 5000, speed: 120 }, "row minutes");
});
test("rower split reads 2:05, 2:05.3, 2.05 and seconds; watts follow Concept2", () => {
  eq(run(`[parseSplit("2:05"), parseSplit("2:05.3"), parseSplit("2.05"), parseSplit("125"), parseSplit("x")]`), [125, 125.3, 125, 125, null], "parse");
  eq(run(`[fmtSplit(125), fmtSplit(125.3), fmtSplit(119.96)]`), ["2:05", "2:05.3", "2:00"], "format");
  eq(run(`rowWatts(120)`), 203, "watts at 2:00");
});
test("Full Body 2+1: A/B/C lists, year-round lateral work on B, and the A, B, optional C rotation", () => {
  reset(); run(`program = { key: "fullbody", startedOn: todayISO() };`);
  eq(run(`activeDayOrder("a")`), ["Squat", "Bench Press", "RDL", "Barbell Row", "Bulgarian Split Squat", "Face Pulls", "Back Extension", "Standing Calf Raise"], "A");
  eq(run(`activeDayOrder("b")`), ["RDL", "Squat", "Incline DB Press", "Cable Lat Pulldown", "Lateral Lunge", "Hip Thrust", "Back Extension", "Seated Calf Raise"], "B");
  eq(run(`activeDayOrder("c")`), ["Kettlebell Swings", "Walking Lunge", "Push-Ups", "Face Pulls", "Bicep Curl", "Tricep Pushdown"], "C");
  const monday = run(`weekStartISO(todayISO())`);
  lift("Squat", [[0, 175, 8]]); run(`data["Squat"].entries[0].date = shiftISO(todayISO(), -1); data["Bench Press"] = Object.assign(newExerciseShell("Bench Press"), { entries: [{ clientId: "x", date: shiftISO(todayISO(), -1), weight: 150, sets: 3, reps: 8 }] });`);
  eq(run(`nextProgramDay()`), "b", "after A comes B");
  run(`data = { RDL: Object.assign(newExerciseShell("RDL"), { entries: [{ clientId: "r", date: todayISO() === weekStartISO(todayISO()) ? shiftISO(todayISO(), -7) : shiftISO(todayISO(), -1), weight: 225, sets: 3, reps: 8 }] }), "Incline DB Press": Object.assign(newExerciseShell("Incline DB Press"), { entries: [{ clientId: "i", date: todayISO() === weekStartISO(todayISO()) ? shiftISO(todayISO(), -7) : shiftISO(todayISO(), -1), weight: 60, sets: 3, reps: 8 }] }) };`);
  eq(run(`nextProgramDay()`), run(`todayISO()`) === monday ? "a" : "c", "after B: C the same week, else A");
  run(`program = { key: "classic" };`);
});
// Heavy and volume tests run on a fixed Thursday (2026-10-15; the week starts Monday the 12th).
function onDay(iso, fn){
  run(`__today = todayISO; todayISO = () => "${iso}";`);
  try{ return fn(); } finally { run(`todayISO = __today;`); }
}
const at = (date, weight, reps, extra) => Object.assign({ clientId: "h" + date + weight, date, weight, sets: 3, reps, difficulty: 7 }, extra || {});
test("Classic: main lifts heavy (4x5) first in the week, volume (3x8) after, each on its own track", () => {
  reset(); run(`program = { key: "classic" }; view = "full";`); heavyDays();
  lift("Squat", []); run(`data["Squat"].entries = ${JSON.stringify([at("2026-10-01", 175, 8), at("2026-10-06", 180, 8)])};`);
  let s = onDay("2026-10-15", () => suggest("Squat"));
  eq([s.heavy, s.weight, s.sets, s.reps, !!s.trackStart], [true, 185, 4, 5, true], "first heavy day: worked out from 180x8");
  run(`data["Squat"].entries.push(${JSON.stringify(at("2026-10-13", 185, 5, { sets: 4, heavy: true }))});`);
  s = onDay("2026-10-15", () => suggest("Squat"));
  eq([s.heavy, s.weight, s.sets, s.reps, !!s.trackStart], [false, 185, 3, 8, false], "second session that week: volume, +5 from the last volume day");
  s = onDay("2026-10-19", () => suggest("Squat"));
  eq([s.heavy, s.weight, s.sets, s.reps], [true, 190, 4, 5], "next week: heavy, +5 from the last heavy day");
  eq(run(`data["Squat"].entries.map(e => entryTargetReps(data["Squat"], e))`), [8, 8, 5], "history judged by its own reps");
  run(`modes.deload = true;`);
  s = onDay("2026-10-19", () => suggest("Squat"));
  eq([s.weight, s.sets, s.reps, s.deloadWeek], [167.5, 3, 5, true], "deload heavy day: 10% under the last heavy, fewer sets");
  run(`modes.deload = false; modes.preseason = true;`);
  eq(onDay("2026-10-19", () => suggest("Squat").heavy), false, "never heavy while a preseason target sets the reps");
  run(`modes.preseason = false;`);
});
test("Full Body 2+1: heavy by day (Squat, Bench, Row on A; RDL on B); v107 entries count as heavy", () => {
  reset(); run(`program = { key: "fullbody", startedOn: "2026-10-10", history: [{ key: "fullbody", startedOn: "2026-10-10" }] };`); heavyDays();
  lift("Squat", [[30, 180, 8]]); lift("RDL", [[30, 225, 8]]); lift("Bench Press", [[30, 150, 8]]);
  const heavyOn = day => onDay("2026-10-15", () => run(`view = "${day}"; ["Squat", "RDL", "Bench Press"].map(n => computeSuggestion(data[n], n).heavy)`));
  eq(heavyOn("a"), [true, false, true], "Day A");
  eq(heavyOn("b"), [false, true, true], "Day B (bench stays heavy; it only runs on A)");
  run(`modes.shoulder = true; shoulderRehab = { startedOn: "2026-10-14", endedOn: null };`);
  eq(heavyOn("a")[2], false, "never heavy while Shoulder Rehab holds the lift");
  run(`modes.shoulder = false; shoulderRehab = {}; data["Squat"].entries.push(${JSON.stringify(at("2026-10-11", 185, 5, { sets: 4 }))});`);
  eq(run(`isHeavyEntry(data["Squat"], data["Squat"].entries[1])`), true, "a v107 Full Body 2+1 entry with no flag is heavy");
  run(`program = { key: "classic" }; view = "full";`);
});
test("rest: main lifts start at 90 sec and step to 2 then 3 min; accessories keep their range", () => {
  reset(); lift("Squat", [[3, 180, 8]]); lift("Cable Chest Fly", [[3, 50, 12]]);
  eq([run(`restTimeFor(data["Squat"])`), run(`restTimerChoicesFor("Squat")`), run(`restTimeFor(data["Cable Chest Fly"])`)], ["90 sec–3 min", [120, 180], "90 sec"], "rest");
});
test("modifier registry rows are complete", () => {
  const bad = run(`MODE_DEFS.filter(m => !m.key || !m.storageKey || !m.name || !m.tag || !["light", "block"].includes(m.tag.kind) || typeof m.applies !== "function").map(m => m.key)`);
  eq(bad, [], "incomplete rows");
});

test("muscle map: main muscles get full sets, helpers half, and recent work sets recovery", () => {
  reset();
  lift("Squat", [[1, 185, 5], [3, 180, 5], [9, 175, 5]]);
  lift("Bench Press", [[0, 155, 8]]);
  run(`data["Bench Press"].entries[0].sets = 6;`);
  const w = run(`(() => { const w = muscleWeek(); return { quads: w.sets.quads, glutes: w.sets.glutes, chest: w.sets.chest, triceps: w.sets.triceps, total: w.total, sessions: w.sessions, quadsFrom: w.lifts.quads, rec: ["chest", "quads", "triceps", "hamstrings"].map(k => muscleRecovery(w, k).state) }; })()`);
  eq(w, { quads: 6, glutes: 3, chest: 6, triceps: 3, total: 12, sessions: 3, quadsFrom: [["Squat", 6]], rec: ["hard", "recovering", "recovering", "ready"] }, "muscle week");
});

test("plates: Hip Thrust is a plate-loaded machine with no bar; barbell lifts keep the 45 lb bar", () => {
  eq(run(`platesLabel(180, "barbell", barWeightFor("Hip Thrust"))`), "2×45 per side", "hip thrust");
  eq(run(`platesLabel(180, "barbell", barWeightFor("Squat"))`), "1×45 + 2×10 + 1×2.5 per side", "squat");
});
test("hit or miss: judged against the saved plan, or the previous session when there is none", () => {
  reset(); lift("Face Pulls", [[6, 110, 10, { sets: 2 }], [3, 130, 12, { sets: 2, plan: { sets: 2, reps: 12, weight: 110 } }]]);
  let v = run(`sessionVerdict(data["Face Pulls"], 1, 12)`);
  eq([v.under, v.missed], [false, false], "2x12 when 2x12 was planned");
  lift("Face Pulls", [[6, 110, 10, { sets: 2 }], [3, 130, 12, { sets: 2 }]]);
  v = run(`sessionVerdict(data["Face Pulls"], 1, 12)`);
  eq([v.under, v.missed], [false, false], "no plan: 2 sets after a 2-set session is not short");
  lift("Face Pulls", [[6, 110, 12], [3, 110, 12, { sets: 2 }]]);
  eq(run(`sessionVerdict(data["Face Pulls"], 1, 12).under`), true, "2 sets after 3 with no plan is short");
  run(`data["Dead Hang"] = Object.assign(newExerciseShell("Dead Hang"), { entries: [{ clientId: "d1", date: shiftISO(todayISO(), -6), sets: 3, reps: 15 }, { clientId: "d2", date: shiftISO(todayISO(), -1), sets: 3, reps: 17, plan: { sets: 3, reps: 17 } }] });`);
  eq(run(`sessionVerdict(data["Dead Hang"], 1, 45).missed`), false, "17 sec when 17 was planned");
});
test("lifting time: first lift logged to the last, leaving out cardio, mobility and recovery", () => {
  reset();
  const at = (h, m) => { const d = new Date(2026, 9, 19, h, m); return d.toISOString(); };
  run(`data = {
    "Squat": Object.assign(newExerciseShell("Squat"), { entries: [{ clientId: "s", date: "2026-10-19", weight: 195, sets: 3, reps: 5, loggedAt: ${JSON.stringify(at(18, 35))} }] }),
    "Farmer's Carry": Object.assign(newExerciseShell("Farmer's Carry"), { entries: [{ clientId: "f", date: "2026-10-19", weight: 60, sets: 3, reps: 40, loggedAt: ${JSON.stringify(at(19, 50))} }] }),
    "Incline Treadmill Walk": Object.assign(newExerciseShell("Incline Treadmill Walk"), { entries: [{ clientId: "t", date: "2026-10-19", minutes: 20, loggedAt: ${JSON.stringify(at(20, 15))} }] }),
    "Hip Stretch": Object.assign(newExerciseShell("Hip Stretch"), { entries: [{ clientId: "h", date: "2026-10-19", loggedAt: ${JSON.stringify(at(18, 10))} }] }) };`);
  eq([run(`liftMinutes("2026-10-19")`), run(`fmtLiftTime(liftMinutes("2026-10-19"))`)], [75, "1 h 15 min"], "Oct 19");
});

if(failures.length){
  console.error(`UNIT TESTS FAILED (${failures.length} of ${passed + failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`UNIT TESTS PASSED (${passed})`);
