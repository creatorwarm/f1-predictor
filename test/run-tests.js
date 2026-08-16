/* Sequential AI backend - spec invariant tests.
   Loads data.js + engine.js + seqengine.js into a Node vm context and
   verifies the §1-§28 guarantees the sequential layer must uphold.
   Run: node test/run-tests.js  (or: npm test) */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({});
['data.js', 'engine.js', 'seqengine.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
});
vm.runInContext(
  'this.__X = { defaultState, predictSession, applyResult, seqPredictSession, ensureSeqState, ' +
  'weekendStateOf, nextSessionToPredict, getLockedPrediction, lockPrediction, ensurePredictionLocked, ' +
  'availableView, addObservation, ingestResult, flowFor, seqDefaultState, mulberry32, hashString, ' +
  'seqAfterResult, SeqAPI, DRIVERS, RACES, GRID, TEAMS, WEATHER, weekendOf };', ctx);
const X = ctx.__X;

let passed = 0, failed = 0;
const fails = [];
function ok(cond, name, detail) {
  if (cond) { passed++; }
  else { failed++; fails.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function group(name) { console.log('\n== ' + name); }

/* helpers ---------------------------------------------------------------- */
function newState() {
  const s = X.defaultState();
  X.ensureSeqState(s);
  return s;
}
function fmtOrder(order) { return order.map(id => X.driverById ? id : id).slice(0, 6).join(','); }
function posMap(byId) { const m = {}; X.DRIVERS.forEach((d, i) => { m[d.id] = byId[d.id] || i + 1; }); return m; }
function resPayload(byId) { return { results: posMap(byId), dnf: [], dns: [] }; }

/* 1. bootstrap ------------------------------------------------------------ */
group('1. bootstrap');
{
  const s = newState();
  ok(s.seq && s.seq.meta && s.seq.weekendStates, 'ensureSeqState adds seq layer');
  ok(typeof s.seq.meta.dataVersion === 'string' && s.seq.meta.dataVersion.length > 0, 'data version fingerprint present');
  const wm = s.seq.worldModel;
  ok(wm && wm.drivers && wm.teams, 'world model seeded with drivers + teams');
  ok(Object.keys(wm.drivers).length === X.GRID, 'world model covers all drivers', Object.keys(wm.drivers).length);
  const maxEV = X.RACES.find(r => r.sprint);
  ok(maxEV, 'calendar contains a sprint event');
  const nf = X.flowFor(maxEV.id);
  ok(JSON.stringify(nf) === JSON.stringify(['sq', 'sprint', 'quali', 'race']), 'sprint flow order');
  ok(JSON.stringify(X.flowFor(X.RACES.find(r => !r.sprint).id)) === JSON.stringify(['quali', 'race']), 'normal flow order');
}

/* 2. state machine ordering ------------------------------------------------ */
group('2. state machine');
{
  const s = newState();
  const ev = X.RACES[0].id;
  const ws0 = X.weekendStateOf(s, ev);
  ok(ws0.phase === 'PRE-WEEKEND', 'phase pre-weekend at start', ws0.phase);
  ok(ws0.nextSession === 'quali', 'first session to predict is quali', ws0.nextSession);

  const quali = resPayload({});
  X.ingestResult(s, ev, 'quali', quali);
  const ws1 = X.weekendStateOf(s, ev);
  ok(ws1.phase === 'IN-WEEKEND', 'phase in-weekend after quali', ws1.phase);
  ok(ws1.nextSession === 'race', 'next session is race after quali', ws1.nextSession);
  ok(X.nextSessionToPredict(s, ev) === 'race', 'nextSessionToPredict matches');

  const race = resPayload({});
  X.ingestResult(s, ev, 'race', race);
  const ws2 = X.weekendStateOf(s, ev);
  ok(ws2.phase === 'POST-WEEKEND', 'phase post-weekend after race', ws2.phase);
  ok(ws2.nextSession === null, 'no session remains after race', ws2.nextSession);
}

/* 3. prediction locking immutability ---------------------------------------- */
group('3. locking / immutability');
{
  const s = newState();
  const ev = X.RACES[0].id;
  const locked = X.ensurePredictionLocked(s, ev, 'quali');
  ok(locked && locked.status === 'LOCKED', 'next session locked');
  const again = X.ensurePredictionLocked(s, ev, 'quali');
  ok(again === locked, 'locking is idempotent');
  ok(X.getLockedPrediction(s, ev, 'quali') === locked, 'ledger returns locked object');

  const blocked = X.ensurePredictionLocked(s, ev, 'race');
  ok(blocked === null, 'cannot lock a non-next session (race before quali)');

  /* immutability: mutating the DRAFT prediction must not corrupt the locked snapshot */
  const s2 = newState();
  const ev2 = X.RACES[0].id;
  const draft = X.seqPredictSession(s2, ev2, 'quali');
  const draftOrder = draft.order.slice();
  const draftConf = draft.confidence;
  const wmVals = s2.seq.worldModel.drivers[draft.order[0]].racePace.value;
  const locked2 = X.lockPrediction(s2, ev2, 'quali', draft);
  draft.order.reverse();
  draft.confidence = 99;
  draft.signals.rating = null;
  s2.seq.worldModel.drivers[locked2.prediction.order[0]].racePace.value = 0;
  ok(locked2.prediction.order.join(',') === draftOrder.join(','), 'locked order snapshot immune to draft mutation');
  ok(locked2.confidence === draftConf, 'locked confidence immune to draft mutation', locked2.confidence + ' vs ' + draftConf);
  ok(locked2.signals === undefined && locked2.inputsSnapshot.weights && locked2.inputsSnapshot.worldModel, 'inputs snapshot (weights + world model) recorded');
  ok(locked2.inputsSnapshot.worldModel.drivers[locked2.prediction.order[0]].racePace.value === wmVals,
    'locked world-model snapshot immune to later state mutation');
  ok(locked2.modelVersion != null && locked2.dataVersion != null, 'model + data versions frozen at lock time', locked2.modelVersion + '/' + locked2.dataVersion);
}

/* 3b. versions frozen at lock time ------------------------------------------- */
group('3b. version freeze');
{
  const s = newState();
  const ev = X.RACES[3].id;
  const draft = X.seqPredictSession(s, ev, 'quali');
  const locked = X.lockPrediction(s, ev, 'quali', draft);
  const mv = locked.modelVersion, dv = locked.dataVersion;
  X.ingestResult(s, ev, 'quali', resPayload({})); /* bumps model version */
  ok(s.seq.meta.modelVersion !== mv, 'model version advanced by result');
  const stored = X.getLockedPrediction(s, ev, 'quali');
  ok(stored.modelVersion === mv && stored.dataVersion === dv, 'ledger keeps versions from lock time', mv + '/' + dv);
}

/* 4. temporal integrity / leakage ------------------------------------------- */
group('4. temporal integrity');
{
  const s = newState();
  const ev = X.RACES[1].id;
  X.ingestResult(s, ev, 'quali', resPayload({}));
  const view = X.availableView(s, ev, 'race');
  ok(view.weekends[ev] && view.weekends[ev].quali, 'quali visible to race prediction');
  ok(!(view.weekends[ev] && view.weekends[ev].race), 'race result NOT visible to race prediction (no leakage)');
  const viewQ = X.availableView(s, ev, 'quali');
  ok(!(viewQ.weekends[ev] && viewQ.weekends[ev].quali), 'quali result invisible to quali prediction');
}

/* 5. reliability-weighted evidence ------------------------------------------- */
group('5. evidence weighting');
{
  const s = newState();
  const d = X.DRIVERS[0].id;
  const before = s.seq.worldModel.drivers[d].qualiPace.value;
  X.addObservation(s, { subject: d, feature: 'qualiPace', observedValue: 1, reliability: 1, notes: 'test' });
  const afterHigh = s.seq.worldModel.drivers[d].qualiPace.value;
  const s2 = newState();
  X.addObservation(s2, { subject: d, feature: 'qualiPace', observedValue: 1, reliability: 0.05, notes: 'test' });
  const afterLow = s2.seq.worldModel.drivers[d].qualiPace.value;
  ok(Math.abs(afterHigh - before) > Math.abs(afterLow - before),
    'high-reliability evidence moves belief more than low-reliability',
    'high ' + (afterHigh - before).toFixed(4) + ' vs low ' + (afterLow - before).toFixed(4));
  ok(afterHigh > before && afterLow > before, 'positive evidence raises belief in both cases');
  const ev = s.seq.evidence[0];
  ok(ev && ev.observedValue === 1 && ev.reliability === 1, 'observation appended to ledger');
}

/* 6. result ingestion + world-model learning --------------------------------- */
group('6. result ingestion');
{
  const s = newState();
  const ev = X.RACES[2].id;
  const d0 = X.DRIVERS[0].id;
  const paceBefore = s.seq.worldModel.drivers[d0].qualiPace.value;
  const rev = {};
  X.DRIVERS.forEach((d, i) => { rev[d.id] = X.GRID - i; });
  X.ingestResult(s, ev, 'quali', resPayload(rev));
  ok(s.weekends[ev] && s.weekends[ev].quali, 'quali stored in weekends');
  ok(s.seq.evidence.length > 0, 'result converted to observations');
  ok(s.seq.worldModel.drivers[d0].qualiPace.value < paceBefore, 'front-runner belief downgraded after poor quali', paceBefore + ' -> ' + s.seq.worldModel.drivers[d0].qualiPace.value);
  ok(s.seq.modelVersions.length >= 1 && s.seq.dataVersions.length >= 1, 'model + data versions recorded after result');
  const b = s.seq.worldModel.drivers[X.DRIVERS[0].id].qualiPace;
  ok(b.evidenceCount >= 1 && b.lastUpdate, 'belief records evidence count + timestamp');
  const cal = X.SeqAPI.calibration(s);
  ok(cal.bySession.quali && cal.bySession.quali.n >= 1, 'calibration bucket updated', JSON.stringify(cal.bySession));
}

/* 7. calibration metrics correctness ----------------------------------------- */
group('7. calibration');
{
  const s = newState();
  const ev = X.RACES[3].id;
  X.ingestResult(s, ev, 'quali', resPayload({}));
  const cal = X.SeqAPI.calibration(s);
  const q = cal.bySession.quali;
  ok(q.n === 1, 'one forecast scored');
  ok(q.mae != null && q.mae >= 0, 'MAE present', q.mae);
  ok(q.tau != null && q.tau >= -1 && q.tau <= 1, 'tau in range', q.tau);
  ok(q.brier != null && q.logloss != null, 'probabilistic scores present');
  ok(cal.overall.n === 1, 'overall rolled up');
  const evalEntry = X.SeqAPI.evaluation(s, ev, 'quali');
  ok(evalEntry && evalEntry.error && evalEntry.error.mae != null, 'evaluation record stored', evalEntry && evalEntry.error ? evalEntry.error.mae : 'none');
}

/* 8. reproducibility ---------------------------------------------------------- */
group('8. reproducibility');
{
  const s = newState();
  const ev = X.RACES[4].id;
  X.ingestResult(s, ev, 'quali', resPayload({}));
  const p1 = X.seqPredictSession(s, ev, 'race');
  const order1 = p1.order.join(',');
  /* bust the cache + force a re-derivation */
  s.seq.predCache = {};
  const p2 = X.seqPredictSession(s, ev, 'race');
  ok(order1 === p2.order.join(','), 'same seed -> same order', order1);
  ok(JSON.stringify(p1.winProbability) === JSON.stringify(p2.winProbability), 'same seed -> same win probabilities');
}

/* 9. session separation / sprint vs normal -------------------------------------- */
group('9. session separation');
{
  const sprintEv = X.RACES.find(r => r.sprint).id;
  const normalEv = X.RACES.find(r => !r.sprint).id;
  const s = newState();
  X.ingestResult(s, sprintEv, 'sq', resPayload({}));
  X.ingestResult(s, sprintEv, 'sprint', resPayload({}));
  const pQ = X.seqPredictSession(s, sprintEv, 'quali');
  ok(pQ.order.length === X.GRID, 'quali prediction covers full grid');
  ok(s.seq.evidence.filter(e => e.eventId === sprintEv).length >= 2 * X.GRID, 'sq + sprint both produced evidence');
  const pR = X.seqPredictSession(s, sprintEv, 'race');
  ok(pR.order.length === X.GRID, 'sprint-weekend race prediction works');
  const pN = X.seqPredictSession(s, normalEv, 'race');
  ok(pN.order.length === X.GRID, 'normal-weekend race prediction works');
}

/* 10. weekend-flow completeness ------------------------------------------------ */
group('10. flow completeness');
{
  const s = newState();
  const ev = X.RACES[5].id;
  X.ingestResult(s, ev, 'quali', resPayload({}));
  X.ingestResult(s, ev, 'race', resPayload({}));
  const ws = X.weekendStateOf(s, ev);
  ok(ws.completed.indexOf('quali') >= 0 && ws.completed.indexOf('race') >= 0, 'completed sessions tracked');
  ok(ws.phase === 'POST-WEEKEND', 'full weekend resolves to POST-WEEKEND');
}

/* 11. backend-level API mirroring ---------------------------------------------- */
group('11. SeqAPI surface');
{
  const s = newState();
  const ev = X.RACES.find(r => !r.sprint).id;
  ok(typeof X.SeqAPI.weekendState === 'function', 'weekendState route');
  ok(typeof X.SeqAPI.predict === 'function', 'predict route');
  ok(typeof X.SeqAPI.ingestResult === 'function', 'ingestResult route');
  ok(typeof X.SeqAPI.forecastNext === 'function', 'forecastNext route');
  const pr = X.SeqAPI.predictNext(s, ev);
  ok(pr && pr.session === X.flowFor(ev)[0], 'predictNext returns next session prediction', pr && pr.session);
  ok(typeof X.SeqAPI.calibration === 'function' && X.SeqAPI.calibration(s).overall, 'calibration route');
  ok(typeof X.SeqAPI.worldModel === 'function', 'worldModel route');
  ok(typeof X.SeqAPI.modelHistory === 'function', 'modelHistory route');
}

/* 12. engine.js contract preserved ----------------------------------------------- */
group('12. legacy contract');
{
  const s = X.defaultState();
  const ev = X.RACES[7].id;
  const p = X.predictSession(s, ev, 'race');
  ok(Array.isArray(p.order) && p.order.length === X.GRID, 'predictSession returns full order');
  ok(typeof p.confidence === 'number', 'predictSession returns confidence');
  X.weekendOf(s, ev).quali = posMap({});
  const fb = X.applyResult(s, ev, 'quali');
  ok(fb && typeof fb.message === 'string', 'applyResult feedback contract');
  ok(s.seq && s.seq.evidence.length > 0, 'applyResult triggers seq learning (seqAfterResult hook)');
}

/* report ------------------------------------------------------------------- */
console.log('\n' + ('-'.repeat(46)));
console.log('PASS ' + passed + '  FAIL ' + failed);
if (failed) {
  console.log('failures:');
  fails.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
