// The Next tile's words: which modifiers set today's numbers, the call, and the pool of short
// sentences (last session, trend, records, rules) that fill its two guidance lines. Shared global scope.

// Modifiers that change this lift's numbers for today (weight, sets or reps), by display name.
// Preseason only counts where it shifts the reps; elsewhere it adds notes, not numbers.
function planModifiers(name, ex){
  if(ex.trackBy === "duration" || ex.trackBy === "checklist") return [];
  return MODE_DEFS.filter(m => modes[m.key] && m.changesNumbers(name, ex)).map(m => m.name);
}

// The Next tile: always four rows at one fixed size on every lift, so the card never shifts.
// 1: weight, sets x reps, rest. 2-3: the call and a short read of recent notes. 4: the load.
// Once today is logged (noRest) the headline plans the next session in full and takes the whole row.
function renderNextTile(headline, ex, guidance, load, noRest){
  const rest = ex.trackBy !== "duration" && !noRest ? `<span class="rec-rest">Rest ${restTimeFor(ex)}</span>` : "";
  return `<div class="rec-box">
    <div class="rec-headline"><span class="rec-plan">${headline}</span>${rest}</div>
    <div class="rec-desc">${guidance}</div>
    <div class="rec-load${ex.equipment === "barbell" && /^Load /.test(load) ? " plate-line" : ""}">${load}</div>
  </div>`;
}
// Rows 2-3: the call first, then whole sentences from a pool, most useful first. The pool rides on
// the element and fitGuidance() keeps every sentence that still fits, so both lines are always full
// on any phone width and nothing is cut mid-sentence. The 105-character first pass is what a narrow
// phone fits; it only shows if the fit pass can't run.
let guidancePools = [];
function guidanceHtml(msg, pool){
  const id = guidancePools.push([msg, ...pool.filter(Boolean)]) - 1;
  const parts = [msg];
  pool.forEach(t => { if(t && parts.join(" ").length + t.length + 1 <= 105) parts.push(t); });
  return `<span data-gpool="${id}">${escapeHtml(parts.join(" "))}</span>`;
}
function composeGuidance(msg, name, ex, last, work, suggestion){
  return guidanceHtml(msg, [
    dueLine(name), trackLine(name, suggestion), lastSessionLine(ex, work), ...noteInsights(ex.entries), deloadSessionLine(ex, last), hrLine(name, last), ...trendLine(name, ex),
    repRecordLine(name, ex, suggestion), bestLine(ex, work), progressionRule(name, ex), effortLine(ex), daysSinceLine(last), LOG_TIMING_TIP, NOTE_TIP,
  ]);
}
function firstSessionGuidance(name, ex){
  const start = ex.trackBy === "duration" ? "Start easy and steady"
    : ex.unit === "sec" ? "Pick a hold you can finish every set with a little left"
    : ex.trackBy === "reps" ? "Pick reps you can finish every set with 2 to 3 left"
    : "Pick a load you can finish every set with 2 to 3 reps left";
  return guidanceHtml(`${start}; the app takes it from there.`,
    [progressionRule(name, ex), effortLine(ex), LOG_TIMING_TIP, NOTE_TIP]);
}
// Greedy fill: add each sentence in order, drop any that would push past two lines. A tile that
// changes width later (rotation, a scrollbar, the web font arriving) is refit by the observer.
const guidanceObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(list => list.forEach(r => { if(r.target.clientWidth !== r.target._fitW) (r.target._load ? fitLoad : fitOne)(r.target); }))
  : null;
function fitGuidance(){
  document.querySelectorAll(".rec-desc").forEach(box => {
    fitOne(box);
    if(guidanceObserver) guidanceObserver.observe(box);
  });
  document.querySelectorAll(".rec-load.plate-line").forEach(el => {
    el._load = el._load || el.textContent;
    fitLoad(el);
    if(guidanceObserver) guidanceObserver.observe(el);
  });
}
// The plate line stays on one line: each step tightens it only if it still doesn't fit
// ("45 + 2×10 + 2.5 a side" to "45+2×10+2.5/side", then without the leading "Load", then the bar
// note's last words only: "(machine)", "(trap bar)").
const LOAD_TIGHTEN = [s => s.replace(/ \+ /g, "+"), s => s.replace(" a side", "/side"), s => s.replace(/^Load /, ""),
  s => s.replace(/\((?:[^)]*, )?(?:\d+ lb )?([^)]*)\)$/, "($1)")];
function fitLoad(el){
  if(!el.clientWidth) return;
  el._fitW = el.clientWidth;
  let text = el._load;
  el.textContent = text;
  for(const step of LOAD_TIGHTEN){
    if(el.scrollWidth <= el.clientWidth) break;
    el.textContent = text = step(text);
  }
}
function fitOne(box){
  const span = box.querySelector("[data-gpool]");
  const pool = span && guidancePools[+span.dataset.gpool];
  if(!pool || !box.clientWidth) return;
  box._fitW = box.clientWidth;
  box.classList.add("fitting");
  const lh = parseFloat(getComputedStyle(box).lineHeight) || 16;
  const kept = [pool[0]];
  for(const t of pool.slice(1)){
    span.textContent = [...kept, t].join(" ");
    if(box.scrollHeight <= lh * 2 + 2) kept.push(t);
  }
  span.textContent = kept.join(" ");
  box.classList.remove("fitting");
}
const LOG_TIMING_TIP = "Log right after the last set for heart rate timing.";
const NOTE_TIP = "Note anything off; it steers the next session.";
// The best session on record, when it isn't the last one.
function bestLine(ex, last){
  const es = ex.entries;
  if(es.length < 2 || !last) return "";
  if(ex.trackBy === "duration"){
    const best = es.reduce((a, e) => (e.minutes || 0) > (a.minutes || 0) ? e : a, es[0]);
    return best !== last && best.minutes ? `Longest: ${best.minutes} min on ${fmtShortDate(best.date)}.` : "";
  }
  const loaded = ex.trackBy === "weight" && last.weight > 0;
  const score = e => loaded ? (e.weight > 0 ? e.weight * (1 + (e.reps || 0) / 30) : 0) : (e.reps || 0) * (e.sets || 1);
  const best = es.reduce((a, e) => score(e) > score(a) ? e : a, es[0]);
  if(best === last || score(best) <= score(last)) return "";
  const what = ex.trackBy === "weight" && best.weight > 0 ? `${best.weight} lb, ${repLabel(best.sets, best.reps, ex.unit)}` : repLabel(best.sets, best.reps, ex.unit);
  return `Best: ${what} on ${fmtShortDate(best.date)}.`;
}
// The Next tile call after a joint check above 3 of 10.
function painMessage(s, load){
  const p = s.painHold, where = p.area ? ` (${p.area})` : "";
  if(!load) return `Pain ${p.pain}/10${where} last time: same reps until it's 3 or less.`;
  return p.drop || s.weight < p.from ? `Pain ${p.pain}/10${where} last time: down to ${load}. Stop a set if it passes 3.`
    : `Pain ${p.pain}/10${where} last time: hold ${load} until it's 3 or less.`;
}
// Compound lifts keep Est. 1RM up top, so their rep record at today's weight rides in the tile.
function repRecordLine(name, ex, s){
  if(!s || ex.trackBy !== "weight" || !COMPOUND_LIFTS.has(name) || !(s.weight > 0) || s.deloadWeek) return "";
  const rec = repRecord(ex, s.weight);
  return rec ? `Most reps at ${rec.weight} lb: ${rec.reps}, ${fmtShortDate(rec.date)}.` : "";
}
// How this lift moves up, in one line.
// Main lifts: why today is the heavy or the volume day.
function trackLine(name, s){
  if(!s || s.heavy == null || s.deloadWeek || isLoggedToday(name)) return "";
  if(program.key === "fullbody" && HEAVY_DAY[name]){
    const other = FULLBODY_DAYS.find(d => d !== HEAVY_DAY[name] && DAY_ORDER[d].includes(name));
    return other ? `Heavy on Day ${HEAVY_DAY[name].toUpperCase()}, volume on Day ${other.toUpperCase()}.` : `Heavy every Day ${HEAVY_DAY[name].toUpperCase()}.`;
  }
  return s.heavy ? "First time this week, so heavy; the next one is volume." : "Second time this week, so volume; heavy again next week.";
}
function progressionRule(name, ex){
  const target = effectiveTargetReps(ex);
  if(ex.trackBy === "duration") return "Add time first; push the pace only once it feels easy.";
  if(ex.trackBy === "reps"){
    if(ex.preseasonPower) return "End a set the moment a rep slows; speed is the point.";
    return ex.unit === "sec" ? `Build every hold to ${target} sec, then make it harder.` : `Build every set to ${target} reps, then make it harder.`;
  }
  if(ex.preseasonPower) return "Light and fast; add weight only while every rep stays explosive.";
  const maxW = (EXERCISE_DEFAULTS[name] || {}).maxWeight;
  if(maxW) return `At ${maxW} lb, progress with reps, then single-arm.`;
  const inc = ex.increment || 5;
  const range = activeRepRange(ex);
  if(range) return `Add reps each session; add ${inc} lb at ${Math.ceil((range[0] + range[1]) / 2)} reps with some left, or ${range[1]}.`;
  return ex.unit === "sec" ? `Add ${inc} lb once every hold reaches ${target} sec.` : `Add ${inc} lb once every set reaches ${target} ${repsWord(name)}.`;
}
function effortLine(ex){
  if(ex.trackBy === "duration") return "Keep it conversational: RPE 6 to 7.";
  if(ex.preseasonPower) return "Rest fully; every rep should be crisp.";
  return ex.unit === "sec" ? "Aim for RPE 7 to 8: end each hold with a little left." : "Aim for RPE 7 to 8: two or three reps left.";
}
function daysSinceLine(last){
  if(!last) return "";
  const days = Math.round((Date.parse(todayISO()) - Date.parse(last.date)) / 86400000);
  return days > 1 ? `Last done ${days} days ago.` : "";
}
// How the lift has moved, as short separate sentences so they pack into a line's leftover room:
// e1RM over four weeks, sessions at this weight, or sessions this month.
function trendLine(name, ex){
  const t = typeof liftTrend === "function" ? liftTrend(name, ex, todayISO()) : null;
  const bits = [];
  if(t && t.e1rmChange4WeeksPct != null && t.e1rmChange4WeeksPct !== 0) bits.push(`Est. 1RM ${t.e1rmChange4WeeksPct > 0 ? "up" : "down"} ${Math.round(Math.abs(t.e1rmChange4WeeksPct))}% in 4 weeks`);
  if(t && t.sessionsAtCurrentLoad > 1 && ex.entries[ex.entries.length - 1].weight > 0) bits.push(`${t.sessionsAtCurrentLoad} sessions at this weight`);
  if(!bits.length){
    const since = shiftISO(todayISO(), -28);
    const n = ex.entries.filter(e => e.date >= since).length;
    if(n) bits.push(`${n} session${n > 1 ? "s" : ""} in the last 4 weeks`);
  }
  return bits.map(b => b + ".");
}
// Last session's heart rate on this lift, once Whoop has synced it.
function hrLine(name, last){
  const h = last && hrFor(name, last.date);
  return h ? `Heart rate last time: ${h.avg} avg, ${h.peak} peak.` : "";
}
function sessionWhat(ex, e){
  return ex.trackBy !== "weight" ? formatEntryValue(e, ex)
    : `${e.weight > 0 ? `${e.weight} lb` : "bodyweight"}, ${setsText(e, ex)}`;
}
// The last full session's numbers and RPE (a deload session is described on its own line).
function lastSessionLine(ex, work){
  if(!work) return "";
  const afterDeload = !work.deload && ex.entries[ex.entries.length - 1].deload;
  return `${afterDeload ? "Last full session" : "Last"}: ${sessionWhat(ex, work)}${work.difficulty ? ` at RPE ${work.difficulty}` : ""}.`;
}
// When the latest session was a Deload Week session, say so, so it never reads as a drop.
function deloadSessionLine(ex, last){
  return last && last.deload ? `Deload last time: ${sessionWhat(ex, last)}.` : "";
}
// Row 4: what to load. Plates for a barbell, per hand, the bell, bodyweight, or the cardio setting.
function loadText(name, ex, sug){
  if(ex.trackBy === "duration"){
    const last = ex.entries[ex.entries.length - 1];
    const parts = last ? [last.speed ? `${last.speed} mph` : "", last.incline ? `${last.incline}% incline` : ""].filter(Boolean) : [];
    return parts.length ? `Last setting: ${parts.join(" · ")}` : "Conversational pace";
  }
  if(ex.trackBy === "reps") return sug && sug.powerHold ? "Bodyweight: go higher or farther, not more reps" : "Bodyweight";
  if(!sug) return ex.equipment === "barbell" ? "Plates show after your first log" : sidesOf(name).weight === "hand" ? "Load is the weight in each hand" : "Load is the total weight";
  const w = sug.weight;
  if(!(w > 0)) return "Bodyweight";
  // The total first, then how it's made: "Load 180 lb = 45 + 2×10 + 2.5 a side" ("≈" when standard
  // plates can't make it exactly). fitLoad keeps it on one line.
  if(ex.equipment === "barbell"){
    // A bar that isn't the standard 45 lb Olympic bar says so: "(no bar, machine)", "(45 lb trap bar)".
    const bar = barWeightFor(name), note = (EXERCISE_DEFAULTS[name] || {}).barNote;
    const plates = platesLabel(w, ex.equipment, bar).replace("No plates needed", bar ? "the bar alone" : "no plates");
    return `Load ${w} lb ${calcPlates(w, bar).unreachable ? "≈" : "="} ${plates}${note ? ` (${note})` : ""}`;
  }
  const maxW = (EXERCISE_DEFAULTS[name] || {}).maxWeight;
  if(maxW) return `Load ${w} lb = one bell${w >= maxW ? " (heaviest available)" : ""}`;
  return sidesOf(name).weight === "hand" ? `Load ${w} lb in each hand` : `Load ${w} lb total`;
}

let lastDateShown = false;
function toggleLastDate(){ lastDateShown = !lastDateShown; render(); }

// A session in a few characters, for the "Last:" corner: 175 lb, 50 lb/hand, 3x10, 45 min.
function shortValue(name, ex, e){
  if(ex.trackBy === "weight") return `${e.weight} lb${sidesOf(name).weight === "hand" ? "/hand" : ""}`;
  if(ex.trackBy === "duration") return `${e.minutes} min`;
  return repLabel(e.sets, e.reps, ex.unit) + repsSuffix(name);
}
// The plan without the number already shown big: sets and reps for a lift, sets for a reps-only
// exercise, nothing for cardio.
function planShape(name, ex, s){
  if(ex.trackBy === "weight") return repLabel(s.sets, s.reps, ex.unit) + repsSuffix(name);
  if(ex.trackBy === "reps") return `${s.sets} sets`;
  return "";
}
// Today against the last full session, in words: "5 lb heavier", "1 more rep", "5 sec longer",
// "same weight". A lift held at the same weight with a rep change (a rep range) reads in reps.
function stepText(ex, s, prior){
  if(!s || !prior) return "";
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const round = v => Math.round(Math.abs(v) * 10) / 10;
  if(ex.trackBy === "duration"){
    const d = s.minutes - prior.minutes;
    return !isFinite(d) ? "" : d > 0 ? `${round(d)} min longer` : d < 0 ? `${round(d)} min shorter` : "same time";
  }
  const reps = d => ex.unit === "sec" ? (d > 0 ? `${round(d)} sec longer` : `${round(d)} sec shorter`)
    : d > 0 ? `${plural(round(d), "more rep", "more reps")}` : `${plural(round(d), "fewer rep", "fewer reps")}`;
  if(ex.trackBy === "weight" && prior.weight > 0){
    const d = s.weight - prior.weight;
    if(!isFinite(d)) return "";
    if(d > 0) return `${round(d)} lb heavier`;
    if(d < 0) return `${round(d)} lb lighter`;
    return s.reps != null && s.reps !== prior.reps ? `same weight, ${reps(s.reps - prior.reps)}` : "same weight";
  }
  const d = s.reps - prior.reps;
  return !isFinite(d) ? "" : d ? reps(d) : ex.unit === "sec" ? "same hold" : "same reps";
}

// Recovery tile, same shape as the Next tile: the last 7 days, the usual dose, the last session.
function renderRecoveryTile(name, ex){
  const since = shiftISO(todayISO(), -6);
  const week = ex.entries.filter(e => e.date >= since);
  const mins = week.reduce((s, e) => s + (Number(e.minutes) || 0), 0);
  const last = ex.entries[ex.entries.length - 1];
  const headline = week.length ? `Last 7 days: ${week.length}× · ${mins} min` : "Last 7 days: none";
  const load = last ? `Last: ${fmtDate(last.date)}, ${last.minutes} min${last.tempF != null ? ` at ${last.tempF}°F` : ""}` : "Logged for the coach's analysis";
  return renderNextTile(headline, ex, RECOVERY[name].guide, load);
}

// One line of form, one line of swap, under the chart.
function renderTips(name){
  const t = EXERCISE_TIPS[name];
  const fin = programDays().includes(view) && finishersFor(view).includes(name)
    ? `<div class="finisher-tip"><b>Finisher</b> Optional, after the numbered lifts. Doesn't count toward finishing the day.</div>` : "";
  const add = addedLiftTip(name);
  if(!t && !fin && !add) return "";
  return `<div class="ex-tips">${t ? `<div><b>Form</b> ${t[0]}</div><div><b>Swap</b> ${t[1]}</div>` : ""}${fin}${add}</div>`;
}
