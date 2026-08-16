/* F1 Predictor 2026 - dev packages, learning, data, events, init */

/* ---------- dev packages ---------- */
function renderDev() {
  const el = $('#tab-dev');
  let html = '<h1>Development packages</h1><p class="sub">Log when a team brings an upgrade to a race and how much you think it helped. The AI adds it to that team\'s predicted pace â€” then learns from your verdicts and the actual results to calibrate your estimates.</p>';

  html += '<div class="card"><h2 style="margin-top:0">Add a new package</h2><div class="grid3">';
  html += '<div><label class="fld">Team</label><select data-a="devTeam">' + Object.keys(TEAMS).map(t => '<option value="' + t + '"' + (ui.devTeam === t ? ' selected' : '') + '>' + esc(TEAMS[t].name) + '</option>').join('') + '</select></div>';
  html += '<div><label class="fld">Introduced at</label>' + raceSelectHtml('devRaceSel') + '</div>';
  html += '<div><label class="fld">Estimated impact</label><input type="range" class="slider" min="5" max="100" step="5" value="' + ui.devImpact + '" data-a="devImpact">';
  html += '<div class="spread"><span class="hint">Minor tweak â†’</span><span class="hint">â† game-changing</span><b>' + ui.devImpact + '/100</b></div></div>';
  html += '</div>';
  html += '<div class="formrow" style="margin-top:10px"><label class="fld">Est. lap-time gain (optional, e.g. 0.25s)</label><input data-a="devGain" value="' + esc(ui.devGain) + '" placeholder="seconds"></div>';
  html += '<div class="formrow"><label class="fld">Notes</label><textarea data-a="devNote" placeholder="e.g. New floor + beam wing, rear wing tuned for street circuits">' + esc(ui.devNote) + '</textarea></div>';
  html += '<button class="btn primary" data-a="devAdd">Add package</button></div>';

  html += '<div class="row" style="margin-bottom:10px"><span class="muted small">Filter:</span>';
  html += '<button class="btn small ' + (ui.devFilter === 'all' ? 'primary' : '') + '" data-a="devFilter" data-x="all">All</button>';
  RACES.forEach(r => {
    if (!state.devPackages.some(p => p.raceId === r.id && !p.removed)) return;
    html += '<button class="btn small ' + (ui.devFilter === r.id ? 'primary' : '') + '" data-a="devFilter" data-x="' + r.id + '">' + r.flag + ' R' + r.round + '</button>';
  });
  html += '</div>';

  const list = state.devPackages.filter(p => ui.devFilter === 'all' || p.raceId === ui.devFilter);
  if (!list.length) {
    html += '<div class="card"><div class="empty"><div class="big">ðŸ”§</div>No development packages logged yet.<br><span class="hint">When a team shows up with a new floor, wing or engine upgrade â€” log it here.</span></div></div>';
  }
  list.forEach(p => {
    const t = teamById(p.teamId);
    const r = raceById(p.raceId);
    const verdictText = p.verdict ? { helped: 'Verified: helped', hurt: 'Verified: hurt', neutral: 'Verified: no change' }[p.verdict] : 'Awaiting verdict';
    html += '<div class="devpkg"><div class="head">';
    html += '<img class="timg" style="width:30px;height:30px" src="' + esc(t.logo) + '">';
    html += '<div><b style="color:' + t.color + '">' + esc(t.name) + '</b> <span class="muted">Â· introduced ' + r.flag + ' R' + r.round + ' ' + esc(r.name) + '</span></div>';
    html += '<span class="impactpill" style="background:rgba(229,179,52,.15);color:var(--gold)">impact ' + p.impact + '/100</span>';
    if (p.gain) html += '<span class="impactpill" style="background:rgba(91,168,214,.15);color:var(--blue)">~' + esc(p.gain) + 's claimed</span>';
    if (p.removed) html += '<span class="impactpill" style="background:rgba(231,76,60,.15);color:var(--red)">removed</span>';
    html += '</div>';
    if (p.note) html += '<div class="hint" style="margin-top:6px">â€œ' + esc(p.note) + 'â€</div>';
    html += '<div class="row" style="margin-top:8px">';
    if (!p.removed) {
      html += '<span class="hint" style="margin-right:4px">Did it help?</span>';
      html += '<button class="btn small' + (p.verdict === 'helped' ? ' primary' : '') + '" data-a="devVerdict" data-x="' + p.id + '" data-v="helped">Helped</button>';
      html += '<button class="btn small' + (p.verdict === 'neutral' ? ' primary' : '') + '" data-a="devVerdict" data-x="' + p.id + '" data-v="neutral">No change</button>';
      html += '<button class="btn small' + (p.verdict === 'hurt' ? ' primary' : '') + '" data-a="devVerdict" data-x="' + p.id + '" data-v="hurt">Hurt</button>';
      html += '<button class="btn small danger" data-a="devRemove" data-x="' + p.id + '">Remove</button>';
    } else {
      html += '<button class="btn small" data-a="devRestore" data-x="' + p.id + '">Restore</button>';
    }
    html += '<span class="pill" style="margin-left:auto">' + verdictText + '</span>';
    html += '</div></div>';
  });

  el.innerHTML = html;
}

/* ---------- learning ---------- */
function accuracySeries(session) {
  return state.accuracy.filter(a => a.session === session).map(a => a.mae).filter(v => v != null);
}
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

function lineChartHTML(seriesDef, xLabels) {
  const W = 700, H = 170, P = 30;
  const allVals = [];
  seriesDef.forEach(s => s.values.forEach(v => allVals.push(v)));
  if (!allVals.length) return '<div class="hint">No data yet â€” enter a few race results and watch the AI improve.</div>';
  const min = Math.floor(Math.min.apply(null, allVals) - 0.5);
  const max = Math.ceil(Math.max.apply(null, allVals) + 0.5);
  const span = Math.max(1, max - min);
  const xf = i => P + i * ((W - P - 10) / Math.max(1, xLabels.length - 1));
  const yf = v => H - 12 - ((v - min) / span) * (H - 40);
  let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">';
  for (let g = 0; g <= 4; g++) {
    const y = 12 + g * ((H - 40) / 4);
    const val = max - g * (span / 4);
    s += '<line x1="' + P + '" y1="' + y + '" x2="' + (W - 10) + '" y2="' + y + '" stroke="#242a3a" stroke-width="1"/>';
    s += '<text x="' + (P - 6) + '" y="' + (y + 4) + '" fill="#8b93a7" font-size="10" text-anchor="end">' + val.toFixed(1) + '</text>';
  }
  xLabels.forEach((lab, i) => {
    if (i % 2) return;
    s += '<text x="' + xf(i).toFixed(1) + '" y="' + (H - 2) + '" fill="#8b93a7" font-size="10" text-anchor="middle">' + lab + '</text>';
  });
  seriesDef.forEach(ser => {
    if (!ser.values.length) return;
    let d = '';
    ser.values.forEach((v, i) => { d += (i ? ' L' : 'M') + xf(i).toFixed(1) + ' ' + yf(v).toFixed(1); });
    s += '<polyline points="' + d.replace(/[ML]/g, m => m) + '" fill="none" stroke="' + ser.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    ser.values.forEach((v, i) => { s += '<circle cx="' + xf(i).toFixed(1) + '" cy="' + yf(v).toFixed(1) + '" r="3" fill="' + ser.color + '"/>'; });
  });
  s += '</svg>';
  return s;
}

function renderLearn() {
  const el = $('#tab-learn');
  let html = '<h1>Learning &amp; feedback loop</h1>';
  html += '<p class="sub">Every result you enter updates driver and team ratings, recalibrates how much the AI trusts each signal, and reports back on what changed. That is the feedback loop.</p>';

  const raceMAE = accuracySeries('race');
  const qualiMAE = accuracySeries('quali');
  const sprintMAE = accuracySeries('sprint');
  const allMAE = raceMAE.concat(sprintMAE, qualiMAE);
  const racesDone = RACES.filter(r => hasSession(state, r.id, 'race')).length;
  const raceRecs = state.accuracy.filter(a => a.session === 'race');
  const winsRight = raceRecs.filter(a => a.winnerCorrect).length;

  html += '<div class="grid3">';
  html += '<div class="card"><div class="stat"><div class="num">' + racesDone + '/24</div><div class="lbl">Races logged</div></div></div>';
  html += '<div class="card"><div class="stat"><div class="num">' + (avg(allMAE) != null ? avg(allMAE).toFixed(2) : 'â€“') + '</div><div class="lbl">Avg position error</div></div></div>';
  html += '<div class="card"><div class="stat"><div class="num">' + (raceRecs.length ? winsRight + '/' + raceRecs.length : 'â€“') + '</div><div class="lbl">Winners predicted</div></div></div>';
  html += '</div>';

  html += '<div class="card"><h2 style="margin-top:0">Prediction error over time <span class="muted small">(mean position error â€” lower is better)</span></h2>';
  const xLabels = raceRecs.map(a => 'R' + raceById(a.raceId).round);
  html += '<div class="chartwrap">' + lineChartHTML([
    { label: 'Race', color: '#e8a13c', values: raceMAE },
    { label: 'Quali', color: '#5ba8d6', values: qualiMAE },
    { label: 'Sprint', color: '#d65b9a', values: sprintMAE }
  ], xLabels) + '</div>';
  html += '<div class="row" style="margin-top:6px">';
  [['Race', '#e8a13c', raceMAE], ['Quali', '#5ba8d6', qualiMAE], ['Sprint', '#d65b9a', sprintMAE]].forEach(sd => {
    html += '<span class="pill" style="margin-right:10px"><span style="width:10px;height:10px;border-radius:2px;background:' + sd[1] + ';display:inline-block"></span> ' + sd[0] + ': ' + (avg(sd[2]) != null ? avg(sd[2]).toFixed(2) : 'â€“') + '</span>';
  });
  html += '</div></div>';

  html += '<div class="grid2">';
  html += '<div class="card"><h2 style="margin-top:0">Learned signal weights</h2>';
  html += '<div class="hint" style="margin-bottom:6px">The AI shifts trust toward whatever actually predicts results best.</div>';
  const w = state.model.w;
  [['rating', 'Driver rating', '#3671c6'], ['form', 'Recent form', '#e8a13c'], ['quali', 'Quali speed', '#5ba8d6'], ['grid', 'Starting grid', '#7fd6c6'], ['team', 'Team + upgrades', '#b48ce8'], ['track', 'Track history', '#2ecc71']].forEach(sw => {
    const pct = Math.round(w[sw[0]] * 100);
    html += '<div class="weightbar"><span class="lbl">' + sw[1] + '</span><div class="track"><div style="width:' + pct + '%;background:' + sw[2] + '"></div></div><span class="val">' + pct + '%</span></div>';
  });
  html += '<div class="hint" style="margin-top:8px">Weight-learning rate ' + state.model.wlr + ' Â· K (driver) ' + state.model.K.driver + ' Â· K (team) ' + state.model.K.team + ' Â· early season learns fast.</div></div>';

  html += '<div class="card"><h2 style="margin-top:0">Signal accuracy (latest)</h2>';
  const sigOrder = [['rating', 'Driver rating'], ['form', 'Form'], ['quali', 'Quali'], ['grid', 'Grid'], ['team', 'Team'], ['track', 'Track']];
  const sigErrs = {};
  sigOrder.forEach(s => {
    const arr = state.model.signalErr[s[0]] || [];
    sigErrs[s[0]] = arr.length ? avg(arr.slice(-5)) : null;
  });
  sigOrder.forEach(s => {
    const v = sigErrs[s[0]];
    const pct = v != null ? Math.max(4, 100 - (v / 12) * 100) : 4;
    html += '<div class="weightbar"><span class="lbl">' + s[1] + '</span><div class="track"><div style="width:' + pct + '%;background:' + (v != null && v < 3 ? 'var(--green)' : v != null && v < 6 ? 'var(--gold)' : '#e74c3c') + '"></div></div><span class="val">' + (v != null ? v.toFixed(2) : 'â€“') + '</span></div>';
  });
  html += '<div class="hint" style="margin-top:8px">Average position error of each signal on the last few races (lower = better signal).</div></div>';
  html += '</div>';

  html += '<div class="grid2">';
  html += '<div class="card"><h2 style="margin-top:0">Current learned driver ratings</h2>';
  html += '<table><tr><th>#</th><th>Driver</th><th>Team</th><th style="text-align:right">Rating</th><th style="text-align:right">Î”</th></tr>';
  const sorted = DRIVERS.map(d => ({ d, r: state.driverLatent[d.id] })).sort((a, b) => b.r - a.r);
  sorted.forEach((row, i) => {
    const delta = Math.round(row.r - row.d.rating);
    html += '<tr><td>' + (i + 1) + '</td><td>' + driverLineHTML(row.d.id) + '</td><td class="muted">' + esc(teamName(row.d.team)) + '</td>' +
      '<td style="text-align:right;font-weight:700">' + Math.round(row.r) + '</td>' +
      '<td style="text-align:right;color:' + (delta >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (delta > 0 ? '+' : '') + delta + '</td></tr>';
  });
  html += '</table></div>';

  html += '<div class="card"><h2 style="margin-top:0">Learned team ratings</h2>';
  html += '<table><tr><th>#</th><th>Team</th><th style="text-align:right">Rating</th><th style="text-align:right">Î”</th></tr>';
  const tsorted = Object.keys(TEAMS).map(t => ({ t, r: state.teamLatent[t] })).sort((a, b) => b.r - a.r);
  tsorted.forEach((row, i) => {
    const delta = Math.round(row.r - TEAMS[row.t].base);
    html += '<tr><td>' + (i + 1) + '</td><td class="teamcell">' + teamLogoHTML(row.t, 20) + '<b style="color:' + tcolor(row.t) + '">' + esc(TEAMS[row.t].name) + '</b></td>' +
      '<td style="text-align:right;font-weight:700">' + Math.round(row.r) + '</td>' +
      '<td style="text-align:right;color:' + (delta >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (delta > 0 ? '+' : '') + delta + '</td></tr>';
  });
  html += '</table></div>';
  html += '</div>';

  html += '<div class="grid2">';
  html += '<div class="card"><h2 style="margin-top:0">Rating evolution (top drivers)</h2>';
  const top5 = sorted.slice(0, 5).map(x => x.d);
  if (state.ratingHistory.length < 1) {
    html += '<div class="hint">Ratings history will appear once you log races.</div>';
  } else {
    const xL = state.ratingHistory.map(h => 'R' + raceById(h.raceId).round);
    html += '<div class="chartwrap">' + lineChartHTML(top5.map(d => ({
      label: d.short, color: tcolor(d.team),
      values: state.ratingHistory.map(h => h.ratings[d.id])
    })), xL) + '</div>';
  }
  html += '</div></div>';

  html += '<div class="card"><h2 style="margin-top:0">Dev package calibration</h2>';
  const verds = state.devPackages.filter(p => p.verdict && !p.removed);
  if (!verds.length) {
    html += '<div class="hint">Verdicts you give on development packages will be shown here. Each verdict recalibrates how hard the AI trusts your claimed impact.</div>';
  } else {
    html += '<table><tr><th>Package</th><th>Team</th><th>Impact</th><th>Verdict</th></tr>';
    verds.forEach(p => {
      const t = teamById(p.teamId);
      const r = raceById(p.raceId);
      html += '<tr><td class="teamcell"><img class="timg" src="' + esc(t.logo) + '"><b style="color:' + t.color + '">' + esc(t.name) + '</b></td><td class="muted">R' + r.round + ' ' + esc(r.name) + '</td><td>' + p.impact + '/100</td><td><span class="pill">' + { helped: 'Helped âœ“', neutral: 'No change', hurt: 'Hurt' }[p.verdict] + '</span></td></tr>';
    });
    html += '</table>';
  }
  html += '</div>';

  html += '<div class="card"><h2 style="margin-top:0">Sequential model calibration <span class="muted small">(per-session, per-forecast reliability)</span></h2>';
  if (typeof SeqAPI === 'undefined' || !state.seq) {
    html += '<div class="hint">The sequential engine records per-session calibration here once results are logged.</div>';
  } else {
    const cal = SeqAPI.calibration(state);
    const o = cal.overall;
    html += '<div class="grid3">';
    html += '<div class="card"><div class="stat"><div class="num">' + o.n + '</div><div class="lbl">Forecasts scored</div></div></div>';
    html += '<div class="card"><div class="stat"><div class="num">' + (o.mae != null ? o.mae.toFixed(2) : '–') + '</div><div class="lbl">Mean abs error</div></div></div>';
    html += '<div class="card"><div class="stat"><div class="num">' + (o.winnerAccuracy != null ? Math.round(o.winnerAccuracy * 100) + '%' : '–') + '</div><div class="lbl">Winner accuracy</div></div></div>';
    html += '</div>';
    html += '<table style="margin-top:8px"><tr><th>Bucket</th><th>n</th><th style="text-align:right">MAE</th><th style="text-align:right">Brier</th><th style="text-align:right">Log-loss</th><th style="text-align:right">Tau</th></tr>';
    const rows = [['Overall', o]].concat(Object.keys(cal.bySession).map(k => [SESSIONS[k] ? SESSIONS[k].label : k, cal.bySession[k]]));
    rows.forEach(r => {
      const v = r[1];
      html += '<tr><td>' + esc(r[0]) + '</td><td>' + v.n + '</td>' +
        '<td style="text-align:right">' + (v.mae != null ? v.mae.toFixed(2) : '–') + '</td>' +
        '<td style="text-align:right">' + (v.brier != null ? v.brier.toFixed(3) : '–') + '</td>' +
        '<td style="text-align:right">' + (v.logloss != null ? v.logloss.toFixed(3) : '–') + '</td>' +
        '<td style="text-align:right">' + (v.tau != null ? v.tau.toFixed(3) : '–') + '</td></tr>';
    });
    html += '</table>';
    html += '<div class="hint" style="margin-top:8px">Brier/log-loss score how well-calibrated the probability forecasts are (lower = better). Buckets by driver, team, circuit and weather are stored under the model.</div>';
  }
  html += '</div>';

  html += '<div class="card"><h2 style="margin-top:0">What the AI has learned <span class="muted small">(latest ' + Math.min(8, state.log.length) + ')</span></h2>';
  if (!state.log.length) {
    html += '<div class="hint">Log your first race to see the AI\'s feedback.</div>';
  } else {
    state.log.slice(0, 8).forEach(l => {
      const r = raceById(l.raceId);
      html += '<div class="logentry"><span class="muted small">' + (r ? r.flag + ' ' + r.name : l.raceId) + ' Â· ' + SESSIONS[l.session].label + ' Â· ' + new Date(l.at).toLocaleString() + '</span><div>' + esc(l.text) + '</div></div>';
    });
  }
  html += '</div>';

  el.innerHTML = html;
}

/* ---------- data ---------- */
function renderData() {
  const el = $('#tab-data');
  let html = '<h1>Your data</h1><p class="sub">Everything is saved automatically in this browser after every change. You can also back it up to a file or move it to another machine.</p>';

  html += '<div class="grid2">';
  html += '<div class="card"><h2 style="margin-top:0">Storage</h2>';
  html += '<div class="stat" style="text-align:left"><div class="num">' + (state.savedAt ? new Date(state.savedAt).toLocaleString() : 'never') + '</div><div class="lbl">Last auto-save</div></div>';
  html += '<div class="row" style="margin-top:10px"><button class="btn" data-a="saveNow">Save now</button><button class="btn gold" data-a="backup">Download backup file</button></div>';
  html += '</div>';

  html += '<div class="card"><h2 style="margin-top:0">Backup / restore</h2>';
  html += '<div class="row"><button class="btn primary" data-a="exportJson">Export data (.json)</button>';
  html += '<label class="btn" style="cursor:pointer">Import data<input type="file" accept=".json,application/json" data-a="importJson" style="display:none"></label></div>';
  html += '<div class="hint" style="margin-top:8px">The export file contains every result, dev package, learned rating and weight â€” the full brain. Import restores it.</div>';
  html += '<div class="row" style="margin-top:14px"><button class="btn danger" data-a="resetAll">Factory reset (wipe everything)</button></div>';
  html += '</div></div>';

  html += '<div class="card"><h2 style="margin-top:0">How the AI works</h2>';
  html += '<ul class="hint" style="padding-left:18px">';
  html += '<li><b>Six signals</b>: learned driver rating, recent form (EMA), single-lap quali speed, the real starting grid (this round\'s qualifying + back-of-grid starts), team strength (+ your dev packages), and track history.</li>';
  html += '<li><b>Feedback loop</b>: after every session you log, the AI scores its own prediction, then updates driver &amp; team ratings from head-to-head matchups (Elo-style) and re-weights the signals toward whatever predicted best.</li>';
  html += '<li><b>DNF vs DNS</b>: DNF drivers finish behind all classified finishers and still move the ratings; DNS drivers are excluded entirely â€” the AI ignores them for that session.</li>';
  html += '<li><b>Dev packages</b>: an upgrade lifts a team\'s predicted pace from its intro race, decaying over rounds. Your "helped / hurt / no change" verdicts recalibrate how hard it trusts your impact estimate.</li>';
  html += '<li><b>Everything</b> â€” quali, sprint quali, sprints, races, fastest laps, weather â€” feeds the model.</li>';
  html += '</ul></div>';

  el.innerHTML = html;
}

/* ---------- event handling ---------- */
function mutate(fn) {
  fn();
  saveSoon();
  renderAll();
}

function handleAction(a, node) {
  const x = node.dataset.x, v = node.dataset.v, i = node.dataset.i, s = node.dataset.s;

  switch (a) {
    case 'goPredict':
      ui.predRace = x || ui.predRace; ui.predSession = 'race'; showTab('predict'); break;
    case 'goResults': showTab('results'); break;
    case 'goDev': showTab('dev'); break;
    case 'goLearn': showTab('learn'); break;

    case 'setSession':
      if (node.closest('#tab-dashboard')) {
        ui.wkSession = s;
        ui.predSession = ui.resSession = s;
        ui.predRace = ui.resRace = ui.wkRace;
        initBuilder(ui.wkRace, ui.wkSession);
        renderAll();
      } else if (node.closest('#tab-predict')) ui.predSession = s;
      else { ui.resSession = s; renderAll(); }
      break;

    case 'useWkPred':
      ui.predRace = ui.resRace = ui.wkRace;
      ui.predSession = ui.resSession = ui.wkSession;
      initBuilder(ui.wkRace, ui.wkSession);
      showTab('results'); break;

    case 'compareHere':
      ui.predRace = ui.wkRace; ui.predSession = ui.wkSession;
      showTab('predict'); break;

    case 'editHere':
      initBuilder(ui.wkRace, ui.wkSession);
      ui.resRace = ui.wkRace; ui.resSession = ui.wkSession;
      renderAll(); break;

    case 'nextWeekend': {
      const nxt = RACES.slice(raceIndex(ui.wkRace) + 1).find(r => !hasSession(state, r.id, 'race'));
      ui.wkRace = (nxt || RACES[RACES.length - 1]).id;
      ui.wkSession = 'race';
      ui.predRace = ui.resRace = ui.wkRace;
      ui.predSession = ui.resSession = 'race';
      initBuilder(ui.wkRace, ui.wkSession);
      renderAll(); break;
    }

    case 'predictNext': {
      const idx = raceIndex(ui.predRace);
      ui.predRace = RACES[Math.min(RACES.length - 1, idx + 1)].id; renderAll(); break;
    }
    case 'predictPrev': {
      const idx = raceIndex(ui.predRace);
      ui.predRace = RACES[Math.max(0, idx - 1)].id; renderAll(); break;
    }
    case 'usePrediction':
      ui.resRace = ui.predRace; ui.resSession = ui.predSession; initBuilder(ui.predRace, ui.predSession); showTab('results'); break;

    case 'resNext': {
      const idx = raceIndex(ui.resRace);
      ui.resRace = RACES[Math.min(RACES.length - 1, idx + 1)].id; renderAll(); break;
    }
    case 'resPrev': {
      const idx = raceIndex(ui.resRace);
      ui.resRace = RACES[Math.max(0, idx - 1)].id; renderAll(); break;
    }

    case 'bAdd': {
      const b = ui.builder;
      if (b.order.length >= SESSIONS[b.session].max || b.order.includes(x) || b.dnf.includes(x) || b.dns.includes(x)) break;
      b.order.push(x); renderAll(); break;
    }
    case 'bRemove': {
      const b = ui.builder;
      const id = b.order.splice(parseInt(i, 10), 1)[0];
      const d = b.dnf.indexOf(id); if (d >= 0) b.dnf.splice(d, 1);
      renderAll(); break;
    }
    case 'bUp': case 'bDown': {
      const b = ui.builder;
      const idx = parseInt(i, 10), t = idx + (a === 'bUp' ? -1 : 1);
      if (t < 0 || t >= b.order.length) break;
      const tmp = b.order[idx]; b.order[idx] = b.order[t]; b.order[t] = tmp;
      renderAll(); break;
    }
    case 'bDnf': {
      const b = ui.builder;
      const di = b.dnf.indexOf(x);
      if (di >= 0) { b.dnf.splice(di, 1); b.order.push(x); }
      else if (b.order.includes(x)) { b.order.splice(b.order.indexOf(x), 1); b.dnf.push(x); }
      else if (b.dns.includes(x)) { b.dns.splice(b.dns.indexOf(x), 1); b.dnf.push(x); }
      renderAll(); break;
    }
    case 'bDns': {
      const b = ui.builder;
      const di = b.dns.indexOf(x);
      if (di >= 0) { b.dns.splice(di, 1); b.order.push(x); }
      else if (b.order.includes(x)) { b.order.splice(b.order.indexOf(x), 1); b.dns.push(x); }
      else if (b.dnf.includes(x)) { b.dnf.splice(b.dnf.indexOf(x), 1); b.dns.push(x); }
      renderAll(); break;
    }
    case 'bFromBack': {
      const b = ui.builder;
      if (!b.startedBack) b.startedBack = [];
      const i = b.startedBack.indexOf(x);
      if (i >= 0) b.startedBack.splice(i, 1); else b.startedBack.push(x);
      renderAll(); break;
    }
    case 'bMoveTo': break; /* handled on change to avoid double-processing */
    case 'bClear': {
      ui.builder.order = []; ui.builder.dnf = []; ui.builder.dns = []; if (ui.builder.startedBack) ui.builder.startedBack = [];
      renderAll(); break;
    }
    case 'bFillPred': {
      const b = ui.builder;
      const used = new Set(b.order.concat(b.dnf, b.dns));
      const pred = predictSession(state, b.raceId, b.session);
      pred.order.forEach(id => { if (!used.has(id) && b.order.length < SESSIONS[b.session].max) { b.order.push(id); used.add(id); } });
      renderAll(); break;
    }
    case 'bResetSession': {
      const w = state.weekends[ui.resRace];
      if (w) {
        delete w[ui.resSession]; if (w.dnf) delete w.dnf[ui.resSession]; if (w.dns) delete w.dns[ui.resSession];
        if (ui.resSession === 'race' && w.startedBack) delete w.startedBack;
      }
      initBuilder(ui.resRace, ui.resSession);
      mutate(() => {}); break;
    }
    case 'bFast': {
      ui.builder.fastLap = node.value || null; break;
    }
    case 'bWeather': {
      ui.builder.weather = node.value; break;
    }
    case 'bSave': {
      const b = ui.builder;
      if (b.order.length + b.dnf.length + b.dns.length !== GRID) {
        toast('Place all ' + GRID + ' drivers â€” finishers plus any DNFs / DNS â€” first.');
        break;
      }
      const map = {};
      b.order.forEach((id, pos) => { map[id] = pos + 1; });
      mutate(() => {
        const w = weekendOf(state, b.raceId);
        w[b.session] = map;
        if (!w.dnf) w.dnf = {};
        if (!w.dns) w.dns = {};
        w.dnf[b.session] = b.dnf.slice();
        w.dns[b.session] = b.dns.slice();
        if (b.session === 'race') {
          w.fastLap = b.fastLap || null;
          w.startedBack = { race: (b.startedBack || []).slice() };
        }
        w.weather = b.weather;
      });
      const fb = applyResult(state, b.raceId, b.session);
      saveNow(); renderAll();
      if (fb) {
        toast('<b>' + SESSIONS[b.session].label + ' saved.</b><br>' + esc(fb.message), true);
        if (b.session === 'race' && fb.winnerCorrect) toast('ðŸ† The AI predicted the winner!', true);
      }
      break;
    }

    case 'devTeam': ui.devTeam = node.value; break;
    case 'devRace': ui.devRace = node.value; break;
    case 'devImpact': ui.devImpact = parseInt(node.value, 10); break;
    case 'devGain': ui.devGain = node.value; break;
    case 'devNote': ui.devNote = node.value; break;
    case 'devFilter': ui.devFilter = x; renderAll(); break;
    case 'devAdd': {
      if (!ui.devNote.trim() && !ui.devGain.trim()) {
        toast('Add a short note so you remember the package.'); break;
      }
      mutate(() => {
        state.devPackages.push({
          id: 'p' + Date.now(),
          teamId: ui.devTeam, raceId: ui.devRace,
          impact: ui.devImpact,
          gain: ui.devGain.trim(),
          note: ui.devNote.trim(),
          verdict: null, removed: false,
          at: new Date().toISOString()
        });
        state.log.unshift({ raceId: ui.devRace, session: 'race', at: new Date().toISOString(), text: teamName(ui.devTeam) + ' introduced an upgrade at ' + raceById(ui.devRace).name + ' (impact ' + ui.devImpact + '/100). The AI now expects them to gain pace from here.' });
      });
      ui.devNote = ''; ui.devGain = ''; ui.devImpact = 60;
      toast('<b>' + esc(teamName(ui.devTeam)) + '</b> upgrade logged at <b>' + raceById(ui.devRace).flag + ' R' + raceById(ui.devRace).round + '</b>. The AI added it to their pace.', true);
      break;
    }
    case 'devVerdict': {
      mutate(() => {
        const p = state.devPackages.find(p => p.id === x);
        if (p) p.verdict = v;
      });
      toast('Verdict recorded â€” the AI recalibrated how much it trusts that impact estimate.');
      break;
    }
    case 'devRemove': {
      mutate(() => { const p = state.devPackages.find(p => p.id === x); if (p) p.removed = true; });
      break;
    }
    case 'devRestore': {
      mutate(() => { const p = state.devPackages.find(p => p.id === x); if (p) p.removed = false; });
      break;
    }

    case 'saveNow': saveNow(); toast('Saved.'); break;
    case 'backup': {
      const blob = new Blob([exportState(state)], { type: 'application/json' });
      downloadBlob(blob, 'f1-predictor-backup-' + new Date().toISOString().slice(0, 10) + '.json');
      toast('Backup downloaded.', true);
      break;
    }
    case 'exportJson': {
      const blob = new Blob([exportState(state)], { type: 'application/json' });
      downloadBlob(blob, 'f1-predictor-2026.json');
      toast('Export downloaded.', true);
      break;
    }
    case 'resetAll': {
      if (confirm('Wipe all results, ratings, packages and learning?')) {
        state = defaultState();
        mutate(() => {});
        toast('Factory reset done.');
      }
      break;
    }
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-a]');
  if (!btn) return;
  if (btn.disabled) return;
  handleAction(btn.dataset.a, btn);
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'predRaceSel') { ui.predRace = t.value; renderAll(); return; }
  if (t.id === 'resRaceSel') { ui.resRace = t.value; initBuilder(ui.resRace, ui.resSession); renderAll(); return; }
  if (t.id === 'devRaceSel') { ui.devRace = t.value; return; }
  if (t.dataset.a === 'predWeather') { mutate(() => { weekendOf(state, ui.predRace).weather = t.value; }); return; }
  if (t.dataset.a === 'bFast') { ui.builder.fastLap = t.value || null; return; }
  if (t.dataset.a === 'bWeather') { ui.builder.weather = t.value; return; }
  if (t.dataset.a === 'bMoveTo') {
    const b = ui.builder;
    const from = parseInt(t.dataset.i, 10);
    let to = parseInt(t.value, 10) - 1;
    if (from !== to && to >= 0 && to < b.order.length) {
      const id = b.order.splice(from, 1)[0];
      b.order.splice(to, 0, id);
    }
    renderAll();
    return;
  }
  if (t.dataset.a === 'devTeam') { ui.devTeam = t.value; return; }
  if (t.dataset.a === 'devGain') { ui.devGain = t.value; return; }
  if (t.dataset.a === 'devImpact') { ui.devImpact = parseInt(t.value, 10); renderDev(); return; }
  if (t.dataset.a === 'importJson' && t.files && t.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.driverLatent || !parsed.weekends) throw new Error('bad file');
        parsed.version = 4;
        state = parsed;
        saveNow();
        renderAll();
        toast('Data imported successfully.', true);
      } catch (err) {
        toast('Import failed â€” not a valid F1 Predictor file.');
      }
    };
    reader.readAsText(t.files[0]);
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.a === 'devNote') { ui.devNote = t.value; return; }
});

/* ---------- drag & drop reordering ---------- */
let dragId = null;
function clearDragOver() {
  document.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
}
document.addEventListener('dragstart', e => {
  const row = e.target.closest('.orderitem[data-drag]');
  if (!row) return;
  dragId = row.dataset.drag;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  setTimeout(() => row.classList.add('dragging'), 0);
});
document.addEventListener('dragover', e => {
  const row = e.target.closest('.orderitem[data-drag]');
  if (!row || !dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDragOver();
  row.classList.add('drag-over');
});
document.addEventListener('dragleave', e => {
  const row = e.target.closest('.orderitem[data-drag]');
  if (row) row.classList.remove('drag-over');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  const row = e.target.closest('.orderitem[data-drag]');
  if (!row || !dragId) { clearDragOver(); dragId = null; return; }
  const b = ui.builder;
  const from = b.order.indexOf(dragId);
  const to = parseInt(row.dataset.idx, 10);
  if (from >= 0 && to >= 0 && from !== to) {
    const id = b.order.splice(from, 1)[0];
    b.order.splice(from < to ? to - 1 : to, 0, id);
    renderAll();
  }
  clearDragOver();
  dragId = null;
});
document.addEventListener('dragend', () => {
  clearDragOver();
  dragId = null;
});

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  const nx = RACES.find(r => !hasSession(state, r.id, 'race'));
  ui.wkRace = (nx ? nx.id : RACES[RACES.length - 1].id);
  ui.predRace = ui.resRace = ui.wkRace;
  $$('#nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  renderAll();
  saveNow();
});
