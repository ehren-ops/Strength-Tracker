// Interactions: selecting, adding exercises, logging a set.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- interactions ----------
function selectExercise(name){
  selected = name;
  render();
}
function toggleHistory(name){ openHistory[name] = !openHistory[name]; render(); }
function toggleAddExercise(){
  const row = document.getElementById("add-ex-row");
  row.style.display = row.style.display === "none" ? "flex" : "none";
}
function addExercise(){
  const input = document.getElementById("new-ex-name");
  const name = input.value.trim();
  if(!name || data[name]) return;
  data[name] = Object.assign(newExerciseShell(name), { day: view });
  selected = name;
  persist();
  enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name } });
  render();
}
function cssId(name){ return name.replace(/[^a-z0-9]/gi,"-"); }
function escapeHtml(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// Briefly flashes a required-but-empty input red instead of silently
// refusing to log - re-triggers the CSS animation even on a second miss in
// a row by removing and re-adding the class on the next frame.
function flashFieldError(el){
  if(!el) return;
  el.classList.remove("field-error");
  el.focus();
  requestAnimationFrame(() => {
    el.classList.add("field-error");
    setTimeout(() => el.classList.remove("field-error"), 900);
  });
}

function logEntry(){
  const ex = data[selected];
  const dateEl = document.getElementById("f-date");
  const noteEl = document.getElementById("f-note");
  const difficultyEl = document.getElementById("f-difficulty");
  const difficulty = difficultyEl && difficultyEl.value ? Math.max(1, Math.min(10, Number(difficultyEl.value))) : null;

  let entry;
  if(ex.trackBy === "duration"){
    const minutesEl = document.getElementById("f-minutes");
    if(!minutesEl || !minutesEl.value){ flashFieldError(minutesEl); return; }
    entry = {
      clientId: genId(),
      label: "S" + (ex.entries.length + 1),
      date: dateEl.value || todayISO(),
      confirmed: true,
      minutes: Number(minutesEl.value),
      difficulty,
      note: (noteEl.value || "").trim(),
    };
    if(ex.trackDistance){
      const distEl = document.getElementById("f-distance");
      if(distEl && distEl.value) entry.distance = Number(distEl.value);
    }
    if(ex.trackSpeed){
      const speedEl = document.getElementById("f-speed");
      if(speedEl && speedEl.value) entry.speed = Number(speedEl.value);
    }
    if(ex.trackIncline){
      const inclineEl = document.getElementById("f-incline");
      if(inclineEl && inclineEl.value) entry.incline = Number(inclineEl.value);
    }
  } else {
    const isBodyweight = ex.trackBy === "reps";
    const weightEl = document.getElementById("f-weight");
    const setsEl = document.getElementById("f-sets");
    const repsEl = document.getElementById("f-reps");

    const sets = Number(setsEl.value) || 3;
    const reps = Number(repsEl.value) || effectiveTargetReps(ex);
    const weight = isBodyweight ? 0 : Number(weightEl.value);

    if(!isBodyweight && !weightEl.value){ flashFieldError(weightEl); return; }

    entry = {
      clientId: genId(),
      label: "S" + (ex.entries.length + 1),
      date: dateEl.value || todayISO(),
      confirmed: true,
      weight, sets, reps,
      difficulty,
      note: (noteEl.value || "").trim(),
    };
  }
  if(modes.deload && ex.trackBy !== "duration") entry.deload = true;
  // When it was logged, so a session's actual exercise order can be compared with the planned one.
  entry.loggedAt = new Date().toISOString();
  ex.entries.push(entry);
  persist();
  enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: selected, clientId: entry.clientId } });
  // Check every day this lift belongs to, not just the open tab: Upper and Full share lifts, so
  // the last one of a day can be logged from the other tab.
  ["full", "upper", "lower"].filter(d => d === view || DAY_ORDER[d].includes(selected)).forEach(checkCoreWorkoutComplete);
  render();

  const btn = document.querySelector(".log");
  if(btn){
    const originalText = btn.textContent;
    btn.classList.add("log-confirmed");
    btn.textContent = "Logged ✓";
    setTimeout(() => {
      btn.classList.remove("log-confirmed");
      btn.textContent = originalText;
    }, 1600);
  }
}
