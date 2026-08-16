/* F1 Predictor 2026 - Sequential Predictive AI Engine (in-browser backend layer)
   =============================================================================
   Implements the adaptive, session-by-session forecasting architecture:

     CURRENT WEEKEND STATE -> PREDICT NEXT SESSION -> LOCK -> SESSION HAPPENS
       -> INGEST RESULTS -> COMPARE -> DIAGNOSE -> UPDATE WORLD MODEL
       -> RECALIBRATE -> PREDICT NEXT SESSION

   Design rules enforced here:
     - Predict only the next unknown session; never the whole weekend at once.
     - Published predictions are immutable (status LOCKED) with full audit trail.
     - Every observation becomes a reliability-weighted Evidence object.
     - Finishing position is never treated as identical to underlying pace.
     - A single anomalous result cannot destroy the world model.
     - Qualifying evidence updates quali variables; race evidence race variables.
     - No future information may leak into an older prediction (temporal integrity).
     - Every prediction is reproducible from its data/model snapshot (seeded RNG).

   The existing frontend contract (predictSession, applyResult, state shape,
   signals/raw/order/confidence/gaps/probs fields) is preserved.
   */
'use strict';

/* ============================================================================
   1. CONSTANTS & SCHEMAS
   ============================================================================ */
const SEQ_VERSION = 1;

/* session order for a weekend (the app has no FP sessions; practice evidence
   can still be injected manually through addObservation) */
const NORMAL_FLOW = ['quali', 'race'];
const SPRINT_FLOW = ['sq', 'sprint', 'quali', 'race'];
function flowFor(eventId) {
  const r = raceById(eventId);
  return (r && r.sprint) ? SPRINT_FLOW.slice() : NORMAL_FLOW.slice();
}
function sessionsBefore(eventId, session) {
  const f = flowFor(eventId);
  const i = f.indexOf(session);
  return i < 0 ? [] : f.slice(0, i);
}

/* explicit cross-session transfer strengths (session separation, spec §8/§9).
   When evidence for `feature` arrives, update the listed variables with the
   given strength. Driver evidence also nudges the team, and vice-versa. */
const EVIDENCE_TRANSFER = {
  qualiPace:   { driver: { qualiPace: 1.0 }, team: { qualiPace: 0.30 } },
  sprintPace:  { driver: { sprintPace: 1.0, racePace: 0.40 }, team: { racePace: 0.15 } },
  racePace:    { driver: { racePace: 1.0 }, team: { racePace: 0.30 } },
  form:        { driver: { racePace: 0.50 } },
  tyreDeg:     { driver: { tyreDeg: 1.0 }, team: { tyreDeg: 0.30 } },
  reliability: { driver: { reliability: 1.0 }, team: { reliability: 0.30 } },
  wetPerf:     { driver: { wetPerf: 1.0 }, team: { wetPerf: 0.20 } },
  driverExec:  { driver: { driverExec: 1.0, consistency: 0.50, mistakeRisk: 0.50 } },
  teamRacePace:  { team: { racePace: 1.0 } },
  teamQualiPace: { team: { qualiPace: 1.0 } }
};

/* reliability of a clean result by session type */
const SESSION_RELIABILITY = { quali: 0.90, sq: 0.85, sprint: 0.75, race: 0.80 };

/* static circuit characteristics (long-term historical memory) */
const CIRCUIT_CHAR = {
  australia:   { overtaking: 0.55, deg: 0.60, weatherRisk: 0.60, safetyCar: 0.75, trackEvolution: 0.65 },
  china:       { overtaking: 0.65, deg: 0.70, weatherRisk: 0.45, safetyCar: 0.40, trackEvolution: 0.70 },
  japan:       { overtaking: 0.60, deg: 0.75, weatherRisk: 0.55, safetyCar: 0.35, trackEvolution: 0.60 },
  bahrain:     { overtaking: 0.75, deg: 0.90, weatherRisk: 0.15, safetyCar: 0.40, trackEvolution: 0.85 },
  saudi:       { overtaking: 0.60, deg: 0.75, weatherRisk: 0.30, safetyCar: 0.80, trackEvolution: 0.70 },
  miami:       { overtaking: 0.60, deg: 0.65, weatherRisk: 0.55, safetyCar: 0.60, trackEvolution: 0.65 },
  canada:      { overtaking: 0.65, deg: 0.60, weatherRisk: 0.65, safetyCar: 0.75, trackEvolution: 0.75 },
  monaco:      { overtaking: 0.15, deg: 0.45, weatherRisk: 0.60, safetyCar: 0.85, trackEvolution: 0.50 },
  catalunya:   { overtaking: 0.70, deg: 0.85, weatherRisk: 0.30, safetyCar: 0.25, trackEvolution: 0.80 },
  austria:     { overtaking: 0.60, deg: 0.70, weatherRisk: 0.45, safetyCar: 0.30, trackEvolution: 0.75 },
  britain:     { overtaking: 0.70, deg: 0.80, weatherRisk: 0.60, safetyCar: 0.50, trackEvolution: 0.75 },
  belgium:     { overtaking: 0.70, deg: 0.70, weatherRisk: 0.75, safetyCar: 0.55, trackEvolution: 0.70 },
  hungary:     { overtaking: 0.40, deg: 0.70, weatherRisk: 0.35, safetyCar: 0.50, trackEvolution: 0.75 },
  netherlands: { overtaking: 0.55, deg: 0.80, weatherRisk: 0.55, safetyCar: 0.60, trackEvolution: 0.70 },
  monza:       { overtaking: 0.75, deg: 0.70, weatherRisk: 0.30, safetyCar: 0.35, trackEvolution: 0.55 },
  madrid:      { overtaking: 0.50, deg: 0.65, weatherRisk: 0.35, safetyCar: 0.55, trackEvolution: 0.65 },
  azerbaijan:  { overtaking: 0.45, deg: 0.60, weatherRisk: 0.35, safetyCar: 0.85, trackEvolution: 0.60 },
  singapore:   { overtaking: 0.35, deg: 0.75, weatherRisk: 0.55, safetyCar: 0.90, trackEvolution: 0.65 },
  austin:      { overtaking: 0.65, deg: 0.75, weatherRisk: 0.40, safetyCar: 0.45, trackEvolution: 0.75 },
  mexico:      { overtaking: 0.55, deg: 0.70, weatherRisk: 0.25, safetyCar: 0.40, trackEvolution: 0.70 },
  brazil:      { overtaking: 0.65, deg: 0.70, weatherRisk: 0.75, safetyCar: 0.55, trackEvolution: 0.75 },
  vegas:       { overtaking: 0.70, deg: 0.60, weatherRisk: 0.20, safetyCar: 0.40, trackEvolution: 0.60 },
  qatar:       { overtaking: 0.65, deg: 0.85, weatherRisk: 0.35, safetyCar: 0.40, trackEvolution: 0.80 },
  abudhabi:    { overtaking: 0.60, deg: 0.65, weatherRisk: 0.20, safetyCar: 0.40, trackEvolution: 0.65 }
};

const MC_DEFAULT_SIMS = 900;
const MC_LAPS = 57;

/* ============================================================================
   2. UTILITIES
   ============================================================================ */
function nowIso() { return new Date().toISOString(); }
function clamp01(v) { return clamp(v, 0, 1); }
function round4(v) { return Math.round(v * 10000) / 10000; }
function round2(v) { return Math.round(v * 100) / 100; }
function avg(arr) {
  const ok = (arr || []).filter(v => v != null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}
function deepCopy(x) { return JSON.parse(JSON.stringify(x)); }
function hashString(str) {
  /* djb2 - fast, stable across platforms, good enough for fingerprints */
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ============================================================================
   3. STATE BOOTSTRAP
   ============================================================================ */
function mkBelief(value, confidence, baseline, reason) {
  return {
    value, confidence,
    baseline: baseline != null ? baseline : value,
    weekendAdjustment: 0,
    lastUpdate: null,
    reason: reason || 'seed',
    evidenceCount: 0
  };
}
function cloneBelief(b) {
  return {
    value: b.value, confidence: b.confidence, baseline: b.baseline,
    weekendAdjustment: b.weekendAdjustment || 0,
    lastUpdate: b.lastUpdate, reason: b.reason, evidenceCount: b.evidenceCount || 0
  };
}
function seedWorldModel(state) {
  const drivers = {}, teams = {};
  DRIVERS.forEach(d => {
    const pace = clamp01((d.rating - 1400) / 400);
    const base = mkBelief(pace, 0.30, pace, 'historical baseline');
    drivers[d.id] = {
      qualiPace: cloneBelief(base), racePace: cloneBelief(base), sprintPace: cloneBelief(base),
      tyreDeg: mkBelief(0.50, 0.20), tyreWarmup: mkBelief(0.50, 0.20),
      wetPerf: mkBelief(0.50, 0.20), reliability: mkBelief(0.85, 0.30),
      driverExec: mkBelief(0.70, 0.25), consistency: mkBelief(0.70, 0.25),
      startPerf: mkBelief(0.60, 0.20), mistakeRisk: mkBelief(0.40, 0.20),
      tyreManage: mkBelief(0.60, 0.20), overtaking: mkBelief(0.50, 0.20), defending: mkBelief(0.50, 0.20)
    };
  });
  Object.keys(TEAMS).forEach(t => {
    const pace = clamp01((TEAMS[t].base - 1450) / 300);
    const base = mkBelief(pace, 0.35, pace, 'historical baseline');
    teams[t] = {
      qualiPace: cloneBelief(base), racePace: cloneBelief(base),
      highSpeed: mkBelief(0.50, 0.20), lowSpeed: mkBelief(0.50, 0.20),
      straightLine: mkBelief(0.50, 0.20), cornering: mkBelief(0.50, 0.20),
      tyreDeg: mkBelief(0.50, 0.25), tyreWarmup: mkBelief(0.50, 0.20),
      trackEvolution: mkBelief(0.50, 0.20), reliability: mkBelief(0.85, 0.30),
      wetPerf: mkBelief(0.50, 0.20), pitStop: mkBelief(0.60, 0.20),
      strategyFlex: mkBelief(0.60, 0.20), overtaking: mkBelief(0.50, 0.20), safetyCar: mkBelief(0.30, 0.20)
    };
  });
  const circuits = {};
  Object.keys(CIRCUIT_CHAR).forEach(e => {
    circuits[e] = { value: CIRCUIT_CHAR[e], confidence: 1, baseline: null, weekendAdjustment: 0, lastUpdate: null, reason: 'static circuit characteristics', evidenceCount: 0 };
  });
  return { drivers, teams, circuits };
}
function defaultCalibration() {
  return {
    overall: { recs: [] },
    byDriver: {}, byTeam: {}, byCircuit: {}, byWeather: {}, bySession: {}
  };
}
function seqDefaultState(state) {
  return {
    version: SEQ_VERSION,
    meta: {
      modelVersion: 0,
      dataVersion: 'init',
      currentEvent: null,
      currentSession: null
    },
    weekendStates: {},
    worldModel: seedWorldModel(state),
    evidence: [],
    evidenceIndex: {},
    predictionLedger: {},
    evaluations: [],
    diagnoses: [],
    modelUpdates: [],
    outliers: [],
    lessons: [],
    calibration: defaultCalibration(),
    modelVersions: [],
    dataVersions: [],
    featureCache: {},
    predCache: {},
    lastReport: null,
    settings: { seqPaceWeight: 0.12, mcSims: MC_DEFAULT_SIMS, mcLaps: MC_LAPS }
  };
}
/* overrides the stub in engine.js - safe to call at any time */
function ensureSeqState(state) {
  if (!state.seq || state.seq.version !== SEQ_VERSION) state.seq = seqDefaultState(state);
  return state;
}
function bucketOf(cal, key) {
  if (!cal[key]) cal[key] = { recs: [] };
  return cal[key];
}
function pushCapped(arr, x, cap) {
  arr.unshift(x);
  if (arr.length > (cap || 100)) arr.length = cap || 100;
}

/* ============================================================================
   4. TEMPORAL INTEGRITY (spec §19/§20/§30)
   Build a view of the world containing only information that was legitimately
   available before a given session. Future events are excluded entirely.
   ============================================================================ */
function availableView(state, eventId, session) {
  const idx = raceIndex(eventId);
  const allowed = new Set(sessionsBefore(eventId, session));
  const weekends = {};
  RACES.forEach(r => {
    if (raceIndex(r.id) > idx) return;
    const w = state.weekends[r.id];
    if (!w) return;
    if (r.id !== eventId) { weekends[r.id] = w; return; }
    const cw = { weather: w.weather };
    ['sq', 'sprint', 'quali', 'race'].forEach(s => {
      if (allowed.has(s) && w[s]) cw[s] = w[s];
    });
    if (w.dnf || w.dns) {
      cw.dnf = {}; cw.dns = {};
      allowed.forEach(s => {
        if (w.dnf && w.dnf[s]) cw.dnf[s] = w.dnf[s];
        if (w.dns && w.dns[s]) cw.dns[s] = w.dns[s];
      });
      if (!Object.keys(cw.dnf).length) delete cw.dnf;
      if (!Object.keys(cw.dns).length) delete cw.dns;
    }
    if (allowed.has('race')) {
      if (w.startedBack) cw.startedBack = w.startedBack;
      if (w.fastLap) cw.fastLap = w.fastLap;
    }
    weekends[r.id] = cw;
  });
  return Object.assign({}, state, { weekends });
}
function computeFingerprint(obj) { return hashString(JSON.stringify(obj)); }

/* ============================================================================
   5. WEEKEND / SESSION STATE MACHINE (spec §2, §18)
   ============================================================================ */
function initWeekendState(state, eventId) {
  const flow = flowFor(eventId);
  return {
    eventId,
    phase: 'PRE-WEEKEND',
    completed: [],
    nextSession: flow[0],
    sessionsRemaining: flow.slice(),
    awaitingResults: false,
    postUpdateDone: false,
    startedAt: nowIso()
  };
}
function recomputeWeekendState(state, eventId) {
  ensureSeqState(state);
  if (!state.seq.weekendStates[eventId]) state.seq.weekendStates[eventId] = initWeekendState(state, eventId);
  const ws = state.seq.weekendStates[eventId];
  const flow = flowFor(eventId);
  const completed = flow.filter(s => hasSession(state, eventId, s));
  ws.completed = completed;
  const next = flow.find(s => !completed.includes(s));
  ws.nextSession = next || null;
  ws.sessionsRemaining = next ? flow.slice(flow.indexOf(next)) : [];
  ws.awaitingResults = !!(next && getLockedPrediction(state, eventId, next));
  ws.phase = completed.includes('race') ? 'POST-WEEKEND' : (completed.length ? 'IN-WEEKEND' : 'PRE-WEEKEND');
  if (ws.phase === 'POST-WEEKEND' && !ws.postUpdateDone) {
    ws.postUpdateDone = !!(state.seq.weekendStates[eventId] && state.seq.weekendStates[eventId].postUpdateDone);
  }
  state.seq.weekendStates[eventId] = ws;
  state.seq.meta.currentEvent = eventId;
  state.seq.meta.currentSession = ws.nextSession;
  return ws;
}
function weekendStateOf(state, eventId) { return recomputeWeekendState(state, eventId); }
function nextSessionToPredict(state, eventId) { return weekendStateOf(state, eventId).nextSession; }

/* ============================================================================
   6. WORLD MODEL (spec §4)
   Per-driver/team/circuit belief variables with value, confidence, baseline,
   weekend adjustment, last update, reason and evidence count.
   ============================================================================ */
function eff(b) { return clamp01(b.value + (b.weekendAdjustment || 0)); }
function updateBelief(b, observed, weight, reason, eventId) {
  const w = clamp01(weight);
  const c = b.confidence || 0.3;
  const newVal = (c * b.value + w * observed) / (c + w);
  const shift = newVal - b.value;
  b.value = clamp01(newVal);
  b.confidence = clamp01(c + (1 - c) * w * 0.4);
  if (eventId) {
    b.weekendAdjustment = clamp((b.weekendAdjustment || 0) + shift * 0.5, -0.30, 0.30);
  }
  b.lastUpdate = nowIso();
  b.reason = reason;
  b.evidenceCount = (b.evidenceCount || 0) + 1;
}

/* map a finishing/qualifying position to an underlying-pace estimate (0..1).
   Concave: positions at the front are strongly differentiated, the tail is
   compressed - finishing P1 vs P2 means more than P12 vs P13. */
function paceFromPos(pos, n) {
  const z = (n - pos) / (n - 1);
  const k = Math.exp(2.3);
  return clamp01(0.05 + 0.9 * (Math.exp(2.3 * z) - 1) / (k - 1));
}

/* ============================================================================
   7. EVIDENCE ENGINE (spec §6)
   ============================================================================ */
function addObservation(state, observation) {
  ensureSeqState(state);
  const ev = Object.assign({}, observation);
  if (!ev.id) ev.id = 'ev_' + hashString(JSON.stringify(ev) + Math.random());
  if (!ev.createdAt) ev.createdAt = ev.timestamp || nowIso();
  if (!ev.conditions) ev.conditions = {};
  if (!ev.reliability) ev.reliability = 0.6;
  if (!ev.relevance) ev.relevance = 1;
  state.seq.evidence.unshift(ev);
  if (state.seq.evidence.length > 3000) state.seq.evidence.length = 3000;
  const key = ev.subject + ':' + ev.feature;
  const idx = state.seq.evidenceIndex[key] || (state.seq.evidenceIndex[key] = []);
  idx.push(ev.id);
  if (idx.length > 200) idx.shift();
  applyEvidenceToWorldModel(state, ev);
  return ev;
}
function applyEvidenceToWorldModel(state, evidence) {
  const transfer = EVIDENCE_TRANSFER[evidence.feature];
  if (!transfer) return;
  const w = clamp01(evidence.reliability * evidence.relevance);
  const eventId = evidence.eventId || null;
  if (state.seq.worldModel.drivers[evidence.subject]) {
    const dv = state.seq.worldModel.drivers[evidence.subject];
    Object.keys(transfer.driver || {}).forEach(varName => {
      updateBelief(dv[varName], evidence.observedValue, w * transfer.driver[varName], evidence.notes || evidence.feature, eventId);
    });
  } else if (state.seq.worldModel.teams[evidence.subject]) {
    const tv = state.seq.worldModel.teams[evidence.subject];
    Object.keys(transfer.team || {}).forEach(varName => {
      updateBelief(tv[varName], evidence.observedValue, w * transfer.team[varName], evidence.notes || evidence.feature, eventId);
    });
  }
}
function recentEvidence(state, subject, feature, n) {
  const idx = state.seq.evidenceIndex[subject + ':' + feature] || [];
  const byId = {};
  state.seq.evidence.forEach(e => { byId[e.id] = e; });
  return idx.slice(0, n || 8).map(id => byId[id]).filter(Boolean);
}

/* ============================================================================
   8. RESULT INGESTION -> EVIDENCE (spec §6, §9, §20)
   ============================================================================ */
function ingestResultEvidence(state, eventId, session, meta) {
  meta = meta || {};
  const results = meta.results || {};
  const dnf = meta.dnf || [];
  const weather = weatherOf(state, eventId);
  const wet = weather === 'wet' || weather === 'chaos';
  const n = GRID;
  const baseRel = SESSION_RELIABILITY[session] || 0.8;
  const conditions = { weather, session, eventId, trackTemp: meta.trackTemp || null, timestamp: nowIso() };
  const incidentFor = meta.incidentFor || [];
  const damageFor = meta.damageFor || [];
  const trafficFor = meta.trafficFor || [];
  const strategyFor = meta.strategyFor || [];
  const driverErrorFor = meta.driverErrorFor || [];
  const mechDnfFor = meta.mechDnfFor || [];
  const entries = [];

  const classified = Object.keys(results);
  classified.forEach(id => {
    const pos = results[id];
    const observed = paceFromPos(pos, n);
    let rel = baseRel;
    if (incidentFor.includes(id)) rel *= 0.30;
    if (damageFor.includes(id)) rel *= 0.20;
    if (trafficFor.includes(id)) rel *= 0.50;
    if (strategyFor.includes(id)) rel *= 0.55;
    if (driverErrorFor.includes(id)) rel *= 0.40;
    if (session === 'race' && wet) rel *= 0.75;
    rel = clamp01(rel);
    const feature = session === 'race' ? 'racePace' : (session === 'sprint' ? 'sprintPace' : 'qualiPace');
    entries.push({ feature, subject: id, observedValue: observed, reliability: rel, relevance: 1, conditions, eventId, notes: 'classified result' });
    if (session === 'race' && wet) {
      entries.push({ feature: 'wetPerf', subject: id, observedValue: observed, reliability: clamp01(rel * 0.8), relevance: 1, conditions, eventId, notes: 'wet race performance' });
    }
    if (session === 'race') {
      entries.push({ feature: 'form', subject: id, observedValue: observed, reliability: clamp01(rel * 0.8), relevance: 0.6, conditions, eventId, notes: 'race form' });
    }
  });

  dnf.forEach(id => {
    const mech = mechDnfFor.includes(id);
    entries.push({
      feature: 'reliability', subject: id, observedValue: 0,
      reliability: mech ? 0.9 : 0.35, relevance: 1, conditions, eventId,
      notes: mech ? 'mechanical DNF' : 'incident DNF'
    });
  });

  /* team evidence from each team's best classified car (pace of the car) */
  const teamBest = {};
  DRIVERS.forEach(d => {
    const p = results[d.id];
    if (p != null && (teamBest[d.team] == null || p < teamBest[d.team])) teamBest[d.team] = p;
  });
  Object.keys(teamBest).forEach(t => {
    const observed = paceFromPos(teamBest[t], n);
    entries.push({
      feature: (session === 'race') ? 'teamRacePace' : 'teamQualiPace',
      subject: t, observedValue: observed,
      reliability: clamp01(baseRel * (session === 'race' ? 0.9 : 1)),
      relevance: 1, conditions, eventId, notes: 'team best car'
    });
  });

  return entries.map(e => addObservation(state, e).id);
}

/* ============================================================================
   9. PREDICTION ENGINE (spec §3, §5, §10, §11, §22, §34)
   ============================================================================ */
function worldModelPacePositions(state, view, eventId, session) {
  const scores = {};
  DRIVERS.forEach(d => { scores[d.id] = worldModelScore(state, d.id, session, eventId); });
  return scoresToPositions(scores, 0.10);
}
function worldModelScore(state, id, session, eventId) {
  const wm = state.seq.worldModel;
  const d = driverById(id);
  const varName = session === 'race' ? 'racePace' : (session === 'sprint' ? 'sprintPace' : 'qualiPace');
  const dv = eff(wm.drivers[id][varName]);
  const tv = eff(wm.teams[d.team][session === 'race' ? 'racePace' : 'qualiPace']);
  const base = (d.rating - 1400) / 400;
  const tbase = (TEAMS[d.team].base - 1450) / 300;
  let v = 0.45 * base + 0.35 * tbase + 0.12 * dv + 0.08 * tv;
  const wet = weatherOf(state, eventId);
  if ((wet === 'wet' || wet === 'chaos') && session !== 'quali') {
    v += (eff(wm.drivers[id].wetPerf) - 0.5) * 0.12;
  }
  if ((HOME_DRIVERS[eventId] || []).includes(id)) v += 0.03;
  const idx = raceIndex(eventId);
  v += devBoostForTeam(state, d.team, idx) * 0.05;
  return 1400 + clamp01(v) * 400;
}
function weightedBlend(state, signals, eventId, session) {
  const w = state.model.w;
  const keys = ['rating', 'form', 'quali', 'team', 'track', 'grid'];
  const wSeq = (state.seq.settings && state.seq.settings.seqPaceWeight) || 0.12;
  const wet = weatherOf(state, eventId);
  const weatherEffect = WEATHER.find(x => x.id === wet).effect;
  const raw = {};
  DRIVERS.forEach(d => {
    let v = 0, ws = 0;
    keys.forEach(k => {
      const s = signals[k] != null ? signals[k][d.id] : null;
      if (s != null) { v += w[k] * s; ws += w[k]; }
    });
    const sp = signals.seqPace ? signals.seqPace[d.id] : null;
    if (sp != null) { v += wSeq * sp; ws += wSeq; }
    v = ws ? v / ws : 0;
    if (session === 'race' && weatherEffect > 0) {
      v += ((typeof __seqRng === 'function' ? __seqRng() : Math.random()) - 0.5) * weatherEffect * 1.4;
    }
    raw[d.id] = v;
  });
  return raw;
}

/* analytic order distribution for single-session forecasts (quali/sprint) */
function sampleOrderDistribution(raw, nSamp, seed, spread) {
  const rng = mulberry32(seed);
  const counts = {};
  DRIVERS.forEach(d => { counts[d.id] = {}; });
  for (let s = 0; s < nSamp; s++) {
    const noisy = {};
    DRIVERS.forEach(d => { noisy[d.id] = raw[d.id] + (rng() * 2 - 1) * spread; });
    const order = DRIVERS.map(d => d.id).sort((a, b) => noisy[a] - noisy[b]);
    order.forEach((id, i) => { counts[id][i + 1] = (counts[id][i + 1] || 0) + 1; });
  }
  return distributionFromCounts(counts, nSamp, false);
}

/* Monte Carlo race simulation (spec §22). Many simulated races aggregate into
   P(win), P(podium), P(points), P(DNF), expected position, position distribution. */
function simulateRace(state, view, eventId, raw, order, seed, nSims) {
  const rng = mulberry32(seed);
  const circuit = CIRCUIT_CHAR[eventId] || { overtaking: 0.6, deg: 0.6, weatherRisk: 0.4, safetyCar: 0.5, trackEvolution: 0.6 };
  const grid = gridOf(view, eventId);
  const weather = weatherOf(state, eventId);
  const wet = weather === 'wet' || weather === 'chaos';
  const wm = state.seq.worldModel;
  const LAPS = state.seq.settings.mcLaps || MC_LAPS;

  const base = {}, sig = {}, deg = {}, dnfProb = {}, wetBoost = {};
  DRIVERS.forEach(d => {
    const id = d.id;
    base[id] = 0.2 + raw[id] * 0.006;
    sig[id] = 0.09 + (1 - wm.drivers[id].racePace.confidence) * 0.10 + (wet ? 0.05 : 0);
    const dd = eff(wm.drivers[id].tyreDeg);
    const td = eff(wm.teams[d.team].tyreDeg);
    deg[id] = 0.012 + 0.05 * (dd * 0.6 + td * 0.4) * circuit.deg;
    const rel = 0.9 * eff(wm.drivers[id].reliability) + 0.1 * eff(wm.teams[d.team].reliability);
    dnfProb[id] = clamp(0.02 + (1 - rel) * 0.22 + circuit.safetyCar * 0.01, 0.004, 0.4);
    wetBoost[id] = wet ? (eff(wm.drivers[id].wetPerf) - 0.5) * 0.012 : 0;
  });
  const overtake = clamp01(circuit.overtaking);
  const scProb = circuit.safetyCar * 0.014;

  const counts = {}, win = {}, podium = {}, points = {}, dnfC = {}, sumPos = {};
  DRIVERS.forEach(d => {
    const id = d.id;
    counts[id] = {}; win[id] = 0; podium[id] = 0; points[id] = 0; dnfC[id] = 0; sumPos[id] = 0;
  });

  for (let sim = 0; sim < nSims; sim++) {
    const cum = {}, alive = {}, dnfAt = {};
    DRIVERS.forEach(d => {
      const id = d.id;
      cum[id] = (grid && grid[id] != null ? grid[id] : 12) * 0.04;
      alive[id] = true;
    });
    let scPending = false, scLap = 0;
    for (let lap = 1; lap <= LAPS; lap++) {
      const wob = wet ? (rng() * 2 - 1) * 0.05 : 0;
      DRIVERS.forEach(d => {
        const id = d.id;
        if (!alive[id]) return;
        const noise = (rng() * 2 - 1) * sig[id];
        cum[id] += base[id] + wetBoost[id] + wob + deg[id] * lap + noise;
        if (rng() < dnfProb[id] / LAPS) { alive[id] = false; dnfAt[id] = lap; }
      });
      if (!scPending && rng() < scProb) { scPending = true; scLap = lap; }
      if (scPending && lap === scLap + 2) {
        const oNow = DRIVERS.map(d => d.id).sort((a, b) => cum[a] - cum[b]);
        for (let i = 0; i < oNow.length - 1; i++) {
          if (rng() < 0.12) { const t = cum[oNow[i]]; cum[oNow[i]] = cum[oNow[i + 1]]; cum[oNow[i + 1]] = t; }
        }
        scPending = false;
      }
    }
    const classified = DRIVERS.map(d => d.id).filter(id => alive[id]).sort((a, b) => cum[a] - cum[b]);
    const dnfList = DRIVERS.map(d => d.id).filter(id => !alive[id]).sort((a, b) => (dnfAt[a] || 0) - (dnfAt[b] || 0));
    const finalOrder = applyOvertakeStickiness(classified, grid, overtake);
    const full = finalOrder.concat(dnfList);
    full.forEach((id, i) => {
      const pos = i + 1;
      counts[id][pos] = (counts[id][pos] || 0) + 1;
      sumPos[id] += pos;
      if (pos === 1) win[id]++;
      if (pos <= 3) podium[id]++;
      if (pos <= 10) points[id]++;
    });
    dnfList.forEach(id => dnfC[id]++);
  }

  const dist = distributionFromCounts(counts, nSims, true);
  dist.win = pctMap(win, nSims);
  dist.podium = pctMap(podium, nSims);
  dist.points = pctMap(points, nSims);
  dist.dnf = pctMap(dnfC, nSims);
  dist.summary = {
    sims: nSims, laps: LAPS, weather,
    safetyCarProbability: round2(scProb),
    overtakingDifficulty: round2(1 - overtake),
    topWinProbability: dist.win[order[0]] != null ? round2(dist.win[order[0]]) : null
  };
  return dist;
}
function distributionFromCounts(counts, n, withDnf) {
  const probabilities = {}, expectedPositions = {}, win = {}, podium = {}, points = {};
  DRIVERS.forEach(d => {
    const id = d.id;
    const dist = {};
    for (let p = 1; p <= GRID; p++) dist['P' + p] = Math.round(((counts[id][p] || 0) / n) * 1000) / 1000;
    probabilities[id] = dist;
    let ex = 0;
    for (let p = 1; p <= GRID; p++) ex += p * (counts[id][p] || 0);
    expectedPositions[id] = Math.round((ex / n) * 100) / 100;
    win[id] = Math.round(((counts[id][1] || 0) / n) * 1000) / 1000;
    let pod = 0, pts = 0;
    for (let p = 1; p <= 3; p++) pod += counts[id][p] || 0;
    for (let p = 1; p <= 10; p++) pts += counts[id][p] || 0;
    podium[id] = Math.round((pod / n) * 1000) / 1000;
    points[id] = Math.round((pts / n) * 1000) / 1000;
  });
  return { probabilities, expectedPositions, win, podium, points };
}
function pctMap(m, n) {
  const out = {};
  DRIVERS.forEach(d => { out[d.id] = Math.round(((m[d.id] || 0) / n) * 1000) / 1000; });
  return out;
}
/* overtaking difficulty: final classified order is a blend of pace-rank and
   grid-rank. Hard-to-pass circuits stay grid-sticky. */
function applyOvertakeStickiness(classified, grid, overtake) {
  if (!grid) return classified.slice();
  const k = 1 - overtake;
  if (k <= 0.02) return classified.slice();
  const rankP = {};
  classified.forEach((id, i) => { rankP[id] = i + 1; });
  const scored = classified.map(id => ({ id, s: rankP[id] * (1 - k) + (grid[id] || 12) * k }));
  scored.sort((a, b) => a.s - b.s);
  return scored.map(x => x.id);
}

/* confidence: uncertainty in the model, not how persuasive the explanation is */
function seqConfidence(state, eventId, session) {
  const wm = state.seq.worldModel;
  const varName = session === 'race' ? 'racePace' : (session === 'sprint' ? 'sprintPace' : 'qualiPace');
  let csum = 0, n = 0;
  DRIVERS.forEach(d => { csum += wm.drivers[d.id][varName].confidence; n++; });
  const avgConf = n ? csum / n : 0.3;
  const cal = state.seq.calibration.overall.recs || [];
  const mae = avg(cal.slice(-10).map(r => r.mae));
  const penalty = mae != null ? clamp(mae * 0.04, 0, 0.25) : 0.10;
  const sampleBonus = clamp(state.seq.evidence.length / 300, 0, 0.10);
  return clamp(0.30 + avgConf * 0.5 - penalty + sampleBonus, 0.20, 0.95);
}
function assumptionsFor(state, eventId, session) {
  const wet = weatherOf(state, eventId);
  const a = [];
  if (session === 'race') {
    a.push(wet === 'dry' ? 'Dry race expected' : (wet + ' conditions expected to persist'));
    a.push('Current tyre-degradation estimates remain valid');
    a.push('No major reliability failures beyond modelled rates');
    a.push('Normal safety-car probability');
    a.push('Starting grid reflects qualifying result');
  } else {
    a.push('Track conditions similar to recent sessions');
    a.push('No weather disruption during the session');
    a.push('Qualifying/sprint data is the strongest available evidence');
  }
  return a;
}
function uncertaintiesFor(state, eventId, session) {
  const wm = state.seq.worldModel;
  const u = [];
  if (session === 'race') {
    const degConf = avg(DRIVERS.map(d => eff(wm.drivers[d.id].tyreDeg)));
    u.push(degConf < 0.5 ? 'High uncertainty: race tyre degradation' : 'Race tyre degradation reasonably known');
    u.push('Overtaking capability at this circuit');
    if (weatherOf(state, eventId) !== 'dry') u.push('Weather instability');
    u.push('Safety-car timing');
  } else {
    u.push('Track evolution between sessions');
    u.push('Limited direct evidence for this session type');
  }
  return u;
}

/* ============================================================================
   10. MAIN SEQUENTIAL PREDICTION (used by predictSession wrapper)
   ============================================================================ */
function seqPredictSession(state, eventId, session, opts) {
  ensureSeqState(state);
  const locked = getLockedPrediction(state, eventId, session);
  if (locked) return locked.output;

  const cacheKey = predCacheKey(state, eventId, session);
  if (state.seq.predCache[cacheKey]) return state.seq.predCache[cacheKey];

  const view = availableView(state, eventId, session);
  const signals = buildSignals(view, eventId);
  signals.grid = {};
  if (session === 'race') {
    const grid = gridOf(view, eventId);
    DRIVERS.forEach(d => {
      signals.grid[d.id] = grid && grid[d.id] != null ? grid[d.id] : signals.quali[d.id];
    });
  } else {
    DRIVERS.forEach(d => { signals.grid[d.id] = null; });
  }
  signals.seqPace = worldModelPacePositions(state, view, eventId, session);

  const weather = weatherOf(state, eventId);
  const weatherEffect = WEATHER.find(x => x.id === weather).effect;
  const seed = hashString(state.seq.meta.dataVersion + '|' + state.seq.meta.modelVersion + '|' + session);

  let raw, order, gaps = {}, probs = {};
  let probabilities = {}, expectedPositions = {};
  let winProb = {}, podiumProb = {}, pointsProb = {}, dnfProb = {};
  let simulation = null;

  __seqRng = mulberry32(seed);
  try {
    raw = weightedBlend(state, signals, eventId, session);
    order = orderFromRaw(raw);
    if (session === 'race') {
      gaps = predictedGaps(order);
      simulation = simulateRace(state, view, eventId, raw, order, seed, state.seq.settings.mcSims || MC_DEFAULT_SIMS);
      probabilities = simulation.probabilities;
      expectedPositions = simulation.expectedPositions;
      winProb = simulation.win;
      podiumProb = simulation.podium;
      pointsProb = simulation.points;
      dnfProb = simulation.dnf;
      DRIVERS.forEach(d => { probs[d.id] = Math.round((winProb[d.id] || 0) * 1000) / 10; });
    } else {
      const spread = (1 - seqConfidence(state, eventId, session)) * 2.2 + 0.6;
      const dist = sampleOrderDistribution(raw, 420, seed, spread);
      probabilities = dist.probabilities;
      expectedPositions = dist.expectedPositions;
      winProb = dist.win;
      podiumProb = dist.podium;
      pointsProb = dist.points;
    }
  } finally {
    __seqRng = null;
  }

  const legacyConf = confidenceOf(state, raw, order);
  const seqConf = seqConfidence(state, eventId, session);
  const confidence = Math.round(clamp(0.6 * seqConf * 100 + 0.4 * legacyConf, 20, 95));

  const prediction = {
    raceId: eventId,
    eventId,
    session,
    order,
    signals,
    raw,
    confidence,
    weather,
    weatherEffect,
    gaps,
    probs,
    probabilities,
    expectedPositions,
    winProbability: winProb,
    podiumProbability: podiumProb,
    pointsProbability: pointsProb,
    dnfProbability: dnfProb,
    simulation,
    assumptions: assumptionsFor(state, eventId, session),
    uncertainties: uncertaintiesFor(state, eventId, session),
    modelVersion: state.seq.meta.modelVersion,
    dataVersion: state.seq.meta.dataVersion,
    generatedAt: nowIso(),
    predictionId: null,
    status: 'DRAFT'
  };
  state.seq.predCache[cacheKey] = prediction;
  if (Object.keys(state.seq.predCache).length > 40) {
    delete state.seq.predCache[Object.keys(state.seq.predCache)[0]];
  }
  return prediction;
}
function predCacheKey(state, eventId, session) {
  return eventId + ':' + session + ':' + state.seq.meta.modelVersion + ':' + state.seq.meta.dataVersion;
}

/* ============================================================================
   11. PREDICTION LOCKING & LEDGER (spec §12, §13, §19)
   ============================================================================ */
function predKey(eventId, session) { return eventId + ':' + session; }
function getLockedPrediction(state, eventId, session) {
  return state.seq.predictionLedger[predKey(eventId, session)] || null;
}
function lockPrediction(state, eventId, session, pred) {
  const key = predKey(eventId, session);
  if (state.seq.predictionLedger[key]) return state.seq.predictionLedger[key];
  const id = 'prd_' + hashString(key + '|' + state.seq.meta.dataVersion + '|' + state.seq.meta.modelVersion);
  const locked = {
    predictionId: id,
    eventId,
    session,
    status: 'LOCKED',
    createdAt: nowIso(),
    modelVersion: state.seq.meta.modelVersion,
    dataVersion: state.seq.meta.dataVersion,
    inputsSnapshot: {
      worldModel: deepCopy(state.seq.worldModel),
      weights: deepCopy(state.model.w),
      sessionsCompleted: flowFor(eventId).filter(s => hasSession(state, eventId, s)),
      weather: weatherOf(state, eventId),
      devPackages: deepCopy(state.devPackages)
    },
    prediction: {
      order: pred.order.slice(),
      expectedPositions: deepCopy(pred.expectedPositions || {}),
      probabilities: deepCopy(pred.probabilities || {}),
      winProbability: deepCopy(pred.winProbability || {}),
      podiumProbability: deepCopy(pred.podiumProbability || {}),
      pointsProbability: deepCopy(pred.pointsProbability || {}),
      dnfProbability: deepCopy(pred.dnfProbability || {})
    },
    confidence: pred.confidence,
    assumptions: pred.assumptions ? pred.assumptions.slice() : [],
    uncertainties: pred.uncertainties ? pred.uncertainties.slice() : [],
    simulationSummary: deepCopy(pred.simulation || null),
    output: pred
  };
  pred.status = 'LOCKED';
  pred.predictionId = id;
  state.seq.predictionLedger[key] = locked;
  return locked;
}
/* lock the forecast for the next unknown session only (spec §1: never predict
   the whole weekend; never allow a silent rewrite). */
function ensurePredictionLocked(state, eventId, session) {
  ensureSeqState(state);
  const existing = getLockedPrediction(state, eventId, session);
  if (existing) return existing;
  if (nextSessionToPredict(state, eventId) !== session) return null;
  const pred = seqPredictSession(state, eventId, session);
  return lockPrediction(state, eventId, session, pred);
}

/* ============================================================================
   12. POST-SESSION PIPELINE: evaluate, diagnose, update, calibrate (spec §7,
       §14, §17, §26, §27)
   ============================================================================ */
function evaluatePrediction(state, locked, actualMap, meta) {
  const pred = locked.prediction;
  const predMap = {};
  pred.order.forEach((id, i) => { predMap[id] = i + 1; });
  const actualOrder = Object.keys(actualMap).sort((a, b) => actualMap[a] - actualMap[b]);
  const mae = meanAbsError(actualMap, predMap);
  const tau = kendallTau(actualMap, predMap);
  const winnerCorrect = pred.order[0] === actualOrder[0];
  const perDriver = {};
  DRIVERS.forEach(d => {
    const actual = actualMap[d.id];
    if (actual == null) return;
    const expected = pred.expectedPositions && pred.expectedPositions[d.id] != null
      ? pred.expectedPositions[d.id] : predMap[d.id];
    perDriver[d.id] = { expected: round2(expected), actual, delta: round2(actual - expected) };
  });
  const ev = {
    evaluationId: 'evl_' + hashString(locked.predictionId + nowIso()),
    predictionId: locked.predictionId,
    eventId: locked.eventId,
    session: locked.session,
    createdAt: nowIso(),
    status: 'EVALUATED',
    actual: deepCopy(actualMap),
    error: {
      mae: mae != null ? round4(mae) : null,
      tau: round4(tau),
      winnerCorrect,
      perDriver
    }
  };
  pushCapped(state.seq.evaluations, ev, 400);
  return ev;
}

function attributeError(state, eventId, session, id, expectedMap, actual, dnfList, meta) {
  meta = meta || {};
  if (dnfList.includes(id)) {
    return [{ cause: 'reliability_incident', confidence: 0.80 }, { cause: 'noise', confidence: 0.20 }];
  }
  const expected = expectedMap[id];
  const delta = actual - expected;
  if (Math.abs(delta) < 1) return [{ cause: 'noise', confidence: 1 }];
  const d = driverById(id);
  const mate = DRIVERS.find(o => o.team === d.team && o.id !== id);
  const mateExp = mate ? expectedMap[mate.id] : null;
  const mateAct = mate ? (meta.results ? meta.results[mate.id] : null) : null;
  const mateDelta = (mateExp != null && mateAct != null) ? mateAct - mateExp : 0;
  const teamSign = (mateDelta > 1 && delta > 1) || (mateDelta < -1 && delta < -1);
  const incident = (meta.incidentFor || []).includes(id) ? 0.30 : 0;
  const damage = (meta.damageFor || []).includes(id) ? 0.20 : 0;
  const traffic = (meta.trafficFor || []).includes(id) ? 0.30 : 0;
  const strategy = (meta.strategyFor || []).includes(id) ? 0.30 : 0;
  const dErr = (meta.driverErrorFor || []).includes(id) ? 0.30 : 0;
  const isRace = session === 'race';
  let causes;
  if (delta > 0) {
    causes = [
      { cause: teamSign ? 'car_pace_deficit' : 'pace_overestimate', confidence: 0.25 },
      { cause: 'driver_execution', confidence: teamSign ? 0.12 : 0.25 },
      { cause: 'tyre_preparation', confidence: isRace ? 0.15 : 0.05 },
      { cause: 'traffic_incident', confidence: Math.max(incident, damage, traffic) || 0.05 },
      { cause: 'strategy', confidence: strategy },
      { cause: 'driver_error', confidence: dErr },
      { cause: 'track_evolution', confidence: 0.05 },
      { cause: 'noise', confidence: 0.10 }
    ];
  } else {
    causes = [
      { cause: teamSign ? 'car_pace_gain' : 'pace_underestimate', confidence: 0.25 },
      { cause: 'driver_excellence', confidence: teamSign ? 0.12 : 0.25 },
      { cause: 'strategy_gain', confidence: strategy },
      { cause: 'noise', confidence: 0.10 }
    ];
  }
  const total = causes.reduce((s, c) => s + c.confidence, 0) || 1;
  causes.forEach(c => { c.confidence = round4(c.confidence / total); });
  return causes;
}
function applyCauseUpdates(state, eventId, session, id, causes, delta, rec) {
  const wm = state.seq.worldModel;
  const isRace = session === 'race';
  const d = driverById(id);
  const paceVar = isRace ? 'racePace' : (session === 'sprint' ? 'sprintPace' : 'qualiPace');
  causes.forEach(c => {
    const conf = c.confidence;
    if (conf < 0.04) return;
    const scale = conf * 0.03 * rec * Math.min(Math.abs(delta) / 4, 1);
    const reason = 'diagnosis: ' + c.cause + ' (Δ' + (delta > 0 ? '+' : '') + round2(delta) + ')';
    const subj = id;
    let varName = paceVar, before = null, after = null;
    switch (c.cause) {
      case 'pace_overestimate':
        before = wm.drivers[id][paceVar].value;
        updateBelief(wm.drivers[id][paceVar], clamp01(before - scale), 0.5, reason, eventId);
        after = wm.drivers[id][paceVar].value;
        break;
      case 'pace_underestimate':
        before = wm.drivers[id][paceVar].value;
        updateBelief(wm.drivers[id][paceVar], clamp01(before + scale), 0.5, reason, eventId);
        after = wm.drivers[id][paceVar].value;
        break;
      case 'car_pace_deficit':
        varName = isRace ? 'racePace' : 'qualiPace';
        before = wm.teams[d.team][varName].value;
        updateBelief(wm.teams[d.team][varName], clamp01(before - scale * 0.7), 0.5, reason, eventId);
        after = wm.teams[d.team][varName].value;
        break;
      case 'car_pace_gain':
        varName = isRace ? 'racePace' : 'qualiPace';
        before = wm.teams[d.team][varName].value;
        updateBelief(wm.teams[d.team][varName], clamp01(before + scale * 0.7), 0.5, reason, eventId);
        after = wm.teams[d.team][varName].value;
        break;
      case 'driver_execution':
        varName = 'driverExec';
        before = wm.drivers[id].driverExec.value;
        updateBelief(wm.drivers[id].driverExec, clamp01(before - scale), 0.4, reason, eventId);
        after = wm.drivers[id].driverExec.value;
        break;
      case 'driver_excellence':
        varName = 'driverExec';
        before = wm.drivers[id].driverExec.value;
        updateBelief(wm.drivers[id].driverExec, clamp01(before + scale), 0.4, reason, eventId);
        after = wm.drivers[id].driverExec.value;
        break;
      case 'tyre_preparation':
        varName = 'tyreDeg';
        before = wm.drivers[id].tyreDeg.value;
        updateBelief(wm.drivers[id].tyreDeg, clamp01(before + scale * 0.5), 0.3, reason, eventId);
        after = wm.drivers[id].tyreDeg.value;
        break;
      case 'reliability_incident':
        varName = 'reliability';
        before = wm.drivers[id].reliability.value;
        updateBelief(wm.drivers[id].reliability, clamp01(before - scale * 0.5), 0.3, reason, eventId);
        after = wm.drivers[id].reliability.value;
        break;
      default:
        return;
    }
    logModelUpdate(state, eventId, session, subj, varName, before, after, reason);
  });
}
function logModelUpdate(state, eventId, session, subject, varName, before, after, reason) {
  pushCapped(state.seq.modelUpdates, {
    at: nowIso(), eventId, session, subject, varName,
    before: round4(before), after: round4(after), delta: round4(after - before),
    reason
  }, 400);
}
function summarizeCauses(causesAll) {
  const agg = {};
  causesAll.forEach(c => c.causes.forEach(x => { agg[x.cause] = (agg[x.cause] || 0) + x.confidence; }));
  const total = Object.keys(agg).reduce((s, k) => s + agg[k], 0) || 1;
  return Object.keys(agg)
    .map(k => ({ cause: k, confidence: round4(agg[k] / total) }))
    .sort((a, b) => b.confidence - a.confidence);
}
function diagnoseAndUpdate(state, eventId, session, locked, actualMap, meta) {
  const pred = locked.prediction;
  const predMap = {};
  pred.order.forEach((id, i) => { predMap[id] = i + 1; });
  const dnfList = meta.dnf || [];
  const rec = recencyFactor(state);
  const expectedMap = {};
  DRIVERS.forEach(d => {
    expectedMap[d.id] = (pred.expectedPositions && pred.expectedPositions[d.id] != null)
      ? pred.expectedPositions[d.id] : predMap[d.id];
  });
  const causesAll = [], perDriver = {};
  DRIVERS.forEach(d => {
    const id = d.id;
    const actual = actualMap[id];
    if (actual == null) return;
    const causes = attributeError(state, eventId, session, id, expectedMap, actual, dnfList, meta);
    causesAll.push({ id, expected: expectedMap[id], actual, delta: actual - expectedMap[id], causes });
    perDriver[id] = { expected: round2(expectedMap[id]), actual, delta: round2(actual - expectedMap[id]), causes };
    applyCauseUpdates(state, eventId, session, id, causes, actual - expectedMap[id], rec);
  });
  const summary = summarizeCauses(causesAll);
  const diagnosis = {
    perDriver,
    summary,
    primaryCause: summary[0] ? summary[0].cause : 'noise',
    generatedAt: nowIso()
  };
  pushCapped(state.seq.diagnoses, {
    eventId, session, at: nowIso(), summary, primaryCause: diagnosis.primaryCause
  }, 120);
  return diagnosis;
}
function whatChanged(state, locked, diagnosis) {
  const before = locked.inputsSnapshot.worldModel;
  const after = state.seq.worldModel;
  const changes = [];
  Object.keys(before.drivers).forEach(subject => {
    if (!after.drivers[subject]) return;
    Object.keys(before.drivers[subject]).forEach(varName => {
      const b = before.drivers[subject][varName];
      const a = after.drivers[subject][varName];
      if (!a) return;
      const bv = round4(b.value + (b.weekendAdjustment || 0));
      const av = round4(a.value + (a.weekendAdjustment || 0));
      if (Math.abs(av - bv) > 1e-6) changes.push({ subject, varName, before: bv, after: av, reason: a.reason });
    });
  });
  Object.keys(before.teams).forEach(subject => {
    if (!after.teams[subject]) return;
    Object.keys(before.teams[subject]).forEach(varName => {
      const b = before.teams[subject][varName];
      const a = after.teams[subject][varName];
      if (!a) return;
      const bv = round4(b.value + (b.weekendAdjustment || 0));
      const av = round4(a.value + (a.weekendAdjustment || 0));
      if (Math.abs(av - bv) > 1e-6) changes.push({ subject, varName, before: bv, after: av, reason: a.reason });
    });
  });
  return { changes, assumptions: (locked.assumptions || []).slice() };
}

/* ============================================================================
   13. CALIBRATION ENGINE (spec §14)
   ============================================================================ */
function updateCalibration(state, eventId, session, locked, actualMap, meta) {
  const pred = locked.prediction;
  const predMap = {};
  pred.order.forEach((id, i) => { predMap[id] = i + 1; });
  const actualOrder = Object.keys(actualMap).sort((a, b) => actualMap[a] - actualMap[b]);
  const mae = meanAbsError(actualMap, predMap);
  const tau = kendallTau(actualMap, predMap);
  const winnerCorrect = pred.order[0] === actualOrder[0];
  let brier = 0, ll = 0, n = 0;
  DRIVERS.forEach(d => {
    const id = d.id;
    const actual = actualMap[id];
    if (actual == null) return;
    n++;
    const dist = pred.probabilities && pred.probabilities[id];
    const pTop3 = dist ? (dist.P1 || 0) + (dist.P2 || 0) + (dist.P3 || 0) : (predMap[id] <= 3 ? 1 : 0);
    const inTop3 = actual <= 3 ? 1 : 0;
    brier += (pTop3 - inTop3) * (pTop3 - inTop3);
    const pAct = dist ? clamp01(dist['P' + actual] || 0.005) : 0.005;
    ll += -Math.log(Math.max(0.005, pAct));
  });
  brier = n ? brier / n : null;
  ll = n ? ll / n : null;
  const weather = weatherOf(state, eventId);
  const rec = {
    at: nowIso(), eventId, session, weather,
    mae: mae != null ? round4(mae) : null,
    tau: round4(tau),
    brier: brier != null ? round4(brier) : null,
    logloss: ll != null ? round4(ll) : null,
    winnerCorrect,
    dnf: (meta.dnf || []).length
  };
  pushCapped(state.seq.calibration.overall.recs, rec, 200);
  pushCapped(bucketOf(state.seq.calibration.bySession, session).recs, rec, 100);
  pushCapped(bucketOf(state.seq.calibration.byCircuit, eventId).recs, rec, 100);
  pushCapped(bucketOf(state.seq.calibration.byWeather, weather).recs, rec, 100);
  DRIVERS.forEach(d => {
    const id = d.id;
    const actual = actualMap[id];
    if (actual == null) return;
    const dist = pred.probabilities && pred.probabilities[id];
    const expected = (pred.expectedPositions && pred.expectedPositions[id] != null)
      ? pred.expectedPositions[id] : predMap[id];
    const pTop3 = dist ? (dist.P1 || 0) + (dist.P2 || 0) + (dist.P3 || 0) : (predMap[id] <= 3 ? 1 : 0);
    const inTop3 = actual <= 3 ? 1 : 0;
    const pAct = dist ? clamp01(dist['P' + actual] || 0.005) : 0.005;
    const drec = {
      at: nowIso(), eventId, session, weather,
      mae: round4(Math.abs(actual - expected)),
      brier: round4((pTop3 - inTop3) * (pTop3 - inTop3)),
      logloss: round4(-Math.log(Math.max(0.005, pAct))),
      expected: round2(expected), actual
    };
    pushCapped(bucketOf(state.seq.calibration.byDriver, id).recs, drec, 100);
    pushCapped(bucketOf(state.seq.calibration.byTeam, d.team).recs, drec, 100);
  });
}
function aggregateRecs(recs) {
  return {
    n: recs.length,
    mae: avg(recs.map(r => r.mae)),
    brier: avg(recs.map(r => r.brier)),
    logloss: avg(recs.map(r => r.logloss)),
    tau: avg(recs.map(r => r.tau)),
    winnerAccuracy: recs.length ? recs.filter(r => r.winnerCorrect).length / recs.length : null,
    dnfMean: avg(recs.map(r => r.dnf))
  };
}
function aggregateSigned(recs) {
  const deltas = recs.map(r => r.actual - r.expected).filter(v => v != null);
  return deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;
}
function calibrationSummary(state) {
  const cal = state.seq.calibration;
  const mapOf = obj => {
    const out = {};
    Object.keys(obj).forEach(k => { out[k] = aggregateRecs(obj[k].recs); });
    return out;
  };
  return {
    overall: aggregateRecs(cal.overall.recs),
    bySession: mapOf(cal.bySession),
    byCircuit: mapOf(cal.byCircuit),
    byWeather: mapOf(cal.byWeather),
    byDriver: mapOf(cal.byDriver),
    byTeam: mapOf(cal.byTeam)
  };
}

/* ============================================================================
   14. OUTLIER DETECTION (spec §16)
   ============================================================================ */
function detectOutliers(state, eventId, session, locked, actualMap, meta) {
  const pred = locked.prediction;
  const predMap = {};
  pred.order.forEach((id, i) => { predMap[id] = i + 1; });
  const dnfList = meta.dnf || [];
  DRIVERS.forEach(d => {
    const id = d.id;
    const actual = actualMap[id];
    if (actual == null) return;
    const expected = (pred.expectedPositions && pred.expectedPositions[id] != null)
      ? pred.expectedPositions[id] : predMap[id];
    const delta = Math.abs(actual - expected);
    if (delta >= 4) {
      const reason = dnfList.includes(id) ? 'retirement' : 'large gap from forecast';
      pushCapped(state.seq.outliers, {
        at: nowIso(), eventId, session, subject: id,
        expected: round2(expected), actual, reason,
        impact: 'low', updateWeight: 0.12
      }, 120);
    }
  });
}

/* ============================================================================
   15. POST-WEEKEND LEARNING (spec §26, §27) + "WHAT CHANGED" (spec §17)
   ============================================================================ */
function runPostWeekendLearning(state, eventId) {
  const wm = state.seq.worldModel;
  const lessons = [];
  DRIVERS.forEach(d => {
    ['qualiPace', 'racePace'].forEach(vn => {
      const b = wm.drivers[d.id][vn];
      if (Math.abs(b.weekendAdjustment || 0) > 0.03) {
        lessons.push({
          event: (raceById(eventId) || { name: eventId }).name,
          subject: d.id, feature: vn,
          result: b.weekendAdjustment > 0 ? 'underestimated' : 'overestimated',
          confidence: round2(b.confidence)
        });
        b.value = clamp01(b.value + (b.weekendAdjustment || 0) * 0.5);
        b.weekendAdjustment = 0;
        b.confidence = clamp01(b.confidence + 0.02);
        b.lastUpdate = nowIso();
        b.reason = 'post-weekend learning';
      }
    });
  });
  Object.keys(TEAMS).forEach(t => {
    ['qualiPace', 'racePace'].forEach(vn => {
      const b = wm.teams[t][vn];
      if (Math.abs(b.weekendAdjustment || 0) > 0.02) {
        lessons.push({
          event: (raceById(eventId) || { name: eventId }).name,
          subject: t, feature: vn,
          result: b.weekendAdjustment > 0 ? 'underestimated' : 'overestimated',
          confidence: round2(b.confidence)
        });
        b.value = clamp01(b.value + (b.weekendAdjustment || 0) * 0.5);
        b.weekendAdjustment = 0;
        b.confidence = clamp01(b.confidence + 0.02);
        b.lastUpdate = nowIso();
        b.reason = 'post-weekend learning';
      }
    });
  });
  state.seq.lessons = state.seq.lessons.concat(lessons);
  if (state.seq.lessons.length > 200) state.seq.lessons.length = 200;
  return lessons;
}

/* ============================================================================
   16. PIPELINE ENTRY: run after a session result is ingested (spec §1)
   ============================================================================ */
function seqAfterResult(state, eventId, session, pred, meta) {
  ensureSeqState(state);
  meta = meta || {};
  let locked = getLockedPrediction(state, eventId, session);
  if (!locked) locked = lockPrediction(state, eventId, session, pred);

  if (!state.predictions[eventId]) state.predictions[eventId] = {};
  state.predictions[eventId][session] = locked.prediction.order.slice();

  ingestResultEvidence(state, eventId, session, meta);
  const actualMap = Object.assign({}, meta.results || {});
  const ev = evaluatePrediction(state, locked, actualMap, meta);
  const diagnosis = diagnoseAndUpdate(state, eventId, session, locked, actualMap, meta);
  const changes = whatChanged(state, locked, diagnosis);
  updateCalibration(state, eventId, session, locked, actualMap, meta);
  detectOutliers(state, eventId, session, locked, actualMap, meta);
  bumpModelVersion(state, eventId, session);
  const ws = weekendStateOf(state, eventId);

  let lessons = [];
  if (ws.phase === 'POST-WEEKEND' && !ws.postUpdateDone) {
    lessons = runPostWeekendLearning(state, eventId);
    ws.postUpdateDone = true;
  }

  const report = {
    eventId, session,
    predictionId: locked.predictionId,
    evaluationId: ev.evaluationId,
    error: ev.error,
    diagnosis,
    changeCount: changes.changes.length,
    lessons,
    modelVersion: state.seq.meta.modelVersion,
    dataVersion: state.seq.meta.dataVersion,
    nextSession: ws.nextSession,
    phase: ws.phase,
    awaitingResults: ws.awaitingResults
  };
  state.seq.lastReport = report;
  return report;
}
function bumpModelVersion(state, eventId, session) {
  state.seq.meta.modelVersion++;
  state.seq.predCache = {};
  const fp = computeFingerprint({
    weekends: state.weekends,
    worldModel: state.seq.worldModel,
    w: state.model.w
  });
  state.seq.meta.dataVersion = fp;
  pushCapped(state.seq.modelVersions, {
    at: nowIso(), modelVersion: state.seq.meta.modelVersion, eventId, session
  }, 200);
  pushCapped(state.seq.dataVersions, {
    at: nowIso(), eventId, session,
    fingerprint: fp, modelVersion: state.seq.meta.modelVersion
  }, 200);
}

/* ============================================================================
   17. INGEST + LEARN ENTRY (used by SeqAPI POST /sessions/:id/result)
   ============================================================================ */
function ingestResult(state, eventId, session, payload) {
  ensureSeqState(state);
  payload = payload || {};
  const w = weekendOf(state, eventId);
  w[session] = payload.results || {};
  w.dnf = w.dnf || {};
  w.dns = w.dns || {};
  w.dnf[session] = payload.dnf || [];
  w.dns[session] = payload.dns || [];
  if (payload.meta && payload.meta.weather) w.weather = payload.meta.weather;
  if (session === 'race') {
    if (payload.fastLap) w.fastLap = payload.fastLap;
    w.startedBack = { race: (payload.startedBack || []).slice() };
  }
  ensurePredictionLocked(state, eventId, session);
  const fb = applyResult(state, eventId, session);
  return { feedback: fb, report: fb.report };
}

/* ============================================================================
   18. API SURFACE (spec §28) - adapted to the in-browser frontend.
   Each method mirrors the documented route.
   ============================================================================ */
const SeqAPI = {
  routes: {
    'GET /weekends/:id': 'weekend(state, id)',
    'GET /weekends/:id/state': 'weekendState(state, id)',
    'GET /sessions/:id/prediction': 'sessionPrediction(state, eventId, session)',
    'GET /sessions/:id/result': 'sessionResult(state, eventId, session)',
    'POST /sessions/:id/result': 'ingestResult(state, eventId, session, payload)',
    'POST /sessions/:id/learn': 'learn(state, eventId, session)',
    'POST /sessions/:id/predict': 'predict(state, eventId, session)',
    'GET /predictions/:id': 'prediction(state, eventId, session)',
    'GET /predictions/:id/evaluation': 'evaluation(state, eventId, session)',
    'GET /world-model/:event': 'worldModel(state, "event", id)',
    'GET /world-model/:driver': 'worldModel(state, "driver", id)',
    'GET /world-model/:team': 'worldModel(state, "team", id)',
    'GET /calibration': 'calibration(state)',
    'GET /performance': 'performance(state)',
    'GET /model-history': 'modelHistory(state)'
  },

  weekend: (state, id) => weekendOf(state, id),
  weekendState: (state, id) => weekendStateOf(state, id),
  session: (state, eventId, session) => ({
    event: eventId, session,
    availableSessions: sessionsBefore(eventId, session),
    stored: state.weekends[eventId] ? (state.weekends[eventId][session] || null) : null
  }),
  sessionPrediction: (state, eventId, session) =>
    getLockedPrediction(state, eventId, session) || seqPredictSession(state, eventId, session),
  sessionResult: (state, eventId, session) => {
    const w = state.weekends[eventId];
    return w ? (w[session] || null) : null;
  },
  ingestResult: (state, eventId, session, payload) => ingestResult(state, eventId, session, payload),
  learn: (state, eventId, session) => {
    const w = state.weekends[eventId];
    if (!w || !w[session]) return null;
    const fb = applyResult(state, eventId, session);
    return { feedback: fb, report: fb.report };
  },
  predict: (state, eventId, session) => seqPredictSession(state, eventId, session),
  predictNext: (state, eventId) => {
    const next = nextSessionToPredict(state, eventId);
    return next ? seqPredictSession(state, eventId, next) : null;
  },
  forecastNext: (state, eventId) => {
    const next = nextSessionToPredict(state, eventId);
    return next ? ensurePredictionLocked(state, eventId, next) : null;
  },
  prediction: (state, eventId, session) => getLockedPrediction(state, eventId, session),
  evaluation: (state, eventId, session) =>
    state.seq.evaluations.find(e => e.eventId === eventId && e.session === session) || null,
  worldModel: (state, scope, id) => {
    if (scope === 'event') return weekendOf(state, id);
    if (scope === 'driver') return state.seq.worldModel.drivers[id] || null;
    if (scope === 'team') return state.seq.worldModel.teams[id] || null;
    return state.seq.worldModel;
  },
  calibration: state => calibrationSummary(state),
  performance: state => performanceSummary(state),
  modelHistory: state => ({
    modelVersions: state.seq.modelVersions.slice(0, 50),
    dataVersions: state.seq.dataVersions.slice(0, 50),
    modelUpdates: state.seq.modelUpdates.slice(0, 50),
    evaluations: state.seq.evaluations.slice(0, 20),
    outliers: state.seq.outliers.slice(0, 20),
    lessons: state.seq.lessons.slice(0, 20)
  })
};

function performanceSummary(state) {
  const cal = calibrationSummary(state);
  const evs = state.seq.evaluations;
  const byCircuitMae = {};
  evs.forEach(e => {
    if (e.error.mae == null) return;
    byCircuitMae[e.eventId] = byCircuitMae[e.eventId] || [];
    byCircuitMae[e.eventId].push(e.error.mae);
  });
  const worstCircuits = Object.keys(byCircuitMae)
    .map(id => ({ eventId: id, mae: avg(byCircuitMae[id]) }))
    .sort((a, b) => b.mae - a.mae).slice(0, 3);
  const over = [], under = [];
  Object.keys(cal.byDriver).forEach(id => {
    const signed = aggregateSigned(cal.byDriver[id].recs);
    if (signed == null) return;
    if (signed > 0.35) over.push({ driver: id, avgGap: round2(signed) });
    if (signed < -0.35) under.push({ driver: id, avgGap: round2(signed) });
  });
  over.sort((a, b) => b.avgGap - a.avgGap);
  under.sort((a, b) => a.avgGap - b.avgGap);
  return {
    predictionCount: evs.length,
    ...cal.overall,
    worstCircuits,
    systematicallyOverestimated: over.slice(0, 5),
    systematicallyUnderestimated: under.slice(0, 5),
    worldModelVersion: state.seq.meta.modelVersion,
    lastReport: state.seq.lastReport
  };
}
