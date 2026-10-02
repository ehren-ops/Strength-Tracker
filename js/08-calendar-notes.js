// Session calendar, day guessing, last session, and the rule-based Coach's Notes.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- overview ----------
const DAY_GROUP_KEYS = ["full","upper","lower","extra"];
// How much a logged exercise should count as evidence for a given day
// type. An exercise that lives on only one day list (e.g. Walking Lunge,
// Lower Body only, or Farmer's Carry, Extra only) is strong, distinctive
// evidence; one shared across several lists (e.g. Squat/RDL, on both Full
// Body and Lower Body) doesn't discriminate between them and should count
// for proportionally less. Raw overlap counts previously let Full Body's
// broad roster (which overlaps with almost everything) win ties it
// shouldn't.
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

function getSessionsByDate(){
  const map = {};
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist") return;
    ex.entries.forEach(e => {
      if(!e.date) return;
      if(!map[e.date]) map[e.date] = [];
      if(!map[e.date].includes(name)) map[e.date].push(name);
    });
  });
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
          html += `<div style="font-size:0.78rem;color:var(--slate);font-family:var(--font-mono);">${n} - ${formatEntryValue(entry, ex)}</div>`;
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
      Recovery readiness: <b style="color:${readinessColor};font-family:var(--font-mono);">${recovery.readiness}/10</b>
      - ${recovery.daysSince} day${recovery.daysSince===1?'':'s'} rested${recovery.neededRestDays > 0 ? `, ~${recovery.neededRestDays} more suggested` : ', should be ready'}
    </p>`;
  }

  html += `</div>`;
  return html;
}

function getLastSessionDate(){
  let maxDate = null;
  Object.values(data).forEach(ex => {
    if(ex.trackBy === "checklist") return;
    ex.entries.forEach(e => {
      if(e.date && (!maxDate || e.date > maxDate)) maxDate = e.date;
    });
  });
  return maxDate;
}

function generateCoachNotes(){
  const lastDate = getLastSessionDate();
  if(!lastDate) return null;

  const items = [];
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist") return;
    for(let i = ex.entries.length - 1; i >= 0; i--){
      if(ex.entries[i].date === lastDate){
        const entry = ex.entries[i];
        const prev = ex.entries[i-1] || null;
        let trend = "first";
        if(prev){
          if(ex.trackBy === "weight") trend = entry.weight > prev.weight ? "increased" : entry.weight < prev.weight ? "decreased" : "held";
          else trend = entry.reps > prev.reps ? "increased" : entry.reps < prev.reps ? "decreased" : "held";
        }
        const targetReps = ex.targetReps || 8;
        const hit = ex.trackBy === "weight" ? entry.reps >= targetReps : true;
        items.push({ name, entry, trend, hit, ex });
        break;
      }
    }
  });
  if(!items.length) return null;

  // Guess which day type this session matches best, just for the opening line
  const dayGuess = guessDayForNames(items.map(i => i.name));
  const dayLabel = dayGuess ? DAY_TITLES[dayGuess] : "Last session";

  const total = items.length;
  const hitCount = items.filter(i => i.hit).length;
  const increased = items.filter(i => i.trend === "increased");
  const missed = items.filter(i => !i.hit);
  const concerns = items.filter(i => i.entry.note && CONCERN_WORDS.some(w => i.entry.note.toLowerCase().includes(w)));

  const sentences = [];
  sentences.push(`${dayLabel} on ${fmtDate(lastDate)} - ${hitCount}/${total} lifts hit target clean.`);

  if(increased.length){
    const names = increased.slice(0,2).map(i => i.name).join(" and ");
    sentences.push(`${names} moved up in weight and still landed it - good sign, keep building there.`);
  }
  if(missed.length){
    const names = missed.slice(0,2).map(i => i.ex.trackBy==="weight" ? `${i.name} (${i.entry.weight}lbs)` : i.name).join(" and ");
    sentences.push(`${names} missed target - hold steady there next time instead of adding more.`);
  }
  if(concerns.length){
    const c = concerns[0];
    sentences.push(`Worth flagging: ${c.name} noted "${escapeHtml(c.entry.note)}" - keep an eye on that rather than pushing through it.`);
  }
  if(!missed.length && !concerns.length && hitCount === total){
    sentences.push(increased.length ? `Clean session across the board - nothing to dial back here.` : `Solid and consistent - everything landed, nothing urgent to change.`);
  }
  if(modes.ski && (dayGuess === "lower" || dayGuess === "full")){
    sentences.push(`🎿 Ski season is on - keep leaning into single-leg work and a controlled lowering phase on squat/split squat/lunge.`);
  }
  if(modes.knee){
    sentences.push(`🦵 Knee care mode is on - squat, Bulgarian split squat, and walking lunge are holding at a lighter load.`);
  }
  if(modes.back){
    sentences.push(`🩺 Low back care mode is on - squat, RDL, barbell row, and kettlebell swings are holding at a lighter load.`);
  }

  return sentences.join(" ");
}

