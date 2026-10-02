// Rendering and day pages: tabs, pill row, exercise card, checklists, history, edit and delete, log form.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- rendering ----------
let lastRenderedView = null;
function render(){
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
  if(v !== "overview" && DAY_ORDER[v] && DAY_ORDER[v].length) selected = DAY_ORDER[v][0];
  render();
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
  const customExercises = Object.keys(data).filter(k => !allDayNames().includes(k) && (data[k].day || "full") === day);
  const list = getDisplayOrder(day).concat(customExercises);

  let html = `<div class="pill-row" id="pill-scroll">`;
  list.forEach((name, i) => {
    const loggedToday = isLoggedToday(name);
    // Preseason-flagged exercises get a light purple pill so they're
    // visible at a glance in the row, and a darker solid purple instead
    // of the usual amber when they're also the selected/active pill.
    const isPreseasonPill = modes.preseason && !!(EXERCISE_DEFAULTS[name] && EXERCISE_DEFAULTS[name].preseason);
    const pillClasses = ['pill'];
    if(isPreseasonPill) pillClasses.push('preseason-pill');
    if(day === "extra" && EXTRA_CATEGORY[name]) pillClasses.push('cat-' + EXTRA_CATEGORY[name]);
    if(selected===name) pillClasses.push('active');
    if(loggedToday) pillClasses.push('logged-today');
    html += `<div class="${pillClasses.join(' ')}" onclick="selectExercise('${name.replace(/'/g,"\\'")}')">${(day !== "extra" && i < activeDayOrder(day).length) ? (i+1)+'. ' : ''}${name}${loggedToday?' ✓':''}</div>`;
  });
  html += `<div class="pill pill-add" onclick="toggleAddExercise()">+</div></div>`;
  html += `<div id="add-ex-row" style="display:none" class="add-ex-row">
    <input id="new-ex-name" placeholder="Exercise name">
    <button onclick="addExercise()">Add</button>
  </div>`;

  if(DAY_ORDER[day].includes(selected) && !activeDayOrder(day).includes(selected)) selected = activeDayOrder(day)[0];
  let ex = data[selected];
  if(!ex && DAY_ORDER[day].includes(selected)){
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
    ↗ ${ex.conservative ? "Conservative" : "Standard"}
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

function renderChecklistCard(name, ex){
  const routine = CHECKLIST_ROUTINES[name];
  const entry = ex.entries.find(e => e.date === todayISO());
  const completed = new Set(entry ? entry.completedIndices || [] : []);

  let html = `<div class="card">`;
  html += `<h2 class="ex-name">${name}</h2>`;
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
  return on;
}

// One line of form, one line of swap, under the Next box.
function renderTips(name){
  const t = EXERCISE_TIPS[name];
  if(!t) return "";
  return `<div class="ex-tips"><div><b>Form</b> ${t[0]}</div><div><b>Swap</b> ${t[1]}</div></div>`;
}

function renderExerciseCard(name, ex){
  if(ex.trackBy === "checklist") return renderChecklistCard(name, ex);
  const hasEntries = ex.entries.length > 0;
  const last = hasEntries ? ex.entries[ex.entries.length-1] : null;
  const first = hasEntries ? ex.entries[0] : null;
  const suggestion = computeSuggestion(ex, name);
  const skiActive = modes.ski && !!ex.targetRepsSki;
  const kneeActive = modes.knee && KNEE_SENSITIVE_EXERCISES.has(name);
  const backActive = modes.back && LOW_BACK_SENSITIVE_EXERCISES.has(name);
  const preseasonActive = modes.preseason && !!ex.preseason;
  const deloadActive = modes.deload && ex.trackBy !== "duration";

  const isCustom = !allDayNames().includes(name);

  let html = `<div class="card${skiActive ? ' ski-mode' : ''}${kneeActive ? ' knee-mode' : ''}${backActive ? ' back-mode' : ''}${preseasonActive ? ' preseason-mode' : ''}">`;
  if(isCustom && deletingExercise === name){
    html += `<div class="ex-name-row">
      <span style="color:var(--slate);font-size:0.85rem;">Delete "${escapeHtml(name)}" and all its logged history?</span>
      <span class="row-actions">
        <button class="danger-btn" onclick="confirmDeleteExercise('${name.replace(/'/g,"\\'")}')">Yes, delete</button>
        <button class="cancel-btn" onclick="cancelDeleteExercise()">Cancel</button>
      </span>
    </div>`;
  } else {
    html += `<h2 class="ex-name">${name}${skiActive ? '<span class="ski-badge">🎿 Ski</span>' : ''}${kneeActive ? '<span class="knee-badge">🦵 Knee Care</span>' : ''}${backActive ? '<span class="back-badge">🩺 Back Care</span>' : ''}${preseasonActive ? '<span class="preseason-badge">🏔️ Preseason</span>' : ''}${deloadActive ? '<span class="deload-badge">🔋 Deload</span>' : ''}${isCustom ? `<button class="icon-btn" onclick="startDeleteExercise('${name.replace(/'/g,"\\'")}')" aria-label="Delete exercise" style="float:right;font-size:1rem;">✕</button>` : ''}</h2>`;
  }
  if(kneeActive && KNEE_CARE_TIP[name]){
    html += `<div class="care-line knee-care-line">${KNEE_CARE_TIP[name]}</div>`;
  }
  if(backActive && LOW_BACK_CARE_TIP[name]){
    html += `<div class="care-line back-care-line">${LOW_BACK_CARE_TIP[name]}</div>`;
  }
  if(kneeActive || backActive){
    html += `<p class="care-disclaimer">Load adjustment only, not a substitute for a PT or doctor.</p>`;
  }
  if(skiActive && ex.skiTempo){
    html += `<div class="ski-tempo-line">Ski tempo: ${ex.skiTempo} · target ${ex.targetRepsSki} reps</div>`;
  }
  if(preseasonActive && ex.preseasonTempo){
    html += `<div class="preseason-line">Preseason tempo: ${ex.preseasonTempo} · target ${ex.targetRepsPreseason} reps</div>`;
  }
  if(preseasonActive && ex.preseasonNote){
    html += `<div class="preseason-line">${ex.preseasonNote}${ex.preseasonWeek3 ? ' <b>Add from week 3.</b>' : ''}</div>`;
  }

  if(!hasEntries){
    html += `<p style="color:var(--slate);font-size:0.8rem;margin:0.2rem 0;">No entries yet - log your first set below.</p>`;
    html += renderTips(name);
  } else {
    const delta = ex.entries.length > 1
      ? (ex.trackBy==="weight" ? last.weight-first.weight : ex.trackBy==="duration" ? last.minutes-first.minutes : last.reps-first.reps)
      : 0;
    const deltaColor = delta>0 ? "color:var(--emerald)" : delta<0 ? "color:var(--amber)" : "color:var(--slate)";
    const bigVal = ex.trackBy==="weight" ? last.weight+" lbs" : ex.trackBy==="duration" ? last.minutes+" min" : last.reps+" reps";

    html += `<div class="weight-row">
      <div class="weight-main">
        <span class="big-val">${bigVal}</span>
      </div>
      ${ex.trackBy === "weight" ? render1RMInline(name, ex, last) : ''}
    </div>`;

    if(ex.entries.length>1){
      html += `<div class="delta-line" style="${deltaColor}">${delta>0?'+':''}${delta} since first</div>`;
    }

    let recHtml = "";
    if(suggestion){
      const unitWord = ex.unit === "sec" ? "hold time" : "reps";
      let msg;
      let nextLabel;
      if(ex.trackBy === "weight"){
        nextLabel = `${suggestion.weight} lbs ${repLabel(suggestion.sets,suggestion.reps,ex.unit)}`;
        // When the prior session's actual reps beat the target, call that out by
        // name with the real number instead of flattening it to a plain "hit
        // target" - going over is a stronger, more specific signal than a bare hit.
        const wentOverTarget = suggestion.hitTarget && !suggestion.deload && !suggestion.deloadWeek && last.reps > suggestion.reps;
        const actualAmt = ex.unit === "sec" ? `${last.reps} sec` : `${last.reps} reps`;
        const targetAmt = ex.unit === "sec" ? `${suggestion.reps} sec` : `${suggestion.reps} reps`;
        const hitLeadIn = wentOverTarget
          ? `Went over target ${unitWord} (did ${actualAmt}, target is ${targetAmt})`
          : `Hit target ${unitWord}`;
        if(suggestion.deloadWeek){
          msg = suggestion.deloadKeptReduction
            ? `Deload: already reduced, so same weight, fewer sets. Stop around RPE 6, 3 to 4 reps short of failure.`
            : `Deload: ~10% lighter, a third fewer sets. Stop around RPE 6, 3 to 4 reps short of failure.`;
        } else if(suggestion.atRepCap){
          msg = `Heaviest bell at ${MAX_WEIGHT_REP_CAP} reps: go single-arm, or add a 1 sec hold at the top.`;
        } else if(suggestion.atMaxWeight && suggestion.readyToProgress){
          msg = `Heaviest bell: add reps. Go single-arm at ${MAX_WEIGHT_REP_CAP}.`;
        } else if(suggestion.noteTarget != null && !(suggestion.careFlags && suggestion.careFlags.length)){
          msg = `From your note: "${escapeHtml(suggestion.noteText)}"`;
        } else if(suggestion.deload){
          msg = `Missed target ${unitWord} ${suggestion.missStreak} sessions straight: drop ~15% and rebuild.`;
        } else if(suggestion.noteConcern){
          msg = suggestion.hitTarget
            ? `${hitLeadIn}, but your note said "${escapeHtml(suggestion.noteConcern)}": hold.`
            : `Missed target ${unitWord}, note said "${escapeHtml(suggestion.noteConcern)}": hold.`;
        } else if(suggestion.careFlags && suggestion.careFlags.length){
          const flagLabel = suggestion.careFlags.map(f => f === "knee" ? "Knee Care" : "Low Back Care").join(" + ");
          msg = suggestion.noteTarget != null
            ? `${flagLabel}: your note's lighter ${suggestion.noteTarget} lb.`
            : `${flagLabel}: ~10% lighter, holding.`;
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
        nextLabel = repLabel(suggestion.sets,suggestion.reps,ex.unit);
        msg = suggestion.deloadWeek ? `Deload: same reps, fewer sets. Stop around RPE 6, 3 to 4 reps short of failure.`
          : suggestion.powerHold ? `Power: hold reps; go higher or farther only while every rep stays fast.`
          : `Add 2 reps.`;
      }
      const restPart = ex.trackBy !== "duration" ? ` <span style="font-weight:400;">· Rest ${restTimeFor(ex)}</span>` : "";
      const rpePart = last.difficulty ? ` <span class="rec-rpe">Last RPE ${last.difficulty}</span>` : "";
      const loadLine = ex.equipment === "barbell" ? `<div class="plate-line">Load: ${platesLabel(suggestion.weight, ex.equipment)}</div>` : "";
      recHtml = `<div class="rec-box">
        <div class="rec-headline">Next: ${nextLabel}${restPart}</div>
        <div class="rec-desc">${msg}${rpePart}</div>
        ${loadLine}
      </div>`;
    }

    html += recHtml;
    html += renderTips(name);
    html += renderChart(ex, suggestion, true, name);
  }

  html += renderForm(name, ex);

  if(!hasEntries){
    html += `<div style="margin-top:0.7rem;"><p style="color:var(--slate);font-size:0.8rem;font-style:italic;">Nothing logged yet.</p></div>`;
  } else {
    // keep original array index attached so edit/delete target the right entry
    const reversed = ex.entries.map((e,i) => ({ e, i })).reverse(); // most recent first
    const recent = reversed.slice(0, 3);
    const older = reversed.slice(3);

    html += `<div style="margin-top:0.9rem;">`;
    html += `<h3 class="section" style="margin-bottom:0.4rem;">Recent History</h3>`;
    const histColLabel = ex.trackBy==="duration" ? "Cardio" : ex.trackBy==="weight" ? "Load" : "Sets";
    const cardioCls = ex.trackBy==="duration" ? " cardio" : "";
    html += `<div class="hist-row header${cardioCls}"><span>Date</span><span>${histColLabel}</span><span>RPE</span><span>Note</span></div>`;
    recent.forEach((r, idx) => { html += renderHistRow(r.e, r.i, idx === 0, ex, name); });

    if(older.length){
      html += `<button class="hist-toggle" onclick="toggleHistory('${name.replace(/'/g,"\\'")}')">Show earlier history (${older.length})</button>`;
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

function renderHistRow(e, idx, isLatest, ex, name){
  const key = name + "|" + idx;

  if(editingKey === key){
    const unitLabel = ex.unit === "sec" ? "Seconds" : "Reps";
    return `<div class="hist-edit-box">
      <div class="form-row">
        ${ex.trackBy==="weight" ? `<div class="field"><label>Weight</label><input type="number" inputmode="decimal" id="edit-weight" value="${e.weight}"></div>` : ""}
        ${ex.trackBy==="duration"
          ? `<div class="field"><label>Minutes</label><input type="number" inputmode="numeric" id="edit-minutes" value="${e.minutes}"></div>`
            + (ex.trackDistance ? `<div class="field"><label>Miles</label><input type="number" inputmode="decimal" step="0.1" id="edit-distance" value="${e.distance ?? ''}"></div>` : "")
            + (ex.trackSpeed ? `<div class="field"><label>MPH</label><input type="number" inputmode="decimal" step="0.1" id="edit-speed" value="${e.speed ?? ''}"></div>` : "")
            + (ex.trackIncline ? `<div class="field"><label>Incline %</label><input type="number" inputmode="decimal" step="0.5" id="edit-incline" value="${e.incline ?? ''}"></div>` : "")
          : `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="edit-sets" value="${e.sets}"></div>
             <div class="field"><label>${unitLabel}</label><input type="number" inputmode="numeric" id="edit-reps" value="${e.reps}"></div>`
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

  if(deletingKey === key){
    return `<div class="hist-row${isLatest?' latest':''}" style="grid-template-columns:1fr auto auto;">
      <span style="color:var(--slate);">Delete this entry?</span>
      <button class="danger-btn" onclick="confirmDeleteEntry('${name.replace(/'/g,"\\'")}', ${idx})">Yes, delete</button>
      <button class="cancel-btn" onclick="cancelDelete()">Cancel</button>
    </div>`;
  }

  // Narrow date, numbers and RPE columns; the note takes the rest in the body font, which fits
  // far more per line than the mono numbers.
  let html = `<div class="hist-row${isLatest?' latest':''}${ex.trackBy==="duration"?' cardio':''}">`;
  const tag = isLatest ? (e.date === todayISO() ? "Today" : "Latest") : "";
  html += `<span>${fmtDate(e.date)}${e.confirmed===false?'<span class="est">*</span>':''}${tag ? `<br><span class="latest-tag">${tag}</span>` : ''}</span>`;
  html += `<span class="exact">${formatEntryValue(e, ex)}</span>`;
  html += `<span class="exact">${e.difficulty ?? "-"}</span>`;
  html += `<span class="hist-note-cell">`;
  html += `<span class="note">${e.note ? escapeHtml(e.note) : ""}</span>`;
  html += `<span class="row-actions">
    <button class="icon-btn" onclick="startEdit('${name.replace(/'/g,"\\'")}', ${idx})" aria-label="Edit">✎</button>
    <button class="icon-btn" onclick="startDelete('${name.replace(/'/g,"\\'")}', ${idx})" aria-label="Delete">✕</button>
  </span>`;
  html += `</span>`;
  html += `</div>`;
  return html;
}

function startEdit(name, idx){ editingKey = name + "|" + idx; deletingKey = null; render(); }
function cancelEdit(){ editingKey = null; render(); }
function startDelete(name, idx){ deletingKey = name + "|" + idx; editingKey = null; render(); }
function cancelDelete(){ deletingKey = null; render(); }

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

function renderForm(name, ex){
  const unitLabel = ex.unit === "sec" ? "Seconds" : "Reps";
  let html = "";
  if(ex.entries.length){
    html += `<div class="action-row">`;
    html += `<button type="button" class="tool-btn" onclick="repeatLast('${name.replace(/'/g,"\\'")}')">↻ Repeat set</button>`;
    html += renderProgressionToggle(name, ex);
    if(ex.trackBy !== "duration"){
      html += `<button type="button" class="rest-action-btn" onclick="startRestTimer('${name.replace(/'/g,"\\'")}')">⏱ ${restTimeFor(ex)}</button>`;
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
  if(plan){
    if(plan.sets != null) setsDefault = plan.sets;
    if(plan.reps != null && (mods.length || !ex.autoloadLastReps)) repsDefault = plan.reps;
    if(ex.trackBy === "weight" && plan.weight != null) weightDefault = plan.weight;
    if(ex.trackBy === "duration" && plan.minutes != null) minutesDefault = plan.minutes;
  }
  // RPE rides in the numbers row, so the form is three short rows: numbers, note, date and log.
  const rpeField = `<div class="field field-rpe"><label>RPE</label><input type="number" inputmode="numeric" id="f-difficulty" min="1" max="10" value="7"></div>`;
  if(ex.trackBy === "weight"){
    html += `<div class="field"><label>Weight</label><input type="number" inputmode="decimal" id="f-weight" value="${weightDefault}"></div>`;
    html += `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="f-sets" value="${setsDefault}"></div>`;
    html += `<div class="field"><label>${unitLabel}</label><input type="number" inputmode="numeric" id="f-reps" value="${repsDefault}"></div>`;
  } else if(ex.trackBy === "duration"){
    html += `<div class="field"><label>Minutes</label><input type="number" inputmode="numeric" id="f-minutes" value="${minutesDefault}"></div>`;
    if(ex.trackDistance) html += `<div class="field"><label>Miles</label><input type="number" inputmode="decimal" step="0.1" id="f-distance"></div>`;
    if(ex.trackSpeed) html += `<div class="field"><label>MPH</label><input type="number" inputmode="decimal" step="0.1" id="f-speed"></div>`;
    if(ex.trackIncline) html += `<div class="field"><label>Incline %</label><input type="number" inputmode="decimal" step="0.5" id="f-incline"></div>`;
  } else {
    html += `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="f-sets" value="${setsDefault}"></div>`;
    html += `<div class="field"><label>${unitLabel}</label><input type="number" inputmode="numeric" id="f-reps" value="${repsDefault}"></div>`;
  }
  // Cardio already fills its row (minutes, miles, speed, incline), so RPE moves next to Note.
  if(ex.trackBy !== "duration") html += rpeField;
  html += `</div>`;
  if(plan) html += `<p class="prefill-note">${mods.length ? `Pre-filled: ${mods.join(", ")} plan` : "Pre-filled: next progression"}</p>`;
  html += `<div class="form-row">
    ${ex.trackBy === "duration" ? rpeField : ""}<div class="field field-note"><label>Note</label><input type="text" id="f-note" placeholder="${ex.trackBy==='duration' ? 'e.g. easy spin' : 'e.g. felt heavy, or next: 185'}"></div>
  </div>`;
  html += `<div class="date-log-row">
    <div class="field"><label>Date</label><input type="date" id="f-date" value="${todayISO()}"></div>
    <button class="log" onclick="logEntry()">Log set</button>
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

