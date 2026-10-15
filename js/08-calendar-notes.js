// Session calendar, day guessing, last session, and the rule-based Coach's Notes.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- overview ----------
const DAY_GROUP_KEYS = ["full","upper","lower","extra"];
// How strongly a logged lift points at a day type: one on a single day list is strong evidence,
// one shared across lists (Squat on Full and Lower) counts proportionally less.
function daySpecificityWeight(name){
  const memberships = DAY_GROUP_KEYS.filter(d => DAY_ORDER[d].includes(name)).length;
  return memberships > 0 ? 1 / memberships : 0;
}
function guessDayForNames(names){
  let best = null, bestScore = 0;
  DAY_GROUP_KEYS.forEach(d => {
    const score = names.reduce((sum, n) => sum + (DAY_ORDER[d].includes(n) ? daySpecificityWeight(n) : 0), 0);
    // "Extra" wins ties outright (>=) rather than only strictly beating the
    // leader (>) - a one-off exercise that happens to also moonlight in a
    // muscle group's list should read as an off-day Extra session by
    // default, not as whichever group it happens to also belong to.
    const wins = d === "extra" ? score >= bestScore : score > bestScore;
    if(score > 0 && wins){ bestScore = score; best = d; }
  });
  return best;
}

// Each date's lifts in the order they were done: by when each was first logged that day. Lifts with
// no log time (older entries) follow, in their planned program order.
function getSessionsByDate(){
  const map = {}, firstAt = {};
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    ex.entries.forEach(e => {
      if(!e.date) return;
      if(!map[e.date]) map[e.date] = [];
      if(!map[e.date].includes(name)) map[e.date].push(name);
      const k = e.date + "|" + name;
      if(e.loggedAt && (!firstAt[k] || e.loggedAt < firstAt[k])) firstAt[k] = e.loggedAt;
    });
  });
  const planned = name => {
    const i = Object.values(DAY_ORDER).map(list => list.indexOf(name)).filter(x => x >= 0);
    return i.length ? Math.min(...i) : 999;
  };
  Object.entries(map).forEach(([date, names]) => names.sort((a, b) => {
    const ta = firstAt[date + "|" + a], tb = firstAt[date + "|" + b];
    if(ta && tb) return ta < tb ? -1 : ta > tb ? 1 : 0;
    if(ta || tb) return ta ? -1 : 1;
    return planned(a) - planned(b);
  }));
  return map;
}

const CAL_MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const CAL_DAY_LETTERS = { full:"F", upper:"U", lower:"L", extra:"E" };
const CAL_DAY_COLORS = { full:"var(--accent-2)", upper:"var(--amber)", lower:"var(--emerald)", extra:"var(--slate)" };

function prevMonth(){
  calendarMonth--;
  if(calendarMonth < 0){ calendarMonth = 11; calendarYear--; }
  calendarSelectedDate = null;
  render();
}
function nextMonth(){
  calendarMonth++;
  if(calendarMonth > 11){ calendarMonth = 0; calendarYear++; }
  calendarSelectedDate = null;
  render();
}
function selectCalendarDate(dateStr){
  calendarSelectedDate = calendarSelectedDate === dateStr ? null : dateStr;
  render();
}
function toggleCalendarExpanded(){
  calendarExpanded = !calendarExpanded;
  render();
}
function toggleLastSessionExpanded(){
  lastSessionExpanded = !lastSessionExpanded;
  render();
}
function toggleVolumeExpanded(){
  volumeExpanded = !volumeExpanded;
  render();
}

function renderCalendar(){
  const sessionsByDate = getSessionsByDate();
  const firstOfMonth = new Date(calendarYear, calendarMonth, 1);
  const daysInMonth = new Date(calendarYear, calendarMonth+1, 0).getDate();
  const startWeekday = firstOfMonth.getDay();
  const todayStr = todayISO();
  const monthPrefix = `${calendarYear}-${String(calendarMonth+1).padStart(2,"0")}-`;
  const sessionsThisMonth = Object.keys(sessionsByDate).filter(d => d.startsWith(monthPrefix)).length;

  let html = `<div class="card">`;
  html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:${calendarExpanded?'0.6rem':'0'};">
    <button class="tool-btn" onclick="prevMonth()">‹ Prev</button>
    <h3 class="section" style="margin:0;">${CAL_MONTH_NAMES[calendarMonth]} ${calendarYear}</h3>
    <button class="tool-btn" onclick="nextMonth()">Next ›</button>
  </div>`;

  html += `<div onclick="toggleCalendarExpanded()" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;font-size:0.78rem;color:var(--slate);padding:${calendarExpanded?'0':'0.3rem 0'};">
    <span>${sessionsThisMonth} session${sessionsThisMonth===1?'':'s'} this month</span>
    <span style="color:var(--amber);font-weight:600;">${calendarExpanded ? 'Hide calendar ▲' : 'Show calendar ▼'}</span>
  </div>`;

  if(calendarExpanded){
    html += `<div class="cal-grid cal-header" style="margin-top:0.5rem;">` + ["S","M","T","W","T","F","S"].map(d => `<div>${d}</div>`).join("") + `</div>`;
    html += `<div class="cal-grid">`;
    for(let i = 0; i < startWeekday; i++) html += `<div class="cal-cell empty"></div>`;
    for(let day = 1; day <= daysInMonth; day++){
      const dateStr = `${calendarYear}-${String(calendarMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const namesLogged = sessionsByDate[dateStr];
      const dayType = namesLogged ? guessDayForNames(namesLogged) : null;
      const letter = dayType ? CAL_DAY_LETTERS[dayType] : "";
      const color = dayType ? CAL_DAY_COLORS[dayType] : "transparent";
      const isToday = dateStr === todayStr;
      const isSelected = dateStr === calendarSelectedDate;
      html += `<div class="cal-cell${isToday?' today':''}${namesLogged?' has-session':''}${isSelected?' selected':''}" ${namesLogged ? `onclick="selectCalendarDate('${dateStr}')"` : ''}>
        <span class="cal-daynum">${day}</span>
        ${letter ? `<span class="cal-badge" style="background:${color};">${letter}</span>` : ''}
      </div>`;
    }
    html += `</div>`;

    if(calendarSelectedDate && sessionsByDate[calendarSelectedDate]){
      const names = sessionsByDate[calendarSelectedDate];
      html += `<div class="cal-detail"><p style="font-weight:600;font-size:0.8rem;margin:0 0 0.35rem;">${fmtDate(calendarSelectedDate)}</p>`;
      names.forEach(n => {
        const ex = data[n];
        const entry = ex.entries.slice().reverse().find(e => e.date === calendarSelectedDate);
        if(entry){
          html += `<div style="font-size:0.78rem;color:var(--slate);font-family:var(--font-body);font-variant-numeric:tabular-nums;">${n} - ${formatEntryValue(entry, ex)}</div>`;
        }
      });
      html += `</div>`;
    }

    const legendTitles = { ...DAY_TITLES, extra: "Extra" };
    html += `<div class="cal-legend">`;
    Object.keys(CAL_DAY_LETTERS).forEach(d => {
      html += `<span><span class="cal-badge" style="background:${CAL_DAY_COLORS[d]};">${CAL_DAY_LETTERS[d]}</span> ${legendTitles[d]}</span>`;
    });
    html += `</div>`;
  }

  const recovery = computeRecoveryReadiness();
  if(recovery){
    const readinessColor = recovery.readiness >= 7 ? "var(--emerald)" : recovery.readiness >= 4 ? "var(--amber)" : "var(--danger)";
    html += `<p style="font-size:0.76rem;color:var(--slate);margin:0.6rem 0 0;padding-top:0.5rem;border-top:1px dashed var(--line);">
      Recovery readiness: <b style="color:${readinessColor};font-family:var(--font-body);font-variant-numeric:tabular-nums;">${recovery.readiness}/10</b>
      - ${recovery.daysSince} day${recovery.daysSince===1?'':'s'} rested${recovery.neededRestDays > 0 ? `, ~${recovery.neededRestDays} more suggested` : ', should be ready'}
    </p>`;
  }

  html += `</div>`;
  return html;
}

function getLastSessionDate(){
  let maxDate = null;
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    ex.entries.forEach(e => {
      if(e.date && (!maxDate || e.date > maxDate)) maxDate = e.date;
    });
  });
  return maxDate;
}

// ---------- lifts that are due ----------
// A program lift is due once the days it belongs to were trained at least twice since it was last
// done, counting only real misses. A session where it was skipped with a reason (injury, equipment,
// time, other), one in a deload week, or one while Shoulder Rehab had it paused doesn't count. A lift
// a modifier pauses or hides right now (rehab pause, preseason-only, knee-only), or one never logged,
// is never due.
const DUE_AFTER_MISSES = 2;
function trainingDates(){
  const byDate = {};
  Object.entries(data).forEach(([n, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(n)) return;
    ex.entries.forEach(e => {
      const d = (byDate[e.date] ||= { names: new Set(), deload: false });
      d.names.add(n);
      if(e.deload) d.deload = true;
    });
  });
  const inDeloadWindow = d => !!(deloadDates.startedOn && d >= deloadDates.startedOn && d <= (deloadDates.endedOn || todayISO()));
  Object.entries(byDate).forEach(([date, d]) => { d.day = guessDayForNames([...d.names]); if(inDeloadWindow(date)) d.deload = true; });
  return byDate;
}
function pausedByRehabOn(name, date){
  const r = shoulderRehab;
  if(!r || !r.startedOn || date < r.startedOn || date > (r.endedOn || todayISO())) return false;
  return SHOULDER_PAUSED.has(name) || (name === "Bicep Curl" && date < shiftISO(r.startedOn, (HAMMER_FROM_WEEK - 1) * 7));
}
function dueLifts(){
  const dates = trainingDates(), today = todayISO();
  const sorted = Object.keys(dates).filter(d => d < today).sort();
  const due = {};
  ["full", "upper", "lower"].forEach(day => activeDayOrder(day).forEach(name => {
    if(name in due) return;
    due[name] = null;
    if(isShoulderPaused(name)) return;
    const homes = ["full", "upper", "lower"].filter(d => activeDayOrder(d).includes(name));
    const ex = data[name];
    // Never logged: not part of the routine yet, so never due.
    if(!ex || !ex.entries.length) return;
    const last = ex.entries[ex.entries.length - 1].date;
    const missed = sorted.filter(d => d > last && homes.includes(dates[d].day) && !dates[d].names.has(name)
      && !skipReason(name, d) && !dates[d].deload && !pausedByRehabOn(name, d));
    if(missed.length >= DUE_AFTER_MISSES) due[name] = { missedSessions: missed.length, lastDone: last };
  }));
  Object.keys(due).forEach(n => { if(!due[n]) delete due[n]; });
  return due;
}
function dueLine(name, due){
  const d = (due || dueLifts())[name];
  return d ? `Due: missed its last ${d.missedSessions} sessions; do it early today.` : "";
}

// Joint checks over the last 14 days, by area: flagged when 2 of the area's last 3 scores are
// above 3 of 10, the point where a care modifier (or a professional) should come in.
const PAIN_CARE = { knee: "knee", back: "back", shoulder: "shoulder" };
function painSignals(){
  const since = shiftISO(todayISO(), -14), byArea = {};
  Object.values(data).forEach(ex => ex.entries.forEach(e => {
    if(e.pain != null && e.date >= since) (byArea[e.painArea || "other"] = byArea[e.painArea || "other"] || []).push(e);
  }));
  return Object.entries(byArea).map(([area, es]) => {
    const last3 = es.sort((a, b) => ((a.date + (a.loggedAt || "")) < (b.date + (b.loggedAt || "")) ? -1 : 1)).slice(-3);
    const high = last3.filter(e => e.pain > PAIN_HOLD_ABOVE).length;
    return high >= 2 ? { area, high, of: last3.length } : null;
  }).filter(Boolean);
}
function painLine(sig){
  const what = `${sig.area[0].toUpperCase() + sig.area.slice(1)} pain was above 3 on ${sig.high} of your last ${sig.of} joint checks`;
  const mod = PAIN_CARE[sig.area] && MODE_DEFS.find(m => m.key === PAIN_CARE[sig.area]);
  return mod && !modes[mod.key] ? `${what}: consider turning on ${mod.name}.` : `${what}: if it keeps up, get it checked by a physio or doctor.`;
}

function generateCoachNotes(){
  const lastDate = getLastSessionDate();
  if(!lastDate) return null;

  const items = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
    for(let i = ex.entries.length - 1; i >= 0; i--){
      if(ex.entries[i].date === lastDate){
        const entry = ex.entries[i];
        const hit = ex.trackBy === "weight" ? entry.reps >= entryTargetReps(ex, entry) : true;
        items.push({ name, entry, hit, ex });
        break;
      }
    }
  });
  if(!items.length) return null;

  // Guess which day type this session matches best, just for the opening line
  const dayGuess = guessDayForNames(items.map(i => i.name));
  const dayLabel = dayGuess ? DAY_TITLES[dayGuess] : "Last session";

  // Only what the cards don't already say: the session's result, misses, flagged notes, records,
  // balance and lifts falling behind. Modifier status lives on the badges and the Overview rows.
  const total = items.length;
  const hitCount = items.filter(i => i.hit).length;
  const missed = items.filter(i => !i.hit && !i.entry.deload);
  const concerns = items.filter(i => i.entry.note && CONCERN_WORDS.some(w => i.entry.note.toLowerCase().includes(w)));
  const records = items.filter(i => prFlags(i.ex)[i.ex.entries.indexOf(i.entry)]);

  const sentences = [`${dayLabel} on ${fmtDate(lastDate)}: ${hitCount}/${total} lifts hit target.`];
  if(records.length){
    sentences.push(`Rep PR${records.length > 1 ? "s" : ""}: ${records.slice(0, 3).map(i => i.ex.trackBy === "weight" ? `${i.name} (${i.entry.reps} at ${i.entry.weight} lb)` : `${i.name} (${i.entry.reps})`).join(", ")}.`);
  }
  if(missed.length){
    const names = missed.slice(0,2).map(i => i.ex.trackBy==="weight" ? `${i.name} (${i.entry.weight} lb)` : i.name).join(" and ");
    sentences.push(`${names} missed target: hold the weight next time.`);
  }
  painSignals().forEach(sig => sentences.push(painLine(sig)));
  if(concerns.length){
    const c = concerns[0];
    sentences.push(`Watch ${c.name}: you noted "${escapeHtml(c.entry.note)}". Don't push through it.`);
  }
  const bal = weeklyBalance();
  if(bal.ratio != null && bal.ratio < bal.target){
    sentences.push(`Pulling is behind pressing: ${bal.pull} pull sets to ${bal.push} press over 4 weeks. About ${bal.short} more pull set${bal.short === 1 ? "" : "s"} a week evens it out.`);
  }
  const dueNow = Object.keys(dueLifts());
  if(dueNow.length){
    sentences.push(`Due: ${dueNow.slice(0, 3).join(", ")}${dueNow.length > 3 ? ` and ${dueNow.length - 3} more` : ""} missed ${dueNow.length > 1 ? "their" : "its"} last 2+ sessions. Do ${dueNow.length > 1 ? "them" : "it"} early next time.`);
  }

  return sentences.join(" ");
}

