import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {DEFAULTS, initializeLoading, simulate} from '../web/model.js';
import {WORKER_SOURCE} from '../web/worker-source.js';

const near = (a, b, atol = 1e-8) =>
  assert.ok(Math.abs(a - b) <= atol, `${a} differs from ${b} by ${Math.abs(a - b)}`);
const finite = duration => ({loading: {mode: 'finite-clamped', duration}});
const modes = ['sink', 'complete', 'residual', 'retention'];

// Independent fixed-step RK4 reference for the LOADING ODEs only.
// It neither imports the production derivative nor evaluates its analytic formulas.
function integrateLoading(p, duration, q, steps = 20000) {
  let y = [0, 0];
  const h = duration / steps;
  const rhs = ([b, s]) => [
    p.koff / p.kd * p.free0 * (p.receptor - b) - p.koff * b,
    q * p.release * p.free0 - p.release * s
  ];
  const plus = (x, v, f) => x.map((a, i) => a + f * v[i]);
  for (let i = 0; i < steps; i++) {
    const a = rhs(y), b = rhs(plus(y, a, h/2));
    const c = rhs(plus(y, b, h/2)), d = rhs(plus(y, c, h));
    y = y.map((v, j) => v + h * (a[j] + 2*b[j] + 2*c[j] + d[j]) / 6);
  }
  return y;
}

test('omitted loading preserves the explicit equilibrium default exactly', () => {
  for (const mode of modes) {
    assert.deepEqual(simulate(DEFAULTS, mode),
      simulate(DEFAULTS, mode, {loading: {mode: 'equilibrium'}}));
    const {prewash} = initializeLoading(DEFAULTS, mode);
    near(prewash.bound, DEFAULTS.receptor * DEFAULTS.free0 / (DEFAULTS.kd + DEFAULTS.free0), 0);
    near(prewash.retained, mode === 'retention' ? DEFAULTS.partition * DEFAULTS.free0 : 0, 0);
  }
});

test('finite analytic loading agrees with independently integrated loading ODEs', () => {
  for (const p of [
    DEFAULTS,
    {...DEFAULTS, kd: 20, koff: 0.08, release: 2, partition: 0.2},
    {...DEFAULTS, free0: 0.03, receptor: 8, partition: 30, release: 0.005}
  ]) for (const duration of [0.001, 0.2, 3]) {
    const numerical = integrateLoading(p, duration, p.partition);
    const {prewash} = initializeLoading(p, 'retention', finite(duration).loading);
    near(prewash.bound, numerical[0], 1e-9);
    near(prewash.retained, numerical[1], 1e-8);
  }
});

test('zero-duration loading leaves binding sites and reservoir empty', () => {
  for (const mode of modes) {
    const {prewash, loading} = initializeLoading(DEFAULTS, mode, finite(0).loading);
    near(prewash.free, DEFAULTS.free0, 0);
    near(prewash.bound, 0, 0);
    near(prewash.retained, 0, 0);
    near(prewash.total, DEFAULTS.free0, 0);
    near(loading.netReplenishment, 0, 0);
  }
});

test('zero-duration loading followed by complete removal leaves no drug', () => {
  for (const mode of modes) {
    const r = simulate({...DEFAULTS, residual: 0}, mode, finite(0));
    for (const pt of r.points) {
      for (const k of ['free', 'bound', 'retained', 'occupancy', 'freeAuc', 'occupancyAuc'])
        near(pt[k], 0, 0);
      near(pt.removed, DEFAULTS.free0, 0);
    }
  }
});

test('zero-duration loading with residual medium can bind after the wash', () => {
  const r = simulate(DEFAULTS, 'residual', finite(0));
  near(r.points[0].bound, 0, 0);
  assert.ok(r.endpoint.occupancy > 0);
  // Prevent a misleading claim that zero loading means zero postwash exposure.
  near(r.points[0].free, DEFAULTS.residual * DEFAULTS.free0, 0);
});

test('one-hour pulse nearly equilibrates binding but not the slow reservoir', () => {
  const f = initializeLoading(DEFAULTS, 'retention', finite(1).loading);
  const e = initializeLoading(DEFAULTS, 'retention');
  assert.ok(f.prewash.bound / e.prewash.bound > 0.9999);
  assert.ok(f.prewash.retained / e.prewash.retained < 0.14);
  near(f.prewash.free, e.prewash.free, 0);
  assert.ok(f.prewash.total < e.prewash.total);
});

test('long loading converges to equilibrium prewash state and whole washout curves', () => {
  const p = {...DEFAULTS, washes: [0, 0.37, 2, 6]};
  for (const mode of modes) {
    const f = simulate(p, mode, finite(200));
    const e = simulate(p, mode);
    for (const key of ['free', 'bound', 'retained', 'total'])
      near(f.prewash[key], e.prewash[key], 1e-10);
    assert.equal(f.points.length, e.points.length);
    f.points.forEach((a, i) => {
      const b = e.points[i];
      near(a.t, b.t, 0); assert.equal(a.event, b.event);
      for (const key of ['free', 'bound', 'retained', 'removed', 'occupancy', 'freeAuc', 'occupancyAuc'])
        near(a[key], b[key], 1e-7);
    });
  }
});

test('shorter loading reduces retained inventory and persistence in the worked case', () => {
  const f = simulate(DEFAULTS, 'retention', finite(1));
  const e = simulate(DEFAULTS, 'retention');
  assert.equal(f.parameters.koff, e.parameters.koff);
  assert.ok(f.endpoint.occupancy < e.endpoint.occupancy);
  assert.ok(f.endpoint.freeAuc < e.endpoint.freeAuc);
  assert.ok(f.endpoint.occupancyAuc < e.endpoint.occupancyAuc);
});

test('bound and retained inventories increase monotonically toward their own equilibria', () => {
  let previous = {bound: 0, retained: 0};
  const e = initializeLoading(DEFAULTS, 'retention').prewash;
  for (const t of [0, 1e-12, 0.001, 0.1, 1, 10, 200]) {
    const {prewash} = initializeLoading(DEFAULTS, 'retention', finite(t).loading);
    for (const k of ['bound', 'retained']) {
      assert.ok(prewash[k] >= previous[k]);
      assert.ok(prewash[k] <= e[k]);
    }
    previous = prewash;
  }
});

test('very short loading has the correct linear uptake limit without cancellation', () => {
  const t = 1e-12;
  const {prewash} = initializeLoading(DEFAULTS, 'retention', finite(t).loading);
  const initialBindingFlux = DEFAULTS.koff / DEFAULTS.kd * DEFAULTS.free0 * DEFAULTS.receptor;
  const initialRetentionFlux = DEFAULTS.partition * DEFAULTS.release * DEFAULTS.free0;
  near(prewash.bound / t, initialBindingFlux, 1e-9);
  near(prewash.retained / t, initialRetentionFlux, 1e-9);
  assert.ok(prewash.bound > 0 && prewash.retained > 0);
});

test('clamped loading reports replenishment instead of claiming a fixed-dose pulse', () => {
  for (const mode of modes) {
    const {prewash, loading} = initializeLoading(DEFAULTS, mode, finite(1).loading);
    near(loading.initialBathInventory, DEFAULTS.free0, 0);
    near(loading.netReplenishment, prewash.bound + prewash.retained, 0);
    near(loading.initialBathInventory + loading.netReplenishment, prewash.total);
    assert.ok(loading.netReplenishment > 0);
  }
});

test('finite loading preserves mass, physical bounds, and exact wash boundaries', () => {
  const p = {...DEFAULTS, washes: [0, 0.123, 2, 24]};
  for (const duration of [0, 0.01, 1, 20]) for (const mode of modes) {
    const s = simulate(p, mode, finite(duration));
    assert.ok(s.diagnostics.relativeMassError < 1e-9);
    for (let i = 0; i < s.points.length; i++) {
      const a = s.points[i], b = s.points[i + 1];
      assert.ok(a.free >= 0 && a.bound >= 0 && a.bound <= p.receptor && a.retained >= 0);
      near(a.free + a.bound + a.retained + a.removed, s.prewash.total, 1e-8);
      if (a.event === 'before wash') {
        near(a.bound, b.bound, 0); near(a.retained, b.retained, 0);
        near(b.free, a.free * (mode === 'complete' ? 0 : p.residual), 0);
      }
    }
  }
});

test('finite loading preserves sink analytics and excludes loading from postwash AUC', () => {
  const r = simulate(DEFAULTS, 'sink', finite(1));
  const theta0 = r.prewash.bound / DEFAULTS.receptor;
  near(r.points[0].freeAuc, 0, 0);
  near(r.points[0].occupancyAuc, 0, 0);
  for (const pt of r.points) {
    near(pt.occupancy, theta0 * Math.exp(-DEFAULTS.koff * pt.t), 1e-12);
    near(pt.occupancyAuc, theta0 * (1 - Math.exp(-DEFAULTS.koff * pt.t)) / DEFAULTS.koff, 1e-12);
  }
});

test('finite loading preserves no-retention and zero-residual equivalences', () => {
  const options = finite(0.25);
  assert.deepEqual(
    simulate({...DEFAULTS, partition: 0}, 'retention', options).points,
    simulate({...DEFAULTS, partition: 0}, 'residual', options).points);
  assert.deepEqual(
    simulate({...DEFAULTS, residual: 0}, 'complete', options).points,
    simulate({...DEFAULTS, residual: 0}, 'residual', options).points);
});

test('zero loading concentration gives zero inventory at any loading duration', () => {
  for (const duration of [0, 0.01, 1000]) {
    const r = simulate({...DEFAULTS, free0: 0}, 'retention', finite(duration));
    near(r.prewash.total, 0, 0);
    near(r.loading.netReplenishment, 0, 0);
    near(r.endpoint.occupancy, 0, 0);
  }
});

test('finite-loading washout is stable under a tighter integration tolerance', () => {
  const a = simulate(DEFAULTS, 'retention', finite(0.1));
  const b = simulate(DEFAULTS, 'retention', {...finite(0.1), tolerance: 1e-10});
  a.points.forEach((pt, i) => {
    near(pt.occupancy, b.points[i].occupancy, 1e-6);
    near(pt.freeAuc, b.points[i].freeAuc, 1e-6);
  });
});

test('invalid or contradictory loading requests fail explicitly', () => {
  for (const loading of [null, [], {}, 'finite-clamped',
    {mode: 'closed-bolus', duration: 1}, {mode: 'equilibrium', duration: 1},
    {mode: 'finite-clamped'}, {mode: 'finite-clamped', duration: 1, unknown: true}]) {
    assert.throws(() => simulate(DEFAULTS, 'retention', {loading}));
  }
  for (const duration of [-1, NaN, Infinity, '1', null, 1000001]) {
    assert.throws(() => simulate(DEFAULTS, 'retention', finite(duration)));
  }
});

test('packaged engine includes the same finite-loading initialization and trajectories', () => {
  const sandbox = {self: {}};
  runInNewContext(WORKER_SOURCE, sandbox);
  const packed = runInNewContext(
    "simulate(DEFAULTS, 'retention', {loading:{mode:'finite-clamped',duration:1}})", sandbox);
  assert.equal(JSON.stringify(packed), JSON.stringify(simulate(DEFAULTS, 'retention', finite(1))));
});
