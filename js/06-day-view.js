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
  syncHoldButton();
}

function renderTabs(){
  document.getElementById("tabs").innerHTML = tabOrder().map(v =>
    `<div class="tab ${view===v?'active':''}" onclick="switchView('${v}')">${v==='overview'?'Overview':DAY_TITLES[v]}</div>`
  ).join("");
  document.getElementById("page-title").textContent = view === "overview" ? "Overview" : DAY_TITLES[view];
  document.getElementById("page-sub").textContent = view === "overview"
    ? "Aggregate progress across everything you've logged."
    : "Tap a day, log your sets, watch progress build.";
}

function switchView(v){
  const tabs = tabOrder(), from = tabs.indexOf(view);
  view = v;
  if(v === "extra") selected = extraList(extraGroup)[0];
  else if(v !== "overview" && DAY_ORDER[v] && DAY_ORDER[v].length) selected = DAY_ORDER[v][0];
  navTransition("tab", tabs.indexOf(v) < from ? "back" : "fwd", render);
}

// ---------- view transitions ----------
// Tab switches and lift picks animate with the View Transitions API: the browser snapshots the old
// screen, render() runs, and CSS slides the new one in from the side it came from (a tab: the whole
// page below the header; a lift: its card, while the amber highlight glides to the new tab or pill).
// State changes before the call; only the repaint waits a frame. No API, reduced motion or a test
// browser (navigator.webdriver; scenario 105 turns it on) just renders.
let viewTransitions = !navigator.webdriver;
let vtSeq = 0;
function navTransition(kind, dir, update){
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(!viewTransitions || !document.startViewTransition || reduce){ update(); return null; }
  const root = document.documentElement, id = ++vtSeq;
  const nameCard = () => { const c = kind === "card" && document.querySelector("#app .card"); if(c) c.style.viewTransitionName = "vt-card"; };
  root.dataset.vt = kind;
  root.dataset.vtDir = dir;
  nameCard();
  const t = document.startViewTransition(() => { update(); nameCard(); });
  t.finished.catch(() => {}).then(() => {
    if(id !== vtSeq) return; // a newer transition owns the marks
    delete root.dataset.vt;
    delete root.dataset.vtDir;
    const c = document.querySelector("#app .card");
    if(c) c.style.viewTransitionName = "";
  });
  return t;
}
// Which way a lift pick moves along the pill row, read from the row on screen.
function pillDirection(name){
  const pills = [...document.querySelectorAll("#pill-scroll .pill[data-name]")];
  const from = pills.findIndex(p => p.classList.contains("active")), to = pills.findIndex(p => p.dataset.name === name);
  return to < from ? "back" : "fwd";
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
  const keys = EXTRA_GROUPS.map(g => g.key), dir = keys.indexOf(group) < keys.indexOf(extraGroup) ? "back" : "fwd";
  extraGroup = group;
  saveExtraPrefs();
  selected = extraList(group)[0];
  navTransition("card", dir, render);
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

// The pill row's visual order only (power first: preseason power work, or Box Jumps in season). Everything else reads DAY_ORDER as is,
// so a tab still opens on its main lift.
function getDisplayOrder(day){
  const order = activeDayOrder(day);
  if(!modes.preseason && !modes.ski) return order;
  const isPower = name => !!(EXERCISE_DEFAULTS[name] && EXERCISE_DEFAULTS[name].preseasonPower) && (modes.preseason || IN_SEASON_KEEP.has(name));
  const power = order.filter(isPower);
  if(!power.length) return order;
  return power.concat(order.filter(name => !isPower(name)));
}

function renderDay(day){
  const app = document.getElementById("app");
  // A custom lift saved under the other program's day shows on its matching day (Full = A, Upper = B, Lower = C).
  const homeDay = d => programDays().includes(d) ? d : { full: "a", upper: "b", lower: "c", a: "full", b: "upper", c: "lower" }[d];
  const customExercises = Object.keys(data).filter(k => k !== REHAB_NAME && !allDayNames().includes(k) && homeDay(data[k].day || "full") === day);
  // Shoulder Rehab leads every day's row while it is on, unnumbered so the lifts keep their numbers.
  const lead = modes.shoulder ? [REHAB_NAME] : [];
  // Bridges join a day after its numbered lifts while their modifier is on: Push-Ups (Shoulder
  // Rehab) on Full Body (A and B; Upper has them already), Spanish Squat (Knee Care) on Lower and Full Body (A and B).
  const bridge = [];
  if(modes.shoulder && ["upper", "full", "a", "b"].includes(day)) bridge.push(PUSHUP_NAME);
  if(modes.knee && ["lower", "full", "a", "b"].includes(day)) bridge.push(...KNEE_ONLY);
  const finishers = day === "extra" ? [] : finishersFor(day);
  let list, added = [];
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
    const base = lead.concat(getDisplayOrder(day), bridge.filter(n => !getDisplayOrder(day).includes(n)), customExercises);
    added = addedLifts(day).filter(n => !base.includes(n) && !finishers.includes(n));
    list = base.concat(added, finishers);
  }
  if(selected === REHAB_NAME && !modes.shoulder) selected = activeDayOrder(day)[0];

  // Mobility is one card, so its group needs no pill of its own (only Shoulder Rehab, when on).
  const hidePills = day === "extra" && extraGroup === "mobility" && !lead.length;
  const due = day === "extra" ? {} : dueLifts();
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
    if(name === REHAB_NAME || (name === PUSHUP_NAME && bridge.includes(name) && !activeDayOrder(day).includes(name))) pillClasses.push('rehab-pill');
    if(day !== "extra" && KNEE_ONLY.has(name)) pillClasses.push('knee-pill');
    if(name === MOBILITY_NAME) pillClasses.push('cat-stretch');
    if(finishers.includes(name)) pillClasses.push('finisher-pill');
    if(added.includes(name)) pillClasses.push(isKept(day, name) ? 'added-pill kept' : 'added-pill');
    if(day === "extra" && EXTRA_CATEGORY[name]) pillClasses.push('cat-' + EXTRA_CATEGORY[name]);
    if(selected===name) pillClasses.push('active');
    const skipped = !loggedToday && skipReason(name);
    const paused = !loggedToday && !skipped && isShoulderPaused(name);
    if(loggedToday) pillClasses.push('logged-today');
    if(skipped || paused) pillClasses.push('skipped-today');
    const n = i - lead.length;
    if(!loggedToday && !skipped && !paused && due[name]) pillClasses.push('due');
    const title = skipped ? ` title="Skipped today: ${SKIP_REASONS[skipped]}"` : paused ? ` title="Paused: Shoulder Rehab"`
      : due[name] && !loggedToday ? ` title="Due: missed its last ${due[name].missedSessions} sessions"` : '';
    // A due lift says how long it has been ("12d") in amber, so it stands out in the row.
    const dueTag = pillClasses.includes('due') ? `<span class="due-tag">${due[name].daysSince}d</span>` : "";
    html += `<div class="${pillClasses.join(' ')}" data-name="${escapeHtml(name)}" onclick="selectExercise('${name.replace(/'/g,"\\'")}')"${title}>${(day !== "extra" && n >= 0 && n < activeDayOrder(day).length) ? (n+1)+'. ' : ''}${name}${loggedToday?' ✓':''}${dueTag}</div>`;
  });
  html += `<div class="pill pill-add" onclick="${day === "extra" ? "toggleAddExercise()" : "openLibrary()"}" aria-label="${day === "extra" ? "Add an exercise" : "Exercise library"}">+</div></div>`;
  html += `<div id="add-ex-row" style="display:none" class="add-ex-row">
    <input id="new-ex-name" placeholder="Exercise name">
    <button onclick="addExercise()">Add</button>
  </div>`;

  if(DAY_ORDER[day].includes(selected) && !activeDayOrder(day).includes(selected) && !added.includes(selected)) selected = activeDayOrder(day)[0];
  if(selected === MOBILITY_NAME){
    app.innerHTML = html + renderMobilityCard();
    return;
  }
  let ex = selected === REHAB_NAME && modes.shoulder ? ensureRehabExercise() : data[selected];
  if(!ex && (DAY_ORDER[day].includes(selected) || bridge.includes(selected) || finishers.includes(selected) || added.includes(selected))){
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
    <span class="onerm-val">${oneRM} lb ✎</span>
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

// Top right of the card: Est. 1RM on the main barbell lifts (and custom lifts, or any lift with a
// tested 1RM); everything else shows its rep record at today's weight, the number it is chasing.
function topRightSlot(name, ex, work, now, isCustom){
  if(ex.trackBy === "weight" && (COMPOUND_LIFTS.has(name) || ex.actual1RM || isCustom)) return render1RMInline(name, ex, work);
  if(ex.trackBy !== "weight" && ex.trackBy !== "reps") return "";
  const loaded = ex.trackBy === "weight" && now.weight > 0;
  const rec = repRecord(ex, loaded ? now.weight : 0);
  const label = ex.unit === "sec" ? "Longest hold" : "Most reps";
  const val = !rec ? "New weight" : `${rec.reps} ${ex.unit === "sec" ? "sec" : "reps"}${loaded && rec.weight !== now.weight ? ` at ${rec.weight} lb` : ""}`;
  return `<div class="onerm-box rep-record"><span class="onerm-label">${label}</span><span class="onerm-val">${val}</span></div>`;
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
  html += `<div class="ex-title-row"><h2 class="ex-name">${opts && opts.title || name}</h2>${routineButton(`playChecklist('${name.replace(/'/g,"\\'")}')`, name, name, routineItemsFor(name).map((_, i) => i))}</div>`;
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
  html += `<div class="hist-foot"><p style="font-size:0.72rem;color:var(--slate);margin:0;">${doneCount}/${routine.items.length} done today</p>${renderSkipControl(name)}</div>`;
  html += `</div>`;
  return html;
}

function renderExerciseCard(name, ex){
  if(name === REHAB_NAME) return renderRehabCard();
  if(ex.trackBy === "checklist") return renderChecklistCard(name, ex);
  const hasEntries = ex.entries.length > 0;
  const last = hasEntries ? ex.entries[ex.entries.length-1] : null;
  const work = hasEntries ? lastWorking(ex) : null; // last non-deload session: where the lift stands
  const first = hasEntries ? ex.entries[0] : null;
  const suggestion = computeSuggestion(ex, name);
  const mods = modifiersOn(name, ex), on = key => mods.some(m => m.key === key);
  const skiActive = on("ski"), kneeActive = on("knee"), backActive = on("back"), preseasonActive = on("preseason");
  const recovery = isRecovery(name);

  const isCustom = !allDayNames().includes(name);
  // "+20 since first" rides in the Recent History heading, with the rest of the card's history.
  const delta = ex.entries.length > 1
    ? (ex.trackBy==="weight" ? work.weight-first.weight : ex.trackBy==="duration" ? work.minutes-first.minutes : work.reps-first.reps)
    : 0;
  const deltaUnit = ex.trackBy === "weight" ? "lb" : ex.trackBy === "duration" ? "min" : ex.unit === "sec" ? "sec" : "reps";
  const deltaHtml = ex.entries.length > 1 && !recovery ? `<span class="delta-line ${delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : ""}">${delta>0?'+':''}${delta} ${deltaUnit} since first</span>` : "";
  // The big number is the weight to lift today, or what was logged today once it is. The top right
  // keeps the last day a full session was lifted, before today, so the two never get mixed up.
  const today = todayISO();
  const todayLog = recovery ? null : [...ex.entries].reverse().find(e => e.date === today) || null;
  const prs = prFlags(ex);
  const prior = [...ex.entries].reverse().find(e => e.date < today && !e.deload) || null;
  // A main lift's heavy and volume days are judged against the last session on the same track.
  const onTrack = e => !suggestion || suggestion.heavy == null || isHeavyEntry(ex, e) === suggestion.heavy;
  const trackPrior = [...ex.entries].reverse().find(e => e.date < today && !e.deload && onTrack(e)) || null;
  const trackWork = (hasEntries && [...ex.entries].reverse().find(e => !e.deload && onTrack(e))) || work;
  // Just the weight; a tap adds the date, on every card, until tapped again.
  const priorHtml = prior && !recovery ? `<button type="button" class="last-line" onclick="toggleLastDate()" aria-pressed="${lastDateShown}" title="${fmtShortDate(prior.date)}">Last: ${shortValue(name, ex, prior)}${lastDateShown ? ` · ${fmtShortDate(prior.date)}` : ""}</button>` : "";

  // Active modifiers: each badge starts its own note (Knee Care on the knee tip, and so on), so the
  // pill and what it changes read together. Badges with no note on this lift (Deload) sit in a strip
  // above the notes.
  const usedBadges = new Set();
  const badgeOf = m => `<span class="${m.key}-badge">${m.emoji} ${typeof m.badge === "function" ? m.badge(name) : m.badge}</span>`;
  const pill = key => { const m = mods.find(x => x.key === key); if(!m || usedBadges.has(key)) return ""; usedBadges.add(key); return badgeOf(m); };
  let modHtml = "";
  if(kneeActive && KNEE_CARE_TIP[name]){
    modHtml += `<div class="care-line knee-care-line">${pill("knee")}${KNEE_CARE_TIP[name]}</div>`;
  }
  if(backActive && LOW_BACK_CARE_TIP[name]){
    modHtml += `<div class="care-line back-care-line">${pill("back")}${LOW_BACK_CARE_TIP[name]}</div>`;
  }
  const shoulderTip = shoulderCardTip(name);
  if(shoulderTip){
    modHtml += `<div class="care-line shoulder-care-line">${pill("shoulder")}${shoulderTip}</div>`;
  }
  // One line per modifier: its pill, then its notes run together, so nothing is left dangling on a
  // line of its own. The pill names the modifier, so the text never repeats it.
  // Tempo copy comes from the app's defaults first, so a wording change reaches lifts saved earlier.
  // A main lift's volume day under Preseason or Ski is 3x8 at normal speed; the tempo belongs to its heavy day.
  const volumeDay = !!(ex.targetRepsStrength && suggestion && suggestion.heavy === false);
  const skiTempo = (EXERCISE_DEFAULTS[name] || {}).skiTempo || ex.skiTempo;
  const ski = [modes.ski && ex.inSeasonNote, skiActive && skiTempo ? (volumeDay ? `Volume day: normal tempo. The ${skiTempo} is for the heavy day.` : `Tempo: ${skiTempo}, ${ex.targetRepsSki} reps.`) : ""].filter(Boolean);
  if(ski.length) modHtml += `<div class="ski-tempo-line">${pill("ski")}${ski.join(" ")}</div>`;
  const pre = [preseasonActive && ex.preseasonTempo ? (volumeDay ? `Volume day: normal tempo. The ${ex.preseasonTempo} is for the heavy day.` : `Tempo: ${ex.preseasonTempo}, ${ex.targetRepsPreseason} reps.`) : "",
    preseasonActive && ex.preseasonNote ? `${ex.preseasonNote}${ex.preseasonWeek3 && !(preseasonWeek() >= 3) ? ' <b>Add from week 3.</b>' : ''}` : ""].filter(Boolean);
  if(pre.length) modHtml += `<div class="preseason-line">${pill("preseason")}${pre.join(" ")}</div>`;

  const leftover = mods.filter(m => !usedBadges.has(m.key));
  if(leftover.length) modHtml = `<div class="mod-badges">${leftover.map(badgeOf).join("")}</div>` + modHtml;

  let html = `<div class="card${mods.filter(m => m.key !== "deload").map(m => ` ${m.key}-mode`).join("")}">`;
  const timerBtn = timerGroupFor(name, ex);
  let titleHtml;
  if(isCustom && deletingExercise === name){
    titleHtml = `<div class="ex-name-row">
      <span style="color:var(--slate);font-size:0.85rem;">Delete "${escapeHtml(name)}" and all its logged history?</span>
      <span class="row-actions">
        <button class="danger-btn" onclick="confirmDeleteExercise('${name.replace(/'/g,"\\'")}')">Yes, delete</button>
        <button class="cancel-btn" onclick="cancelDeleteExercise()">Cancel</button>
      </span>
    </div>`;
  } else {
    // The clock and what it will run ride at the right of the name row.
    titleHtml = `<div class="ex-title-row"><h2 class="ex-name">${name}${isCustom ? `<button class="icon-btn" onclick="startDeleteExercise('${name.replace(/'/g,"\\'")}')" aria-label="Delete exercise" style="float:right;font-size:1rem;">✕</button>` : ''}</h2>${timerBtn}</div>`;
  }
  if(!hasEntries){
    html += titleHtml + modHtml;
    // Same tile as every other lift, so the card never changes shape.
    html += recovery ? renderRecoveryTile(name, ex) : renderNextTile("Next: first session", ex, firstSessionGuidance(name, ex), loadText(name, ex, null));
    html += renderTips(name);
  } else {
    const sideTag = s => s ? `<span class="side-tag">${s}</span>` : "";
    const bigOf = v => ex.trackBy==="weight" ? v.weight+" lb" + sideTag(weightSuffix(name).trim() === "total" ? "" : weightSuffix(name))
      : ex.trackBy==="duration" ? v.minutes+" min" + (v.tempF != null ? sideTag(` ${v.tempF}°F`) : "") : v.reps+" "+(ex.unit === "sec" ? "sec" : repsWord(name)) + sideTag(sidesOf(name).reps === "steps" ? " total" : repsSuffix(name));
    let bigVal, bigLabel;
    if(recovery){ bigVal = bigOf(work); bigLabel = "Last"; }
    else if(todayLog){ bigVal = bigOf(todayLog); bigLabel = "Logged today ✓" + (prs[ex.entries.lastIndexOf(todayLog)] ? " · PR" : ""); }
    else if(suggestion && suggestion.shoulderPaused){ bigVal = "Paused"; bigLabel = "Today"; }
    else if(suggestion){ bigVal = bigOf(suggestion); bigLabel = "Today"; }
    else { bigVal = bigOf(work); bigLabel = "Last"; }

    // Card head: the name row (with the clock) across the top, then a grid so each pair lines up:
    // today's weight with Last, the label under the weight with the record.
    html += `<div class="card-head">
      ${titleHtml}
      <span class="big-val">${bigVal}</span><div class="ch-side">${priorHtml}</div>
      <span class="big-label${todayLog ? " locked" : ""}">${bigLabel}</span><div class="ch-side ch-rec">${topRightSlot(name, ex, work, todayLog || suggestion || work, isCustom)}</div>
    </div>`;
    html += modHtml;

    let recHtml = "";
    if(suggestion){
      const unitWord = ex.unit === "sec" ? "hold time" : "reps";
      // Today's change from the last full session, in words ("5 lb heavier", "same weight"), so the
      // call says what to do with this set instead of "add" or "hold".
      const chg = stepText(ex, suggestion, trackPrior) || (ex.trackBy === "weight" ? "same weight" : ex.trackBy === "duration" ? "same time" : "same reps");
      const vsLast = /^same/.test(chg) ? "same as last time" : `${chg} than last time`;
      let msg;
      let nextLabel;
      if(ex.trackBy === "weight"){
        nextLabel = `<b>${suggestion.weight} lb${weightSuffix(name)}</b> · ${repLabel(suggestion.sets,suggestion.reps,ex.unit)}${repsSuffix(name)}`;
        // When the prior session's actual reps beat the target, call that out by
        // name with the real number instead of flattening it to a plain "hit
        // target" - going over is a stronger, more specific signal than a bare hit.
        const wentOverTarget = suggestion.hitTarget && !suggestion.range && !suggestion.deload && !suggestion.deloadWeek && trackWork.reps > suggestion.reps;
        const actualAmt = ex.unit === "sec" ? `${trackWork.reps} sec` : `${trackWork.reps} reps`;
        const targetAmt = ex.unit === "sec" ? `${suggestion.reps} sec` : `${suggestion.reps} reps`;
        const hitLeadIn = wentOverTarget
          ? `Went over target ${unitWord} (did ${actualAmt}, target is ${targetAmt})`
          : `Hit target ${unitWord}`;
        if(suggestion.shoulderPaused){
          nextLabel = "paused";
          msg = name === "Bicep Curl"
            ? `Left arm paused until week 3 of Shoulder Rehab. Right-arm hammer curls are fine now.`
            : `Paused for Shoulder Rehab until the side-raise press is pain-free.`;
        } else if(suggestion.painHold){
          msg = painMessage(suggestion, `${suggestion.weight} lb`);
        } else if(suggestion.shoulderHold){
          const h = suggestion.shoulderHold, inc = h.inc || incrementFor(ex, name);
          const share = h.first && h.fullWeight ? ` (${Math.round(h.pct * 100)}% of ${h.fullWeight})` : "";
          const cue = name === "Bicep Curl" ? "hammer curls, lower over 3 sec" : name === "Barbell Row" ? "palms-in grip, no shrug" : "medium grip, short of the chest";
          const next = h.atFull ? `Held at your pre-rehab weight until rehab is off.`
            : h.step ? `Up ${inc} lb after two clean sessions.`
            : h.streak === 1 ? `One more clean session adds ${inc} lb.` : `Two clean sessions add ${inc} lb.`;
          msg = `Rehab: ${suggestion.weight} lb${share}, ${cue}. ${next}`;
        } else if(suggestion.trackStart && !suggestion.deloadWeek && !suggestion.reentry){
          const ts = suggestion.trackStart;
          msg = `First ${suggestion.heavy ? "heavy" : "volume"} day: ${suggestion.weight} lb, worked out from your ${ts.from} lb x ${ts.fromReps}. Progresses on its own from here.`;
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
          const flagged = noteConcernWord(suggestion.noteConcern) || "a concern";
          msg = suggestion.hitTarget
            ? `${hitLeadIn}, but your note flagged ${flagged}: ${chg} today.`
            : `Missed target ${unitWord} and your note flagged ${flagged}: ${chg} today.`;
        } else if(suggestion.careFlags && suggestion.careFlags.length){
          const flagLabel = suggestion.careFlags.map(f => f === "knee" ? "Knee Care" : "Low Back Care").join(" + ");
          msg = suggestion.noteTarget != null
            ? `${flagLabel}: your note's lighter ${suggestion.noteTarget} lb.`
            : `${flagLabel}: ~10% lighter, holding.`;
        } else if(suggestion.noteCue === "hold"){
          msg = `${hitLeadIn}; ${chg} today, as your note said.`;
        } else if(suggestion.noteCue === "up"){
          msg = `${hitLeadIn}; ${chg} today, as your note said.`;
        } else if(suggestion.difficultyNote === "hard"){
          msg = `${hitLeadIn}, but rated 9-10: ${chg} today.`;
        } else if(suggestion.difficultyNote === "easy"){
          msg = `${hitLeadIn} and it felt easy: ${chg} today.`;
        } else if(suggestion.refit && !suggestion.deloadWeek){
          const [lo, hi] = suggestion.range;
          msg = `${suggestion.refit.fromReps} reps at ${suggestion.refit.from} lb is under the ${lo}-${hi} range: ${suggestion.weight} lb lands back in it.`;
        } else if(suggestion.range && !suggestion.deloadWeek){
          const [lo, hi] = suggestion.range;
          msg = suggestion.readyToProgress ? (suggestion.rangeEarly ? `${trackWork.reps} reps with reps to spare: ${chg} today, back to ${lo} reps a set.` : `Every set reached ${hi} reps: ${chg} today, back to ${lo} reps a set.`)
            : suggestion.hitTarget ? `${trackWork.reps} reps a set last time. Today: ${suggestion.reps} reps, same weight. ${pinStepFor(name) ? `Next pin once every set reaches ${hi}.` : `Add weight at ${suggestion.mid} with reps left, or ${hi}.`}`
            : `Under ${lo} reps last time: same weight, build back to ${lo} reps a set.`;
        } else if(suggestion.readyToProgress){
          if(ex.conservative){
            msg = wentOverTarget
              ? `Hit target ${unitWord} ${suggestion.streak} sessions straight (${actualAmt} last time): ${chg} today.`
              : `Hit target ${unitWord} ${suggestion.streak} sessions straight: ${chg} today.`;
          } else {
            msg = `${hitLeadIn}: ${chg} today.`;
          }
        } else if(suggestion.hitTarget){
          msg = `${hitLeadIn} (${suggestion.streak} of ${suggestion.requiredStreak} sessions needed): ${chg} today, one more time.`;
        } else {
          msg = `Missed target ${unitWord} last time: ${chg} today, get every rep before adding.`;
        }
      } else if(ex.trackBy === "duration"){
        nextLabel = `${suggestion.minutes} min`;
        msg = suggestion.difficultyNote === "easy"
          ? `Felt easy last time: ${chg} today.`
          : suggestion.difficultyNote === "hard"
          ? `Rated hard last time: ${chg} today.`
          : `Same time as last session.`;
      } else {
        nextLabel = repLabel(suggestion.sets,suggestion.reps,ex.unit) + repsSuffix(name);
        msg = suggestion.painHold ? painMessage(suggestion, null)
          : suggestion.deloadWeek ? `Deload: same reps, fewer sets. Stop around RPE 6, 3 to 4 reps short of failure.`
          : suggestion.powerHold ? `Power: hold reps; go higher or farther only while every rep stays fast.`
          : ex.unit === "sec" ? `Each hold ${suggestion.reps} sec today: ${vsLast}.`
          : `${suggestion.reps} ${repsWord(name)} a set today: ${vsLast}.`;
      }
      // Before today's log the weight is the big number, so the headline is the sets and reps and the
      // step from the last full session. Once today is logged, it plans the next session in full.
      let headline;
      if(todayLog) headline = suggestion.heavy != null ? `Next ${suggestion.heavy ? "heavy" : "volume"} day: ${nextLabel}` : `Next time: ${nextLabel}`;
      else if(suggestion.shoulderPaused) headline = "Paused today";
      else headline = [suggestion.heavy != null ? (suggestion.heavy ? "Heavy" : "Volume") : "", planShape(name, ex, suggestion)].filter(Boolean).join(" · ");
      recHtml = renderNextTile(headline, ex, composeGuidance(msg, name, ex, last, work, suggestion), suggestion.shoulderPaused ? "No load today" : loadText(name, ex, suggestion), !!todayLog);
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
    html += `<h3 class="section hist-head" style="margin-bottom:0.4rem;"><span>Recent History</span>${deltaHtml}</h3>`;
    const histColLabel = recovery ? "Session" : ex.trackBy==="duration" ? "Cardio" : ex.trackBy==="weight" ? "Load" + (sidesOf(name).weight === "total" ? "" : "/" + sidesOf(name).weight) : "Sets" + repsSuffix(name);
    const cardioCls = ex.trackBy==="duration" ? " cardio" : "";
    html += `<div class="hist-row header${cardioCls}"><span>Date</span><span>${histColLabel}</span><span>RPE</span><span>Note</span></div>`;
    recent.forEach((r, idx) => { html += renderHistRow(r.e, r.i, idx === 0, ex, name, prs[r.i]); });

    // One footer row: earlier history on the left, the newest PR in the middle (dated when it is
    // older than the rows shown, so every card with a record shows it), Skip today on the right.
    // While picking a skip reason the reasons take the whole row.
    const prRow = reversed.find(r => prs[r.i]);
    const prOld = prRow && !recent.includes(prRow);
    const picking = skipPicking === name;
    const prHtml = prRow && !picking ? `<span class="pr-detail"><b>PR</b> ${prText(prRow.e, ex, prs[prRow.i])}${prOld ? `, ${fmtShortDate(prRow.e.date)}` : ""}</span>` : "";
    // A fixed three-slot grid, so the PR line starts in the same place on every card.
    html += `<div class="hist-foot pr-foot${picking ? " picking" : ""}"><span class="foot-left">${older.length && !picking ? `<button class="hist-toggle" onclick="toggleHistory('${name.replace(/'/g,"\\'")}')">Earlier (${older.length})</button>` : ""}</span>${prHtml || "<span></span>"}${renderSkipControl(name)}</div>`;
    if(older.length){
      html += `<div class="hist ${openHistory[name] ? 'open' : ''}" id="hist-${cssId(name)}">`;
      older.forEach(r => { html += renderHistRow(r.e, r.i, false, ex, name, prs[r.i]); });
      html += `</div>`;
    }

    html += `</div>`;
  }
  html += `</div>`;
  return html;
}
