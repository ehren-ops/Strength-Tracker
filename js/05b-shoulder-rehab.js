// Shoulder Rehab modifier: a daily rehab checklist first on every day tab, and the lifts that would
// aggravate a cranky rotator cuff paused or held while it is on. Switched off, none of this changes
// the app, except a short ramp back for the lifts it paused.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

const REHAB_NAME = "Shoulder Rehab";
// Paused outright: flies, incline pressing, lateral raises and overhead slams load the irritated
// tendon at the end of its range. Face pulls, pushdowns, legs and riding stay as they are.
const SHOULDER_PAUSED = new Set(["Cable Chest Fly", "Incline DB Press", "Lateral Raise", "Med Ball Slam"]);
// Ramped back once rehab is off. Bicep Curl joins because it is paused until week 3, then hammer
// curls only; Barbell Row because it is held at 85% the whole time.
const SHOULDER_RETURN = new Set([...SHOULDER_PAUSED, "Bicep Curl", "Barbell Row"]);
const SHOULDER_RETURN_STEPS = [0.85, 0.925, 1];
const SHOULDER_RETURN_WINDOW_DAYS = 56; // after 8 weeks off rehab the ramp no longer applies
const HAMMER_FROM_WEEK = 3;
// The rehab is for the left shoulder; the right is trained alongside it (see REHAB_RIGHT_SIDE).
const RIGHT_PRESS_TIP = "Right arm: single-arm DB floor press or landmine press keeps pressing trained.";
// Held lifts start at a share of the last working weight from before rehab and stay there.
const SHOULDER_HOLD_PCT = { "Bench Press": 0.85, "Bicep Curl": 0.7, "Barbell Row": 0.85 };
const SHOULDER_CARE_TIP = {
  "Bench Press": "85% of pre-rehab weight, medium grip (forearms vertical), elbows ~45°, stop 2-3 in above the chest. Over 3 of 10: drop 10 lb. Incline push-ups or a right-arm DB floor press also work.",
  "Bicep Curl": "Hammer curls only, both arms, light, lower over 3 seconds. Skip if the front of the left shoulder aches.",
  "Barbell Row": "85% of pre-rehab weight, palms-in grip (neutral handle, or single-arm DB rows), elbows ~45°, pull to the lower ribs, no shrug. Over 3 of 10: drop 10 lb.",
};
const SHOULDER_PAUSED_TIP = "Paused for Shoulder Rehab. Back once the side-raise press is pain-free.";
const SHOULDER_PAUSED_TIPS = {
  "Cable Chest Fly": "Paused for Shoulder Rehab. " + RIGHT_PRESS_TIP,
  "Incline DB Press": "Paused for Shoulder Rehab. " + RIGHT_PRESS_TIP,
  "Bicep Curl": "Left arm paused until week 3. Right arm: slow hammer curls, 3 × 10 light, can start now.",
};
const BENCH_PHASE3_TIP = "Phase 3: full-range bench is back. Add 5 lb a session while it stays at 3 of 10 or less, up to your pre-rehab weight.";
// Push-ups are the pressing bridge: incline while the shoulder settles, the floor in phase 3. While
// rehab is on they also join the Upper and Full Body rows, after the numbered lifts.
const PUSHUP_NAME = "Push-Ups";
const PUSHUP_TIP = {
  early: "Shoulder Rehab: incline only, hands on a bench or counter, shoulder width, elbows about 45°. Stop a few inches short of the bottom. 3 of 10 or less.",
  phase3: "Shoulder Rehab phase 3: floor push-ups to full depth. Pain-free here is a good sign for full-range bench.",
};
// Lifts the modifier leaves alone but has a word on, shown while it is on.
const SHOULDER_KEEP_TIP = {
  "Face Pulls": "Shoulder Rehab: keep as is. More pulling evens out the pressing, which protects both shoulders.",
};
// Logged sessions of a paused or held lift say so in their note, like Deload.
const REHAB_NOTE = "Rehab";
const REHAB_RIGHT_SIDE = [
  "Train it too: pressing outrunning pulling loads both shoulders the same way, and training the right keeps a little strength in the left (cross-education).",
  "Rotation work on both sides, the right about 50% heavier (5-8 lb). Holds on the right are optional: one round after the left at about 70% effort.",
  "No 3 of 10 limit on the right, but if it aches the same way, sharpest on a resisted side raise, treat it like the left.",
];

const REHAB_RULES = [
  ["During", "3 of 10 pain or less"],
  ["Next morning", "no worse, or drop the load a step"],
  ["Every rep", "slow, 3 sec up and 3 sec down"],
];
// One master list so checked items keep their index as the phases change.
const REHAB_ITEMS = [
  { group: "holds", name: "Outward-rotation press", dose: "5 × 30-45 s", description: "Stand side-on to a wall, towel between elbow and ribs, elbow bent 90°. Press the back of the hand into the wall at 30-50% effort and hold. 30 s rest between holds.", variation: "Calms pain and wakes up the rotator cuff without moving the joint.", right: "Optional: one hold after the left, about 70% effort." },
  { group: "holds", name: "Inward-rotation press", dose: "5 × 30-45 s", description: "Same setup in a door frame: elbow at your side, bent 90°, palm pressing toward your belly against the frame. 30-50% effort, 30 s rest.", variation: "Balances the outward press so both sides of the cuff work.", right: "Optional: one hold after the left, about 70% effort." },
  { group: "holds", name: "Side-raise press", dose: "5 × 30-45 s", description: "Straight arm about 30° out from your side, outside of the wrist against a wall. Press out into the wall, starting at 30% effort.", variation: "Targets the supraspinatus. Pain-free at full effort means you're through.", right: "Optional: one hold after the left, about 70% effort. An ache here on the right means treat it like the left." },
  { group: "strength", name: "Side-lying external rotation", dose: "3 × 12-15, 3-5 lb", description: "Lie on your good side, towel under the working elbow, elbow bent 90°. Rotate the weight up toward the ceiling over 3 s, lower over 3 s.", variation: "The most important one. Drop to 2 lb if the last reps hurt.", right: "Yes, every session, about 50% heavier: 5-8 lb." },
  { group: "strength", name: "Band external and internal rotation", dose: "3 × 15 each way", description: "Band anchored at elbow height, elbow tucked at your side with a towel. Rotate out, then turn around and rotate in. Slow both ways.", variation: "Lighter band if you can't keep the elbow pinned.", right: "Yes, every session, with a heavier band." },
  { group: "strength", name: "Scaption raise (full can)", dose: "3 × 10-12, 2-5 lb", description: "Thumbs up, arms about 30° forward of your sides. Raise to shoulder height, no higher, over 3 s and lower over 3 s.", variation: "No weight at first if 2 lb is above 3 of 10.", right: "Already both arms together." },
  { group: "strength", name: "Prone Y and T raises", dose: "2 × 10 each, 2 s hold", description: "Face down on a bench or the floor. Lift straight arms into a Y, hold 2 s, lower. Then out to the sides into a T.", variation: "No weight to start. Thumbs up on both.", right: "Already both arms together." },
  { group: "strength", name: "Push-up plus", dose: "3 × 12", description: "Plank on hands or a wall. Arms stay straight: push the floor away so the shoulder blades spread apart, then let them come back together.", variation: "Wall or counter version if the floor is too much.", right: "Already both sides." },
  { group: "strength", name: "Slow hammer curl", dose: "3 × 10, light", description: "Neutral grip, elbows pinned. Curl up, then lower over 3 s.", variation: "Skip it if the front of the left shoulder aches.", right: "Both arms. The right can start now; the left joins in week 3.", leftFromWeek: HAMMER_FROM_WEEK },
  { group: "return", name: "External rotation at 90° with band", dose: "3 × 12", description: "Upper arm out to the side at shoulder height, elbow bent 90°. Rotate the forearm up against the band, slow both ways.", variation: "Drop the arm to 45° if 90° pinches.", right: "Both sides." },
  { group: "return", name: "Landmine press, half-kneeling", dose: "3 × 8-10, empty bar", description: "Half-kneeling or split stance, press the end of the bar up and forward. Ribs down, no arching.", variation: "Then bring back full-depth bench, then incline. Flies and lateral raises last.", right: "Fine on the right any time to keep pressing trained." },
];
const REHAB_GROUPS = {
  holds: "Holds",
  strength: "Strengthening",
  return: "Back to training",
};
const REHAB_PHASE_TEXT = {
  1: "Phase 1: holds every day, about 12 minutes at 30-50% effort.",
  2: "Phase 2: slow strengthening 3× a week after a lift. Holds on the other days.",
  3: "Phase 3: back to full training. Add these after a lift; keep the strengthening going.",
};

function rehabWeek(){
  if(!shoulderRehab.startedOn) return 1;
  return Math.floor(Math.max(0, daysBetween(shoulderRehab.startedOn, todayISO())) / 7) + 1;
}
function rehabPhase(){
  if(!modes.shoulder) return 0;
  if(shoulderRehab.phase3) return 3;
  return rehabWeek() >= 2 ? 2 : 1;
}
function isShoulderPaused(name){
  return !!modes.shoulder && (SHOULDER_PAUSED.has(name) || (name === "Bicep Curl" && rehabWeek() < HAMMER_FROM_WEEK));
}
function isShoulderHeld(name){
  return !!modes.shoulder && !isShoulderPaused(name) && !!SHOULDER_CARE_TIP[name];
}
function isShoulderModified(name){ return isShoulderPaused(name) || isShoulderHeld(name) || (!!modes.shoulder && name === PUSHUP_NAME); }
// The line on a lift's card while rehab is on: paused, held, or kept with a word. Null otherwise.
function shoulderCardTip(name){
  if(!modes.shoulder) return null;
  if(isShoulderPaused(name)) return SHOULDER_PAUSED_TIPS[name] || SHOULDER_PAUSED_TIP;
  if(name === "Bench Press" && rehabPhase() === 3) return BENCH_PHASE3_TIP;
  if(isShoulderHeld(name)) return SHOULDER_CARE_TIP[name];
  if(name === PUSHUP_NAME) return rehabPhase() === 3 ? PUSHUP_TIP.phase3 : PUSHUP_TIP.early;
  return SHOULDER_KEEP_TIP[name] || null;
}
function withRehabNote(note){
  const n = (note || "").trim();
  return /rehab/i.test(n) ? n : n ? `${REHAB_NOTE}, ${n}` : REHAB_NOTE;
}
// Sessions of a paused or held lift logged while rehab was on carry "Rehab" in the note, including
// ones logged earlier today before it was switched on. Runs at startup, after sign-in and on toggle.
function ensureRehabNotes(){
  const from = shoulderRehab.startedOn;
  if(!from) return 0;
  const to = modes.shoulder ? todayISO() : (shoulderRehab.endedOn || from);
  let changed = 0;
  [...SHOULDER_RETURN, ...Object.keys(SHOULDER_CARE_TIP), PUSHUP_NAME].forEach(name => {
    const ex = data[name];
    if(!ex) return;
    ex.entries.forEach(e => {
      if(e.date < from || e.date > to) return;
      const fixed = withRehabNote(e.note);
      if(fixed === (e.note || "")) return;
      e.note = fixed;
      changed++;
      enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: name, clientId: e.clientId } });
    });
  });
  if(changed) persist();
  return changed;
}

// The groups shown today, each with the master indices it covers.
function rehabGroupsToday(){
  const phase = rehabPhase(), week = rehabWeek();
  const idx = g => REHAB_ITEMS.map((it, i) => it.group === g ? i : -1).filter(i => i >= 0);
  if(phase === 1) return [{ key: "holds", title: `${REHAB_GROUPS.holds} · daily`, idx: idx("holds") }];
  const groups = [];
  if(phase === 3) groups.push({ key: "return", title: `${REHAB_GROUPS.return} · after a lift`, idx: idx("return") });
  groups.push({ key: "strength", title: `${REHAB_GROUPS.strength} · 3× a week`, idx: idx("strength") });
  groups.push({ key: "holds", title: `${REHAB_GROUPS.holds} · other days`, idx: idx("holds") });
  return groups;
}
// Done for the day when any one group shown is fully checked: holds on a rest day, strengthening after a lift.
function rehabDoneOn(entry){
  if(!entry) return false;
  const done = new Set(entry.completedIndices || []);
  return rehabGroupsToday().some(g => g.idx.length && g.idx.every(i => done.has(i)));
}
function rehabDoneToday(){
  const ex = data[REHAB_NAME];
  return !!ex && rehabDoneOn(ex.entries.find(e => e.date === todayISO()));
}

// The last two weeks of rehab: days done and the pain scores logged, for the card and the coach.
function rehabRecent(days){
  const ex = data[REHAB_NAME];
  const since = shiftISO(todayISO(), -(days - 1));
  const from = [since, shoulderRehab.startedOn || since].sort().pop();
  const entries = ex ? ex.entries.filter(e => e.date >= from).sort((a, b) => a.date < b.date ? -1 : 1) : [];
  const daysOn = Math.max(1, daysBetween(from, todayISO()) + 1);
  return {
    daysOn,
    daysDone: entries.filter(e => (e.completedIndices || []).length > 0).length,
    pain: entries.filter(e => e.difficulty != null).map(e => ({ date: e.date, pain: e.difficulty })),
  };
}

function setRehabPain(n){
  const entry = getOrCreateTodayChecklistEntry(REHAB_NAME);
  entry.difficulty = entry.difficulty === n ? null : n;
  persist();
  enqueueOp({ id: genId(), type: "upsert_entry", payload: { exerciseName: REHAB_NAME, clientId: entry.clientId } });
  render();
}
function setRehabPhase3(on){
  shoulderRehab.phase3 = !!on;
  saveShoulderRehab();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  render();
}

function ensureRehabExercise(){
  if(data[REHAB_NAME]) return data[REHAB_NAME];
  data[REHAB_NAME] = newExerciseShell(REHAB_NAME);
  persist();
  enqueueOp({ id: genId(), type: "upsert_exercise", payload: { name: REHAB_NAME } });
  return data[REHAB_NAME];
}

function renderRehabCard(){
  const name = REHAB_NAME, q = "'" + name + "'";
  const ex = ensureRehabExercise();
  const entry = ex.entries.find(e => e.date === todayISO());
  const done = new Set(entry ? entry.completedIndices || [] : []);
  const phase = rehabPhase(), week = rehabWeek();
  const pain = entry && entry.difficulty != null ? entry.difficulty : null;

  let html = `<div class="card shoulder-mode rehab-card">`;
  html += `<div class="ex-title-row"><h2 class="ex-name">${name}</h2><span class="rehab-week">Week ${week} · Phase ${phase}</span></div>`;
  html += `<p class="rehab-phase">${REHAB_PHASE_TEXT[phase]}</p>`;
  html += `<div class="rehab-rules">${REHAB_RULES.map(([k, v]) => `<span><b>${k}:</b> ${v}</span>`).join("")}</div>`;

  rehabGroupsToday().forEach(g => {
    const n = g.idx.filter(i => done.has(i)).length;
    html += `<h3 class="section rehab-group">${g.title}<span class="rehab-count">${n}/${g.idx.length}</span></h3>`;
    g.idx.forEach(idx => {
      const item = REHAB_ITEMS[idx];
      const key = name + "|" + idx;
      const isOpen = !!openStretchItems[key];
      const isDone = done.has(idx);
      html += `<div class="stretch-item${isDone ? ' done' : ''}">
        <div class="stretch-row">
          <label class="stretch-check">
            <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleChecklistItem(${q}, ${idx})">
            <span class="stretch-name">${item.name}</span>
          </label>
          <span class="stretch-dose">${item.leftFromWeek && week < item.leftFromWeek ? item.dose + ", right arm" : item.dose}</span>
          <button class="stretch-toggle" onclick="toggleStretchDetail('${key}')" aria-label="Details">${isOpen ? '▲' : '▼'}</button>
        </div>
        ${isOpen ? `<div class="stretch-detail">
          <p>${item.description}</p>
          ${item.variation ? `<p class="stretch-variation">${item.variation}</p>` : ''}
          ${item.right ? `<p class="rehab-right-line"><b>Right side:</b> ${item.right}</p>` : ''}
        </div>` : ''}
      </div>`;
    });
  });

  html += `<div class="rehab-pain"><span class="rehab-pain-label">Pain today</span><div class="rehab-pain-scale">`;
  for(let n = 0; n <= 10; n++){
    const zone = n <= 3 ? "ok" : n <= 6 ? "warn" : "bad";
    html += `<button type="button" class="pain-btn pain-${zone}${pain === n ? ' on' : ''}" onclick="setRehabPain(${n})" aria-label="Pain ${n} of 10">${n}</button>`;
  }
  html += `</div></div>`;
  if(pain != null && pain > 3) html += `<p class="rehab-warn">Above 3 of 10: lighter or fewer holds next time, and check how it feels tomorrow morning.</p>`;

  const recent = rehabRecent(14);
  const painList = recent.pain.slice(-5).map(p => p.pain).join(", ");
  html += `<p class="rehab-trend">Last ${recent.daysOn} day${recent.daysOn === 1 ? "" : "s"}: ${recent.daysDone} with rehab done${painList ? ` · pain ${painList}` : ""}</p>`;

  html += `<div class="rehab-right"><b>Right shoulder</b>${REHAB_RIGHT_SIDE.map(t => `<p>${t}</p>`).join("")}${phase === 1 ? `<p>Right-arm slow hammer curls (3 × 10, light) can start now.</p>` : ""}</div>`;

  const paused = [...SHOULDER_PAUSED].filter(n => data[n] || allDayNames().includes(n));
  if(week < HAMMER_FROM_WEEK) paused.push("Bicep Curl for the left arm (hammer curls from week 3)");
  html += `<div class="rehab-hold"><b>Paused in the app:</b> ${paused.join(", ")}. <b>Bench:</b> ${phase === 3 ? "full range, building back up" : "85% of your pre-rehab weight, medium grip, elbows about 45°, stop short of the chest"}. <b>Pressing bridge:</b> ${phase === 3 ? "floor push-ups" : "incline push-ups"}, on Upper and Full Body.${week >= HAMMER_FROM_WEEK ? " <b>Curls:</b> hammer only, light." : ""} <b>Also hold off:</b> dips, upright rows, behind-neck pressing, straight-bar curls, racquet and throwing.</div>`;

  html += `<div class="rehab-foot"><span class="rehab-check">Through it when a full-effort side-raise press is pain-free.</span>`;
  if(phase === 2) html += `<button type="button" class="skip-btn" onclick="setRehabPhase3(true)">Move to Phase 3</button>`;
  if(phase === 3) html += `<button type="button" class="skip-btn" onclick="setRehabPhase3(false)">Back to Phase 2</button>`;
  html += `</div>`;
  html += `<p class="care-disclaimer">General guidance, not a substitute for a PT or doctor. Sharp pain, night pain or weakness: get it checked.</p>`;
  html += `</div>`;
  return html;
}

// Suggestion overlay, after the time-off ramp and before the deload week. While rehab is on, paused
// lifts are flagged and held lifts never climb. Once it is off, the paused lifts come back over
// three sessions at 85%, 92.5% and 100% of their last pre-rehab weight while each one hits its reps.
function applyShoulder(core, ex, name, baseline){
  if(!core || ex.trackBy !== "weight" || !baseline.length) return core;
  if(modes.shoulder){
    if(isShoulderPaused(name)) return { ...core, readyToProgress: false, shoulderPaused: true };
    if(!isShoulderHeld(name)) return core;
    const last = baseline[baseline.length - 1];
    const pre = shoulderRehab.startedOn ? baseline.filter(e => e.date < shoulderRehab.startedOn).pop() : null;
    // Never above the rehab share of the pre-rehab weight (bench 85%, hammer curls 70%), and never
    // above what was last logged, so a step down for pain sticks.
    const start = pre && pre.weight > 0 ? roundLoad(pre.weight * SHOULDER_HOLD_PCT[name]) : last.weight;
    const cap = Math.min(start, last.weight);
    // Phase 3: full-range bench builds back up from there, 5 lb a session, up to the pre-rehab weight.
    if(name === "Bench Press" && rehabPhase() === 3){
      const top = pre && pre.weight > 0 ? pre.weight : core.weight;
      const hit = last.reps >= effectiveTargetReps(ex);
      const weight = last.date < (shoulderRehab.startedOn || "") ? start : Math.min(top, hit ? last.weight + 5 : last.weight);
      return { ...core, weight, reps: effectiveTargetReps(ex), readyToProgress: hit, reentry: undefined, shoulderBuild: { fullWeight: top } };
    }
    return { ...core, weight: Math.min(core.weight, cap), readyToProgress: false, shoulderHold: { pct: SHOULDER_HOLD_PCT[name], fullWeight: pre ? pre.weight : null } };
  }
  if(!shoulderRehab.startedOn || !SHOULDER_RETURN.has(name)) return core;
  if((core.careFlags && core.careFlags.length) || core.noteTarget != null || core.reentry) return core;
  const end = shoulderRehab.endedOn || shoulderRehab.startedOn;
  if(daysBetween(end, todayISO()) > SHOULDER_RETURN_WINDOW_DAYS) return core;
  const pre = baseline.filter(e => e.date < shoulderRehab.startedOn).pop();
  if(!pre || !(pre.weight > 0)) return core;
  const since = baseline.filter(e => e.date >= end);
  if(since.some(e => e.weight >= pre.weight)) return core; // already back
  const step = since.length + 1;
  if(step > SHOULDER_RETURN_STEPS.length) return core;
  if(!since.every(e => e.reps >= effectiveTargetReps(ex))) return core;
  const weight = roundLoad(pre.weight * SHOULDER_RETURN_STEPS[step - 1]);
  return { ...core, weight, reps: effectiveTargetReps(ex), readyToProgress: false, shoulderReturn: { step, fullWeight: pre.weight } };
}

// For the coach: where rehab stands and what it changed today. Null when it has never been used.
function rehabCoachBlock(){
  if(!modes.shoulder && !shoulderRehab.startedOn) return null;
  const recent = rehabRecent(14);
  const block = {
    on: !!modes.shoulder,
    startedOn: shoulderRehab.startedOn || null,
    endedOn: modes.shoulder ? null : (shoulderRehab.endedOn || null),
  };
  if(modes.shoulder){
    block.week = rehabWeek();
    block.phase = rehabPhase();
    block.pausedLifts = [...SHOULDER_PAUSED, "Bicep Curl"].filter(n => isShoulderPaused(n) && (data[n] || allDayNames().includes(n)));
    block.heldLifts = Object.keys(SHOULDER_CARE_TIP).filter(isShoulderHeld);
    // What bench, push-ups and the right side do in rehab is fixed text in the coach prompt (cached);
    // only the facts that change ride here.
    if(rehabPhase() === 3) block.benchPhase3 = true;
    block.last14Days = { daysOn: recent.daysOn, daysWithRehabDone: recent.daysDone, painScores0to10: recent.pain };
  }
  return block;
}
