/* F1 Predictor 2026 - prediction engine + feedback loop (v4)
   - pairwise Bradley-Terry Elo learning (driver + team latent)
   - gradient-descent weight learning over 6 signals (incl. real starting grid)
   - EMA form tracking, DNF + DNS handling, stored predictions for compare */
'use strict';

/* ---------- default state ---------- */
function defaultState() {
  const d = {}, q = {}, s = {}, f = {}, qe = {}, se = {};
  DRIVERS.forEach(x => {
    d[x.id] = x.rating; q[x.id] = x.rating; s[x.id] = x.rating;
  });
  const t = {};
  Object.keys(TEAMS).forEach(k => { t[k] = TEAMS[k].base; });
  return {
    version: 4,
    createdAt: new Date().toISOString(),
    driverLatent: d,          // learned driver ability
    teamLatent: t,            // learned team/car ability
    qualiLatent: q,           // learned single-lap speed
    sprintLatent: s,          // learned sprint speed
    formEma: f,               // EMA of recent race finishing position
    qualiEma: qe,             // EMA of recent quali position
    sprintEma: se,            // EMA of recent sprint position
    devPackages: [],
    weekends: {},             // raceId -> { sq, sprint, quali, race, dnf, dns, fastLap, weather }
    predictions: {},          // raceId -> session -> predicted order (for compare)
    model: {
      w: { rating: 0.30, form: 0.25, quali: 0.20, team: 0.15, track: 0.10, grid: 0.08 },
      K: { driver: 30, team: 13, quali: 24, sprint: 26 },
      spread: 80,             // score units per 1 win-prob step
      wlr: 0.16,              // weight-learning rate
      signalErr: { rating: [], form: [], quali: [], team: [], track: [], grid: [] }
    },
    accuracy: [],
    ratingHistory: [],
    log: [],
    settings: { fastestLapPoint: true, km: 24 }
  };
}

/* ---------- scoring ---------- */
function scoreForPos(pos, maxPoints) {
  const table = maxPoints >= 20 ? RACE_POINTS : SPRINT_POINTS;
  if (pos <= table.length) return table[pos - 1];
  return Math.max(0.01, table[table.length - 1] * Math.pow(0.5, pos - table.length));
}
function pointsForPos(pos, maxPoints) {
  const table = maxPoints >= 20 ? RACE_POINTS : SPRINT_POINTS;
  if (pos >= 1 && pos <= table.length) return table[pos - 1];
  return 0;
}

/* ---------- state helpers ---------- */
function weekendOf(state, raceId) {
  if (!state.weekends[raceId]) state.weekends[raceId] = {};
  return state.weekends[raceId];
}
function hasSession(state, raceId, session) {
  const w = state.weekends[raceId];
  return !!(w && w[session] && Object.keys(w[session]).length >= 2);
}
function weatherOf(state, raceId) {
  const w = state.weekends[raceId];
  return (w && w.weather) ? w.weather : 'dry';
}
/* real starting grid for a race: that round's qualifying order, with drivers
   who didn't take part in qualifying (pit-lane / back-of-grid starts) at the back. */
function gridOf(state, raceId) {
  const w = state.weekends[raceId];
  const fromBack = new Set();
  ((w && w.dns && w.dns.quali) || []).forEach(id => fromBack.add(id));
  ((w && w.startedBack && w.startedBack.race) || []).forEach(id => fromBack.add(id));
  if (!w || (!hasSession(state, raceId, 'quali') && !fromBack.size)) return null;
  const grid = {};
  let next = 1;
  if (w.quali) {
    Object.keys(w.quali).sort((a, b) => w.quali[a] - w.quali[b]).forEach(id => {
      if (fromBack.has(id)) return;
      grid[id] = next++;
    });
  }
  fromBack.forEach(id => { if (grid[id] == null) grid[id] = next++; });
  return grid;
}
function driverById(id) { return DRIVERS.find(d => d.id === id); }
function teamOf(driverId) { return driverById(driverId).team; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/* ---------- dev packages ---------- */
function devBoostForTeam(state, teamId, raceIdx) {
  let boost = 0;
  state.devPackages.forEach(p => {
    if (p.teamId !== teamId || p.removed) return;
    const introIdx = raceIndex(p.raceId);
    if (introIdx < 0 || raceIdx < introIdx) return;
    const age = raceIdx - introIdx;
    let mult = 1;
    if (p.verdict === 'helped') mult = 1.35;
    else if (p.verdict === 'hurt') mult = 0.55;
    else if (p.verdict === 'neutral') mult = 0.85;
    const decay = Math.pow(0.85, age);
    boost += (p.impact / 100) * 1.8 * mult * decay;
  });
  return boost;
}
function activePackages(state, raceId) {
  const idx = raceIndex(raceId);
  return state.devPackages.filter(p => !p.removed && idx >= 0 && idx >= raceIndex(p.raceId));
}

/* ---------- signal building ---------- */
/* All signals are in "position" units (1..GRID), lower = better. */

function scoresToPositions(scores, soft) {
  /* scores: {id: score} -> {id: expectedPos}, softened toward midfield */
  const ids = Object.keys(scores);
  const N = ids.length;
  const sorted = ids.slice().sort((a, b) => scores[b] - scores[a]);
  const pos = {};
  let i = 0;
  while (i < N) {
    let j = i;
    while (j < N && scores[sorted[j]] === scores[sorted[i]]) j++;
    const rank = (i + j - 1) / 2 + 1;
    for (let k = i; k < j; k++) pos[sorted[k]] = rank;
    i = j;
  }
  const mid = (N + 1) / 2;
  ids.forEach(id => { pos[id] = pos[id] * (1 - soft) + mid * soft; });
  return pos;
}

function emaOf(state, key, id, fallback) {
  const v = state[key][id];
  return v != null ? v : fallback;
}

function buildSignals(state, raceId) {
  const race = raceById(raceId);
  const idx = raceIndex(raceId);
  const boostMap = {};
  Object.keys(TEAMS).forEach(t => { boostMap[t] = devBoostForTeam(state, t, idx); });
  const homeBonus = HOME_DRIVERS[raceId] || [];
  const homeOf = id => homeBonus.includes(id);

  const teamScores = {};
  Object.keys(TEAMS).forEach(t => {
    teamScores[t] = state.teamLatent[t] + boostMap[t] * 90;
  });
  const teamPos = scoresToPositions(teamScores, 0.12);

  const signals = {};
  const ratingScores = {};
  const qualiScores = {};
  const teamRaw = {};

  DRIVERS.forEach(d => {
    const boostScore = boostMap[d.team] * 90;
    const hs = homeOf(d.id) ? 45 : 0;

    /* 1 - learned driver + team ability */
    ratingScores[d.id] = state.driverLatent[d.id] + state.teamLatent[d.team] * 0.5 + boostScore * 0.5 + hs;

    /* 3 - single-lap speed */
    qualiScores[d.id] = state.qualiLatent[d.id] + state.teamLatent[d.team] * 0.5 + boostScore * 0.6 + hs;

    /* 4 - team pace (the car: identical for both drivers) */
    teamRaw[d.id] = teamPos[d.team];
  });

  signals.rating = scoresToPositions(ratingScores, 0.12);
  signals.quali = scoresToPositions(qualiScores, 0.12);

  /* 2 - recent race form (EMA) */
  signals.form = {};
  DRIVERS.forEach(d => {
    signals.form[d.id] = emaOf(state, 'formEma', d.id, signals.rating[d.id]);
  });

  /* 4 - team signal */
  signals.team = Object.assign({}, teamRaw);

  /* 5 - track affinity */
  signals.track = {};
  DRIVERS.forEach(d => {
    const tf = trackFormOfDriver(state, d.id, raceId);
    signals.track[d.id] = tf != null ? tf : signals.rating[d.id];
  });

  return signals;
}
function trackFormOfDriver(state, driverId, raceId) {
  const races = RACES.filter(r => r.id !== raceId);
  let num = 0, den = 0;
  races.forEach(r => {
    const w = state.weekends[r.id];
    if (!w || !w.race) return;
    const pos = w.race[driverId];
    if (pos == null) return;
    num += pos; den++;
  });
  return den ? num / den : null;
}

function blendPositions(state, signals, weatherEffect) {
  const w = state.model.w;
  const sigKeys = ['rating', 'form', 'quali', 'team', 'track', 'grid'];
  const raw = {};
  DRIVERS.forEach(d => {
    let v = 0, ws = 0;
    sigKeys.forEach(k => {
      const s = signals[k] != null ? signals[k][d.id] : null;
      if (s != null) { v += w[k] * s; ws += w[k]; }
    });
    v = ws ? v / ws : 0; /* weights act relative to the active signals */
    if (weatherEffect) v += ((typeof __seqRng === 'function' ? __seqRng() : Math.random()) - 0.5) * weatherEffect * 1.4;
    raw[d.id] = v;
  });
  return raw;
}

function orderFromRaw(raw) {
  return DRIVERS.map(d => d.id).sort((a, b) => raw[a] - raw[b]);
}

function predictedGaps(order) {
  const gaps = {};
  let prev = 0;
  order.forEach((id, i) => {
    if (i === 0) { gaps[id] = 0; prev = 0; return; }
    prev += 0.13 + (i - 1) * 0.028 + (typeof __seqRng === 'function' ? __seqRng() : Math.random()) * 0.06;
    gaps[id] = prev;
  });
  return gaps;
}

function winProbs(state, raw, order) {
  /* Bradley-Terry win prob: P(i wins) ∝ product over j of P(i beats j) */
  const n = order.length;
  const pseudo = {};
  order.forEach((id, i) => { pseudo[id] = -raw[id] * (state.model.spread / 55); });
  const tau = 95;
  const prod = {};
  let sum = 0;
  order.forEach((a, i) => {
    let p = 1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      p *= sigmoid((pseudo[a] - pseudo[order[j]]) / tau);
    }
    prod[a] = p; sum += p;
  });
  const probs = {};
  order.forEach(id => { probs[id] = Math.round((prod[id] / (sum || 1)) * 1000) / 10; });
  return probs;
}

function confidenceOf(state, raw, order) {
  const sigStd = [];
  order.forEach(id => {
    const a = state.driverLatent[id] - state.teamLatent[teamOf(id)];
    sigStd.push(Math.abs(a) / 400);
  });
  const avgStd = sigStd.reduce((x, y) => x + y, 0) / sigStd.length;
  const rec = recentAccuracy(state);
  const confA = clamp(0.5 + (1 - avgStd) * 0.35, 0.35, 0.9);
  const confB = clamp(1 - (rec.mae || 3.4) / 7, 0.35, 0.95);
  const haveRace = Object.keys(state.weekends).some(r => hasSession(state, r, 'race'));
  const conf = Math.round(clamp(confA * confB * (haveRace ? 1 : 0.75), 0.2, 0.95) * 100);
  return conf;
}

function recentAccuracy(state) {
  const races = state.accuracy.filter(a => a.session === 'race').slice(-3);
  const maes = races.map(a => a.mae).filter(v => v != null);
  return { mae: maes.length ? maes.reduce((a, b) => a + b, 0) / maes.length : null };
}

/* ---------- public prediction API ---------- */
/* The sequential engine (seqengine.js) reimplements predictSession as the
   adaptive, session-by-session forecaster. This wrapper keeps a legacy
   fallback so the UI never breaks even if that layer is not loaded. */
function predictSession(state, raceId, session) {
  if (typeof seqPredictSession === 'function') return seqPredictSession(state, raceId, session);
  return legacyPredictSession(state, raceId, session);
}

function legacyPredictSession(state, raceId, session) {
  const weather = weatherOf(state, raceId);
  const weatherEffect = WEATHER.find(w => w.id === weather).effect;
  const signals = buildSignals(state, raceId);
  /* grid factor: the real starting grid (that round's qualifying + back-of-grid
     starts) feeds the race prediction; null for other sessions */
  signals.grid = {};
  if (session === 'race') {
    const grid = gridOf(state, raceId);
    DRIVERS.forEach(d => { signals.grid[d.id] = grid && grid[d.id] != null ? grid[d.id] : signals.quali[d.id]; });
  } else {
    DRIVERS.forEach(d => { signals.grid[d.id] = null; });
  }
  const raw = blendPositions(state, signals, session === 'race' ? weatherEffect : 0);
  const order = orderFromRaw(raw);
  const gaps = session === 'race' ? predictedGaps(order) : {};
  const probs = session === 'race' ? winProbs(state, raw, order) : {};
  return {
    raceId, session, order, signals, raw,
    confidence: confidenceOf(state, raw, order),
    weather, weatherEffect, gaps, probs
  };
}

function predictAllSessions(state, raceId) {
  const race = raceById(raceId);
  const out = { race: null, quali: null, sprint: null, sq: null };
  out.race = predictSession(state, raceId, 'race');
  out.quali = predictSession(state, raceId, 'quali');
  if (race.sprint) {
    out.sprint = predictSession(state, raceId, 'sprint');
    out.sq = predictSession(state, raceId, 'sq');
  }
  return out;
}

/* ---------- accuracy ---------- */
function kendallTau(actual, predicted) {
  const ids = Object.keys(actual);
  const n = ids.length;
  if (n < 2) return 0;
  let concordant = 0, discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a1 = actual[ids[i]], a2 = actual[ids[j]];
      const p1 = predicted[ids[i]], p2 = predicted[ids[j]];
      if (a1 == null || a2 == null || p1 == null || p2 == null) continue;
      const sA = Math.sign(a1 - a2), sP = Math.sign(p1 - p2);
      if (sA === sP) concordant++; else if (sA !== 0 && sP !== 0) discordant++;
    }
  }
  return (concordant - discordant) / (concordant + discordant || 1);
}

function meanAbsError(actual, predicted) {
  const ids = Object.keys(actual);
  let sum = 0, n = 0;
  ids.forEach(id => {
    if (actual[id] != null && predicted[id] != null) { sum += Math.abs(actual[id] - predicted[id]); n++; }
  });
  return n ? sum / n : null;
}

/* ---------- feedback loop ---------- */

function learnTargets(state, session, results, dnf, dns) {
  /* full learning ranking: classified first, then DNFs, DNS excluded */
  const classified = Object.keys(results).sort((a, b) => results[a] - results[b]);
  const full = classified.concat(dnf.filter(id => !dns.includes(id)));
  const targets = {};
  full.forEach((id, i) => { targets[id] = i + 1; });
  return { targets, classified, dnf: full.slice(classified.length) };
}

function latentOf(state, session, id) {
  if (session === 'race') return state.driverLatent;
  if (session === 'quali' || session === 'sq') return state.qualiLatent;
  return state.sprintLatent;
}

function learnScore(state, session, id) {
  const L = latentOf(state, session, id);
  return L[id] + state.teamLatent[teamOf(id)];
}

function updateEma(state, session, id, pos) {
  const key = session === 'race' ? 'formEma' : (session === 'quali' || session === 'sq') ? 'qualiEma' : 'sprintEma';
  const alpha = 0.55;
  const prev = state[key][id];
  state[key][id] = prev == null ? pos : prev * alpha + (1 - alpha) * pos;
}

function updatePairwise(state, session, full, targets, rec) {
  /* pairwise Bradley-Terry updates on driver latent (teams updated separately) */
  const spread = state.model.spread;
  const Kd = state.model.K.driver * rec;

  for (let i = 0; i < full.length; i++) {
    for (let j = i + 1; j < full.length; j++) {
      const a = full[i], b = full[j];
      const p = sigmoid((learnScore(state, session, a) - learnScore(state, session, b)) / spread);
      const ga = (1 - p) * Kd;   /* a won -> gain */
      const gb = -p * Kd;        /* b lost */
      latentOf(state, session, a)[a] = clamp(latentOf(state, session, a)[a] + ga, 1400, 1800);
      latentOf(state, session, b)[b] = clamp(latentOf(state, session, b)[b] + gb, 1400, 1800);
    }
  }
}

function updateTeams(state, targets, rec) {
  /* team-vs-team Elo from each team's best classified car result.
     The car's pace is measured by its fastest car, so a teammate's bad
     finish or DNF no longer drags the whole team rating down. */
  const Kt = state.model.K.team * rec;
  const teamBest = {};
  Object.keys(TEAMS).forEach(t => {
    let best = null;
    DRIVERS.forEach(d => {
      const p = targets[d.id];
      if (d.team === t && p != null && (best == null || p < best)) best = p;
    });
    if (best != null) teamBest[t] = best;
  });
  const list = Object.keys(teamBest).sort((a, b) => teamBest[a] - teamBest[b]);
  if (list.length < 2) return;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const p = sigmoid((state.teamLatent[a] - state.teamLatent[b]) / state.model.spread);
      const ga = (1 - p) * Kt;
      const gb = -p * Kt;
      state.teamLatent[a] = clamp(state.teamLatent[a] + ga, 1450, 1750);
      state.teamLatent[b] = clamp(state.teamLatent[b] + gb, 1450, 1750);
    }
  }
}

function updateWeights(state, signals, targets) {
  /* gradient descent: minimize sum of (blend - actual)^2 w.r.t. weights */
  const w = state.model.w;
  const lr = state.model.wlr;
  const ids = Object.keys(targets);
  const n = ids.length;
  if (n < 2) return;
  const sigKeys = ['rating', 'form', 'quali', 'team', 'track', 'grid']
    .filter(k => signals[k] != null && ids.every(id => typeof signals[k][id] === 'number' && !isNaN(signals[k][id])));
  if (!sigKeys.length) return;

  const blend = blendPositions(state, signals, 0);
  const mean = {};
  const sd = {};
  sigKeys.forEach(sig => {
    let m = 0;
    ids.forEach(id => m += signals[sig][id]);
    m /= n;
    let v = 0;
    ids.forEach(id => v += Math.pow(signals[sig][id] - m, 2));
    sd[sig] = Math.sqrt(v / n) || 1;
    mean[sig] = m;
  });

  const grads = {};
  sigKeys.forEach(sig => {
    let g = 0;
    ids.forEach(id => {
      const err = blend[id] - targets[id];
      const z = (signals[sig][id] - mean[sig]) / sd[sig];
      g += err * z;
    });
    g /= n;
    grads[sig] = g;
    w[sig] = clamp(w[sig] - lr * g, 0.01, 0.9);
  });

  const MAXW = 0.42; /* keep the blend diversified so the model adapts to regime changes */
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  Object.keys(w).forEach(sig => { w[sig] = w[sig] / total; });
  let over = Object.values(w).filter(v => v > MAXW).reduce((a, b) => a + b, 0);
  let under = Object.values(w).filter(v => v <= MAXW).length || 1;
  if (over > 0) {
    Object.keys(w).forEach(sig => {
      w[sig] = w[sig] > MAXW ? MAXW : w[sig] + over / under;
    });
    const t2 = Object.values(w).reduce((a, b) => a + b, 0);
    Object.keys(w).forEach(sig => { w[sig] = w[sig] / t2; });
  }

  /* record per-signal standalone MAE for the learning page */
  const errs = {};
  sigKeys.forEach(sig => {
    const pred = {};
    ids.forEach(id => { pred[id] = signals[sig][id]; });
    const e = meanAbsError(targets, pred);
    errs[sig] = e != null ? e : 99;
    state.model.signalErr[sig].push(Number(errs[sig].toFixed(2)));
    if (state.model.signalErr[sig].length > 40) state.model.signalErr[sig].shift();
  });
  return errs;
}

function recencyFactor(state) {
  const racesDone = Object.keys(state.weekends).filter(r => hasSession(state, r, 'race')).length;
  if (racesDone <= 4) return 1.7;
  if (racesDone <= 12) return 1.25;
  return 0.95;
}

function applyResult(state, raceId, session) {
  const w = state.weekends[raceId];
  if (!w || !w[session]) return null;
  const results = w[session];
  const dnf = (w.dnf && w.dnf[session]) || [];
  const dns = (w.dns && w.dns[session]) || [];

  /* store the prediction made before learning, for later comparison */
  const pred = predictSession(state, raceId, session);
  if (!state.predictions[raceId]) state.predictions[raceId] = {};
  if (!state.predictions[raceId][session]) {
    state.predictions[raceId][session] = pred.order.slice();
  }

  const { targets, classified, dnf: dnfList } = learnTargets(state, session, results, dnf, dns);

  const rec = recencyFactor(state);
  updatePairwise(state, session, classified.concat(dnfList), targets, rec);
  updateTeams(state, targets, rec);

  /* EMA form tracking (classified + dnf; dns excluded) */
  classified.concat(dnfList).forEach(id => {
    updateEma(state, session, id, targets[id]);
  });

  /* weight learning */
  const errs = updateWeights(state, pred.signals, targets);

  /* rating snapshot for charts */
  if (session === 'race') {
    state.ratingHistory.push({ raceId, at: new Date().toISOString(), ratings: Object.assign({}, state.driverLatent) });
    if (state.ratingHistory.length > 60) state.ratingHistory.shift();
  }

  const actualMap = {};
  Object.keys(results).forEach(id => { actualMap[id] = results[id]; });
  const predMap = {};
  pred.order.forEach((id, i) => { predMap[id] = i + 1; });

  const mae = meanAbsError(actualMap, predMap);
  const tau = kendallTau(actualMap, predMap);
  const winner = Object.keys(actualMap).sort((a, b) => actualMap[a] - actualMap[b])[0];

  state.accuracy.push({
    raceId, session, date: new Date().toISOString(),
    mae: mae != null ? Math.round(mae * 100) / 100 : null,
    tau: Math.round(tau * 1000) / 1000,
    winnerCorrect: pred.order[0] === winner,
    dnf: dnf.length, dns: dns.length
  });

  const message = learnMessage(state, raceId, session, mae, tau, pred, actualMap, dnf.length, dns.length);
  state.log.unshift({ raceId, session, at: new Date().toISOString(), text: message });
  state.log = state.log.slice(0, 60);

  /* sequential engine: lock/evaluate/diagnose/update/calibrate/advance */
  let report = null;
  if (typeof seqAfterResult === 'function') {
    report = seqAfterResult(state, raceId, session, pred, {
      results: w[session], dnf: dnf || [], dns: dns || [],
      weather: weatherOf(state, raceId),
      fastLap: w.fastLap || null
    });
  }

  return { mae, tau, errs, message, winnerCorrect: pred.order[0] === winner, report };
}

function learnMessage(state, raceId, session, mae, tau, pred, actualMap, nDnf, nDns) {
  const race = raceById(raceId);
  const topActual = Object.keys(actualMap).sort((a, b) => actualMap[a] - actualMap[b])[0];
  const topPred = pred.order[0];
  const a = driverById(topActual), p = driverById(topPred);
  const parts = [];
  parts.push(`${race.flag} ${race.name} (${SESSIONS[session].label}): AI predicted ${p.short}, ${a.short} won.`);
  if (mae != null) parts.push(`mean error ${mae.toFixed(2)} positions,`);
  if (tau != null) parts.push(`rank match ${Math.round(tau * 100)}%.`);
  if (nDnf || nDns) parts.push(`(${nDnf} DNF, ${nDns} DNS)`);
  if (topActual === topPred) parts.push('Winner called correctly!');
  return parts.join(' ');
}

/* ---------- standings ---------- */
function computeStandings(state) {
  const pts = {};
  const teamPts = {};
  DRIVERS.forEach(d => { pts[d.id] = 0; });
  Object.keys(TEAMS).forEach(t => { teamPts[t] = 0; });

  RACES.forEach(r => {
    const w = state.weekends[r.id];
    if (!w) return;
    if (w.sprint) {
      Object.keys(w.sprint).forEach(id => { pts[id] += pointsForPos(w.sprint[id], 8); });
    }
    if (w.race) {
      Object.keys(w.race).forEach(id => { pts[id] += pointsForPos(w.race[id], 25); });
      if (w.fastLap && w.race[w.fastLap] != null && w.race[w.fastLap] <= 10 && state.settings.fastestLapPoint) {
        pts[w.fastLap] += 1;
      }
    }
  });

  DRIVERS.forEach(d => { teamPts[d.team] += pts[d.id]; });

  const wdc = DRIVERS.map(d => ({ driver: d, pts: pts[d.id] }))
    .sort((a, b) => b.pts - a.pts || state.driverLatent[b.driver.id] - state.driverLatent[a.driver.id]);
  const wcc = Object.keys(TEAMS).map(t => ({ team: TEAMS[t], pts: teamPts[t] }))
    .sort((a, b) => b.pts - a.pts);

  return { wdc, wcc };
}

/* ---------- persistence ---------- */
const STORAGE_KEY = 'f1predictor2026_v4';
function saveState(state) {
  state.savedAt = new Date().toISOString();
  try {
    if (typeof localStorage === 'undefined') return true; /* Node / test runner */
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) { return false; }
}
function loadState() {
  try {
    let s = null;
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) s = JSON.parse(raw);
    }
    if (!s) return ensureSeqState(defaultState());
    if (s.version !== 4) return ensureSeqState(defaultState());
    const d = defaultState();
    Object.keys(d).forEach(k => { if (s[k] === undefined) s[k] = d[k]; });
    Object.keys(d.model).forEach(k => { if (s.model[k] === undefined) s.model[k] = d.model[k]; });
    Object.keys(d.model.w).forEach(k => { if (s.model.w[k] === undefined) s.model.w[k] = d.model.w[k]; });
    Object.keys(d.model.signalErr).forEach(k => { if (s.model.signalErr[k] === undefined) s.model.signalErr[k] = d.model.signalErr[k]; });
    if (!s.predictions) s.predictions = {};
    return ensureSeqState(s);
  } catch (e) { return ensureSeqState(defaultState()); }
}
function exportState(state) {
  return JSON.stringify(state, null, 2);
}

/* Sequential-engine bootstrap hook. seqengine.js overrides this function so a
   fresh state gets its weekend machine, world model, evidence store and ledger.
   Overridden at runtime once that layer is loaded; harmless no-op otherwise. */
function ensureSeqState(state) { return state; }
