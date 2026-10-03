// Progress charts: calendar quarters and the inline SVG chart.
// Classic script sharing one global scope with the other js/NN-*.js files, run in order.

// ---------- chart quarters (calendar-aligned: Q1 Jan-Mar ... Q4 Oct-Dec) ----------
const QUARTER_MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function currentQuarterIndex(){
  const d = new Date();
  return d.getFullYear() * 4 + Math.floor(d.getMonth() / 3);
}
function quarterFromIndex(qIndex){
  const year = Math.floor(qIndex / 4);
  const q = qIndex - year * 4;
  return { year, q };
}
function quarterDateRange(qIndex){
  const { year, q } = quarterFromIndex(qIndex);
  const startMonth = q * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
  return { start, end, year, q };
}
function dateInQuarter(dateStr, qIndex){
  if(!dateStr) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const { start, end } = quarterDateRange(qIndex);
  return t >= start.getTime() && t <= end.getTime();
}
function fmtQuarterRange(qIndex){
  const { start, end, year, q } = quarterDateRange(qIndex);
  const s = `${QUARTER_MONTH_ABBR[start.getUTCMonth()]} ${start.getUTCDate()}`;
  const e = `${QUARTER_MONTH_ABBR[end.getUTCMonth()]} ${end.getUTCDate()}`;
  return `Q${q + 1} ${year} · ${s} – ${e}`;
}
function shiftChartQuarter(chartKey, delta){
  chartQuarterOffset[chartKey] = (chartQuarterOffset[chartKey] || 0) + delta;
  render();
}

// ---------- chart (pure inline SVG, no external library) ----------
function renderChart(ex, suggestion, isRealExercise, chartKey){
  const W = 320, H = 130, padR = 14, padT = 10, padB = 20;
  const entries = ex.entries;
  const deloadFlagsFull = isRealExercise ? computeDeloadFlags(ex) : new Array(entries.length).fill(false);

  const offset = chartQuarterOffset[chartKey] || 0;
  const qIndex = currentQuarterIndex() + offset;
  const points = entries
    .map((e, i) => ({ x: i, y: chartValue(e, ex), entry: e, deload: deloadFlagsFull[i] }))
    .filter(p => dateInQuarter(p.entry.date, qIndex));
  const deloadFlags = points.map(p => p.deload);

  let nav = `<div class="chart-quarter-nav">
    <button class="tool-btn" onclick="shiftChartQuarter('${chartKey.replace(/'/g,"\\'")}', -1)">‹ Prev</button>
    <span class="chart-quarter-label">${fmtQuarterRange(qIndex)}</span>
    <button class="tool-btn" ${offset >= 0 ? "disabled" : ""} onclick="shiftChartQuarter('${chartKey.replace(/'/g,"\\'")}', 1)">Next ›</button>
  </div>`;
  if(!points.length){
    return nav + `<p style="font-size:0.76rem;color:var(--slate);font-style:italic;margin:0.4rem 0 0;">No sessions logged this quarter.</p>`;
  }

  const hasProjection = !!suggestion && offset === 0;
  const projY = hasProjection ? suggestionValue(suggestion, ex) : null;

  const allY = points.map(p=>p.y).concat(hasProjection ? [projY] : []);
  const forceStep = ex.trackBy === "weight" ? undefined : 1;
  const { lo, hi, step } = niceTicks(allY, forceStep);
  const tickValues = ticksBetween(lo, hi, step);

  // Left padding scales with how wide the y-axis labels actually are,
  // so large numbers (like total volume) don't overflow past the edge.
  const tickLabels = tickValues.map(v => String(v));
  const maxLabelLen = tickLabels.reduce((m,s) => Math.max(m, s.length), 1);
  const padL = 14 + maxLabelLen * 5.5;

  const n = points.length + (hasProjection ? 1 : 0);
  const xStep = n > 1 ? (W - padL - padR) / (n - 1) : 0;

  function xAt(i){ return padL + i * xStep; }
  function yAt(v){ return padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo || 1)); }

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}">`;

  // gridlines + y labels
  tickValues.forEach(v => {
    const y = yAt(v);
    svg += `<line x1="${padL}" y1="${y}" x2="${W-padR}" y2="${y}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    svg += `<text x="${padL-6}" y="${y+3}" font-size="8" fill="var(--chart-axis)" text-anchor="end" style="font-family:var(--font-body);font-variant-numeric:tabular-nums">${v}</text>`;
  });

  // solid line through actual points
  if(points.length > 1){
    const path = points.map((p,i) => `${i===0?'M':'L'}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(" ");
    svg += `<path d="${path}" fill="none" stroke="var(--chart-line)" stroke-width="2.5"/>`;
  }
  // dots + x labels for actual points - deload gets a hollow red marker,
  // under 3 sets gets dark red, missed target reps gets red, extra reps/sets
  // (that actually hit target) gets green - each with a small sets×reps label
  points.forEach((p,i) => {
    const isDeload = deloadFlags[i];
    const targetReps = ex.targetReps || 8;
    const isUnder = isRealExercise && !isDeload && ex.trackBy !== "duration" && p.entry.sets < 3;
    const isMissed = isRealExercise && !isDeload && !isUnder && ex.trackBy !== "duration" && p.entry.reps < targetReps;
    const isExtra = isRealExercise && !isDeload && !isUnder && !isMissed && ex.trackBy !== "duration" &&
      (p.entry.reps > targetReps || p.entry.sets > 3);
    const titleText = `${fmtDate(p.entry.date)}: ${formatEntryValue(p.entry, ex)}${p.entry.note?" - "+p.entry.note:""}${isDeload?" - deload":""}${isExtra?" - extra volume":""}${isUnder?" - under 3 sets":""}${isMissed?" - missed target reps":""}`;

    function labelWithHalo(text, color){
      const labelY = Math.max(padT + 7, yAt(p.y) - 8);
      const w = text.length * 4.6 + 3;
      svg += `<rect x="${(xAt(i)-w/2).toFixed(1)}" y="${(labelY-6.5).toFixed(1)}" width="${w.toFixed(1)}" height="9" rx="2" fill="var(--chart-label-halo)" opacity="0.85"/>`;
      svg += `<text x="${xAt(i).toFixed(1)}" y="${labelY.toFixed(1)}" font-size="7.5" fill="${color}" font-weight="700" text-anchor="middle" style="font-family:var(--font-body);font-variant-numeric:tabular-nums">${text}</text>`;
    }

    if(isDeload){
      svg += `<line x1="${xAt(i).toFixed(1)}" y1="${padT}" x2="${xAt(i).toFixed(1)}" y2="${H-padB}" stroke="var(--danger)" stroke-width="1" stroke-dasharray="2 2" opacity="0.5"/>`;
      svg += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="5" fill="var(--chart-white)" stroke="var(--danger)" stroke-width="2"><title>${titleText}</title></circle>`;
    } else if(isUnder){
      svg += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="4.5" fill="var(--chart-under)"><title>${titleText}</title></circle>`;
      labelWithHalo(`${p.entry.sets}×${p.entry.reps}`, "var(--chart-under)");
    } else if(isMissed){
      svg += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="4.5" fill="var(--chart-missed)"><title>${titleText}</title></circle>`;
      labelWithHalo(`${p.entry.sets}×${p.entry.reps}`, "var(--chart-missed)");
    } else if(isExtra){
      svg += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="4.5" fill="var(--chart-extra)"><title>${titleText}</title></circle>`;
      labelWithHalo(`${p.entry.sets}×${p.entry.reps}`, "var(--chart-extra)");
    } else {
      svg += `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="4" fill="var(--chart-line)"><title>${titleText}</title></circle>`;
    }
    svg += `<text x="${xAt(i).toFixed(1)}" y="${H-4}" font-size="8" fill="${isDeload?'var(--danger)':'var(--chart-axis)'}" text-anchor="middle" style="font-family:var(--font-body);font-variant-numeric:tabular-nums">${isDeload?'D':p.entry.label}</text>`;
  });

  // dashed projection segment
  if(hasProjection && points.length){
    const lastP = points[points.length-1];
    const x1 = xAt(points.length-1), y1 = yAt(lastP.y);
    const x2 = xAt(points.length), y2 = yAt(projY);
    svg += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--chart-line)" stroke-width="2" stroke-dasharray="5 4"/>`;
    const projLabel = ex.trackBy==="weight" ? `${suggestion.weight}lbs ${repLabel(suggestion.sets,suggestion.reps,ex.unit)}` : ex.trackBy==="duration" ? `${suggestion.minutes} min` : repLabel(suggestion.sets,suggestion.reps,ex.unit);
    svg += `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="4" fill="var(--chart-white)" stroke="var(--chart-line)" stroke-width="2"><title>Suggested next: ${projLabel}</title></circle>`;
    svg += `<text x="${x2.toFixed(1)}" y="${H-4}" font-size="8" fill="var(--chart-line)" text-anchor="middle" style="font-family:var(--font-body);font-variant-numeric:tabular-nums">Next</text>`;
  }

  svg += `</svg>`;
  return nav + svg;
}

