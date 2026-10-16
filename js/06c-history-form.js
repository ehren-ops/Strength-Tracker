// Below the Next tile: Recent History rows with edit, delete and skip; the log form with its
// per-set reps and joint check; and the chart value helpers. Shared global scope.

// Right end of the card footer, on every card: skip this lift today, for injury or another reason.
// Once it is logged, or paused by Shoulder Rehab, the same spot says so instead of going blank;
// while skipped, it shows the reason and an undo.
function renderSkipControl(name){
  if(isLoggedToday(name)) return `<div class="skip-ctl"><span class="skip-state">Done today ✓</span></div>`;
  if(isShoulderPaused(name)) return `<div class="skip-ctl"><span class="skip-state">Paused: Shoulder Rehab</span></div>`;
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

// Cardio in two short lines for the history column: "35 min · 1.8 mi" over "3.1 mph · 12%", so the
// note keeps the same room it has on a lift.
function cardioCell(e, ex){
  const has = v => v != null && v !== "";
  const pace = cardioPace(e, ex);
  const speed = !pace ? null : ex.rowing ? `${pace.calc ? "~" : ""}${fmtSplit(Math.round(pace.value))}/500` : `${pace.calc ? "~" : ""}${pace.value} mph`;
  const top = [`${e.minutes} min`, has(e.distance) && `${e.distance} ${ex.rowing ? "m" : "mi"}`].filter(Boolean).join(" · ");
  const bottom = [speed, has(e.spm) && `${e.spm} spm`, has(e.incline) && `${e.incline}%`].filter(Boolean).join(" · ");
  return bottom ? `${top}<br>${bottom}` : top;
}

function renderHistRow(e, idx, isLatest, ex, name, pr){
  const key = name + "|" + idx;

  if(editingKey === key){
    return `<div class="hist-edit-box">
      <div class="form-row">
        ${ex.trackBy==="weight" ? `<div class="field"><label>${weightFieldLabel(name)}</label><input type="number" inputmode="decimal" id="edit-weight" value="${e.weight}"></div>` : ""}
        ${ex.trackBy==="duration"
          ? cardioFields("edit", ex, e)
            + (ex.trackIncline ? `<div class="field"><label>Incline %</label><input type="number" inputmode="decimal" step="0.5" id="edit-incline" value="${e.incline ?? ''}"></div>` : "")
            + (isRecovery(name) ? `<div class="field"><label>°F</label><input type="number" inputmode="numeric" id="edit-temp" value="${e.tempF ?? ''}"></div>` : "")
          : `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="edit-sets" value="${e.sets}"></div>
             <div class="field"><label>${repsFieldLabel(name, ex.unit)}</label><input type="number" inputmode="numeric" id="edit-reps" value="${e.reps}"></div>`
        }
      </div>
      ${ex.trackBy !== "duration" ? `<div class="form-row">
        <div class="field" style="flex:1 1 100%;"><label>Reps per set (optional)</label><input type="text" id="edit-perset" value="${(e.repsBySet || []).join(" ")}" placeholder="e.g. 8 8 6"></div>
      </div>${painRow("edit", e.pain, e.painArea || defaultPainArea(name, ex), false)}` : ""}
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
  html += `<span>${fmtDate(e.date)}${tag ? `<br><span class="latest-tag">${tag}</span>` : ''}</span>`;
  const hr = hrFor(name, e.date);
  html += `<span class="exact">${ex.trackBy === "duration" && !isRecovery(name) ? cardioCell(e, ex) : formatEntryValue(e, ex)}${hr ? `<span class="hist-hr" title="Heart rate: average / peak">${hrShort(hr)}</span>` : ""}</span>`;
  html += `<span class="exact">${e.difficulty ?? "-"}</span>`;
  html += `<span class="hist-note-cell">`;
  html += `<span class="note">${painTag(e)}${e.note ? escapeHtml(e.note) : ""}</span>`;
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
  programDays().filter(day => day === view || DAY_ORDER[day].includes(name)).forEach(checkCoreWorkoutComplete);
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
    Object.assign(entry, readCardio("edit", ex));
    if(ex.trackIncline){
      const inclineEl = document.getElementById("edit-incline");
      entry.incline = inclineEl && inclineEl.value ? Number(inclineEl.value) : null;
    }
  } else {
    const isBodyweight = ex.trackBy === "reps";
    const weightEl = document.getElementById("edit-weight");
    entry.sets = Number(document.getElementById("edit-sets").value) || entry.sets;
    entry.reps = Number(document.getElementById("edit-reps").value) || entry.reps;
    const perEl = document.getElementById("edit-perset");
    applyPerSet(entry, perEl ? (perEl.value.match(/\d+/g) || []).map(Number).filter(v => v > 0) : null);
    const pain = readPain("edit");
    if(pain) Object.assign(entry, pain); else { delete entry.pain; delete entry.painArea; }
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
// A solid clock face for the hold timer, so it never reads as the rest stopwatch.
const HOLD_ICON = `<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.4V8l2.5 1.5"/></svg>`;
// Deload Week starts the note with this, so the history and the coach read the session as planned.
const DELOAD_NOTE = "Deload";
function renderForm(name, ex){
  let html = "";
  // Timed lifts get the hold timer in the rest button's place, from the very first session.
  const holdBtn = isHoldLift(ex) ? (() => {
    const p = holdPlanFor(name, ex);
    return `<button type="button" class="hold-action-btn" onclick="startHoldTimer('${name.replace(/'/g,"\\'")}')" aria-label="Start hold timer, ${p.sets} holds of ${p.secs} seconds">${HOLD_ICON}${p.sets}x${p.secs}</button>`;
  })() : "";
  const spacer = `<button type="button" class="action-btn-spacer" tabindex="-1" aria-hidden="true">-</button>`;
  if(!ex.entries.length && holdBtn) html += `<div class="action-row">${spacer}${spacer}${holdBtn}</div>`;
  if(ex.entries.length){
    html += `<div class="action-row">`;
    html += `<button type="button" class="tool-btn" onclick="repeatLast('${name.replace(/'/g,"\\'")}')">↻ ${isRecovery(name) ? "Repeat last" : "Repeat set"}</button>`;
    html += renderProgressionToggle(name, ex);
    if(holdBtn){
      html += holdBtn;
    } else if(ex.trackBy !== "duration"){
      html += `<button type="button" class="rest-action-btn" onclick="startRestTimer('${name.replace(/'/g,"\\'")}')" aria-label="Start rest timer, ${restTimeFor(ex)}">${STOPWATCH_ICON}${restTimeFor(ex)}</button>`;
    } else {
      html += `<button type="button" class="action-btn-spacer" tabindex="-1" aria-hidden="true">-</button>`;
    }
    html += `</div>`;
  }
  html += `<div class="form-row">`;
  // The form starts on this session's recommendation, so logging it as prescribed takes one tap:
  // the modifier-adjusted plan when a modifier changes this lift's numbers, otherwise the next
  // progression. Lifts set to carry their last reps keep doing so unless a modifier or a rep
  // range sets the reps. A first-ever log has no recommendation and starts as before.
  const mods = planModifiers(name, ex);
  const plan = ex.entries.length ? computeSuggestion(ex, name) : null;
  let repsDefault = (ex.autoloadLastReps && ex.entries.length) ? ex.entries[ex.entries.length - 1].reps : effectiveTargetReps(ex);
  let setsDefault = ex.targetRepsStrength && plannedHeavy(name, ex) ? HEAVY_SETS : 3;
  let weightDefault = "";
  let minutesDefault = "";
  // Recovery starts on the last session's minutes and temperature, or the usual dose.
  const recovery = isRecovery(name);
  const lastLog = ex.entries[ex.entries.length - 1];
  if(recovery) minutesDefault = lastLog ? lastLog.minutes : RECOVERY[name].minutes;
  if(plan){
    if(plan.sets != null) setsDefault = plan.sets;
    // A rep range (Back Extension's 10-15) plans the reps, so the form matches the Next tile.
    if(plan.reps != null && (mods.length || !ex.autoloadLastReps || activeRepRange(ex))) repsDefault = plan.reps;
    if(ex.trackBy === "weight" && plan.weight != null) weightDefault = plan.weight;
    if(ex.trackBy === "duration" && plan.minutes != null) minutesDefault = plan.minutes;
  }
  // RPE rides in the numbers row, so the form is three short rows: numbers, note, date and log.
  const rpeField = `<div class="field field-rpe"><label>RPE</label><input type="number" inputmode="numeric" id="f-difficulty" min="1" max="10" value="7"></div>`;
  if(ex.trackBy === "weight"){
    html += `<div class="field"><label>${weightFieldLabel(name)}</label><input type="number" inputmode="decimal" id="f-weight" value="${weightDefault}"></div>`;
    html += `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="f-sets" value="${setsDefault}" oninput="syncPerSet()"></div>`;
    html += `<div class="field"><label>${repsFieldLabel(name, ex.unit)}</label><input type="number" inputmode="numeric" id="f-reps" value="${repsDefault}"></div>`;
  } else if(ex.trackBy === "duration"){
    html += cardioFields("f", ex, { minutes: minutesDefault });
    if(ex.trackIncline) html += `<div class="field"><label>Incline %</label><input type="number" inputmode="decimal" step="0.5" id="f-incline"></div>`;
    if(recovery) html += `<div class="field"><label>Temp °F</label><input type="number" inputmode="numeric" id="f-temp" value="${lastLog && lastLog.tempF != null ? lastLog.tempF : RECOVERY[name].temp}"></div>`;
  } else {
    html += `<div class="field"><label>Sets</label><input type="number" inputmode="numeric" id="f-sets" value="${setsDefault}" oninput="syncPerSet()"></div>`;
    html += `<div class="field"><label>${repsFieldLabel(name, ex.unit)}</label><input type="number" inputmode="numeric" id="f-reps" value="${repsDefault}"></div>`;
  }
  // Cardio already fills its row (minutes, miles, speed, incline), so RPE moves next to Note.
  if(ex.trackBy !== "duration") html += rpeField;
  html += `</div>`;
  const prefill = plan ? (mods.length ? `Pre-filled: ${mods.join(", ")} plan` : "Pre-filled: next progression") : "";
  if(ex.trackBy !== "duration"){
    // Optional reps for each set, for sessions where the last set fell short: "8 8 6".
    const painOpen = !recovery && careModifierOn(name, ex);
    html += `<div class="prefill-row"><span class="prefill-note">${prefill}</span><span class="form-toggles"><button type="button" class="perset-toggle pain-toggle" onclick="togglePain(this)" aria-expanded="${painOpen}">Joint check</button><button type="button" class="perset-toggle" onclick="togglePerSet(this)">Reps per set</button></span></div>`;
    html += `<div class="perset-row" id="perset-row" hidden></div>`;
    html += painRow("f", null, defaultPainArea(name, ex), !painOpen);
  } else if(plan) html += `<p class="prefill-note">${prefill}</p>`;
  html += `<div class="form-row">
    ${ex.trackBy === "duration" && !recovery ? rpeField : ""}<div class="field field-note">${ex.trackBy === "duration" && !recovery ? "<label>Note</label>" : ""}<input type="text" id="f-note" aria-label="Note" value="${withModifierTags("", activeModifierTags(name, ex))}" placeholder="${recovery ? 'Note, e.g. after lifting' : ex.trackBy==='duration' ? 'Note, e.g. easy spin' : 'Note, e.g. felt heavy, or next: 185'}"></div>
  </div>`;
  html += `<div class="date-log-row">
    <div class="field"><input type="date" id="f-date" aria-label="Date" value="${todayISO()}"></div>
    <button class="log" onclick="logEntry()">${recovery ? "Log session" : "Log set"}</button>
  </div>`;
  return html;
}

// Joint check: an optional 0-10 pain score and where, saved on the session. Open by itself when a
// care modifier (knee, back, shoulder) covers this lift; otherwise one tap away.
const PAIN_AREAS = ["knee", "back", "shoulder", "elbow", "hip", "wrist", "ankle", "other"];
const PAIN_AREA_BY_PATTERN = { squat: "knee", "single-leg": "knee", power: "knee", hinge: "back", push: "shoulder", pull: "shoulder" };
function careModifierOn(name, ex){
  return modifiersOn(name, ex).some(m => m.key === "knee" || m.key === "back" || m.key === "shoulder");
}
function defaultPainArea(name, ex){
  const care = modifiersOn(name, ex).find(m => m.key === "knee" || m.key === "back" || m.key === "shoulder");
  if(care) return care.key;
  const last = [...ex.entries].reverse().find(e => e.painArea);
  return last ? last.painArea : PAIN_AREA_BY_PATTERN[LIFT_PATTERNS[name]] || "other";
}
function painRow(prefix, score, area, hidden){
  return `<div class="pain-row" id="${prefix}-pain-row"${hidden ? " hidden" : ""}>
    <label class="perset-field pain-score"><span>Pain 0-10</span><input type="number" inputmode="numeric" class="perset-in" id="${prefix}-pain" min="0" max="10" value="${score ?? ""}" placeholder="-"></label>
    <label class="perset-field"><span>Where</span><select class="perset-in" id="${prefix}-pain-area">${PAIN_AREAS.map(a => `<option value="${a}"${a === area ? " selected" : ""}>${a[0].toUpperCase() + a.slice(1)}</option>`).join("")}</select></label>
  </div>`;
}
function togglePain(btn){
  const row = document.getElementById("f-pain-row");
  if(!row) return;
  row.hidden = !row.hidden;
  btn.setAttribute("aria-expanded", String(!row.hidden));
  if(row.hidden) document.getElementById("f-pain").value = "";
  else document.getElementById("f-pain").focus();
}
// { pain, painArea } from an open joint check with a score typed in (0 counts); null otherwise.
function readPain(prefix){
  const row = document.getElementById(prefix + "-pain-row"), el = document.getElementById(prefix + "-pain");
  if(!row || row.hidden || !el || el.value === "") return null;
  return { pain: Math.max(0, Math.min(10, Math.round(Number(el.value) || 0))), painArea: document.getElementById(prefix + "-pain-area").value };
}
function painTag(e){
  return e.pain != null ? `<span class="pain-tag${e.pain > PAIN_HOLD_ABOVE ? " high" : ""}">Pain ${e.pain}${e.painArea ? " " + e.painArea : ""}</span>` : "";
}

// Time, distance and pace for a cardio card (plus stroke rate on the rower). Typing any two fills
// the third (marked as worked out); typing into a filled field makes it yours again.
function cardioFields(prefix, ex, e){
  const v = x => x == null ? "" : x;
  const auto = `oninput="cardioAutofill('${prefix}', ${!!ex.rowing}, this)"`;
  let html = `<div class="field"><label>Minutes</label><input type="number" inputmode="decimal" step="any" id="${prefix}-minutes" value="${v(e.minutes)}" ${auto}></div>`;
  if(ex.trackDistance) html += `<div class="field"><label>${ex.rowing ? "Meters" : "Miles"}</label><input type="number" inputmode="decimal" step="any" id="${prefix}-distance" value="${v(e.distance)}" ${auto}></div>`;
  if(ex.trackSpeed) html += ex.rowing
    ? `<div class="field"><label>Split /500m</label><input type="text" id="${prefix}-speed" placeholder="2:05" value="${e.speed ? fmtSplit(e.speed) : ""}" ${auto}></div>`
    : `<div class="field"><label>MPH</label><input type="number" inputmode="decimal" step="any" id="${prefix}-speed" value="${v(e.speed)}" ${auto}></div>`;
  if(ex.trackSpm) html += `<div class="field"><label>SPM</label><input type="number" inputmode="numeric" id="${prefix}-spm" value="${v(e.spm)}"></div>`;
  return html;
}
function cardioAutofill(prefix, rowing, typed){
  const els = { t: document.getElementById(prefix + "-minutes"), d: document.getElementById(prefix + "-distance"), p: document.getElementById(prefix + "-speed") };
  if(!els.t || !els.d || !els.p) return;
  if(typed) delete typed.dataset.auto;
  const read = k => {
    const el = els[k];
    if(!el.value || el.dataset.auto) return null;
    const n = k === "p" && rowing ? parseSplit(el.value) : Number(el.value);
    return n > 0 ? n : null;
  };
  const vals = { t: read("t"), d: read("d"), p: read("p") };
  const missing = Object.keys(vals).filter(k => vals[k] == null);
  if(missing.length !== 1){
    Object.values(els).forEach(el => { if(el.dataset.auto && el !== typed){ el.value = ""; delete el.dataset.auto; } });
    return;
  }
  const k = missing[0], solved = solveCardio(vals.t, vals.d, vals.p, rowing);
  const out = { t: solved.minutes, d: solved.distance, p: solved.speed }[k];
  if(!out) return;
  els[k].value = k === "p" && rowing ? fmtSplit(out) : out;
  els[k].dataset.auto = "1";
}
// The cardio fields as entry values; a missing one is worked out from the other two.
function readCardio(prefix, ex){
  const num = id => { const el = document.getElementById(prefix + "-" + id); return el && el.value !== "" && Number(el.value) > 0 ? Number(el.value) : null; };
  const speedEl = document.getElementById(prefix + "-speed");
  const speed = !speedEl || !speedEl.value ? null : ex.rowing ? parseSplit(speedEl.value) : (Number(speedEl.value) > 0 ? Number(speedEl.value) : null);
  const solved = solveCardio(num("minutes"), ex.trackDistance ? num("distance") : null, ex.trackSpeed ? speed : null, !!ex.rowing);
  const out = {};
  if(solved.minutes) out.minutes = solved.minutes;
  if(ex.trackDistance) out.distance = solved.distance;
  if(ex.trackSpeed) out.speed = solved.speed;
  if(ex.trackSpm) out.spm = num("spm");
  return out;
}

// The per-set reps row: one small box per set, filled with the reps above. Opening it, or changing
// the set count while it's open, rebuilds it (keeping anything already typed).
function togglePerSet(btn){
  const row = document.getElementById("perset-row");
  if(!row) return;
  row.hidden = !row.hidden;
  btn.textContent = row.hidden ? "Reps per set" : "Same reps each set";
  if(!row.hidden){ row.innerHTML = ""; syncPerSet(); }
}
function syncPerSet(){
  const row = document.getElementById("perset-row");
  if(!row || row.hidden) return;
  const n = Math.max(1, Math.min(8, Number((document.getElementById("f-sets") || {}).value) || 3));
  const reps = (document.getElementById("f-reps") || {}).value || "";
  const kept = [...row.querySelectorAll("input")].map(i => i.value);
  row.innerHTML = Array.from({ length: n }, (_, i) =>
    `<label class="perset-field"><span>Set ${i + 1}</span><input type="number" inputmode="numeric" class="perset-in" value="${kept[i] != null ? kept[i] : reps}"></label>`).join("");
}
// Reps from the per-set row when it's open and the sets differ; null otherwise.
function readPerSet(){
  const row = document.getElementById("perset-row");
  if(!row || row.hidden) return null;
  const reps = [...row.querySelectorAll("input")].map(i => Number(i.value)).filter(v => v > 0);
  return reps.length ? reps : null;
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
