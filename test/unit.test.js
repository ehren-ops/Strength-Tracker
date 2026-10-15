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
// Fresh state for each test: no modifiers, no rehab or deload records, an empty log.
function reset(){
  run(`data = {}; MODE_DEFS.forEach(m => { modes[m.key] = false; }); shoulderRehab = {}; deloadDates = {}; skips = {};`);
}
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
test("rep range: inside the range aims for one more rep", () => {
  reset(); lift("Cable Chest Fly", [[3, 50, 12]]);
  const s = suggest("Cable Chest Fly");
  eq([s.weight, s.reps, s.readyToProgress], [50, 13, false], "fly");
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
  reset(); lift("Squat", [[27, 170, 8], [20, 180, 8]]);
  const s = suggest("Squat");
  eq([s.weight, s.reentry && s.reentry.step], [162.5, 1], "squat");
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
test("rep PRs: more reps at a weight or heavier; deloads and new weights never count", () => {
  reset(); lift("Cable Chest Fly", [[20, 50, 12], [15, 55, 10], [10, 50, 11], [5, 50, 13], [3, 45, 14, { deload: true }], [0, 50, 14]]);
  eq(run(`prFlags(data["Cable Chest Fly"])`), [false, false, false, true, false, true], "flags");
  eq(run(`repRecord(data["Cable Chest Fly"], 50).reps`), 14, "record at 50");
  eq(run(`repRecord(data["Cable Chest Fly"], 55).weight`), 55, "record at 55");
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
  eq(run(`activeDayOrder("upper")`), ["Bench Press", "Incline DB Press", "Cable Chest Fly", "Barbell Row", "Face Pulls", "Bicep Curl", "Tricep Pushdown", "Back Extension"], "upper");
});
test("ski phases are exclusive and preseason adds its week-3 lifts in week 3", () => {
  reset(); run(`skiPhase = {}; setSkiPhase("preseason");`);
  eq(run(`[modes.preseason, modes.ski, preseasonWeek(), activeDayOrder("lower").includes("Trap Bar Jump")]`), [true, false, 1, false], "week 1");
  run(`skiPhase.startedOn = shiftISO(todayISO(), -14);`);
  eq(run(`[preseasonWeek(), activeDayOrder("lower").includes("Trap Bar Jump")]`), [3, true], "week 3");
  run(`setSkiPhase("season");`);
  eq(run(`[modes.preseason, modes.ski]`), [false, true], "in season");
  eq(run(`[getDisplayOrder("lower")[0], activeDayOrder("lower").filter(n => PRESEASON_ONLY.has(n))]`), ["Box Jumps", ["Box Jumps"]], "box jumps stay in season, first");
});
test("modifier registry rows are complete", () => {
  const bad = run(`MODE_DEFS.filter(m => !m.key || !m.storageKey || !m.name || !m.tag || !["light", "block"].includes(m.tag.kind) || typeof m.applies !== "function").map(m => m.key)`);
  eq(bad, [], "incomplete rows");
});

if(failures.length){
  console.error(`UNIT TESTS FAILED (${failures.length} of ${passed + failures.length}):\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log(`UNIT TESTS PASSED (${passed})`);
