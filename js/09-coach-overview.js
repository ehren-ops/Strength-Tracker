// AI coach (session and weekly): payloads, trends, exercise order, panels. Deload status and popup, Training Modifiers, the Overview page and the backup card.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- coach analyses (on demand, cached, never re-generated automatically) ----------
// Two kinds from the coach edge function: "session" is the post-workout note for the very next
// session (keyed by session date); "weekly" is the deeper check-in (keyed by the week's last
// day). Synced to the ai_breakdowns table when signed in, which is also where outlive's
// strength-sync reads them from.
const AI_BREAKDOWN_KEY = "strength-tracker-ai-breakdowns";
const AI_CHECKIN_KEY = "strength-tracker-ai-checkins";
function loadCoachCache(key){
  try{ return JSON.parse(window.localStorage.getItem(key)) || {}; }catch(e){ return {}; }
}
let aiBreakdowns = loadCoachCache(AI_BREAKDOWN_KEY);
let aiCheckins = loadCoachCache(AI_CHECKIN_KEY);
function coachStore(kind){ return kind === "weekly" ? aiCheckins : aiBreakdowns; }
function saveCoachStore(kind){
  try{ window.localStorage.setItem(kind === "weekly" ? AI_CHECKIN_KEY : AI_BREAKDOWN_KEY, JSON.stringify(coachStore(kind))); }catch(e){}
}
let coachExpanded = {};
let coachLoading = {};
let coachError = {};

function shiftISO(iso, days){
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`;
}
function compactEntry(e, ex){
  let s = `${e.date} ${formatEntryValue(e, ex)}`;
  if(e.difficulty) s += ` @${e.difficulty}`;
  if(e.note) s += ` "${String(e.note).slice(0, 100)}"`;
  if(e.deload) s += " [deload]";
  return s;
}
function describeSuggestion(ex, name){
  const s = computeSuggestion(ex, name);
  if(!s) return null;
  if(ex.trackBy === "weight"){
    const why = s.deloadWeek ? "deload week" : s.noteTarget != null ? "set by last note" : s.deload ? "deload" : s.careFlags ? "care-mode trim" : s.readyToProgress ? "add weight"
      : s.noteConcern ? "hold, note flagged" : s.difficultyNote === "hard" ? "hold, last RPE high" : "hold";
    return `${s.weight} lb ${s.sets}x${s.reps} (${why})`;
  }
  if(ex.trackBy === "duration") return `${s.minutes} min`;
  return `${s.sets}x${s.reps}${s.powerHold ? " (power: hold reps, progress height or distance)" : ""}`;
}
// Movement pattern per lift, so the coach can compare push vs pull, squat vs hinge, etc.
const LIFT_PATTERNS = {
  "Bench Press": "push", "Incline DB Press": "push", "Cable Chest Fly": "push", "Tricep Pushdown": "push", "Lateral Raise": "push",
  "Barbell Row": "pull", "Cable Lat Pulldown": "pull", "Face Pulls": "pull", "Bicep Curl": "pull", "Dead Hang": "pull",
  "RDL": "hinge", "Hip Thrust": "hinge", "Back Extension": "hinge", "Kettlebell Swings": "hinge",
  "Squat": "squat", "Spanish Squat": "squat",
  "Bulgarian Split Squat": "single-leg", "Walking Lunge": "single-leg", "Lateral Lunge": "single-leg",
  "Box Jumps": "power", "Trap Bar Jump": "power", "Skater Bound": "power", "Med Ball Slam": "power",
  "Standing Calf Raise": "calves", "Seated Calf Raise": "calves",
  "Farmer's Carry": "carry and grip", "Copenhagen Plank": "core", "5-Minute Core Routine": "core",
};

// Pre-computed trend signals, so the model reasons over patterns instead of re-reading raw logs.
// e1RM is Epley (weight x (1 + reps/30)); it puts 135x6 and 135x8 on one scale. Timed holds
// (unit "sec", like Farmer's Carry) log seconds in the reps field, so they get no e1RM and their
// change is reported in seconds instead.
function liftTrend(name, ex, asOf){
  if(ex.trackBy === "checklist" || ex.trackBy === "duration") return null;
  const es = ex.entries.filter(e => e.date <= asOf);
  if(!es.length) return null;
  const last = es[es.length - 1];
  const timed = ex.unit === "sec";
  const e1 = e => (!timed && e.weight > 0 && e.reps) ? e.weight * (1 + e.reps / 30) : null;
  const since = shiftISO(asOf, -28);
  const recent = es.filter(e => e.date >= since);
  const base = recent.length > 1 ? recent[0] : null;
  let atLoad = 0;
  const rpeAtLoad = [];
  for(let i = es.length - 1; i >= 0 && es[i].weight === last.weight; i--){
    atLoad++;
    if(es[i].difficulty) rpeAtLoad.unshift(es[i].difficulty);
  }
  const a = base && e1(base), b = e1(last);
  return {
    pattern: LIFT_PATTERNS[name] || "other",
    sessionsLast4Weeks: recent.length,
    e1rmChange4WeeksPct: a && b ? Math.round((b - a) / a * 1000) / 10 : null,
    [timed ? "secondsChange4Weeks" : "repsChange4Weeks"]: base && (timed || !(last.weight > 0)) && base.reps != null && last.reps != null ? last.reps - base.reps : null,
    sessionsAtCurrentLoad: atLoad,
    rpeAtCurrentLoad: rpeAtLoad,
  };
}

function patternSummary(asOf){
  const by = {};
  Object.entries(data).forEach(([name, ex]) => {
    const t = liftTrend(name, ex, asOf);
    if(!t || t.e1rmChange4WeeksPct == null) return;
    (by[t.pattern] ||= []).push(`${name} ${t.e1rmChange4WeeksPct > 0 ? "+" : ""}${t.e1rmChange4WeeksPct}%`);
  });
  return Object.fromEntries(Object.entries(by).map(([p, lifts]) => {
    const pcts = lifts.map(l => parseFloat(l.split(" ").pop()));
    return [p, { avgE1rmChange4WeeksPct: Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length * 10) / 10, lifts }];
  }));
}

// The order lifts were actually done in on one date, each with its planned number from the day's
// list (the pill numbering). Lifts usually go in planned order; a lift out of place usually means
// its equipment was busy. Null when any entry that day predates order tracking.
function sessionOrder(date){
  const done = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist") return;
    ex.entries.forEach(e => { if(e.date === date) done.push({ name, at: e.loggedAt }); });
  });
  if(!done.length || done.some(d => !d.at)) return null;
  done.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  const seen = new Set();
  const lifts = done.filter(d => !seen.has(d.name) && seen.add(d.name)).map(d => d.name);
  const day = guessDayForNames(lifts);
  const planned = day && day !== "extra" ? getDisplayOrder(day) : [];
  const num = n => planned.indexOf(n) + 1;
  const numbered = lifts.filter(n => num(n) > 0);
  const outOfOrder = numbered.filter((n, i) => numbered.slice(i + 1).some(m => num(m) < num(n)) || numbered.slice(0, i).some(m => num(m) > num(n)));
  return {
    logged: lifts.map(n => num(n) ? `${n} (#${num(n)})` : `${n} (extra)`).join(", "),
    outOfOrder,
  };
}

// When each lift was logged on one date, oldest first. Lifts are logged right after their last set,
// so the coach function splits the wearable's heart-rate stream at these times to estimate each
// lift's peak and average HR. Empty when the day predates log times.
function sessionLogTimes(date){
  const logs = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist") return;
    ex.entries.forEach(e => { if(e.date === date && e.loggedAt) logs.push({ name, at: e.loggedAt }); });
  });
  return logs.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
}
// The latest earlier session of the same day type, for a like-for-like heart-rate comparison.
function previousComparableSession(date){
  const day = guessDayForNames(sessionLogTimes(date).map(l => l.name));
  const dates = new Set();
  Object.values(data).forEach(ex => ex.entries.forEach(e => { if(e.date < date) dates.add(e.date); }));
  const prev = [...dates].sort().reverse().find(d => guessDayForNames(sessionLogTimes(d).map(l => l.name)) === day && sessionLogTimes(d).length >= 2);
  return prev ? { date: prev, logs: sessionLogTimes(prev) } : null;
}

function coachTz(){
  try{ return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }catch(e){ return "UTC"; }
}
function activeModes(){ return Object.fromEntries(MODE_DEFS.map(m => [m.key, !!modes[m.key]])); }

// One session plus the last 8 results per lift, so the note can see trends, not just today.
function buildSessionCoachPayload(date){
  const exercises = [];
  let prevDate = null;
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist") return;
    ex.entries.forEach(e => { if(e.date < date && (!prevDate || e.date > prevDate)) prevDate = e.date; });
    let idx = -1;
    ex.entries.forEach((e, i) => { if(e.date === date) idx = i; });
    if(idx === -1) return;
    exercises.push({
      name,
      today: compactEntry(ex.entries[idx], ex),
      targetReps: ex.trackBy === "weight" ? effectiveTargetReps(ex) : null,
      history: ex.entries.slice(Math.max(0, idx - 8), idx).map(e => compactEntry(e, ex)),
      appSuggestion: describeSuggestion(ex, name),
      trend: liftTrend(name, ex, date),
      units: sidesText(name),
    });
  });
  const dayGuess = guessDayForNames(exercises.map(e => e.name));
  const daysSincePrevious = prevDate ? Math.round((new Date(date) - new Date(prevDate)) / 86400000) : null;
  return { date, tz: coachTz(), dayLabel: dayGuess ? DAY_TITLES[dayGuess] : "Session", daysSincePrevious, modes: activeModes(), deload: deloadStatus(), order: sessionOrder(date), logTimes: sessionLogTimes(date), compareSession: previousComparableSession(date), exercises, patterns: patternSummary(date) };
}

// The past week plus 6 weeks of history per lift, enough to judge loading blocks and deloads.
function buildWeeklyCoachPayload(){
  const weekEnd = todayISO();
  const since = shiftISO(weekEnd, -41);
  const sessionDates = new Set();
  const exercises = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist") return;
    const recent = ex.entries.filter(e => e.date >= since && e.date <= weekEnd);
    if(!recent.length) return;
    recent.forEach(e => sessionDates.add(e.date));
    exercises.push({ name, units: sidesText(name), entries: recent.map(e => compactEntry(e, ex)), appSuggestion: describeSuggestion(ex, name), trend: liftTrend(name, ex, weekEnd) });
  });
  const orderSince = shiftISO(weekEnd, -13);
  const sessionOrders = Object.fromEntries([...sessionDates].filter(d => d >= orderSince).sort()
    .map(d => [d, sessionOrder(d)]).filter(([, o]) => o));
  const weekLogTimes = Object.fromEntries([...sessionDates].filter(d => d >= shiftISO(weekEnd, -6)).sort()
    .map(d => [d, sessionLogTimes(d)]).filter(([, l]) => l.length >= 2));
  return { weekStart: shiftISO(weekEnd, -6), weekEnd, tz: coachTz(), modes: activeModes(), deload: deloadStatus(), sessionDates: [...sessionDates].sort(), sessionOrders, weekLogTimes, exercises, patterns: patternSummary(weekEnd) };
}

async function generateCoach(kind){
  const payload = kind === "weekly" ? buildWeeklyCoachPayload() : buildSessionCoachPayload(getLastSessionDate());
  const key = kind === "weekly" ? payload.weekEnd : payload.date;
  if(!key) return;
  // The coach function only runs for signed-in accounts, so the Anthropic key can't be spent anonymously.
  if(!currentSession || !currentSession.access_token){
    coachError[kind] = "Sign in to use AI coaching (Backup & Restore, bottom of Overview).";
    render();
    return;
  }
  coachLoading[kind] = true;
  coachError[kind] = null;
  render();
  try{
    // The session also lets the function match this account to Outlive for recovery data.
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + currentSession.access_token };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/coach`, {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: kind, payload }),
    });
    const body = await res.json().catch(() => null);
    if(!res.ok || !body || !body.breakdown) throw new Error((body && body.error) || `request failed (${res.status})`);
    coachStore(kind)[key] = { ...body.breakdown, generatedAt: body.generatedAt || new Date().toISOString() };
    saveCoachStore(kind);
    enqueueOp({ id: genId(), type: "upsert_breakdown", payload: { kind, date: key } });
    coachExpanded[kind + key] = true;
  }catch(e){
    // A fresh deployment (anyone else pulling this repo and standing up their own Supabase
    // project) won't have ANTHROPIC_API_KEY set yet - show setup instructions instead of a
    // "try again" that would fail forever.
    coachError[kind] = e.message === "anthropic_key_not_configured"
      ? "This needs an Anthropic API key configured on your Supabase project. Add ANTHROPIC_API_KEY under Project Settings → Edge Functions → Secrets - see supabase/functions/coach/README.md for details."
      : e.message === "not_signed_in"
      ? "Your sign-in expired. Sign in again under Backup & Restore at the bottom of Overview, then retry."
      : e.message === "daily_limit_reached"
      ? "Daily AI limit reached (10 a day). It resets at midnight."
      : "Couldn't generate this right now - try again in a moment.";
  }finally{
    coachLoading[kind] = false;
    render();
  }
}

function toggleCoachExpanded(id){
  coachExpanded[id] = !coachExpanded[id];
  render();
}

// Breakdowns saved before the coach format had a headline plus four fixed lists.
function normalizeCoach(b){
  if(!b) return null;
  if(Array.isArray(b.sections)) return b;
  return {
    verdict: b.headline || "",
    sections: [["What went well", b.wentWell], ["What didn't go great", b.notGreat], ["How to improve", b.howToImprove], ["Be mindful of next time", b.mindfulNextTime]]
      .filter(([, items]) => items && items.length)
      .map(([title, items]) => ({ title, items })),
  };
}

function renderAiBreakdownList(title, items){
  if(!items || !items.length) return "";
  return `<div style="margin-top:0.5rem;">
    <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;font-weight:700;color:var(--slate);margin-bottom:0.25rem;">${escapeHtml(String(title))}</div>
    <ul style="margin:0;padding-left:1.1rem;font-size:0.82rem;line-height:1.45;color:var(--ink);">
      ${items.map(i => `<li>${escapeHtml(String(i))}</li>`).join("")}
    </ul>
  </div>`;
}

// The current week's check-in, if one was made in the last 7 days; otherwise the button shows.
function currentCheckinKey(){
  const latest = Object.keys(aiCheckins).sort().pop();
  return latest && latest >= shiftISO(todayISO(), -6) ? latest : null;
}

const COACH_LABELS = { session: "Session Breakdown", weekly: "Weekly Check-in" };
const COACH_SHORT = { session: "Session", weekly: "Weekly" };
function coachKey(kind){ return kind === "weekly" ? currentCheckinKey() : getLastSessionDate(); }

// Header-row button: generates the first time, then opens and closes the panel below.
function onCoachButton(kind){
  const key = coachKey(kind);
  if(key && coachStore(kind)[key]) toggleCoachExpanded(kind + key);
  else generateCoach(kind);
}

function renderCoachButton(kind){
  const key = coachKey(kind);
  const open = key && coachStore(kind)[key] && coachExpanded[kind + key];
  const loading = !!coachLoading[kind];
  return `<button class="ai-btn${open ? " open" : ""}" onclick="onCoachButton('${kind}')" ${loading ? "disabled" : ""}>
    <span class="ai-tag">✨ AI</span>
    <span>${loading ? "Working…" : COACH_SHORT[kind]}</span>
  </button>`;
}

function renderCoachPanel(kind){
  const key = coachKey(kind);
  const cached = key ? normalizeCoach(coachStore(kind)[key]) : null;
  const loading = !!coachLoading[kind];
  const err = coachError[kind] ? `<div style="font-size:0.74rem;color:var(--danger);margin-top:0.4rem;">${escapeHtml(coachError[kind])}</div>` : "";
  if(!cached) return err ? `<div class="ai-panel"><div class="ai-panel-head"><span>✨ AI · ${COACH_LABELS[kind]}</span></div>${err}</div>` : "";

  const id = kind + key;
  const expanded = !!coachExpanded[id];
  const [, m, d] = key.split("-");
  const sub = (kind === "weekly" ? "week ending " : "") + `${Number(m)}/${Number(d)}`;
  let html = `<div class="ai-panel">
    <div class="ai-panel-head" onclick="toggleCoachExpanded('${id}')">
      <span>✨ AI · ${COACH_LABELS[kind]} <span style="opacity:0.7;font-weight:400;">· ${sub}</span></span>
      <span class="ai-toggle">${expanded ? "Hide ▲" : "Show ▼"}</span>
    </div>`;
  if(expanded){
    html += `<div style="margin-top:0.4rem;">
      <p style="font-size:0.85rem;line-height:1.5;color:var(--ink);margin:0;font-weight:600;">${escapeHtml(String(cached.verdict || ""))}</p>
      ${cached.sections.map(s => renderAiBreakdownList(s.title, s.items)).join("")}
      <button class="ai-btn" style="margin-top:0.6rem;" onclick="generateCoach('${kind}')" ${loading ? "disabled" : ""}>
        ${loading ? "Regenerating…" : "↻ Regenerate"}
      </button>
    </div>`;
  }
  html += `${err}</div>`;
  return html;
}

function renderLastSessionBreakdown(){
  const lastDate = getLastSessionDate();
  if(!lastDate) return "";
  const sessionsByDate = getSessionsByDate();
  const names = sessionsByDate[lastDate];
  if(!names || !names.length) return "";

  let html = `<div onclick="toggleLastSessionExpanded()" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:0.78rem;color:var(--slate);margin-top:0.6rem;padding-top:0.5rem;border-top:1px dashed var(--line);">
    <span>${names.length} exercise${names.length===1?'':'s'} logged</span>
    <span style="color:var(--amber);font-weight:600;">${lastSessionExpanded ? 'Hide breakdown ▲' : 'Show breakdown ▼'}</span>
  </div>`;

  if(lastSessionExpanded){
    html += `<div style="margin-top:0.5rem;">`;
    names.forEach(n => {
      const ex = data[n];
      const entry = ex.entries.slice().reverse().find(e => e.date === lastDate);
      if(entry){
        html += `<div class="session-row">
          <span>${n}</span>
          <span class="exact">${formatEntryValue(entry, ex)}</span>
          <span class="exact">${entry.difficulty ?? "-"}</span>
        </div>`;
      }
    });
    html += `</div>`;
  }

  return html;
}

// Last deload and when the next one is due. With no deload on record, the
// clock starts at the first logged session.
function deloadStatus(){
  let firstDate = null;
  Object.values(data).forEach(ex => {
    if(ex.trackBy === "checklist") return;
    ex.entries.forEach(e => { if(e.date && (!firstDate || e.date < firstDate)) firstDate = e.date; });
  });
  const anchor = modes.deload ? null : (deloadDates.endedOn || firstDate);
  const nextDue = anchor ? shiftISO(anchor, DELOAD_EVERY_DAYS) : null;
  return {
    on: !!modes.deload,
    startedOn: deloadDates.startedOn || null,
    endedOn: deloadDates.endedOn || null,
    nextDue,
    daysUntilDue: nextDue ? daysBetween(todayISO(), nextDue) : null,
  };
}

function fmtShortDate(iso){
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A deload is planned as one week: on day 7 it switches itself off and a popup
// offers to keep it on for another week instead.
function checkDeloadAutoEnd(){
  if(!modes.deload || !deloadDates.plannedEndOn || todayISO() < deloadDates.plannedEndOn) return;
  toggleMode("deload");
  showDeloadEndedModal();
}
function showDeloadEndedModal(){
  const el = document.getElementById("deload-modal");
  if(!el) return;
  el.innerHTML = `<div class="app-modal-card">
    <h3 class="section" style="color:var(--deload-text);">🔋 Deload week complete</h3>
    <p style="font-size:0.85rem;line-height:1.5;margin:0 0 0.8rem;">A week is up, so Deload Week is now off and suggestions pick back up from your pre-deload weights.</p>
    <div style="display:flex;gap:0.5rem;justify-content:flex-end;flex-wrap:wrap;">
      <button class="tool-btn" onclick="keepDeloadOn()">Keep it on another week</button>
      <button class="tool-btn" style="background:var(--deload);color:var(--deload-on-text);border-color:var(--deload);" onclick="closeDeloadModal()">Sounds good</button>
    </div>
  </div>`;
  el.hidden = false;
}
function closeDeloadModal(){
  const el = document.getElementById("deload-modal");
  if(el) el.hidden = true;
}
function keepDeloadOn(){
  const startedOn = deloadDates.startedOn;
  toggleMode("deload");
  deloadDates = { startedOn: startedOn || todayISO(), endedOn: null, plannedEndOn: shiftISO(todayISO(), DELOAD_LENGTH_DAYS) };
  saveDeloadDates();
  enqueueOp({ id: genId(), type: "upsert_settings", payload: {} });
  closeDeloadModal();
  render();
}

// One modifier: a title row with its on/off switch, then a short description.
// The hidden label keeps "Name: ON/OFF" readable for screen readers.
function renderModifierRow(key, emoji, name, desc, extraHtml){
  const on = !!modes[key];
  return `<div class="mod-row">
      <div class="mod-head">
        <span class="mod-title">${emoji} ${name}</span>
        <button class="theme-toggle mod-switch${on ? " on" : ""}" style="--mod-color:var(--${key})" onclick="toggleMode('${key}')" aria-pressed="${on}" aria-label="${name}"><span class="knob"></span><span class="sr-only">${name}: ${on ? "ON" : "OFF"}</span></button>
      </div>
      <p class="mod-desc">${desc}</p>
      ${extraHtml || ""}
    </div>`;
}

// Deload status is always exactly two short lines, so the row stays the same size on or off.
function renderDeloadModifier(){
  const st = deloadStatus();
  let last, next;
  if(st.on){
    const days = daysBetween(st.startedOn, todayISO()) + 1;
    last = `On since ${fmtShortDate(st.startedOn)} · day ${days}`;
    next = deloadDates.plannedEndOn ? `Switches off ${fmtShortDate(deloadDates.plannedEndOn)} unless you keep it on` : `Switch off when the week is up`;
  } else {
    last = st.startedOn ? `Last deload: ${fmtShortDate(st.startedOn)} to ${fmtShortDate(st.endedOn || st.startedOn)}` : `No deload logged yet`;
    if(!st.nextDue) next = `Next recommended: after ~5 weeks of training`;
    else if(st.daysUntilDue > 0) next = `Next recommended: ${fmtShortDate(st.nextDue)} (in ${st.daysUntilDue} day${st.daysUntilDue === 1 ? "" : "s"})`;
    else if(st.daysUntilDue === 0) next = `Next recommended: today`;
    else next = `Next recommended: ${fmtShortDate(st.nextDue)} · <b>due now</b>`;
  }
  return renderModifierRow("deload", "🔋", "Deload Week",
    "A planned lighter week so joints and tendons catch up: about 10% less weight and a third fewer sets on every lift. Lifts already cut for Knee or Back Care just lose sets. Ends itself after 7 days.",
    `<div class="deload-status" id="deload-status"><div>${last}</div><div>${next}</div></div>`);
}

function renderOverview(){
  const app = document.getElementById("app");
  const overviewData = Object.entries(data).map(([name, ex]) => {
    if(ex.entries.length < 2) return null;
    const f = ex.entries[0], l = ex.entries[ex.entries.length-1];
    const firstVal = ex.trackBy==="weight" ? f.weight : f.reps;
    const lastVal = ex.trackBy==="weight" ? l.weight : l.reps;
    if(!firstVal) return null;
    const pct = ((lastVal-firstVal)/firstVal)*100;
    return { name, pct, firstVal, lastVal, trackBy: ex.trackBy };
  }).filter(Boolean).sort((a,b) => b.pct - a.pct);

  const avgPct = overviewData.length ? overviewData.reduce((s,o)=>s+o.pct,0)/overviewData.length : 0;
  const totalSessions = Object.values(data).reduce((s,ex)=>s+ex.entries.length,0);
  const progressing = overviewData.filter(o=>o.pct>0).length;
  const holding = overviewData.filter(o=>o.pct===0).length;
  const declining = overviewData.filter(o=>o.pct<0).length;

  const dayAgg = ["full","upper","lower"].map(day => {
    const names = activeDayOrder(day);
    const relevant = overviewData.filter(o => names.includes(o.name));
    const avg = relevant.length ? relevant.reduce((s,o)=>s+o.pct,0)/relevant.length : null;
    return { day, title: DAY_TITLES[day], avg, count: relevant.length, total: names.length };
  });

  const coachNotes = generateCoachNotes();

  let html = "";
  if(coachNotes){
    html += `<div class="card" style="border-color:var(--amber-light);background:var(--rec-bg);">
      <div class="coach-head">
        <h3 class="section" style="color:var(--amber);">🎯 Coach's Notes</h3>
        ${renderCoachButton("session")}
        ${renderCoachButton("weekly")}
      </div>
      <p style="font-size:0.85rem;line-height:1.5;color:var(--ink);margin:0;">${coachNotes}</p>
      ${renderLastSessionBreakdown()}
      ${renderCoachPanel("session")}
      ${renderCoachPanel("weekly")}
    </div>`;
  }

  html += renderCalendar();

  html += `<div class="card">
    <h3 class="section">Aggregate Progress</h3>
    <div class="ov-grid">
      <div><div class="n" style="color:var(--emerald)">${avgPct>0?'+':''}${avgPct.toFixed(0)}%</div><div class="l">avg change</div></div>
      <div><div class="n">${totalSessions}</div><div class="l">sets logged</div></div>
      <div><div class="n">${overviewData.length}</div><div class="l">lifts tracked</div></div>
    </div>
    <div style="display:flex;gap:0.6rem;font-size:0.72rem;margin-bottom:0.8rem;">
      <span style="color:var(--emerald);font-weight:600;">▲ ${progressing} progressing</span>
      <span style="color:var(--slate);font-weight:600;">● ${holding} holding</span>
      <span style="color:var(--amber);font-weight:600;">▼ ${declining} below first logged</span>
    </div>
    <div style="border-top:1px dashed var(--line);padding-top:0.7rem;">
      <h3 class="section">Net Change by Day</h3>
      <div class="ov-grid">`;
  dayAgg.forEach(d => {
    const color = d.avg===null ? "var(--slate)" : d.avg>0 ? "var(--emerald)" : d.avg<0 ? "var(--amber)" : "var(--slate)";
    html += `<div><div class="n" style="color:${color}">${d.avg===null?'-':(d.avg>0?'+':'')+d.avg.toFixed(0)+'%'}</div><div class="l">${d.title}</div><div style="font-size:0.62rem;color:var(--slate);">${d.count}/${d.total} lifts w/ data</div></div>`;
  });
  html += `</div></div></div>`;

  html += `<div class="card">`;
  html += `<div onclick="toggleVolumeExpanded()" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
    <h3 class="section" style="margin:0;">Volume Trends by Day</h3>
    <span style="font-size:0.78rem;color:var(--amber);font-weight:600;">${volumeExpanded ? 'Hide ▲' : 'Show ▼'}</span>
  </div>`;
  if(!volumeExpanded){
    html += `<div style="margin-top:0.5rem;">`;
    ["full","upper","lower"].forEach(day => {
      const history = calcDayVolumeHistory(day);
      const latest = history.length ? history[history.length-1].weight : null;
      const prev = history.length > 1 ? history[history.length-2].weight : null;
      const pct = (latest !== null && prev) ? ((latest - prev) / prev) * 100 : null;
      const pctColor = pct === null ? "var(--slate)" : pct > 0 ? "var(--emerald)" : pct < 0 ? "var(--amber)" : "var(--slate)";
      const pctText = pct === null ? "-" : `${pct>0?'+':''}${pct.toFixed(0)}%`;
      html += `<div class="session-row">
        <span>${DAY_TITLES[day]}</span>
        <span class="exact">${latest !== null ? latest.toLocaleString()+" lbs" : "-"}</span>
        <span class="exact" style="color:${pctColor};">${pctText}</span>
      </div>`;
    });
    html += `</div>`;
  } else {
    ["full","upper","lower"].forEach(day => {
      const history = calcDayVolumeHistory(day);
      html += `<div style="margin-top:0.9rem;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-weight:600;font-size:0.85rem;">${DAY_TITLES[day]}</span>
          ${history.length ? `<span style="font-family:var(--font-mono);font-size:0.76rem;color:var(--slate);">${history[history.length-1].weight.toLocaleString()} lbs last session</span>` : ''}
        </div>`;
      if(history.length){
        html += renderChart({ trackBy:"weight", entries: history }, null, false, "volume:" + day);
      } else {
        html += `<p style="font-size:0.78rem;color:var(--slate);font-style:italic;margin:0.3rem 0 0;">No sessions logged yet.</p>`;
      }
      html += `</div>`;
    });
  }
  html += `</div>`;

  html += `<div class="card"><h3 class="section">% Change Since First Logged</h3>`;
  if(!overviewData.length){
    html += `<p style="font-size:0.85rem;color:var(--slate);font-style:italic;">Need at least 2 sessions on a lift to show change.</p>`;
  } else {
    overviewData.forEach(o => {
      const color = o.pct>0 ? "var(--emerald)" : o.pct<0 ? "var(--amber)" : "var(--slate)";
      const width = Math.min(Math.abs(o.pct),100);
      const freq = frequencyLabel(data[o.name]);
      html += `<div class="bar-row">
        <div class="top"><span style="font-weight:500;">${o.name}</span><span style="font-family:var(--font-mono);font-size:0.72rem;color:${color};">${o.pct>0?'+':''}${o.pct.toFixed(0)}% · ${o.firstVal}→${o.lastVal}${o.trackBy==='weight'?'lbs':' reps'}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${color};"></div></div>
        ${freq ? `<div style="font-size:0.66rem;color:var(--slate);margin-top:0.15rem;">${freq}</div>` : ''}
      </div>`;
    });
  }
  html += `</div>`;

  html += `<div class="card">
    <h3 class="section">Training Modifiers</h3>
    ${renderDeloadModifier()}
    ${renderModifierRow("ski", "🎿", "Ski Season", "Squat, Bulgarian Split Squat and Walking Lunge shift to lower reps with a slower lowering phase. Roughly Nov to March.")}
    ${renderModifierRow("preseason", "🏔️", "Preseason Prep", "Adds power, lateral, lowering-phase and calf work to your lift days for the 7 to 10 week ramp into ski season. Power work goes first; stop a set when speed drops.")}
    ${renderModifierRow("knee", "🦵", "Knee Care", "Squat, Bulgarian Split Squat and Walking Lunge hold and drop about 10% while your knee settles. Everything else trains as normal.")}
    ${renderModifierRow("back", "🩺", "Low Back Care", "Squat, RDL, Barbell Row, Kettlebell Swings and Hip Thrust (swap to a glute bridge) hold and drop about 10% while your lower back settles. Everything else trains as normal.")}
  </div>`;

  html += renderBackupSyncCard();

  html += `<p class="save-note">${APP_VERSION} · Last updated ${APP_UPDATED}</p>`;

  app.innerHTML = html;
}

function renderBackupSyncCard(){
  const pending = pendingQueue.length;
  let html = `<div class="card"><h3 class="section">Backup &amp; Restore</h3>`;

  if(currentSession){
    const syncedLabel = fmtSyncTime(lastSyncedAt);
    html += `<p style="font-size:0.72rem;color:var(--slate);margin:0 0 0.2rem;">☁ ${escapeHtml(currentSession.user.email)} · ${pending ? pending + " pending" : "synced"}</p>`;
    html += `<p style="font-size:0.64rem;color:var(--slate);margin:0 0 0.5rem;">Last synced: ${syncedLabel || "never yet"}</p>`;
    html += `<div class="header-tools" style="margin-bottom:0.6rem;">
      <button class="tool-btn" id="sync-now-btn" onclick="manualSync()">↻ Sync now</button>
      <button class="tool-btn" onclick="signOutUser()">Sign out</button>
    </div>`;
  } else {
    html += `<p style="font-size:0.7rem;color:var(--slate);margin:0 0 0.4rem;">Sign in to back up to the cloud (optional - logging works without it).</p>`;
    html += `<div class="form-row" style="margin-top:0;">
      <div class="field"><input type="email" id="auth-email" placeholder="Email"></div>
      <div class="field"><input type="password" id="auth-password" placeholder="Password"></div>
    </div>
    <div class="header-tools" style="margin-bottom:0.6rem;">
      <button class="tool-btn" onclick="handleSignIn()">Sign In</button>
      <button class="tool-btn" onclick="handleSignUp()">Create Account</button>
    </div>`;
  }

  html += `<div class="header-tools" style="padding-top:0.5rem;border-top:1px dashed var(--line);">
    <button class="tool-btn" onclick="backupData()">⬇ Backup data</button>
    <button class="tool-btn" onclick="document.getElementById('restore-input').click()">⬆ Restore backup</button>
    <input type="file" id="restore-input" accept="application/json" style="display:none" onchange="restoreData(event)">
  </div>`;
  html += `<p id="card-status" style="font-size:0.68rem;color:var(--slate);margin-top:0.5rem;"></p>`;

  html += `<div style="border-top:1px dashed var(--line);padding-top:0.7rem;margin-top:0.7rem;">
    <h3 class="section">Appearance</h3>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:0.7rem;">
      <div>
        <div style="font-size:0.85rem;font-weight:600;">Neon Dark Mode</div>
        <div style="font-size:0.68rem;color:var(--slate);margin-top:0.1rem;">80s high-contrast theme, everywhere in the app.</div>
      </div>
      <button class="theme-toggle${darkMode ? ' on' : ''}" onclick="toggleDarkMode()" aria-label="Toggle dark mode" aria-pressed="${darkMode}"><span class="knob"></span></button>
    </div>
  </div>`;

  html += `</div>`;
  return html;
}

