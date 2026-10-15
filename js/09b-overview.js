// Overview page: deload status and its end-of-week popup, training modifier rows, Weekly Balance,
// % change since a chosen range, and Backup & Restore. Classic script, shared global scope.

// Last deload and when the next one is due. With no deload on record, the
// clock starts at the first logged session.
function deloadStatus(){
  let firstDate = null;
  Object.entries(data).forEach(([name, ex]) => {
    if(ex.trackBy === "checklist" || isRecovery(name)) return;
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

// Overview sections that fold away by tapping their heading, remembered on this device like the
// graph toggle. Folded, the heading carries a one-line summary instead.
const OVERVIEW_COLLAPSED_KEY = "strength-tracker-overview-collapsed";
let overviewCollapsed = (function(){ try{ return JSON.parse(localStorage.getItem(OVERVIEW_COLLAPSED_KEY)) || {}; }catch(e){ return {}; } })();
function toggleOverviewSection(key){
  overviewCollapsed[key] = !overviewCollapsed[key];
  try{ localStorage.setItem(OVERVIEW_COLLAPSED_KEY, JSON.stringify(overviewCollapsed)); }catch(e){}
  render();
}
function collapsibleHead(key, title, summary){
  const closed = !!overviewCollapsed[key];
  return `<button type="button" class="section-toggle${closed ? " closed" : ""}" onclick="toggleOverviewSection('${key}')" aria-expanded="${!closed}">
    <h3 class="section">${title}</h3>${closed && summary ? `<span class="section-summary">${summary}</span>` : ""}</button>`;
}

// One modifier: a title row with its on/off switch, then a short description.
// The hidden label keeps "Name: ON/OFF" readable for screen readers.
function renderModifierRow(key, extraHtml){
  const { emoji, name, desc } = MODE_DEFS.find(m => m.key === key), on = !!modes[key];
  return `<div class="mod-row">
      <div class="mod-head">
        <span class="mod-title">${emoji} ${name}</span>
        <button class="theme-toggle mod-switch${on ? " on" : ""}" style="--mod-color:var(--${key})" onclick="toggleMode('${key}')" aria-pressed="${on}" aria-label="${name}"><span class="knob"></span><span class="sr-only">${name}: ${on ? "ON" : "OFF"}</span></button>
      </div>
      <p class="mod-desc">${desc}</p>
      ${extraHtml || ""}
    </div>`;
}

// Shoulder Rehab: the daily rehab card on every day, flies, incline, lateral raises and slams
// paused, bench and curls held. One status line on or off.
function renderShoulderModifier(){
  let status;
  if(modes.shoulder) status = `${shoulderRehab.startedOn ? `On since ${fmtShortDate(shoulderRehab.startedOn)}` : "On"} · week ${rehabWeek()}, phase ${rehabPhase()}`;
  else if(shoulderRehab.startedOn) status = `Last run: ${fmtShortDate(shoulderRehab.startedOn)} to ${fmtShortDate(shoulderRehab.endedOn || shoulderRehab.startedOn)}. Paused lifts ramp back 85, 92.5, 100%.`;
  else status = `Not started`;
  return renderModifierRow("shoulder", `<div class="shoulder-status">${status}</div>`);
}

// Deload status is always exactly two short lines, so the row stays the same size on or off.
function renderDeloadModifier(){
  const st = deloadStatus();
  let last, next;
  if(st.on){
    last = st.startedOn ? `On since ${fmtShortDate(st.startedOn)} · day ${daysBetween(st.startedOn, todayISO()) + 1}` : "On";
    next = deloadDates.plannedEndOn ? `Switches off ${fmtShortDate(deloadDates.plannedEndOn)} unless you keep it on` : `Switch off when the week is up`;
  } else {
    last = st.startedOn ? `Last deload: ${fmtShortDate(st.startedOn)} to ${fmtShortDate(st.endedOn || st.startedOn)}` : `No deload logged yet`;
    if(!st.nextDue) next = `Next recommended: after ~5 weeks of training`;
    else if(st.daysUntilDue > 0) next = `Next recommended: ${fmtShortDate(st.nextDue)} (in ${st.daysUntilDue} day${st.daysUntilDue === 1 ? "" : "s"})`;
    else if(st.daysUntilDue === 0) next = `Next recommended: today`;
    else next = `Next recommended: ${fmtShortDate(st.nextDue)} · <b>due now</b>`;
  }
  return renderModifierRow("deload", `<div class="deload-status" id="deload-status"><div>${last}</div><div>${next}</div></div>`);
}

// ---------- weekly balance ----------
// Working sets per movement pattern: this week, and the weekly average over 4 weeks. Pulling
// should at least match pressing (1.5 pull sets per press set while rehabbing a shoulder), the
// imbalance behind most shoulder trouble.
const BALANCE_PATTERNS = ["push", "pull", "squat", "hinge", "single-leg", "power", "calves", "carry and grip", "core"];
function setsByPattern(from, to){
  const out = {};
  Object.entries(data).forEach(([name, ex]) => {
    const p = LIFT_PATTERNS[name];
    if(!p || ex.trackBy === "checklist" || ex.trackBy === "duration") return;
    ex.entries.forEach(e => { if(e.date >= from && e.date <= to) out[p] = (out[p] || 0) + (Number(e.sets) || 0); });
  });
  return out;
}
function weeklyBalance(){
  const today = todayISO();
  const week = setsByPattern(shiftISO(today, -6), today);
  const four = setsByPattern(shiftISO(today, -27), today);
  const avg = Object.fromEntries(Object.entries(four).map(([p, n]) => [p, Math.round(n / 4 * 10) / 10]));
  const push = four.push || 0, pull = four.pull || 0;
  const target = modes.shoulder ? 1.5 : 1;
  const ratio = push ? Math.round(pull / push * 10) / 10 : null;
  // Extra pull sets a week that would reach the target at the current pressing volume.
  const short = ratio != null && ratio < target ? Math.ceil((push * target - pull) / 4) : 0;
  return { week, avg, ratio, target, short };
}
function renderBalanceCard(){
  const b = weeklyBalance();
  const rows = BALANCE_PATTERNS.filter(p => b.week[p] || b.avg[p]);
  const ratioTxt = b.ratio == null ? "" : `Pull : push ${b.ratio} : 1`;
  let html = `<div class="card">${collapsibleHead("balance", "Weekly Balance", ratioTxt)}`;
  if(overviewCollapsed.balance) return html + `</div>`;
  if(!rows.length) return html + `<p class="range-note">Sets per movement pattern show here once you log a few sessions.</p></div>`;
  const ok = b.ratio != null && b.ratio >= b.target;
  if(b.ratio != null){
    html += `<p class="bal-ratio ${ok ? "bal-ok" : "bal-low"}"><b>${ratioTxt}</b> over 4 weeks · target ${b.target} : 1${modes.shoulder ? " while rehabbing" : ""}.${ok ? "" : ` About ${b.short} more pull set${b.short === 1 ? "" : "s"} a week would even it out.`}</p>`;
  }
  const max = Math.max(...rows.map(p => Math.max(b.week[p] || 0, b.avg[p] || 0)), 1);
  html += `<div class="bal-head"><span></span><span></span><span>Week · avg</span></div>`;
  rows.forEach(p => {
    const w = b.week[p] || 0, a = b.avg[p] || 0;
    html += `<div class="bal-row"><span class="bal-name">${p}</span>
      <span class="bal-bar"><span style="width:${(w / max * 100).toFixed(0)}%"></span><i style="left:${(a / max * 100).toFixed(0)}%"></i></span>
      <span class="bal-n">${w} · ${a}</span></div>`;
  });
  html += `<p class="range-note">Working sets per pattern. The tick marks the 4-week weekly average.</p></div>`;
  return html;
}

// Change per lift from its first to its latest full session, over everything logged or a recent
// window. Deload sessions are left out, so a planned light week never reads as a drop.
const CHANGE_RANGES = [["2W", 14, "Past 2 weeks"], ["1M", 30, "Past month"], ["3M", 91, "Past 3 months"], ["6M", 182, "Past 6 months"], ["1Y", 365, "Past year"], ["All", null, "Since first logged"]];
const CHANGE_RANGE_KEY = "strength-tracker-change-range";
let changeRange = (function(){ try{ const v = localStorage.getItem(CHANGE_RANGE_KEY); return CHANGE_RANGES.some(r => r[0] === v) ? v : "All"; }catch(e){ return "All"; } })();
function setChangeRange(key){
  changeRange = key;
  try{ localStorage.setItem(CHANGE_RANGE_KEY, key); }catch(e){}
  render();
}
function changeData(days){
  const since = days ? shiftISO(todayISO(), -days) : "";
  return Object.entries(data).map(([name, ex]) => {
    if(ex.trackBy === "checklist" || ex.trackBy === "duration" || isRecovery(name)) return null;
    const pts = ex.entries.filter(e => !e.deload && e.date >= since);
    if(pts.length < 2) return null;
    const f = pts[0], l = pts[pts.length - 1];
    const firstVal = ex.trackBy === "weight" ? f.weight : f.reps;
    const lastVal = ex.trackBy === "weight" ? l.weight : l.reps;
    if(!firstVal) return null;
    return { name, pct: ((lastVal - firstVal) / firstVal) * 100, firstVal, lastVal, trackBy: ex.trackBy, sessions: pts.length };
  }).filter(Boolean).sort((a, b) => b.pct - a.pct);
}

function renderOverview(){
  const app = document.getElementById("app");
  const overviewData = changeData(null);

  const avgPct = overviewData.length ? overviewData.reduce((s,o)=>s+o.pct,0)/overviewData.length : 0;
  const totalSessions = Object.entries(data).reduce((s,[n,ex])=>n === REHAB_NAME || isRecovery(n) ? s : s+ex.entries.length,0);
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

  html += renderBalanceCard();

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
        <span class="exact">${latest !== null ? latest.toLocaleString()+" lb" : "-"}</span>
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
          ${history.length ? `<span style="font-family:var(--font-body);font-variant-numeric:tabular-nums;font-size:0.76rem;color:var(--slate);">${history[history.length-1].weight.toLocaleString()} lb last session</span>` : ''}
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

  const range = CHANGE_RANGES.find(r => r[0] === changeRange);
  const changeRows = changeData(range[1]);
  const changeAvg = changeRows.length ? Math.round(changeRows.reduce((s, o) => s + o.pct, 0) / changeRows.length) : 0;
  html += `<div class="card">${collapsibleHead("change", "% Change Since First Logged",
    changeRows.length ? `avg ${changeAvg > 0 ? "+" : ""}${changeAvg}% · ${range[0]}` : range[0])}`;
  if(!overviewCollapsed.change){
    html += `<div class="range-row" role="group" aria-label="Range">${CHANGE_RANGES.map(([k, , label]) =>
      `<button type="button" class="range-chip${k === changeRange ? " active" : ""}" onclick="setChangeRange('${k}')" aria-pressed="${k === changeRange}" title="${label}">${k}</button>`).join("")}</div>`;
    html += `<p class="range-note">${range[2]}: first to latest full session${range[1] ? " in the range" : ""}. Deload weeks left out.</p>`;
  }
  if(overviewCollapsed.change){
    // folded: the heading's summary is enough
  } else if(!changeRows.length){
    html += `<p style="font-size:0.85rem;color:var(--slate);font-style:italic;">${range[1] ? "No lift has 2 full sessions in this range yet." : "Need at least 2 sessions on a lift to show change."}</p>`;
  } else {
    changeRows.forEach(o => {
      const color = o.pct>0 ? "var(--emerald)" : o.pct<0 ? "var(--amber)" : "var(--slate)";
      const width = Math.min(Math.abs(o.pct),100);
      const freq = frequencyLabel(data[o.name]);
      html += `<div class="bar-row">
        <div class="top"><span style="font-weight:500;">${o.name}</span><span style="font-family:var(--font-body);font-variant-numeric:tabular-nums;font-size:0.72rem;color:${color};">${o.pct>0?'+':''}${o.pct.toFixed(0)}% · ${o.firstVal}→${o.lastVal}${o.trackBy==='weight'?' lb':' reps'}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${color};"></div></div>
        ${freq ? `<div style="font-size:0.66rem;color:var(--slate);margin-top:0.15rem;">${freq}</div>` : ''}
      </div>`;
    });
  }
  html += `</div>`;

  const modsOn = MODE_DEFS.filter(m => modes[m.key]).map(m => m.short);
  const modRow = m => m.key === "deload" ? renderDeloadModifier() : m.key === "shoulder" ? renderShoulderModifier() : renderModifierRow(m.key);
  html += `<div class="card">
    ${collapsibleHead("modifiers", "Training Modifiers", modsOn.length ? `On: ${modsOn.join(", ")}` : "All off")}
    ${overviewCollapsed.modifiers ? "" : MODE_DEFS.map(modRow).join("")}
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
