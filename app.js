/* F1 Predictor 2026 — UI core: shell, dashboard, forecasts, results entry */
'use strict';

let state = loadState();
let ui = {
  tab: 'dashboard',
  wkRace: 'australia',
  wkSession: 'race',
  predRace: 'australia',
  predSession: 'race',
  resRace: 'australia',
  resSession: 'race',
  builder: null,
  devTeam: 'mclaren',
  devRace: 'australia',
  devImpact: 60,
  devGain: '',
  devNote: '',
  devFilter: 'all'
};
let saveTimer = null;

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function tcolor(teamId) { return TEAMS[teamId] ? TEAMS[teamId].color : '#999'; }
function teamName(teamId) { return TEAMS[teamId] ? TEAMS[teamId].name : teamId; }
function driverShort(id) { const d = driverById(id); return d ? d.short : id; }
function natCode(id) { const d = driverById(id); return d ? d.country.toUpperCase() : ''; }

/* ---------- save ---------- */
function saveNow() {
  if (typeof SeqAPI !== 'undefined' && state.seq && ui.wkRace) {
    try { SeqAPI.forecastNext(state, ui.wkRace); } catch (e) { /* seq layer optional */ }
  }
  if (saveState(state)) {
    $('#savedot').className = 'dot';
    $('#savetxt').textContent = 'Saved ' + (state.savedAt ? new Date(state.savedAt).toLocaleTimeString() : '');
  } else {
    $('#savedot').className = 'dot dirty';
    $('#savetxt').textContent = 'Storage full! Use export';
  }
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}

function toast(msg, good) {
  const t = document.createElement('div');
  t.className = 'toast' + (good ? ' good' : '');
  t.innerHTML = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 6000);
}

function showTab(name) {
  ui.tab = name;
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  renderAll();
  window.scrollTo(0, 0);
}

/* ---------- shared builders ---------- */
function raceOption(raceId) {
  const r = raceById(raceId);
  const done = hasSession(state, raceId, 'race');
  return (done ? '✓ ' : '') + r.flag + ' R' + r.round + ' · ' + r.name;
}
function raceSelectHtml(id) {
  const cur = id === 'predRaceSel' ? ui.predRace : id === 'resRaceSel' ? ui.resRace : id === 'devRaceSel' ? ui.devRace : (ui.wkRace || RACES[0].id);
  return '<select id="' + id + '">' + RACES.map(r =>
    '<option value="' + r.id + '"' + (r.id === cur ? ' selected' : '') + '>' + raceOption(r.id) + '</option>').join('') + '</select>';
}
function sessionFlow(raceId) {
  const r = raceById(raceId);
  return (r && r.sprint) ? ['sq', 'sprint', 'quali', 'race'] : ['quali', 'race'];
}
function sessionTabs(activeId, raceId) {
  const r = raceById(raceId);
  const sess = ['race', 'quali'].concat(r.sprint ? ['sprint', 'sq'] : []);
  return '<div class="tabs-mini">' + sess.map(s => {
    const done = hasSession(state, raceId, s);
    return '<button data-a="setSession" data-s="' + s + '" class="' + (activeId === s ? 'active' : '') + '">' +
      SESSIONS[s].label + (done ? ' <span style="color:var(--green)">✓</span>' : '') + '</button>';
  }).join('') + '</div>';
}
function sessionDoneBadges(raceId) {
  const order = sessionFlow(raceId);
  return '<div class="badges">' + order.map(s => {
    const on = hasSession(state, raceId, s);
    return '<span class="sessionbadge' + (on ? ' on' : '') + '">' + SESSIONS[s].short + (on ? ' ✓' : '') + '</span>';
  }).join('') + '</div>';
}
/* session pipeline for the hero — shows done / next / upcoming in order */
function sessionPipelineHTML(raceId) {
  const flow = sessionFlow(raceId);
  let next = null;
  if (typeof SeqAPI !== 'undefined' && state.seq) {
    try { next = SeqAPI.weekendState(state, raceId).nextSession; } catch (e) { /* ignore */ }
  }
  if (!next) next = flow.find(s => !hasSession(state, raceId, s)) || null;
  return '<div class="pipeline">' + flow.map(s => {
    const done = hasSession(state, raceId, s);
    const live = s === next;
    return '<span class="pipe' + (done ? ' done' : (live ? ' live' : '')) + '"><i class="pdot"></i>' +
      '<b>' + esc(SESSIONS[s].short) + '</b><em>' + (done ? '✓' : (live ? 'NEXT' : '')) + '</em></span>';
  }).join('<span class="pipe-arrow">→</span>') + '</div>';
}

function dateStr(d) {
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  catch (e) { return d; }
}

/* ---------- render isolation ---------- */
function renderAll() {
  const errors = [];
  [renderDashboard, renderPredict, renderResults, renderDev, renderLearn, renderData].forEach(fn => {
    try { fn(); } catch (e) { errors.push(fn.name + ': ' + (e && e.message ? e.message : e)); }
  });
  $$('section.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + ui.tab));
  if (errors.length) showRenderErrors(errors);
}
function showRenderErrors(errors) {
  const el = $('#tab-dashboard');
  if (!el) return;
  const box = document.createElement('div');
  box.style.cssText = 'margin:10px;padding:10px 14px;background:#3a1010;color:#ffb3b3;border:1px solid var(--red,#e74c3c);border-radius:8px;font-size:13px;line-height:1.5';
  box.innerHTML = '<b>Rendering problem (the rest of the page still works):</b><ul style="margin:6px 0 0 18px">' +
    errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul>';
  el.appendChild(box);
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('error', e => {
    try {
      const el = $('#tab-dashboard');
      if (!el) return;
      const box = document.createElement('div');
      box.style.cssText = 'margin:10px;padding:10px 14px;background:#3a1010;color:#ffb3b3;border:1px solid var(--red,#e74c3c);border-radius:8px;font-size:13px';
      box.innerHTML = '<b>Script error:</b> ' + esc(e.message || 'unknown error');
      el.appendChild(box);
    } catch (err) { /* never let the handler itself throw */ }
  });
}

/* ---------- identity components ---------- */
function faceHTML(id, size) {
  const d = driverById(id);
  const c = d ? tcolor(d.team) : '#999';
  return '<span class="face" style="--t:' + c + ';' + (size ? 'width:' + size + 'px;height:' + size + 'px' : '') + '">' +
    (d ? '<img src="' + esc(d.img) + '" alt="">' : '<b style="color:#999">?</b>') + '</span>';
}
function nameCodeHTML(id) {
  const d = driverById(id);
  return '<span class="drv-name">' + esc(d.name) + ' <b class="drv-code" style="color:' + tcolor(d.team) + '">' + esc(d.short) + '</b></span>';
}
function driverLineHTML(id) {
  return faceHTML(id) + nameCodeHTML(id);
}
function teamLogoHTML(teamId, h) {
  const t = TEAMS[teamId];
  if (!t) return '<span class="muted small">' + esc(teamId) + '</span>';
  return '<img class="teamlogo" style="height:' + (h || 18) + 'px" src="' + esc(t.logo) + '" alt="' + esc(t.name) + '">';
}

function standingsTableHTML(rows, opts) {
  opts = opts || {};
  let s = '<div class="chartwrap"><table class="tbl">';
  s += '<tr><th>Pos</th><th>Driver</th><th>Nat</th><th>Team</th><th class="num">Pts</th></tr>';
  rows.forEach((row, i) => {
    const id = row.driver.id;
    s += '<tr>';
    s += '<td class="num" style="font-weight:800;color:' + (i === 0 ? 'var(--gold)' : i === 1 ? '#cdd6e8' : i === 2 ? '#e09a5a' : 'var(--muted)') + '">' + (i + 1) + '</td>';
    s += '<td>' + faceHTML(id, 34) + nameCodeHTML(id) + '</td>';
    s += '<td class="nat">' + esc(natCode(id)) + '</td>';
    s += '<td class="teamcell">' + teamLogoHTML(driverById(id).team) + '<span class="muted small">' + esc(teamName(driverById(id).team)) + '</span></td>';
    s += '<td class="num" style="font-weight:800;font-size:15px">' + row.pts + '</td>';
    s += '</tr>';
  });
  s += '</table></div>';
  return s;
}

function statMini(num, lbl, cls) {
  return '<div class="tile"><b class="' + (cls || '') + '">' + num + '</b><span>' + lbl + '</span></div>';
}
function faceRowHTML(id, pos, rightExtra) {
  const d = driverById(id);
  return '<div class="oitem"><div class="pos">P' + pos + '</div>' + faceHTML(id) +
    '<span class="drv-name">' + esc(d.short) + '</span>' +
    '<span class="muted small" style="flex:1">' + esc(teamName(d.team)) + '</span>' + (rightExtra || '') + '</div>';
}

/* ---------- dashboard ---------- */
function renderDashboard() {
  const el = $('#tab-dashboard');
  const racesDone = RACES.filter(r => hasSession(state, r.id, 'race')).length;
  const pct = Math.round(racesDone / RACES.length * 100);

  if (!raceById(ui.wkRace)) ui.wkRace = RACES[0].id;
  if (!SESSIONS[ui.wkSession]) ui.wkSession = 'race';
  const race = raceById(ui.wkRace);
  const saved = !!(state.weekends[ui.wkRace] && state.weekends[ui.wkRace][ui.wkSession]);

  const raceMAE = state.accuracy.filter(a => a.session === 'race' && a.mae != null).map(a => a.mae);
  const avgMae = raceMAE.length ? (raceMAE.reduce((x, y) => x + y, 0) / raceMAE.length).toFixed(1) : '–';
  const raceRecs = state.accuracy.filter(a => a.session === 'race');
  const winsRight = raceRecs.filter(a => a.winnerCorrect).length;

  let html = '';

  /* ---- hero ---- */
  html += '<div class="hero">';
  html += '<div class="hero-top">';
  html += '<div>';
  html += '<div class="hero-round">ROUND ' + race.round + ' <span>of ' + RACES.length + '</span></div>';
  html += '<div class="hero-name"><span class="mh-flag">' + race.flag + '</span> ' + esc(race.name) + '</div>';
  html += '<div class="hero-meta">' + esc(race.track) + ' · ' + dateStr(race.date) + ' · ' + (race.sprint ? 'Sprint weekend' : 'Grand Prix weekend') + '</div>';
  html += '<div class="hero-progress"><div class="progbar"><div style="width:' + pct + '%"></div></div><span class="progtxt">' + racesDone + ' / ' + RACES.length + ' races logged</span></div>';
  html += '</div>';
  html += '<div class="hero-stats">';
  html += statMini(winsRight + '/' + raceRecs.length, 'Winners called', raceRecs.length ? 'good' : '');
  html += statMini(avgMae, 'Avg position error');
  html += statMini((raceRecs.length ? Math.round(raceRecs.reduce((s, a) => s + a.tau, 0) / raceRecs.length * 100) : '–') + '%', 'Rank match');
  html += '</div>';
  html += '</div>';
  html += sessionPipelineHTML(ui.wkRace);
  html += '</div>';

  /* ---- sequential engine strip ---- */
  if (typeof SeqAPI !== 'undefined' && state.seq) {
    try {
      const ws = SeqAPI.weekendState(state, ui.wkRace);
      const locked = ws.nextSession ? SeqAPI.prediction(state, ui.wkRace, ws.nextSession) : null;
      const evCount = Array.isArray(state.seq.evidence) ? state.seq.evidence.length : 0;
      const cal = SeqAPI.calibration(state).overall || {};
      html += '<div class="seqstrip"><span class="seqlogo">AI</span>';
      html += '<span class="pill live">' + esc(ws.phase) + '</span>';
      html += '<span class="pill ' + (ws.nextSession ? 'todo' : 'done') + '">next: ' + esc(ws.nextSession ? SESSIONS[ws.nextSession].label : 'done') + '</span>';
      html += '<span class="pill ' + (ws.awaitingResults ? 'live' : 'todo') + '">' + (ws.awaitingResults ? 'awaiting results' : 'forecast open') + '</span>';
      html += '<span class="pill ' + (locked ? 'done' : 'todo') + '">' + (locked ? 'locked ✓' : 'unlocked') + '</span>';
      html += '<span class="pill todo">evidence ' + evCount + '</span>';
      if (cal.n) html += '<span class="pill todo">cal MAE ' + (cal.mae != null ? cal.mae.toFixed(2) : '–') + ' · Brier ' + (cal.brier != null ? cal.brier.toFixed(3) : '–') + '</span>';
      html += '</div>';
    } catch (e) {
      console.error('seq strip:', e);
    }
  }

  /* ---- flow: 1 · AI FORECAST   |   2 · REALITY ---- */
  html += '<div class="flow">';

  /* step 1 — the AI forecasts */
  const pred = predictSession(state, ui.wkRace, ui.wkSession);
  html += '<div class="card flow-card flow-a">';
  html += '<div class="fc-head"><span class="flow-num">1</span><span class="flow-title">AI forecast<small>what the model expects for ' + SESSIONS[ui.wkSession].label + '</small></span>' +
    '<span class="pill live" style="margin-left:auto">confidence ' + pred.confidence + '%</span></div>';
  html += '<div class="fc-body">';
  html += sessionTabs(ui.wkSession, ui.wkRace);
  html += '<div class="wk-list" style="margin-top:8px">';
  pred.order.forEach((id, i) => {
    const d = driverById(id);
    html += '<div class="wk-row' + (i < 3 ? ' top3' : '') + '"><div class="pos p' + (i + 1) + '">P' + (i + 1) + '</div>' + faceHTML(id, 34) +
      '<span class="drv-name">' + esc(d.short) + '</span>' +
      '<span class="teamlab">' + esc(teamName(d.team)) + '</span>' +
      (ui.wkSession === 'race' ? '<span class="prob">' + (pred.probs[id] || 0).toFixed(1) + '%</span>' : '') + '</div>';
  });
  html += '</div>';
  const topP = pred.order[0];
  const topD = driverById(topP);
  const wl = state.model.w;
  html += '<div class="why"><b style="color:var(--text)">' + esc(topD.name) + '</b> tops the forecast — P' + Math.round(pred.signals.rating[topP]) +
    ' on driver rating (weight ' + Math.round(wl.rating * 100) + '%), form ' + Math.round(wl.form * 100) + '%, quali ' + Math.round(wl.quali * 100) + '%, grid ' + Math.round(wl.grid * 100) + '%, team ' + Math.round(wl.team * 100) + '%, track ' + Math.round(wl.track * 100) + '%.</div>';
  html += '<div class="row" style="margin-top:12px"><button class="btn small primary" data-a="useWkPred">Use as starting order →</button>';
  html += '<button class="btn small" data-a="goPredict" data-x="' + ui.wkRace + '">Full forecast</button></div>';
  html += '</div>';
  html += '</div>';

  /* step 2 — enter the real result */
  html += '<div class="card flow-card flow-b">';
  if (!saved) {
    if (!ui.builder || ui.builder.raceId !== ui.wkRace || ui.builder.session !== ui.wkSession) initBuilder(ui.wkRace, ui.wkSession);
    const b = ui.builder;
    html += '<div class="fc-head"><span class="flow-num">2</span><span class="flow-title">Real result<small>log what actually happened — the AI then learns from it</small></span>' +
      '<span class="pill todo" style="margin-left:auto">not logged yet</span></div>';
    html += '<div class="fc-body">';
    html += orderListHTML(b);
    html += addPanelHTML(b);
    html += saveRowHTML(b);
    html += '</div>';
  } else {
    const w = state.weekends[ui.wkRace];
    const actualOrder = Object.keys(w[ui.wkSession]).sort((a, b) => w[ui.wkSession][a] - w[ui.wkSession][b]);
    const stored = (state.predictions[ui.wkRace] && state.predictions[ui.wkRace][ui.wkSession]) || null;
    const acc = state.accuracy.find(a => a.raceId === ui.wkRace && a.session === ui.wkSession);
    const logEntry = state.log.find(l => l.raceId === ui.wkRace && l.session === ui.wkSession);
    let exact = 0;
    if (stored) stored.forEach((id, i) => { if (actualOrder[i] === id) exact++; });
    const winnerCalled = !!(stored && stored[0] === actualOrder[0]);

    html += '<div class="fc-head"><span class="flow-num">2</span><span class="flow-title">Real result<small>' + SESSIONS[ui.wkSession].label + ' logged — the AI has learned</small></span>' +
      '<span class="pill done" style="margin-left:auto">learned ✓</span></div>';
    html += '<div class="fc-body">';
    html += '<div class="learned-msg">' + (logEntry ? esc(logEntry.text) : SESSIONS[ui.wkSession].label + ' result saved.') + '</div>';
    html += '<div class="learned-grid">';
    html += statMini(winnerCalled ? '✓' : '✗', 'Winner called', winnerCalled ? 'good' : 'bad');
    html += statMini(exact + '/' + (stored ? stored.length : '–'), 'Exact positions');
    html += statMini(acc && acc.mae != null ? acc.mae.toFixed(1) : '–', 'Mean error');
    html += '</div>';
    html += '<div class="micro" style="margin:4px 0 6px">What actually happened</div>';
    html += '<div class="wk-list">';
    actualOrder.forEach((id, i) => {
      const hit = !!(stored && stored[i] === id);
      html += '<div class="wk-row' + (i < 3 ? ' top3' : '') + '"><div class="pos p' + (i + 1) + '">P' + (i + 1) + '</div>' + faceHTML(id, 34) +
        '<span class="drv-name">' + esc(driverShort(id)) + '</span>' +
        '<span class="teamlab">' + esc(teamName(driverById(id).team)) + '</span>' +
        (hit ? '<span class="pill ok" style="margin-left:auto">✓</span>' : (stored ? '<span class="pill bad" style="margin-left:auto">' + esc(driverShort(stored[i])) + ' was P' + (i + 1) + ' call</span>' : '')) + '</div>';
    });
    html += '</div>';
    html += '<div class="row" style="margin-top:12px">';
    html += '<button class="btn small primary" data-a="compareHere">Full comparison</button>';
    html += '<button class="btn small" data-a="editHere">Edit result</button>';
    if (ui.wkSession === 'race') html += '<button class="btn small" data-a="nextWeekend">Next weekend →</button>';
    html += '</div>';
    html += '</div>';
  }
  html += '</div>';

  html += '</div>'; /* flow */

  /* week footer */
  html += '<div class="card"><div class="spread"><span class="micro">Weekend log</span>' +
    sessionDoneBadges(ui.wkRace) +
    '<button class="btn small" data-a="goResults">Open results entry →</button></div></div>';

  /* AI vs reality: winner-call strip */
  const logged = RACES.filter(r => hasSession(state, r.id, 'race'));
  if (logged.length) {
    html += '<div class="card"><div class="spread"><span class="micro">AI vs reality</span>' +
      '<span class="hint">did the AI call each winner?</span></div>';
    html += '<div class="winstrip" style="margin-top:10px">';
    RACES.forEach(r => {
      const done = hasSession(state, r.id, 'race');
      const rec = state.accuracy.find(a => a.raceId === r.id && a.session === 'race');
      let cls = 'wcell no', lab = '–';
      if (done && rec) {
        cls = rec.winnerCorrect ? 'wcell yes' : 'wcell no';
        const w = state.weekends[r.id];
        const winner = Object.keys(w.race).sort((a, b) => w.race[a] - w.race[b])[0];
        const pWin = (state.predictions[r.id] && state.predictions[r.id].race) ? state.predictions[r.id].race[0] : null;
        lab = (rec.winnerCorrect ? '✓ ' : '✗ ') + r.round + ' · ' + driverShort(winner) + (pWin && !rec.winnerCorrect ? ' (AI: ' + driverShort(pWin) + ')' : '');
      }
      html += '<span class="' + cls + '" title="R' + r.round + ' ' + esc(r.name) + ': ' + esc(lab) + '">' + (done ? (rec && rec.winnerCorrect ? '✓' : '✗') : '–') + '</span>';
    });
    html += '</div></div>';
  }

  /* championship */
  const st = computeStandings(state);
  const hasRacing = st.wdc.some(x => x.pts > 0);

  html += '<div class="grid2">';
  html += '<div class="card"><div class="card-hd"><span class="micro gold">Drivers’ championship</span></div>';
  if (!hasRacing) html += '<div class="hint">No results logged yet — the AI is waiting. Enter the real order in the card above and it starts learning.</div>';
  else html += standingsTableHTML(st.wdc.slice(0, 10));
  html += '</div>';

  html += '<div class="card"><div class="card-hd"><span class="micro blue">Constructors’ championship</span></div>';
  if (!hasRacing) html += '<div class="hint">Constructor points appear here as you log results.</div>';
  else {
    html += '<div class="chartwrap"><table class="tbl">';
    html += '<tr><th>Pos</th><th>Team</th><th class="num">Pts</th></tr>';
    st.wcc.forEach((row, i) => {
      html += '<tr><td class="num" style="font-weight:800;color:' + (i === 0 ? 'var(--gold)' : i === 1 ? '#cdd6e8' : i === 2 ? '#e09a5a' : 'var(--muted)') + '">' + (i + 1) + '</td>' +
        '<td class="teamcell">' + teamLogoHTML(row.team.id, 22) + '<b style="color:' + row.team.color + '">' + esc(row.team.name) + '</b></td>' +
        '<td class="num" style="font-weight:800;font-size:15px">' + row.pts + '</td></tr>';
    });
    html += '</table></div>';
  }
  html += '</div></div>';

  el.innerHTML = html;
}

/* ---------- predictions ---------- */
function comparePanelHTML(raceId, session) {
  const w = state.weekends[raceId];
  const stored = state.predictions[raceId] && state.predictions[raceId][session];
  if (!w || !w[session] || !stored) return '';
  const actualOrder = Object.keys(w[session]).sort((a, b) => w[session][a] - w[session][b]);
  const predMap = {};
  stored.forEach((id, i) => { predMap[id] = i + 1; });
  const n = stored.length;
  let exact = 0, off = [];
  actualOrder.forEach((id, i) => {
    if (predMap[id] === i + 1) exact++;
    else if (predMap[id] != null) off.push({ id, actual: i + 1, pred: predMap[id] });
  });
  const wWinner = stored[0] === actualOrder[0];

  let s = '<div class="card"><div class="card-hd"><span class="micro">AI’s forecast vs actual ' + SESSIONS[session].label + '</span></div>';
  s += '<div class="learned-grid" style="margin-bottom:12px">';
  s += statMini(exact + '/' + n, 'Exact positions');
  s += statMini(wWinner ? '✓' : '✗', 'Winner called' + (wWinner ? '' : ' (' + driverShort(stored[0]) + ')'), wWinner ? 'good' : 'bad');
  const acc = state.accuracy.find(a => a.raceId === raceId && a.session === session);
  s += statMini(acc && acc.mae != null ? acc.mae.toFixed(1) : '–', 'Mean error');
  s += '</div>';

  s += '<div class="cmpgrid">';
  s += '<div class="cmphalf"><div class="cmphd">AI predicted</div>';
  stored.forEach((id, i) => {
    const ap = w[session][id];
    const hit = ap != null && ap === i + 1;
    const tag = hit ? '<span class="cmp-tag ok">✓</span>' : (ap != null ? '<span class="cmp-tag">→ P' + ap + '</span>' : '<span class="cmp-tag">–</span>');
    s += '<div class="cmp-row' + (hit ? ' hit' : ' miss') + '"><span class="cmpno">P' + (i + 1) + '</span>' + faceHTML(id, 30) +
      '<span class="drv-code" style="color:' + (driverById(id) ? tcolor(driverById(id).team) : '#999') + '">' + esc(driverShort(id)) + '</span>' + tag + '</div>';
  });
  s += '</div>';
  s += '<div class="cmphalf"><div class="cmphd">Actual result</div>';
  actualOrder.forEach((id, i) => {
    const hit = predMap[id] === i + 1;
    s += '<div class="cmp-row' + (hit ? ' hit' : '') + '"><span class="cmpno">P' + (i + 1) + '</span>' + faceHTML(id, 30) +
      '<span class="drv-code" style="color:' + (driverById(id) ? tcolor(driverById(id).team) : '#999') + '">' + esc(driverShort(id)) + '</span>' +
      (hit ? '<span class="cmp-tag ok">✓</span>' : (predMap[id] != null ? '<span class="cmp-tag">was P' + predMap[id] + '</span>' : '<span class="cmp-tag">–</span>')) + '</div>';
  });
  s += '</div></div>';
  s += '<div class="hint" style="margin-top:10px">Green rows are positions the AI called exactly. The forecast here was frozen before you entered this result — this is your honest scorecard.</div>';
  s += '</div>';
  return s;
}

function renderPredict() {
  const el = $('#tab-predict');
  const race = raceById(ui.predRace);
  let html = '<h1>Forecasts</h1><p class="page-sub">The AI’s best guess from ratings, form, quali speed, team upgrades and track history. Predict first, then enter the real results — the comparison is saved.</p>';

  html += '<div class="card"><div class="spread">' + raceSelectHtml('predRaceSel');
  html += '<div class="row"><button class="btn small" data-a="predictPrev">← Prev</button><button class="btn small" data-a="predictNext">Next →</button></div></div>';
  html += sessionTabs(ui.predSession, ui.predRace) + '</div>';

  html += '<div class="card"><div class="card-hd"><span class="micro">' + race.flag + ' ' + esc(race.name) + ' · ' + SESSIONS[ui.predSession].label + ' prediction</span></div>';

  if (ui.predSession === 'race') {
    html += '<div class="row" style="margin:2px 0 12px"><label class="fld" style="margin:0">Weather: </label>' +
      '<select data-a="predWeather">' + WEATHER.map(w => '<option value="' + w.id + '"' + (weatherOf(state, ui.predRace) === w.id ? ' selected' : '') + '>' + w.label + '</option>').join('') + '</select>';
    html += '<span class="hint">Wet & chaos weather increases unpredictability.</span></div>';
  }

  const pred = predictSession(state, ui.predRace, ui.predSession);
  html += '<div class="spread"><div><span class="pill live" style="margin-right:8px">Confidence ' + pred.confidence + '%</span>';
  html += activePackages(state, ui.predRace).map(p => '<span class="pill active" style="margin-right:6px">' + teamLogoHTML(p.teamId, 14) + ' upgrade</span>').join('');
  html += '</div><button class="btn small" data-a="usePrediction">Use as start point for Results</button></div>';

  html += '<div class="predgrid" style="margin-top:10px">';
  const showGap = ui.predSession === 'race';
  const showWin = ui.predSession === 'race';
  pred.order.forEach((id, i) => {
    const d = driverById(id);
    html += '<div class="oitem"><div class="pos">P' + (i + 1) + '</div>' + faceHTML(id);
    html += '<span class="drv-name">' + esc(d.name) + ' <b class="drv-code" style="color:' + tcolor(d.team) + '">' + esc(d.short) + '</b></span>';
    html += '<span class="muted small" style="flex:1">' + esc(teamName(d.team)) + '</span>';
    if (showGap) {
      const g = pred.gaps[id];
      html += '<span class="gap">' + (g > 0 ? '+' + g.toFixed(2) + 's' : 'LEAD') + '</span>';
    }
    if (showWin) {
      html += '<div class="bar winbar"><div style="width:' + Math.min(100, (pred.probs[id] || 0) * 2.2) + '%;background:' + (i === 0 ? 'var(--gold)' : tcolor(d.team)) + '"></div></div>';
      html += '<span class="gap" style="width:44px;text-align:right">' + (pred.probs[id] || 0).toFixed(1) + '%</span>';
    }
    html += '</div>';
  });
  html += '</div></div>';

  const top = pred.order[0];
  const dTop = driverById(top);
  html += '<div class="card"><div class="card-hd"><span class="micro">Why the AI picked ' + esc(dTop.name) + '</span></div>';
  html += '<div class="hint" style="margin-bottom:8px">Contribution of each learned signal (lower position = better):</div>';
  [['rating', 'Learned driver rating'], ['form', 'Recent race form'], ['quali', 'Single-lap quali speed'], ['grid', 'This round’s starting grid'], ['team', 'Team strength + upgrades'], ['track', 'Track history']].forEach(pair => {
    html += '<div class="wbar"><span class="lbl">' + pair[1] + '</span><div class="track"><div style="width:100%;background:' + tcolor(dTop.team) + '"></div></div><span class="val">P' + Math.round(pred.signals[pair[0]][top]) + '</span></div>';
  });
  html += '<div class="hint" style="margin-top:8px">Model weights — how much the AI currently trusts each signal: ' +
    [['rating', 'rating'], ['form', 'form'], ['quali', 'quali'], ['grid', 'grid'], ['team', 'team'], ['track', 'track']].map(p => p[0] + ' ' + Math.round(state.model.w[p[1]] * 100) + '%').join(' · ') + '.</div>';
  html += '</div>';

  html += comparePanelHTML(ui.predRace, ui.predSession);

  el.innerHTML = html;
}

/* ---------- results entry ---------- */
function initBuilder(raceId, session) {
  const w = state.weekends[raceId];
  const existing = (w && w[session]) ? w[session] : null;
  const dnf = (w && w.dnf && w.dnf[session]) ? w.dnf[session] : [];
  const dns = (w && w.dns && w.dns[session]) ? w.dns[session] : [];
  const startedBack = (w && w.startedBack && w.startedBack.race) ? w.startedBack.race.slice() : [];
  const order = [];
  const inOrder = {};
  if (existing) {
    Object.keys(existing).sort((a, b) => existing[a] - existing[b]).forEach(id => { order.push(id); inOrder[id] = 1; });
  }
  dnf.forEach(id => { inOrder[id] = 1; });
  dns.forEach(id => { inOrder[id] = 1; });
  ui.builder = { raceId, session, order, dnf, dns, startedBack, fastLap: (w && w.fastLap) || null, weather: weatherOf(state, raceId) };
  if (!existing) {
    const pred = predictSession(state, raceId, session);
    pred.order.forEach(id => {
      if (!inOrder[id] && order.length < SESSIONS[session].max) { order.push(id); inOrder[id] = 1; }
    });
  }
}

function orderListHTML(b) {
  const allowStatus = b.session === 'race' || b.session === 'sprint';
  let s = '<div class="hint" style="margin-bottom:8px">Drag a row or use the position dropdown. ☰ = grab handle.</div>';
  if (b.order.length === 0) s += '<div class="hint" style="margin-bottom:8px">Start from the AI forecast (button below), or add drivers from the panel.</div>';
  s += '<div class="orderlist">';
  b.order.forEach((id, i) => {
    s += '<div class="oitem' + (i < 3 ? ' top3' : '') + '" data-drag="' + id + '" data-idx="' + i + '" draggable="true">';
    s += '<span class="grip">☰</span><div class="pos">P' + (i + 1) + '</div>' + faceHTML(id, 36);
    s += '<span class="drv-name" style="flex:1">' + esc(driverShort(id)) + ((b.startedBack || []).includes(id) ? ' <span class="backpill" title="Started from the back — didn’t take part in qualifying">back</span>' : '') + '</span>';
    s += '<select class="possel" data-a="bMoveTo" data-i="' + i + '" title="Set position">' +
      Array.from({ length: GRID }, (_, k) => '<option value="' + (k + 1) + '"' + (k === i ? ' selected' : '') + '>' + (k + 1) + '</option>').join('') + '</select>';
    s += '<button class="btn mini ghost" data-a="bUp" data-i="' + i + '" title="Move up">↑</button>';
    s += '<button class="btn mini ghost" data-a="bDown" data-i="' + i + '" title="Move down">↓</button>';
    if (allowStatus) {
      s += '<button class="btn mini dnft" data-a="bDnf" data-x="' + id + '" title="Mark as DNF">DNF</button>';
      s += '<button class="btn mini dnst" data-a="bDns" data-x="' + id + '" title="Mark as DNS">DNS</button>';
    }
    s += '<button class="btn mini danger" data-a="bRemove" data-i="' + i + '" title="Remove">✕</button>';
    s += '</div>';
  });
  s += '</div><div class="row" style="margin-top:10px">';
  s += '<button class="btn small" data-a="bClear">Clear</button>';
  if (b.order.length < GRID) s += '<button class="btn small" data-a="bFillPred">Fill with AI forecast</button>';
  s += '</div>';
  return s;
}

/* add-drivers / DNF / DNS / started-from-the-back / fast lap / weather panel */
function addPanelHTML(b) {
  const allowStatus = b.session === 'race' || b.session === 'sprint';
  const unplaced = DRIVERS.filter(d => !b.order.includes(d.id) && !b.dnf.includes(d.id) && !b.dns.includes(d.id));
  let s = '<div class="spread"><span class="micro">Add drivers</span>' +
    '<span class="hint">' + b.order.length + ' finishers' + (b.dnf.length ? ' · ' + b.dnf.length + ' DNF' : '') + (b.dns.length ? ' · ' + b.dns.length + ' DNS' : '') + ' / ' + GRID + ' placed</span></div>';
  if (!unplaced.length) {
    s += '<div class="hint" style="margin-top:8px">Every driver is placed. ✓</div>';
  } else {
    s += '<div data-panel="add" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    unplaced.forEach(d => {
      s += '<button class="chip" data-a="bAdd" data-x="' + d.id + '">' + faceHTML(d.id, 28) + '<b>' + esc(d.short) + '</b> <span class="muted">' + esc(teamName(d.team)) + '</span></button>';
    });
    s += '</div>';
  }
  if (allowStatus) {
    s += '<span class="micro" style="display:block;margin-top:16px">DNF <span class="muted small">· retired, no points</span></span>';
    s += '<div data-panel="dnf" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    if (!b.dnf.length) s += '<span class="hint">None marked.</span>';
    b.dnf.forEach(id => {
      s += '<button class="chip" data-a="bDnf" data-x="' + id + '">' + faceHTML(id, 28) + '<b>' + esc(driverShort(id)) + '</b> <span class="muted">DNF ✕</span></button>';
    });
    s += '</div>';
    s += '<span class="micro" style="display:block;margin-top:16px">DNS <span class="muted small">· did not start, AI ignores for this session</span></span>';
    s += '<div data-panel="dns" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">';
    if (!b.dns.length) s += '<span class="hint">None marked.</span>';
    b.dns.forEach(id => {
      s += '<button class="chip" data-a="bDns" data-x="' + id + '">' + faceHTML(id, 28) + '<b>' + esc(driverShort(id)) + '</b> <span class="muted">DNS ⏻</span></button>';
    });
    s += '</div>';
  }
  /* started from the back belongs to QUALIFYING — the starting grid is set here */
  if (b.session === 'quali') {
    const sb = b.startedBack || [];
    s += '<span class="micro" style="display:block;margin-top:16px">Started from the back <span class="muted small">· didn’t take part in qualifying (pit lane / back of grid)</span></span>';
    s += '<div class="hint" style="margin:6px 0">The AI puts these drivers at the back of the starting grid for the Grand Prix.</div>';
    s += '<div data-panel="back" style="display:flex;flex-wrap:wrap;gap:6px">';
    if (!sb.length) s += '<span class="hint">None marked — everyone starts from their quali position.</span>';
    DRIVERS.forEach(d => {
      const on = sb.includes(d.id);
      s += '<button class="chip' + (on ? ' on' : '') + '" data-a="bFromBack" data-x="' + d.id + '" title="' + (on ? 'No longer starts from the back' : 'Started from the back — no quali') + '">' + faceHTML(d.id, 28) + '<b>' + esc(d.short) + '</b> <span class="muted">' + (on ? 'back ↑' : 'mark') + '</span></button>';
    });
    s += '</div>';
  }
  if (b.session === 'race') {
    s += '<div class="formrow" style="margin-top:14px"><label class="fld">Fastest lap (bonus point)</label>';
    s += '<select data-a="bFast"><option value="">— none —</option>' + DRIVERS.map(d => '<option value="' + d.id + '"' + (b.fastLap === d.id ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('') + '</select></div>';
  }
  if (b.session === 'race' || b.session === 'sprint') {
    s += '<div class="formrow"><label class="fld">Weather</label>';
    s += '<select data-a="bWeather">' + WEATHER.map(w => '<option value="' + w.id + '"' + (b.weather === w.id ? ' selected' : '') + '>' + w.label + '</option>').join('') + '</select></div>';
  }
  return s;
}

function saveRowHTML(b) {
  const placed = b.order.length + b.dnf.length + b.dns.length;
  const complete = placed === GRID;
  const remaining = GRID - placed;
  let s = '<div class="card spread savebar">';
  s += '<span class="hint">' + (complete ? 'All ' + GRID + ' drivers placed ✓' : (remaining > 0 ? remaining + ' driver' + (remaining === 1 ? '' : 's') + ' still to place' : 'Ready to save')) + '</span>';
  s += '<div class="row">';
  s += '<button class="btn danger" data-a="bResetSession">Reset session</button>';
  s += '<button class="btn primary" data-a="bSave"' + (complete ? '' : ' disabled') + '>Save &amp; teach the AI</button>';
  s += '</div></div>';
  return s;
}

function renderResults() {
  const el = $('#tab-results');
  const race = raceById(ui.resRace);
  let html = '<h1>Results entry</h1><p class="page-sub">Log each weekend: sprint quali, sprint, qualifying and the Grand Prix. Drag or use the dropdown to reorder, and flag any driver as DNF (retired) or DNS (never started).</p>';

  html += '<div class="card"><div class="spread">' + raceSelectHtml('resRaceSel');
  html += '<div class="row"><button class="btn small" data-a="resPrev">← Prev</button><button class="btn small" data-a="resNext">Next →</button></div></div>';
  html += '<div class="row" style="margin-top:10px"><span class="micro">Weekend log</span> ' + sessionDoneBadges(ui.resRace) + '</div>';
  html += sessionTabs(ui.resSession, ui.resRace);
  html += '</div>';

  if (!ui.builder || ui.builder.raceId !== ui.resRace || ui.builder.session !== ui.resSession) {
    initBuilder(ui.resRace, ui.resSession);
  }
  const b = ui.builder;

  html += '<div class="grid2">';
  html += '<div class="card"><div class="card-hd"><span class="micro red">Finishing order</span></div>' + orderListHTML(b) + '</div>';
  html += '<div class="card"><div class="card-hd"><span class="micro blue">Session details</span></div>' + addPanelHTML(b) + '</div>';
  html += '</div>';

  html += saveRowHTML(b);

  el.innerHTML = html;
}
