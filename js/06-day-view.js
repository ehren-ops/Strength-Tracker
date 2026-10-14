// Rendering and day pages: tabs, pill row, exercise card, checklists, history, edit and delete, log form.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- rendering ----------
let lastRenderedView = null;
let logFormDirty = false; // typed into the log form since the last render: don't re-render under it
function render(){
  guidancePools = [];
  logFormDirty = false;
  const oldPillScroll = document.getElementById("pill-scroll");
  const sameView = lastRenderedView === view;
  const savedPillScrollLeft = (sameView && oldPillScroll) ? oldPillScroll.scrollLeft : null;
  renderTabs();
  if(view === "overview") renderOverview();
  else renderDay(view);
  if(savedPillScrollLeft !== null){
    const newPillScroll = document.getElementById("pill-scroll");
    if(newPillScroll) newPillScroll.scrollLeft = savedPillScrollLeft;
  }
  lastRenderedView = view;
  fitGuidance();
}

function renderTabs(){
  document.getElementById("tabs").innerHTML = TAB_ORDER.map(v =>
    `<div class="tab ${view===v?'active':''}" onclick="switchView('${v}')">${v==='overview'?'Overview':DAY_TITLES[v]}</div>`
  ).join("");
  document.getElementById("page-title").textContent = view === "overview" ? "Overview" : DAY_TITLES[view];
  document.getElementById("page-sub").textContent = view === "overview"
    ? "Aggregate progress across everything you've logged."
    : "Tap a day, log your sets, watch progress build.";
}

function switchView(v){
  view = v;
  if(v === "extra") selected = extraList(extraGroup)[0];
  else if(v !== "overview" && DAY_ORDER[v] && DAY_ORDER[v].length) selected = DAY_ORDER[v][0];
  render();
}

// ---------- Extra groups and the Mobility card ----------
// One group's row: its exercises in program order plus custom Extra exercises (under Strength),
// with the stretch and core routines folded into the single Mobility card.
function extraList(group){
  if(group === "mobility") return [MOBILITY_NAME];
  const customs = Object.keys(data).filter(k => !allDayNames().includes(k) && k !== REHAB_NAME && data[k].day === "extra");
  return activeDayOrder("extra").concat(customs).filter(n => extraGroupOf(n) === group);
}
function selectExtraGroup(group){
  extraGroup = group;
  saveExtraPrefs();
  selected = extraList(group)[0];
  render();
}
function currentMobilityRoutine(){
  if(isMobilityRoutine(mobilityRoutine)) return mobilityRoutine;
  // Otherwise the routine done most recently, or Hip.
  let best = MOBILITY_ROUTINES[0][0], bestDate = "";
  MOBILITY_ROUTINES.forEach(([n]) => (data[n] ? data[n].entries : []).forEach(e => { if(e.date > bestDate){ bestDate = e.date; best = n; } }));
  return best;
}
function selectMobilityRoutine(name){
  mobilityRoutine = name;
  saveExtraPrefs();
  render();
}
function renderMobilityCard(){
  const routine = currentMobilityRoutine();
  let ex = data[routine];
  if(!ex){
    ex = data[routine] = newExerciseShell(routine);
    persist();
    enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name: routine } });
  }
  const chips = `<div class="routine-chips">${MOBILITY_ROUTINES.map(([n, label]) => {
    const done = isLoggedToday(n);
    return `<button type="button" class="routine-chip${n === routine ? " active" : ""}${done ? " done" : ""}" onclick="selectMobilityRoutine('${n}')" aria-pressed="${n === routine}">${label}${done ? " ✓" : ""}</button>`;
  }).join("")}</div>`;
  return renderChecklistCard(routine, ex, { title: MOBILITY_NAME, chips });
}

// Only used for the pill row's visual order - every other DAY_ORDER[day]
// consumer (completion banner, volume history, calendar day-guessing,
// default tab selection) keeps reading the static array so this reorder
// can't shift the "opening a tab lands on your main lift" behavior or
// anything else that depends on stable positions.
function getDisplayOrder(day){
  const order = activeDayOrder(day);
  if(!modes.preseason) return order;
  const isPower = name => !!(EXERCISE_DEFAULTS[name] && EXERCISE_DEFAULTS[name].preseasonPower);
  const power = order.filter(isPower);
  if(!power.length) return order;
  return power.concat(order.filter(name => !isPower(name)));
}

function renderDay(day){
  const app = document.getElementById("app");
  const customExercises = Object.keys(data).filter(k => k !== REHAB_NAME && !allDayNames().includes(k) && (data[k].day || "full") === day);
  // Shoulder Rehab leads every day's row while it is on, unnumbered so the lifts keep their numbers.
  const lead = modes.shoulder ? [REHAB_NAME] : [];
  // Bridges join a day after its numbered lifts while their modifier is on: Push-Ups (Shoulder
  // Rehab) on Upper and Full Body, Spanish Squat (Knee Care) on Lower and Full Body.
  const bridge = [];
  if(modes.shoulder && (day === "upper" || day === "full")) bridge.push(PUSHUP_NAME);
  if(modes.knee && (day === "lower" || day === "full")) bridge.push(...KNEE_ONLY);
  let list;
  let groupRow = "";
  if(day === "extra"){
    // A routine opened directly (from history or the calendar) opens inside the Mobility card.
    if(isMobilityRoutine(selected)){ mobilityRoutine = selected; selected = MOBILITY_NAME; }
    const shown = selected === REHAB_NAME || extraList(extraGroupOf(selected)).includes(selected);
    if(shown && selected !== REHAB_NAME) extraGroup = extraGroupOf(selected);
    else if(!shown) selected = extraList(extraGroup)[0];
    saveExtraPrefs();
    groupRow = `<div class="group-row">${EXTRA_GROUPS.map(g => `<button type="button" class="group-chip${g.key === extraGroup ? " active" : ""}" onclick="selectExtraGroup('${g.key}')" aria-pressed="${g.key === extraGroup}">${g.label}${g.key === "mobility" && isLoggedToday(MOBILITY_NAME) ? " ✓" : ""}</button>`).join("")}</div>`;
    list = lead.concat(extraList(extraGroup));
  } else {
    list = lead.concat(getDisplayOrder(day), bridge.filter(n => !getDisplayOrder(day).includes(n)), customExercises);
  }
  if(selected === REHAB_NAME && !modes.shoulder) selected = activeDayOrder(day)[0];

  // Mobility is one card, so its group needs no pill of its own (only Shoulder Rehab, when on).
  const hidePills = day === "extra" && extraGroup === "mobility" && !lead.length;
  let html = groupRow + `<div class="pill-row" id="pill-scroll"${hidePills ? ' hidden' : ''}>`;
  list.forEach((name, i) => {
    if(name === MOBILITY_NAME) return; // the group button stands in for it
    const loggedToday = isLoggedToday(name);
    // Preseason-flagged exercises get a light purple pill so they're
    // visible at a glance in the row, and a darker solid purple instead
    // of the usual amber when they're also the selected/active pill.
    const isPreseasonPill = modes.preseason && !!(EXERCISE_DEFAULTS[name] && EXERCISE_DEFAULTS[name].preseason);
    const pillClasses = ['pill'];
    if(isPreseasonPill) pillClasses.push('preseason-pill');
    if(name === REHAB_NAME || (name === PUSHUP_NAME && bridge.includes(name))) pillClasses.push('rehab-pill');
    if(day !== "extra" && KNEE_ONLY.has(name)) pillClasses.push('knee-pill');
    if(name === MOBILITY_NAME) pillClasses.push('cat-stretch');
    if(day === "extra" && EXTRA_CATEGORY[name]) pillClasses.push('cat-' + EXTRA_CATEGORY[name]);
    if(selected===name) pillClasses.push('active');
    const skipped = !loggedToday && skipReason(name);
    const paused = !loggedToday && !skipped && isShoulderPaused(name);
    if(loggedToday) pillClasses.push('logged-today');
    if(skipped || paused) pillClasses.push('skipped-today');
    const n = i - lead.length;
    const title = skipped ? ` title="Skipped today: ${SKIP_REASONS[skipped]}"` : paused ? ` title="Paused: Shoulder Rehab"` : '';
    html += `<div class="${pillClasses.join(' ')}" onclick="selectExercise('${name.replace(/'/g,"\\'")}')"${title}>${(day !== "extra" && n >= 0 && n < activeDayOrder(day).length) ? (n+1)+'. ' : ''}${name}${loggedToday?' ✓':''}</div>`;
  });
  html += `<div class="pill pill-add" onclick="toggleAddExercise()">+</div></div>`;
  html += `<div id="add-ex-row" style="display:none" class="add-ex-row">
    <input id="new-ex-name" placeholder="Exercise name">
    <button onclick="addExercise()">Add</button>
  </div>`;

  if(DAY_ORDER[day].includes(selected) && !activeDayOrder(day).includes(selected)) selected = activeDayOrder(day)[0];
  if(selected === MOBILITY_NAME){
    app.innerHTML = html + renderMobilityCard();
    return;
  }
  let ex = selected === REHAB_NAME && modes.shoulder ? ensureRehabExercise() : data[selected];
  if(!ex && (DAY_ORDER[day].includes(selected) || bridge.includes(selected))){
    ex = data[selected] = newExerciseShell(selected);
    persist();
    enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name: selected } });
  }
  if(!ex){
    app.innerHTML = html + `<p style="color:var(--slate);font-size:0.85rem;">Select an exercise above.</p>`;
    return;
  }
  html += renderExerciseCard(selected, ex);
  app.innerHTML = html;
}

function render1RMInline(name, ex, last){
  if(editing1RM === name){
    return `<div class="onerm-box onerm-edit">
      <input type="number" inputmode="decimal" id="input-1rm" value="${ex.actual1RM || ''}">
      <button class="icon-btn" onclick="save1RM('${name.replace(/'/g,"\\'")}')">✓</button>
      <button class="icon-btn" onclick="cancel1RM()">✕</button>
    </div>`;
  }
  if(!ex.actual1RM && !last.weight){
    return `<div class="onerm-box" onclick="start1RM('${name.replace(/'/g,"\\'")}')">
      <span class="onerm-label">1RM</span>
      <span class="onerm-val">- ✎</span>
    </div>`;
  }
  const oneRM = ex.actual1RM || estimate1RM(last.weight, last.reps);
  const label = ex.actual1RM ? "1RM (actual)" : "Est. 1RM";
  return `<div class="onerm-box" onclick="start1RM('${name.replace(/'/g,"\\'")}')">
    <span class="onerm-label">${label}</span>
    <span class="onerm-val">${oneRM} lbs ✎</span>
  </div>`;
}

function renderProgressionToggle(name, ex){
  if(ex.trackBy !== "weight") return `<button class="action-btn-spacer" tabindex="-1" aria-hidden="true">-</button>`;
  // Short label so the action row stays one line tall; the aria-label keeps the full meaning.
  return `<button class="progression-btn" onclick="toggleConservative('${name.replace(/'/g,"\\'")}')" aria-label="Progression: ${ex.conservative ? "Conservative" : "Standard"}">
    ${ex.conservative ? "Conservative" : "Standard"}
  </button>`;
}

function toggleConservative(name){
  data[name].conservative = !data[name].conservative;
  persist();
  enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name } });
  render();
}

function start1RM(name){ editing1RM = name; render(); }
function cancel1RM(){ editing1RM = null; render(); }
function save1RM(name){
  const val = Number(document.getElementById("input-1rm").value);
  if(val > 0) data[name].actual1RM = val;
  else delete data[name].actual1RM;
  editing1RM = null;
  persist();
  enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name } });
  render();
}

function getOrCreateTodayChecklistEntry(name){
  const ex = data[name];
  const today = todayISO();
  let entry = ex.entries.find(e => e.date === today);
  if(!entry){
    entry = { clientId: genId(), date: today, confirmed: true, completedIndices: [] };
    ex.entries.push(entry);
  }
  return entry;
}

function toggleChecklistItem(name, idx){
  const entry = getOrCreateTodayChecklistEntry(name);
  const set = new Set(entry.completedIndices || []);
  if(set.has(idx)) set.delete(idx); else set.add(idx);
  entry.completedIndices = Array.from(set).sort((a,b) => a - b);
  persist();
  enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: name, clientId: entry.clientId } });
  render();
}

function toggleStretchDetail(key){
  openStretchItems[key] = !openStretchItems[key];
  render();
}

function renderChecklistCard(name, ex, opts){
  const routine = CHECKLIST_ROUTINES[name];
  const entry = ex.entries.find(e => e.date === todayISO());
  const completed = new Set(entry ? entry.completedIndices || [] : []);

  let html = `<div class="card">`;
  html += `<h2 class="ex-name">${opts && opts.title || name}</h2>`;
  if(opts && opts.chips) html += opts.chips;
  if(routine.intro) html += `<p style="font-size:0.78rem;color:var(--slate);margin:0 0 0.8rem;">${routine.intro}</p>`;

  routine.items.forEach((item, idx) => {
    const key = name + "|" + idx;
    const isOpen = !!openStretchItems[key];
    const isDone = completed.has(idx);
    html += `<div class="stretch-item${isDone ? ' done' : ''}">
      <div class="stretch-row">
        <label class="stretch-check">
          <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleChecklistItem('${name.replace(/'/g,"\\'")}', ${idx})">
          <span class="stretch-name">${item.name}</span>
        </label>
        <span class="stretch-dose">${item.dose}</span>
        <button class="stretch-toggle" onclick="toggleStretchDetail('${key.replace(/'/g,"\\'")}')" aria-label="Details">${isOpen ? '▲' : '▼'}</button>
      </div>
      ${isOpen ? `<div class="stretch-detail">
        <p>${item.description}</p>
        ${item.variation ? `<p class="stretch-variation"><b>Variation:</b> ${item.variation}</p>` : ''}
      </div>` : ''}
    </div>`;
  });

  const doneCount = routine.items.filter((_, i) => completed.has(i)).length;
  html += `<p style="font-size:0.72rem;color:var(--slate);margin-top:0.8rem;">${doneCount}/${routine.items.length} done today</p>`;
  html += `</div>`;
  return html;
}

// Modifiers that change this lift's numbers for today (weight, sets or reps), by display name.
// Preseason only counts where it shifts the reps; elsewhere it adds notes, not numbers.
function planModifiers(name, ex){
  if(ex.trackBy === "duration" || ex.trackBy === "checklist") return [];
  const on = [];
  if(modes.deload) on.push("Deload Week");
  if(modes.ski && ex.targetRepsSki) on.push("Ski Season");
  if(modes.preseason && ex.preseason && ex.targetRepsPreseason) on.push("Preseason Prep");
  if(modes.knee && KNEE_SENSITIVE_EXERCISES.has(name)) on.push("Knee Care");
  if(modes.back && LOW_BACK_SENSITIVE_EXERCISES.has(name)) on.push("Low Back Care");
  if(isShoulderPaused(name) || isShoulderHeld(name)) on.push("Shoulder Rehab");
  return on;
}

// The Next tile: always four rows at one fixed size on every lift, so the card never shifts.
// 1: weight, sets x reps, rest. 2-3: the call and a short read of recent notes. 4: the load.
function renderNextTile(headline, ex, guidance, load){
  const rest = ex.trackBy !== "duration" ? `<span class="rec-rest">Rest ${restTimeFor(ex)}</span>` : "";
  return `<div class="rec-box">
    <div class="rec-headline"><span class="rec-plan">${headline}</span>${rest}</div>
    <div class="rec-desc">${guidance}</div>
    <div class="rec-load${/ per side/.test(load) ? " plate-line" : ""}">${load}</div>
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
function composeGuidance(msg, name, ex, last, work){
  return guidanceHtml(msg, [
    ...noteInsights(ex.entries), lastSessionLine(ex, work), deloadSessionLine(ex, last), hrLine(name, last), ...trendLine(name, ex),
    bestLine(ex, work), progressionRule(name, ex), effortLine(ex), daysSinceLine(last), LOG_TIMING_TIP, NOTE_TIP,
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
  ? new ResizeObserver(list => list.forEach(r => { if(r.target.clientWidth !== r.target._fitW) fitOne(r.target); }))
  : null;
function fitGuidance(){
  document.querySelectorAll(".rec-desc").forEach(box => {
    fitOne(box);
    if(guidanceObserver) guidanceObserver.observe(box);
  });
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
// How this lift moves up, in one line.
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
    : `${e.weight > 0 ? `${e.weight} lb` : "bodyweight"}, ${repLabel(e.sets, e.reps, ex.unit)}`;
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
  if(!sug) return ex.equipment === "barbell" ? "Load: plates shown after your first log" : sidesOf(name).weight === "hand" ? "Load: weight in each hand" : "Load: total weight";
  const w = sug.weight;
  if(!(w > 0)) return "Bodyweight";
  if(ex.equipment === "barbell") return `Load: ${w} lb · ${platesLabel(w, ex.equipment)}`;
  const maxW = (EXERCISE_DEFAULTS[name] || {}).maxWeight;
  if(maxW) return `Load: one ${w} lb bell${w >= maxW ? " (heaviest available)" : ""}`;
  return sidesOf(name).weight === "hand" ? `Load: ${w} lb in each hand` : `Load: ${w} lb total`;
}

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
// Today against the last full session: +5 lbs, −15 lbs, +2 reps, +5 min, or same.
function stepText(ex, s, prior){
  if(!prior) return "";
  const [d, unit] = ex.trackBy === "weight" ? [s.weight - prior.weight, "lbs"]
    : ex.trackBy === "duration" ? [s.minutes - prior.minutes, "min"] : [s.reps - prior.reps, ex.unit === "sec" ? "sec" : "reps"];
  if(!isFinite(d)) return "";
  const n = Math.round(Math.abs(d) * 10) / 10;
  return d > 0 ? `+${n} ${unit}` : d < 0 ? `−${n} ${unit}` : "same as last";
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
  if(!t) return "";
  return `<div class="ex-tips"><div><b>Form</b> ${t[0]}</div><div><b>Swap</b> ${t[1]}</div></div>`;
}

function renderExerciseCard(name, ex){
  if(name === REHAB_NAME) return renderRehabCard();
  if(ex.trackBy === "checklist") return renderChecklistCard(name, ex);
  const hasEntries = ex.entries.length > 0;
  const last = hasEntries ? ex.entries[ex.entries.length-1] : null;
  const work = hasEntries ? lastWorking(ex) : null; // last non-deload session: where the lift stands
  const first = hasEntries ? ex.entries[0] : null;
  const suggestion = computeSuggestion(ex, name);
  const skiActive = modes.ski && !!ex.targetRepsSki;
  const kneeActive = modes.knee && (KNEE_SENSITIVE_EXERCISES.has(name) || KNEE_ONLY.has(name));
  const backActive = modes.back && LOW_BACK_SENSITIVE_EXERCISES.has(name);
  const preseasonActive = modes.preseason && !!ex.preseason;
  const deloadActive = modes.deload && ex.trackBy !== "duration";
  const recovery = isRecovery(name);
  const shoulderPaused = isShoulderPaused(name), shoulderActive = isShoulderModified(name);

  const isCustom = !allDayNames().includes(name);
  // "+20 since first" rides in the Recent History heading, with the rest of the card's history.
  const delta = ex.entries.length > 1
    ? (ex.trackBy==="weight" ? work.weight-first.weight : ex.trackBy==="duration" ? work.minutes-first.minutes : work.reps-first.reps)
    : 0;
  const deltaColor = delta>0 ? "color:var(--emerald)" : delta<0 ? "color:var(--amber)" : "color:var(--slate)";
  const deltaHtml = ex.entries.length > 1 && !recovery ? ` · <span class="delta-line" style="${deltaColor}">${delta>0?'+':''}${delta} since first</span>` : "";
  // The big number is the weight to lift today, or what was logged today once it is. The top right
  // keeps the last day a full session was lifted, before today, so the two never get mixed up.
  const today = todayISO();
  const todayLog = recovery ? null : [...ex.entries].reverse().find(e => e.date === today) || null;
  const prior = [...ex.entries].reverse().find(e => e.date < today && !e.deload) || null;
  const priorHtml = prior && !recovery ? `<span class="last-line">Last: ${shortValue(name, ex, prior)} · ${fmtShortDate(prior.date)}</span>` : "";

  // Active modifiers: badges, then their notes, under the current weight rather than above it.
  const badges = [skiActive && '<span class="ski-badge">🎿 Ski</span>', kneeActive && '<span class="knee-badge">🦵 Knee Care</span>',
    backActive && '<span class="back-badge">🩺 Back Care</span>', preseasonActive && '<span class="preseason-badge">🏔️ Preseason</span>',
    deloadActive && '<span class="deload-badge">🔋 Deload</span>', shoulderActive && `<span class="shoulder-badge">🩹 ${shoulderPaused ? "Paused" : "Shoulder Rehab"}</span>`].filter(Boolean).join("");
  let modHtml = badges ? `<div class="mod-badges">${badges}</div>` : "";
  if(kneeActive && KNEE_CARE_TIP[name]){
    modHtml += `<div class="care-line knee-care-line">${KNEE_CARE_TIP[name]}</div>`;
  }
  if(backActive && LOW_BACK_CARE_TIP[name]){
    modHtml += `<div class="care-line back-care-line">${LOW_BACK_CARE_TIP[name]}</div>`;
  }
  const shoulderTip = shoulderCardTip(name);
  if(shoulderTip){
    modHtml += `<div class="care-line shoulder-care-line">${shoulderTip}</div>`;
  }
  if(kneeActive || backActive){
    modHtml += `<p class="care-disclaimer">Load adjustment only, not a substitute for a PT or doctor.</p>`;
  }
  if(skiActive && ex.skiTempo){
    modHtml += `<div class="ski-tempo-line">Ski tempo: ${ex.skiTempo} · target ${ex.targetRepsSki} reps</div>`;
  }
  if(preseasonActive && ex.preseasonTempo){
    modHtml += `<div class="preseason-line">Preseason tempo: ${ex.preseasonTempo} · target ${ex.targetRepsPreseason} reps</div>`;
  }
  if(preseasonActive && ex.preseasonNote){
    modHtml += `<div class="preseason-line">${ex.preseasonNote}${ex.preseasonWeek3 ? ' <b>Add from week 3.</b>' : ''}</div>`;
  }

  let html = `<div class="card${skiActive ? ' ski-mode' : ''}${kneeActive ? ' knee-mode' : ''}${backActive ? ' back-mode' : ''}${preseasonActive ? ' preseason-mode' : ''}${shoulderActive ? ' shoulder-mode' : ''}">`;
  if(isCustom && deletingExercise === name){
    html += `<div class="ex-name-row">
      <span style="color:var(--slate);font-size:0.85rem;">Delete "${escapeHtml(name)}" and all its logged history?</span>
      <span class="row-actions">
        <button class="danger-btn" onclick="confirmDeleteExercise('${name.replace(/'/g,"\\'")}')">Yes, delete</button>
        <button class="cancel-btn" onclick="cancelDeleteExercise()">Cancel</button>
      </span>
    </div>`;
  } else {
    html += `<div class="ex-title-row"><h2 class="ex-name">${name}${isCustom ? `<button class="icon-btn" onclick="startDeleteExercise('${name.replace(/'/g,"\\'")}')" aria-label="Delete exercise" style="float:right;font-size:1rem;">✕</button>` : ''}</h2>${priorHtml}</div>`;
  }
  if(!hasEntries){
    html += modHtml;
    // Same tile as every other lift, so the card never changes shape.
    html += recovery ? renderRecoveryTile(name, ex) : renderNextTile("Next: first session", ex, firstSessionGuidance(name, ex), loadText(name, ex, null));
    html += renderTips(name);
  } else {
    const sideTag = s => s ? `<span class="side-tag">${s}</span>` : "";
    const bigOf = v => ex.trackBy==="weight" ? v.weight+" lbs" + sideTag(weightSuffix(name).trim() === "total" ? "" : weightSuffix(name))
      : ex.trackBy==="duration" ? v.minutes+" min" + (v.tempF != null ? sideTag(` ${v.tempF}°F`) : "") : v.reps+" "+repsWord(name) + sideTag(sidesOf(name).reps === "steps" ? " total" : repsSuffix(name));
    let bigVal, bigLabel;
    if(recovery){ bigVal = bigOf(work); bigLabel = "Last"; }
    else if(todayLog){ bigVal = bigOf(todayLog); bigLabel = "Logged today ✓"; }
    else if(suggestion && suggestion.shoulderPaused){ bigVal = "Paused"; bigLabel = "Today"; }
    else if(suggestion){ bigVal = bigOf(suggestion); bigLabel = "Today"; }
    else { bigVal = bigOf(work); bigLabel = "Last"; }

    html += `<div class="weight-row">
      <div class="weight-main">
        <span class="big-label${todayLog ? " locked" : ""}">${bigLabel}</span>
        <span class="big-val">${bigVal}</span>
      </div>
      ${ex.trackBy === "weight" ? render1RMInline(name, ex, work) : ''}
    </div>`;
    html += modHtml;

    let recHtml = "";
    if(suggestion){
      const unitWord = ex.unit === "sec" ? "hold time" : "reps";
      let msg;
      let nextLabel;
      if(ex.trackBy === "weight"){
        nextLabel = `<b>${suggestion.weight} lbs${weightSuffix(name)}</b> · ${repLabel(suggestion.sets,suggestion.reps,ex.unit)}${repsSuffix(name)}`;
        // When the prior session's actual reps beat the target, call that out by
        // name with the real number instead of flattening it to a plain "hit
        // target" - going over is a stronger, more specific signal than a bare hit.
        const wentOverTarget = suggestion.hitTarget && !suggestion.deload && !suggestion.deloadWeek && work.reps > suggestion.reps;
        const actualAmt = ex.unit === "sec" ? `${work.reps} sec` : `${work.reps} reps`;
        const targetAmt = ex.unit === "sec" ? `${suggestion.reps} sec` : `${suggestion.reps} reps`;
        const hitLeadIn = wentOverTarget
          ? `Went over target ${unitWord} (did ${actualAmt}, target is ${targetAmt})`
          : `Hit target ${unitWord}`;
        if(suggestion.shoulderPaused){
          nextLabel = "paused";
          msg = name === "Bicep Curl"
            ? `Left arm paused until week 3 of Shoulder Rehab. Right-arm hammer curls are fine now.`
            : `Paused for Shoulder Rehab until the side-raise press is pain-free.`;
        } else if(suggestion.shoulderHold){
          const h = suggestion.shoulderHold;
          msg = name === "Bicep Curl"
            ? `Shoulder Rehab: hammer curls only at ${suggestion.weight} lb, lower over 3 sec. No adding weight yet.`
            : `Rehab: ${suggestion.weight} lb${h.fullWeight ? ` (${Math.round(h.pct * 100)}% of ${h.fullWeight})` : ""}, close grip, short of the chest. Hold until phase 3.`;
        } else if(suggestion.shoulderBuild && !suggestion.deloadWeek){
          msg = `Shoulder Rehab phase 3: full range, ${suggestion.weight} lb. Add 5 lb a session at 3 of 10 or less, up to ${suggestion.shoulderBuild.fullWeight} lb.`;
        } else if(suggestion.shoulderReturn && !suggestion.deloadWeek){
          const r = suggestion.shoulderReturn, left = SHOULDER_RETURN_STEPS.length - r.step;
          msg = left
            ? `Back from shoulder rehab: ${Math.round(SHOULDER_RETURN_STEPS[r.step - 1] * 1000) / 10}% today, rebuilding to ${r.fullWeight} lb over ${left} more session${left === 1 ? "" : "s"}.`
            : `Back from shoulder rehab: your full ${r.fullWeight} lb, if it stays at 3 of 10 or less.`;
        } else if(suggestion.reentry && !suggestion.deloadWeek){
          const r = suggestion.reentry, left = REENTRY_STEPS.length - r.step;
          msg = r.step === 1
            ? `Back after ${r.daysOff} days off: start near 90% and rebuild to ${r.fullWeight} lb over ${left} more session${left === 1 ? "" : "s"}.`
            : left ? `Rebuilding after time off: ${Math.round(REENTRY_STEPS[r.step - 1] * 100)}% today, full ${r.fullWeight} lb next.`
            : `Back to your full ${r.fullWeight} lb after the time off.`;
        } else if(suggestion.postDeloadHold){
          msg = `First session back from the deload: ${suggestion.weight} lb again (${suggestion.postDeloadHold.why}), then add.`;
        } else if(suggestion.deloadWeek){
          msg = suggestion.deloadKeptReduction
            ? `Deload: already reduced, so same weight, fewer sets. Stop around RPE 6, 3 to 4 reps short of failure.`
            : `Deload: ~10% lighter, a third fewer sets. Stop around RPE 6, 3 to 4 reps short of failure.`;
        } else if(suggestion.atRepCap){
          msg = `Heaviest bell at ${MAX_WEIGHT_REP_CAP} reps: go single-arm, or add a 1 sec hold at the top.`;
        } else if(suggestion.atMaxWeight && suggestion.readyToProgress){
          msg = `Heaviest bell: add reps. Go single-arm at ${MAX_WEIGHT_REP_CAP}.`;
        } else if(suggestion.noteTarget != null && !(suggestion.careFlags && suggestion.careFlags.length)){
          msg = `Using the ${suggestion.noteTarget} lb you set last time.`;
        } else if(suggestion.deload){
          msg = `Missed target ${unitWord} ${suggestion.missStreak} sessions straight: drop ~15% and rebuild.`;
        } else if(suggestion.noteConcern){
          const flagged = CONCERN_WORDS.find(w => suggestion.noteConcern.toLowerCase().includes(w)) || "a concern";
          msg = suggestion.hitTarget
            ? `${hitLeadIn}, but your note flagged ${flagged}: hold.`
            : `Missed target ${unitWord} and your note flagged ${flagged}: hold.`;
        } else if(suggestion.careFlags && suggestion.careFlags.length){
          const flagLabel = suggestion.careFlags.map(f => f === "knee" ? "Knee Care" : "Low Back Care").join(" + ");
          msg = suggestion.noteTarget != null
            ? `${flagLabel}: your note's lighter ${suggestion.noteTarget} lb.`
            : `${flagLabel}: ~10% lighter, holding.`;
        } else if(suggestion.noteCue === "hold"){
          msg = `${hitLeadIn}; holding, as your note said.`;
        } else if(suggestion.noteCue === "up"){
          msg = `${hitLeadIn}; adding weight, as your note said.`;
        } else if(suggestion.difficultyNote === "hard"){
          msg = `${hitLeadIn}, but rated 9-10: hold.`;
        } else if(suggestion.difficultyNote === "easy"){
          msg = `${hitLeadIn}, felt easy: add weight early.`;
        } else if(suggestion.readyToProgress){
          if(ex.conservative){
            msg = wentOverTarget
              ? `Hit target ${unitWord} ${suggestion.streak} sessions straight (${actualAmt} last time): add weight.`
              : `Hit target ${unitWord} ${suggestion.streak} sessions straight: add weight.`;
          } else {
            msg = `${hitLeadIn}: add weight.`;
          }
        } else if(suggestion.hitTarget){
          msg = `${hitLeadIn}, ${suggestion.streak} of ${suggestion.requiredStreak} sessions: hold one more.`;
        } else {
          msg = `Missed target ${unitWord}: hold and chase it.`;
        }
      } else if(ex.trackBy === "duration"){
        nextLabel = `${suggestion.minutes} min`;
        msg = suggestion.difficultyNote === "easy"
          ? `Felt easy: +5 min.`
          : suggestion.difficultyNote === "hard"
          ? `Rated hard: 5 min shorter.`
          : `Holding steady.`;
      } else {
        nextLabel = repLabel(suggestion.sets,suggestion.reps,ex.unit) + repsSuffix(name);
        msg = suggestion.deloadWeek ? `Deload: same reps, fewer sets. Stop around RPE 6, 3 to 4 reps short of failure.`
          : suggestion.powerHold ? `Power: hold reps; go higher or farther only while every rep stays fast.`
          : `Add 2 reps.`;
      }
      // Before today's log the weight is the big number, so the headline is the sets and reps and the
      // step from the last full session. Once today is logged, it plans the next session in full.
      let headline;
      if(todayLog) headline = `Next time: ${nextLabel}`;
      else if(suggestion.shoulderPaused) headline = "Paused today";
      else headline = [planShape(name, ex, suggestion), stepText(ex, suggestion, prior)].filter(Boolean).join(" · ");
      recHtml = renderNextTile(headline, ex, composeGuidance(msg, name, ex, last, work), suggestion.shoulderPaused ? "Load: none today" : loadText(name, ex, suggestion));
    }

    // Recovery: this week's total and the last session instead of a plan and a graph.
    html += recovery ? renderRecoveryTile(name, ex) : recHtml + renderChart(ex, suggestion, true, name) + renderTips(name);
  }

  html += renderForm(name, ex);

  if(!hasEntries){
    html += `<div class="hist-foot"><p style="color:var(--slate);font-size:0.8rem;font-style:italic;margin:0;">Nothing logged yet.</p>${renderSkipControl(name)}</div>`;
  } else {
    // keep original array index attached so edit/delete target the right entry
    const reversed = ex.entries.map((e,i) => ({ e, i })).reverse(); // most recent first
    const recent = reversed.slice(0, 3);
    const older = reversed.slice(3);

    html += `<div style="margin-top:0.9rem;">`;
    html += `<h3 class="section" style="margin-bottom:0.4rem;">Recent History${deltaHtml}</h3>`;
    const histColLabel = recovery ? "Session" : ex.trackBy==="duration" ? "Cardio" : ex.trackBy==="weight" ? "Load" + (sidesOf(name).weight === "total" ? "" : "/" + sidesOf(name).weight) : "Sets" + repsSuffix(name);
    const cardioCls = ex.trackBy==="duration" ? " cardio" : "";
    html += `<div class="hist-row header${cardioCls}"><span>Date</span><span>${histColLabel}</span><span>RPE</span><span>Note</span></div>`;
    recent.forEach((r, idx) => { html += renderHistRow(r.e, r.i, idx === 0, ex, name); });

    // One footer row: earlier history on the left, Skip today on the right.
    // While picking a skip reason the link steps aside so the reasons fit on this one row.
    html += `<div class="hist-foot">${older.length && skipPicking !== name ? `<button class="hist-toggle" onclick="toggleHistory('${name.replace(/'/g,"\\'")}')">Show earlier history (${older.length})</button>` : ""}${renderSkipControl(name)}</div>`;
    if(older.length){
      html += `<div class="hist ${openHistory[name] ? 'open' : ''}" id="hist-${cssId(name)}">`;
      older.forEach(r => { html += renderHistRow(r.e, r.i, false, ex, name); });
      html += `</div>`;
    }

    if(ex.entries.some(e => e.confirmed===false)){
      html += `<p style="font-size:0.68rem;color:var(--slate);margin-top:0.4rem;">* estimated date, not confirmed</p>`;
    }
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

// Right end of the history footer: skip this lift today, for injury or another reason. Hidden once
// the lift is logged today; while skipped, shows the reason and an undo.
function renderSkipControl(name){
  if(isLoggedToday(name) || isShoulderPaused(name) || isRecovery(name)) return "";
  const q = name.replace(/'/g, "\\'");
  const reason = skipReason(name);
  if(reason){
    return `<div class="skip-ctl"><span class="skip-state">Skipped: ${SKIP_REASONS[reason]}</span><button type="button" class="skip-btn" onclick="undoSkip('${q}')">Undo</button></div>`;
  }
  if(skipPicking === name){
    return `<div class="skip-ctl skip-picking">${Object.entries(SKIP_REASONS).map(([k, label]) =>
      `<button type="button" class="skip-reason" onclick="skipExercise('${q}', '${k}')">${label}</button>`).join("")}<button type="button" class="skip-btn skip-cancel" onclick="cancelSkip()" aria-label="Cancel">✕</button></div>`;
  }
  return `<div class="skip-ctl"><button type="button" class="skip-btn" onclick="startSkip('${q}')">Skip today</button></div>`;
}

function renderHistRow(e, idx, isLatest, ex, name){
  const key = name + "|" + idx;

  if(editingKey === key){
    return `<div class="hist-edit-box">
      <div class="form-row">
        ${ex.trackBy==="weight" ? `<div class="field"><label>${weightFieldLabel(name)}</label><input type="number" inputmode="decimal" id="edit-weight" value="${e.weight}"></div>` : ""}
        ${ex.trackBy==="duration"
          ? `<div class="field"><label>Minutes</label><input type="number" inputmode="numeric" id="edit-minutes" value="${e.minutes}"></div>`
            + (ex.trackDistance ? `<div class="field"><label>Miles</label><input type="number" inputmode="decimal" step="0.1" id="edit-distance" value="${e.distance ?? ''}"></div>` : "")
            + (ex.trackSpeed ? `<div class="field"><label>MPH</label><input type="number" inputmode="decimal" step="0.1" id="edit-speed" value="${e.speed ?? ''}"></div>` : "")
            + (ex.trackIncline ? `<div class="field"><label>Incline %</label><input type="number" inputmode="decimal" step="0.5" id="edit-incline" value="${e.incline ?? ''}"></div>` : "")
            + (isRecovery(name) ? `<div class="field"><label>°F</label><input type="number" inputmode="numeric" id="edit-temp" value="${e.tempF ?? ''}"></div>` : "")
          : `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="edit-sets" value="${e.sets}"></div>
             <div class="field"><label>${repsFieldLabel(name, ex.unit)}</label><input type="number" inputmode="numeric" id="edit-reps" value="${e.reps}"></div>`
        }
      </div>
      <div class="form-row">
        <div class="field" style="flex:1 1 100%;"><label>Date</label><input type="date" id="edit-date" value="${e.date || todayISO()}"></div>
      </div>
      <div class="form-row">
        <div class="field" style="flex:0 0 68px;"><label>RPE / 10</label><input type="number" inputmode="numeric" id="edit-difficulty" min="1" max="10" value="${e.difficulty ?? ''}"></div>
        <div class="field" style="flex:1 1 140px;"><label>Note</label><input type="text" id="edit-note" value="${e.note ? escapeHtml(e.note) : ''}"></div>
      </div>
      <div class="edit-actions">
        <button class="save-btn" onclick="saveEditEntry('${name.replace(/'/g,"\\'")}', ${idx})">Save</button>
        <button class="cancel-btn" onclick="cancelEdit()">Cancel</button>
      </div>
    </div>`;
  }

  // Narrow date, numbers and RPE columns; the note takes the rest in the body font, which fits
  // far more per line than the mono numbers.
  let html = `<div class="hist-row${isLatest?' latest':''}${ex.trackBy==="duration"?' cardio':''}">`;
  const tag = isLatest ? (e.date === todayISO() ? "Today" : "Latest") : "";
  html += `<span>${fmtDate(e.date)}${e.confirmed===false?'<span class="est">*</span>':''}${tag ? `<br><span class="latest-tag">${tag}</span>` : ''}</span>`;
  const hr = hrFor(name, e.date);
  html += `<span class="exact">${formatEntryValue(e, ex)}${hr ? `<span class="hist-hr" title="Heart rate: average / peak">${hrShort(hr)}</span>` : ""}</span>`;
  html += `<span class="exact">${e.difficulty ?? "-"}</span>`;
  html += `<span class="hist-note-cell">`;
  html += `<span class="note">${e.note ? escapeHtml(e.note) : ""}</span>`;
  html += `<span class="row-actions">
    <button class="icon-btn" onclick="startEdit('${name.replace(/'/g,"\\'")}', ${idx})" aria-label="Edit">✎</button>
    <button class="icon-btn del-btn${deletingKey === key ? " armed" : ""}" onclick="tapDelete('${name.replace(/'/g,"\\'")}', ${idx})" aria-label="${deletingKey === key ? "Tap again to delete" : "Delete"}">✕</button>
  </span>`;
  html += `</span>`;
  html += `</div>`;
  return html;
}

function startEdit(name, idx){ editingKey = name + "|" + idx; deletingKey = null; render(); }
function cancelEdit(){ editingKey = null; render(); }
// Delete takes two taps: the first turns the ✕ red, the second (within a few seconds) deletes.
function tapDelete(name, idx){
  const key = name + "|" + idx;
  clearTimeout(deleteArmTimer);
  if(deletingKey === key){ confirmDeleteEntry(name, idx); return; }
  deletingKey = key; editingKey = null;
  render();
  deleteArmTimer = setTimeout(() => { if(deletingKey === key){ deletingKey = null; render(); } }, 4000);
}
function cancelDelete(){ deletingKey = null; render(); }

function startSkip(name){ skipPicking = name; render(); }
function cancelSkip(){ skipPicking = null; render(); }
function skipExercise(name, reason){
  const d = todayISO();
  (skips[d] = skips[d] || {})[name] = reason;
  saveSkips();
  skipPicking = null;
  enqueueOp({ id: genId(), type: "upsert_skip", payload: { date: d, name } });
  ["full", "upper", "lower"].filter(day => day === view || DAY_ORDER[day].includes(name)).forEach(checkCoreWorkoutComplete);
  // On to the next lift of the day that isn't done yet.
  if(DAY_ORDER[view]){
    const list = getDisplayOrder(view);
    const next = list.slice(list.indexOf(name) + 1).concat(list).find(n => n !== name && !isLoggedToday(n) && !skipReason(n));
    if(next) selected = next;
  }
  render();
}
function undoSkip(name, quiet){
  const d = todayISO();
  if(!skips[d] || !skips[d][name]) return;
  delete skips[d][name];
  if(!Object.keys(skips[d]).length) delete skips[d];
  saveSkips();
  enqueueOp({ id: genId(), type: "delete_skip", payload: { date: d, name } });
  if(!quiet) render();
}

function startDeleteExercise(name){ deletingExercise = name; render(); }
function cancelDeleteExercise(){ deletingExercise = null; render(); }
function confirmDeleteExercise(name){
  delete data[name];
  deletingExercise = null;
  if(selected === name) selected = (view !== "overview" && DAY_ORDER[view] && DAY_ORDER[view].length) ? DAY_ORDER[view][0] : null;
  persist();
  enqueueOp({ id: genId(), type: "delete_exercise", payload: { name } });
  render();
}

function saveEditEntry(name, idx){
  const ex = data[name];
  const entry = ex.entries[idx];
  const dateVal = document.getElementById("edit-date").value || entry.date;
  const noteVal = document.getElementById("edit-note").value || "";
  const difficultyEl = document.getElementById("edit-difficulty");
  entry.date = dateVal;
  entry.note = noteVal.trim();
  entry.difficulty = difficultyEl && difficultyEl.value ? Math.max(1, Math.min(10, Number(difficultyEl.value))) : null;

  if(ex.trackBy === "duration"){
    const minutesEl = document.getElementById("edit-minutes");
    if(minutesEl) entry.minutes = Number(minutesEl.value) || entry.minutes;
    const tempEl = document.getElementById("edit-temp");
    if(tempEl) entry.tempF = tempEl.value ? Number(tempEl.value) : null;
    if(ex.trackDistance){
      const distEl = document.getElementById("edit-distance");
      entry.distance = distEl && distEl.value ? Number(distEl.value) : null;
    }
    if(ex.trackSpeed){
      const speedEl = document.getElementById("edit-speed");
      entry.speed = speedEl && speedEl.value ? Number(speedEl.value) : null;
    }
    if(ex.trackIncline){
      const inclineEl = document.getElementById("edit-incline");
      entry.incline = inclineEl && inclineEl.value ? Number(inclineEl.value) : null;
    }
  } else {
    const isBodyweight = ex.trackBy === "reps";
    const weightEl = document.getElementById("edit-weight");
    entry.sets = Number(document.getElementById("edit-sets").value) || entry.sets;
    entry.reps = Number(document.getElementById("edit-reps").value) || entry.reps;
    if(!isBodyweight && weightEl) entry.weight = Number(weightEl.value) || entry.weight;
  }

  // Keep entries sorted by date in case the edited date moved it
  ex.entries.sort((a,b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .forEach((e,i) => { e.label = "S" + (i+1); });

  editingKey = null;
  persist();
  enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: name, clientId: entry.clientId } });
  render();
}

function confirmDeleteEntry(name, idx){
  const ex = data[name];
  const clientId = ex.entries[idx].clientId;
  ex.entries.splice(idx, 1);
  ex.entries.forEach((e,i) => { e.label = "S" + (i+1); });
  deletingKey = null;
  persist();
  enqueueOp({ id: genId(), type: "delete_entry", payload: { clientId } });
  render();
}

// A thin line stopwatch in the button's own color, in place of the emoji.
const STOPWATCH_ICON = `<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9.2" r="5.3"/><path d="M8 9.2V6.4M6.4 1.8h3.2M8 1.8v2.1M12.4 4.6l1-1"/></svg>`;
// Deload Week starts the note with this, so the history and the coach read the session as planned.
const DELOAD_NOTE = "Deload";
function renderForm(name, ex){
  let html = "";
  if(ex.entries.length){
    html += `<div class="action-row">`;
    html += `<button type="button" class="tool-btn" onclick="repeatLast('${name.replace(/'/g,"\\'")}')">↻ ${isRecovery(name) ? "Repeat last" : "Repeat set"}</button>`;
    html += renderProgressionToggle(name, ex);
    if(ex.trackBy !== "duration"){
      html += `<button type="button" class="rest-action-btn" onclick="startRestTimer('${name.replace(/'/g,"\\'")}')" aria-label="Start rest timer, ${restTimeFor(ex)}">${STOPWATCH_ICON}${restTimeFor(ex)}</button>`;
    } else {
      html += `<button type="button" class="action-btn-spacer" tabindex="-1" aria-hidden="true">-</button>`;
    }
    html += `</div>`;
  }
  html += `<div class="form-row">`;
  // The form starts on this session's recommendation, so logging it as prescribed takes one tap:
  // the modifier-adjusted plan when a modifier changes this lift's numbers, otherwise the next
  // progression. Lifts set to carry their last reps (Back Extension) keep doing so unless a
  // modifier sets the reps. A first-ever log has no recommendation and starts as before.
  const mods = planModifiers(name, ex);
  const plan = ex.entries.length ? computeSuggestion(ex, name) : null;
  let repsDefault = (ex.autoloadLastReps && ex.entries.length) ? ex.entries[ex.entries.length - 1].reps : effectiveTargetReps(ex);
  let setsDefault = 3;
  let weightDefault = "";
  let minutesDefault = "";
  // Recovery starts on the last session's minutes and temperature, or the usual dose.
  const recovery = isRecovery(name);
  const lastLog = ex.entries[ex.entries.length - 1];
  if(recovery) minutesDefault = lastLog ? lastLog.minutes : RECOVERY[name].minutes;
  if(plan){
    if(plan.sets != null) setsDefault = plan.sets;
    if(plan.reps != null && (mods.length || !ex.autoloadLastReps)) repsDefault = plan.reps;
    if(ex.trackBy === "weight" && plan.weight != null) weightDefault = plan.weight;
    if(ex.trackBy === "duration" && plan.minutes != null) minutesDefault = plan.minutes;
  }
  // RPE rides in the numbers row, so the form is three short rows: numbers, note, date and log.
  const rpeField = `<div class="field field-rpe"><label>RPE</label><input type="number" inputmode="numeric" id="f-difficulty" min="1" max="10" value="7"></div>`;
  if(ex.trackBy === "weight"){
    html += `<div class="field"><label>${weightFieldLabel(name)}</label><input type="number" inputmode="decimal" id="f-weight" value="${weightDefault}"></div>`;
    html += `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="f-sets" value="${setsDefault}"></div>`;
    html += `<div class="field"><label>${repsFieldLabel(name, ex.unit)}</label><input type="number" inputmode="numeric" id="f-reps" value="${repsDefault}"></div>`;
  } else if(ex.trackBy === "duration"){
    html += `<div class="field"><label>Minutes</label><input type="number" inputmode="numeric" id="f-minutes" value="${minutesDefault}"></div>`;
    if(ex.trackDistance) html += `<div class="field"><label>Miles</label><input type="number" inputmode="decimal" step="0.1" id="f-distance"></div>`;
    if(ex.trackSpeed) html += `<div class="field"><label>MPH</label><input type="number" inputmode="decimal" step="0.1" id="f-speed"></div>`;
    if(ex.trackIncline) html += `<div class="field"><label>Incline %</label><input type="number" inputmode="decimal" step="0.5" id="f-incline"></div>`;
    if(recovery) html += `<div class="field"><label>Temp °F</label><input type="number" inputmode="numeric" id="f-temp" value="${lastLog && lastLog.tempF != null ? lastLog.tempF : RECOVERY[name].temp}"></div>`;
  } else {
    html += `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="f-sets" value="${setsDefault}"></div>`;
    html += `<div class="field"><label>${repsFieldLabel(name, ex.unit)}</label><input type="number" inputmode="numeric" id="f-reps" value="${repsDefault}"></div>`;
  }
  // Cardio already fills its row (minutes, miles, speed, incline), so RPE moves next to Note.
  if(ex.trackBy !== "duration") html += rpeField;
  html += `</div>`;
  if(plan) html += `<p class="prefill-note">${mods.length ? `Pre-filled: ${mods.join(", ")} plan` : "Pre-filled: next progression"}</p>`;
  html += `<div class="form-row">
    ${ex.trackBy === "duration" && !recovery ? rpeField : ""}<div class="field field-note"><input type="text" id="f-note" aria-label="Note" value="${[modes.deload && ex.trackBy !== "duration" && DELOAD_NOTE, isShoulderModified(name) && REHAB_NOTE].filter(Boolean).join(", ")}" placeholder="${recovery ? 'Note, e.g. after lifting' : ex.trackBy==='duration' ? 'Note, e.g. easy spin' : 'Note, e.g. felt heavy, or next: 185'}"></div>
  </div>`;
  html += `<div class="date-log-row">
    <div class="field"><input type="date" id="f-date" aria-label="Date" value="${todayISO()}"></div>
    <button class="log" onclick="logEntry()">${recovery ? "Log session" : "Log set"}</button>
  </div>`;
  return html;
}

function repeatLast(name){
  const ex = data[name];
  if(!ex.entries.length) return;
  const last = ex.entries[ex.entries.length - 1];
  if(ex.trackBy === "duration"){
    const m = document.getElementById("f-minutes");
    if(m) m.value = last.minutes;
    const dist = document.getElementById("f-distance");
    if(dist && last.distance != null) dist.value = last.distance;
    const spd = document.getElementById("f-speed");
    if(spd && last.speed != null) spd.value = last.speed;
    const incl = document.getElementById("f-incline");
    if(incl && last.incline != null) incl.value = last.incline;
    const temp = document.getElementById("f-temp");
    if(temp && last.tempF != null) temp.value = last.tempF;
  } else {
    const w = document.getElementById("f-weight");
    const s = document.getElementById("f-sets");
    const r = document.getElementById("f-reps");
    if(w) w.value = last.weight;
    if(s) s.value = last.sets;
    if(r) r.value = last.reps;
  }
  const d = document.getElementById("f-difficulty");
  if(d && last.difficulty) d.value = last.difficulty;
}

function chartValue(e, ex){
  if(ex.trackBy === "weight") return e.weight;
  if(ex.trackBy === "duration") return e.minutes;
  return e.reps;
}

function suggestionValue(suggestion, ex){
  if(ex.trackBy === "weight") return suggestion.weight;
  if(ex.trackBy === "duration") return suggestion.minutes;
  return suggestion.reps;
}

// Retroactively flags any point where the weight dropped right after a
// 3+ session stall at the prior weight - i.e. a deload, whether the user
// followed the app's suggestion exactly or just dropped weight themselves.
function computeDeloadFlags(ex){
  const entries = ex.entries;
  const flags = new Array(entries.length).fill(false);
  if(ex.trackBy !== "weight") return flags;
  const targetReps = effectiveTargetReps(ex);
  for(let i = 1; i < entries.length; i++){
    const prev = entries[i-1], cur = entries[i];
    if(cur.weight < prev.weight){
      let missStreak = 0;
      for(let j = i-1; j >= 0; j--){
        const e = entries[j];
        if(e.weight === prev.weight && e.reps < targetReps) missStreak++;
        else break;
      }
      if(missStreak >= 3) flags[i] = true;
    }
  }
  return flags;
}

