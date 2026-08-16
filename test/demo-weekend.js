/* Sequential AI backend - simulated sprint weekend walkthrough.
   Simulates a full Dutch GP (Zandvoort) weekend through the sequential
   engine: pre-weekend forecast -> sq -> sprint -> quali -> race -> learning,
   printing the world-model response at every stage.
   Run: node test/demo-weekend.js  (or: npm run demo) */
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
  'this.__X = { defaultState, ensureSeqState, ingestResult, seqPredictSession, weekendStateOf, ' +
  'SeqAPI, DRIVERS, RACES, GRID, SESSIONS, mulberry32, driverById };', ctx);
const X = ctx.__X;

const EVENT = 'netherlands'; /* Dutch GP, Zandvoort - a sprint weekend */
const NAMES = id => X.driverById(id).short;

function rank(state, key) {
  return X.DRIVERS.map(d => ({ id: d.id, v: state.seq.worldModel.drivers[d.id][key].value }))
    .sort((a, b) => b.v - a.v);
}
function beliefRow(state) {
  return rank(state, 'racePace').slice(0, 6).map((r, i) => {
    const b = state.seq.worldModel.drivers[r.id].racePace;
    return (i + 1) + '. ' + NAMES(r.id) + ' ' + r.v.toFixed(3) +
      (b.weekendAdjustment ? ' (adj ' + b.weekendAdjustment.toFixed(3) + ')' : '');
  }).join('\n    ');
}
function header(txt) { console.log('\n' + '='.repeat(60) + '\n' + txt + '\n' + '='.repeat(60)); }
function topLine(pred, n) {
  return pred.order.slice(0, n).map((id, i) => (i + 1) + ' ' + NAMES(id)).join('  ');
}
function scoreOf(id) {
  const wm = state.seq.worldModel.drivers[id];
  return wm.racePace.value * 0.5 + wm.qualiPace.value * 0.3 + wm.sprintPace.value * 0.2;
}
function genResult(byId) {
  /* plausible finishing order: baseline belief + seeded noise */
  const rng = X.mulberry32(42);
  const noise = {};
  X.DRIVERS.forEach(d => { noise[d.id] = (rng() - 0.5) * 6; });
  const map = {};
  X.DRIVERS.slice().sort((a, b) => (scoreOf(b.id) - scoreOf(a.id)) + (noise[b.id] - noise[a.id])).forEach((d, i) => { map[d.id] = i + 1; });
  return { results: map, dnf: [], dns: [] };
}

/* build a fresh state + seed the sequential layer */
const state = X.defaultState();
X.ensureSeqState(state);

header('STAGE 0 - PRE-WEEKEND @ ' + EVENT.toUpperCase());
let ws = X.weekendStateOf(state, EVENT);
console.log('phase:      ' + ws.phase);
console.log('next:       ' + ws.nextSession);
console.log('flow:       ' + (X.RACES.find(r => r.id === EVENT).sprint ? 'sq -> sprint -> quali -> race' : 'quali -> race'));
console.log('dataVer:    ' + state.seq.meta.dataVersion.slice(0, 12) + '  modelVer: ' + state.seq.meta.modelVersion);
console.log('top pace beliefs:\n    ' + beliefRow(state));

/* 1. sprint quali --------------------------------------------------------- */
header('STAGE 1 - SPRINT QUALI (sq)');
const pSq = X.seqPredictSession(state, EVENT, 'sq');
console.log('prediction:  ' + topLine(pSq, 6));
console.log('confidence:  ' + pSq.confidence + '%');
console.log('assumptions: ' + pSq.assumptions.join(' | '));
console.log('uncertainty: ' + pSq.uncertainties.join(' | '));
const sqRes = genResult(state.seq.worldModel.drivers);
console.log('actual:      ' + Object.keys(sqRes.results).sort((a, b) => sqRes.results[a] - sqRes.results[b]).slice(0, 6).map((id, i) => (i + 1) + ' ' + NAMES(id)).join('  '));
const rSq = X.ingestResult(state, EVENT, 'sq', sqRes).report;
console.log('-> next: ' + rSq.nextSession + '  modelVer ' + rSq.modelVersion + '  mae? eval: ' + JSON.stringify({ mae: rSq.error ? Math.round(rSq.error * 100) / 100 : 'n/a' }));

/* 2. sprint race ---------------------------------------------------------- */
header('STAGE 2 - SPRINT RACE');
const pSp = X.seqPredictSession(state, EVENT, 'sprint');
console.log('prediction:  ' + topLine(pSp, 6) + '  (conf ' + pSp.confidence + '%)');
const spRes = genResult(state.seq.worldModel.drivers);
console.log('actual:      ' + Object.keys(spRes.results).sort((a, b) => spRes.results[a] - spRes.results[b]).slice(0, 6).map((id, i) => (i + 1) + ' ' + NAMES(id)).join('  '));
const rSp = X.ingestResult(state, EVENT, 'sprint', spRes).report;
console.log('-> next: ' + rSp.nextSession);
console.log('beliefs after sprint (world model responding):\n    ' + beliefRow(state));

/* 3. qualifying ----------------------------------------------------------- */
header('STAGE 3 - QUALIFYING');
const pQ = X.seqPredictSession(state, EVENT, 'quali');
console.log('prediction:  ' + topLine(pQ, 6) + '  (conf ' + pQ.confidence + '%)');
const qRes = genResult(state.seq.worldModel.drivers);
console.log('actual:      ' + Object.keys(qRes.results).sort((a, b) => qRes.results[a] - qRes.results[b]).slice(0, 6).map((id, i) => (i + 1) + ' ' + NAMES(id)).join('  '));
const rQ = X.ingestResult(state, EVENT, 'quali', qRes).report;
console.log('-> next: ' + rQ.nextSession);

/* 4. the grand prix ------------------------------------------------------- */
header('STAGE 4 - THE GRAND PRIX');
const pR = X.seqPredictSession(state, EVENT, 'race');
console.log('prediction:  ' + topLine(pR, 6) + '  (conf ' + pR.confidence + '%)');
const topWins = X.DRIVERS.slice().sort((a, b) => (pR.winProbability[b.id] || 0) - (pR.winProbability[a.id] || 0)).slice(0, 5);
console.log('win probs:   ' + topWins.map(d => NAMES(d.id) + ' ' + Math.round((pR.winProbability[d.id] || 0) * 1000) / 10 + '%').join('  '));
console.log('dnf probs:   ' + X.DRIVERS.slice().sort((a, b) => (pR.dnfProbability[b.id] || 0) - (pR.dnfProbability[a.id] || 0)).slice(0, 3).map(d => NAMES(d.id) + ' ' + Math.round((pR.dnfProbability[d.id] || 0) * 100) + '%').join('  '));
console.log('MC sims:     ' + (pR.simulation && pR.simulation.summary ? pR.simulation.summary.sims + ' sims x ' + pR.simulation.summary.laps + ' laps' : 'n/a'));
const rRes = genResult(state.seq.worldModel.drivers);
console.log('actual:      ' + Object.keys(rRes.results).sort((a, b) => rRes.results[a] - rRes.results[b]).slice(0, 6).map((id, i) => (i + 1) + ' ' + NAMES(id)).join('  '));
const rR = X.ingestResult(state, EVENT, 'race', rRes).report;

/* 5. post-weekend learning -------------------------------------------------- */
header('STAGE 5 - POST-WEEKEND');
ws = X.weekendStateOf(state, EVENT);
console.log('phase:       ' + ws.phase + '   completed: ' + ws.completed.join(' -> '));
const evalR = X.SeqAPI.evaluation(state, EVENT, 'race');
console.log('race eval:   MAE ' + evalR.error.mae + '  tau ' + evalR.error.tau + '  winnerCorrect ' + evalR.error.winnerCorrect);
const cal = X.SeqAPI.calibration(state);
console.log('calibration: overall n=' + cal.overall.n + ' mae=' + (cal.overall.mae != null ? cal.overall.mae.toFixed(2) : '–') +
  ' brier=' + (cal.overall.brier != null ? cal.overall.brier.toFixed(3) : '–'));
console.log('bySession:   ' + JSON.stringify(cal.bySession, null, 0));
console.log('outliers:    ' + (state.seq.outliers.length ? state.seq.outliers.map(o => NAMES(o.subject) + ' d' + Math.round(Math.abs(o.actual - o.expected))).join(', ') : 'none'));
console.log('lessons:     ' + (rR.lessons && rR.lessons.length ? rR.lessons.slice(0, 6).map(l => '[' + l.subject + ' ' + l.feature + '] ' + l.result).join(' | ') : '(none triggered)'));
console.log('beliefs:     (post-weekend, adjustments reset to 0)\n    ' + beliefRow(state));
console.log('dataVer:     ' + state.seq.meta.dataVersion.slice(0, 12) + '  modelVer: ' + state.seq.meta.modelVersion + '  evidence: ' + state.seq.evidence.length);
console.log('ledger:      ' + Object.keys(state.seq.predictionLedger).length + ' locked predictions, ' +
  (state.seq.predictionLedger[EVENT + ':race'] ? 'race LOCKED' : 'race MISSING'));

console.log('\nDone. The engine walked the whole weekend and learned from every session.');
