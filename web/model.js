/**
 * Washout Check 0.1.2-alpha. Original, generic mass-action model.
 * All drug inventories are nM-equivalents per fixed assay volume; time is hours.
 * No fitted or compound-specific parameters. See methods.html.
 */
export const VERSION = '0.1.2-alpha';
export const DEFAULTS = Object.freeze({
  free0: 10, kd: 1, koff: 1, receptor: 0.2, partition: 5,
  release: 0.15, residual: 0.01, duration: 24, washes: [0]
});
export const PRESETS = {
  retention: {...DEFAULTS},
  residual: {...DEFAULTS, free0: 100, partition: 0, receptor: 0.02, residual: 0.05},
  rebinding: {...DEFAULTS, receptor: 10, partition: 0, residual: 0},
  sinklike: {...DEFAULTS, receptor: 0.001, partition: 0, residual: 0},
  repeated: {...DEFAULTS, washes: [0, 0.5, 2, 6]}
};
export function validate(input) {
  const p = {};
  const bounds = {
    free0: [0, 1000], kd: [0.001, 1000], koff: [0.001, 20],
    receptor: [0.0001, 100], partition: [0, 100],
    release: [0.001, 20], residual: [0, 1], duration: [0.1, 168]
  };
  for (const [key, [lo, hi]] of Object.entries(bounds)) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) ||
        input[key] < lo || input[key] > hi)
      throw new Error(`${key} must be a finite number from ${lo} to ${hi}.`);
    p[key] = input[key];
  }
  if (!Array.isArray(input.washes) || input.washes.length < 1 || input.washes.length > 25 ||
      input.washes[0] !== 0 || input.washes.some((t, i, a) =>
        typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > p.duration || (i && t <= a[i - 1])))
    throw new Error('Wash times must start at 0, increase strictly, and lie within the observation window (maximum 25).');
  p.washes = [...input.washes];
  return p;
}
// F, B, S, free AUC, occupancy AUC. W (removed inventory) is updated at events.
export function derivative(y, p, partition) {
  const binding = p.koff / p.kd * y[0] * (p.receptor - y[1]) - p.koff * y[1];
  const transfer = partition * p.release * y[0] - p.release * y[2];
  return [-binding - transfer, binding, transfer, y[0], y[1] / p.receptor];
}
function rk4(y, h, p, q) {
  const add = (a, b, c) => a.map((v, i) => v + c * b[i]);
  const a = derivative(y, p, q);
  const b = derivative(add(y, a, h / 2), p, q);
  const c = derivative(add(y, b, h / 2), p, q);
  const d = derivative(add(y, c, h), p, q);
  return y.map((v, i) => v + h / 6 * (a[i] + 2 * b[i] + 2 * c[i] + d[i]));
}
export function validateLoading(loading = {mode: 'equilibrium'}) {
  if (!loading || typeof loading !== 'object' || Array.isArray(loading) ||
      !['equilibrium', 'finite-clamped', 'finite-dose', 'dose-equilibrium'].includes(loading.mode))
    throw new Error('Unknown loading mode.');
  const closed = ['finite-dose','dose-equilibrium'].includes(loading.mode);
  if (Object.keys(loading).some(k => !(closed?['mode','duration','dose']:['mode','duration']).includes(k)))
    throw new Error('Unknown loading option.');
  const finite = ['finite-clamped','finite-dose'].includes(loading.mode);
  const maxDuration = closed ? 168 : 1e6;
  if (finite && (typeof loading.duration !== 'number' || !Number.isFinite(loading.duration) ||
      loading.duration < 0 || loading.duration > maxDuration))
    throw new Error(`Finite loading duration must be a finite number from 0 to ${maxDuration} hours.`);
  if (!finite && loading.duration !== undefined)
    throw new Error('Equilibrium loading does not take a duration.');
  if (closed && (typeof loading.dose !== 'number' || !Number.isFinite(loading.dose) || loading.dose<0 || loading.dose>1000))
    throw new Error('Finite dose must be a finite number from 0 to 1000 nM-equivalent.');
  return {mode:loading.mode,...(finite?{duration:loading.duration}:{}),...(closed?{dose:loading.dose}:{})};
}
/** Positive root of M=(1+Q)F+RF/(KD+F), evaluated without cancellation. */
export function doseEquilibrium(input, dose, q = input.partition) {
  const p=validate(input);
  validateLoading({mode:'dose-equilibrium',dose});
  if(!Number.isFinite(q)||q<0||q>100)throw new Error('Invalid reservoir ratio.');
  if(dose===0)return {free:0,bound:0,retained:0,total:0};
  const a=1+q,b=a*p.kd+p.receptor-dose;
  const discriminant=Math.sqrt(b*b+4*a*dose*p.kd);
  const free=b>=0?2*dose*p.kd/(b+discriminant):(discriminant-b)/(2*a);
  return {free,bound:p.receptor*free/(p.kd+free),retained:q*free,total:dose};
}
/** Closed, initially unbound bolus. Loading AUC is separate from washout AUC. */
export function integrateDoseLoading(input, dose, duration, q, options={}) {
  const p=validate(input);
  validateLoading({mode:'finite-dose',dose,duration});
  if(!Number.isFinite(q)||q<0||q>100)throw new Error('Invalid reservoir ratio.');
  const tolerance=options.tolerance??1e-8,samples=options.samples??400;
  if(!(tolerance>0&&tolerance<=1e-3)||!Number.isInteger(samples)||samples<2||samples>10000)
    throw new Error('Invalid numerical options.');
  let y=[dose,0,0,0,0],t=0,h=Math.min(.02,duration/100),steps=0,rejected=0,maxMassError=0;
  const points=[];
  const record=()=>{
    maxMassError=Math.max(maxMassError,Math.abs(y[0]+y[1]+y[2]-dose));
    points.push({t,event:t===0?'dose added':'loading sample',free:y[0],bound:y[1],retained:y[2],
      removed:0,occupancy:y[1]/p.receptor,freeAuc:y[3],occupancyAuc:y[4]});
  };
  record();
  if(duration>0)for(let i=1;i<=samples;i++){
    const target=duration*i/samples;
    while(target-t>1e-12*Math.max(1,target)){
      if(++steps>200000)throw new Error('Finite-dose loading is too stiff for this preview. Reduce rates or loading duration.');
      const rate=p.koff/p.kd*(Math.max(0,y[0])+p.receptor)+p.koff+(q+1)*p.release;
      h=Math.min(h,target-t,.5/rate);
      const full=rk4(y,h,p,q),half=rk4(rk4(y,h/2,p,q),h/2,p,q);
      const err=Math.max(...half.map((v,j)=>Math.abs(v-full[j])/(15*tolerance*(1+Math.max(Math.abs(v),Math.abs(y[j]))))));
      const valid=half.every(Number.isFinite)&&half.slice(0,3).every(v=>v>=0)&&half[1]<=p.receptor;
      if(valid&&err<=1){
        y=half;t+=h;h*=err===0?2:Math.min(2,Math.max(.3,.9*err**-.2));
      }else{
        rejected++;h*=.5;
        if(h<1e-14)throw new Error('Finite-dose loading step became too small.');
      }
    }
    t=target;record();
  }
  return {points,endpoint:points.at(-1),diagnostics:{maxMassError,
    relativeMassError:maxMassError/Math.max(1,dose),steps,rejected,tolerance}};
}
/** Loading boundary is explicit: assumed free equilibrium, clamped bath, or fixed dose. */
export function initializeLoading(input, mode = 'retention', loading = {mode: 'equilibrium'}, options={}) {
  const p = validate(input);
  if (!['sink', 'complete', 'residual', 'retention'].includes(mode)) throw new Error('Unknown mechanism.');
  loading=validateLoading(loading);
  const finite = loading.mode === 'finite-clamped';
  const q = mode === 'retention' ? p.partition : 0;
  if(['finite-dose','dose-equilibrium'].includes(loading.mode)){
    const equilibrium=doseEquilibrium(p,loading.dose,q);
    const loadingTrace=loading.mode==='finite-dose'
      ? integrateDoseLoading(p,loading.dose,loading.duration,q,options):null;
    const state=loadingTrace?.endpoint??equilibrium;
    return {prewash:{free:state.free,bound:state.bound,retained:state.retained,total:loading.dose},
      loadingTrace,
      loading:{mode:loading.mode,duration:loading.duration??null,dose:loading.dose,
        initialSitesAndReservoirEmpty:loadingTrace?true:null,freeConcentration:null,
        initialFreeConcentration:loading.dose,initialBathInventory:loading.dose,netReplenishment:0,
        equilibriumFree:equilibrium.free,equilibriumBound:equilibrium.bound,equilibriumRetained:equilibrium.retained}};
  }
  const equilibriumBound = p.receptor * p.free0 / (p.kd + p.free0);
  const equilibriumRetained = q * p.free0;
  const kobs = p.koff / p.kd * p.free0 + p.koff;
  // expm1 preserves precision for pulses much shorter than either filling time.
  const bound = equilibriumBound * (finite ? -Math.expm1(-kobs * loading.duration) : 1);
  const retained = equilibriumRetained * (finite ? -Math.expm1(-p.release * loading.duration) : 1);
  return {
    prewash: {free: p.free0, bound, retained, total: p.free0 + bound + retained},
    loading: {
      mode: loading.mode,
      duration: finite ? loading.duration : null,
      initialSitesAndReservoirEmpty: finite ? true : null,
      freeConcentration: p.free0,
      initialBathInventory: finite ? p.free0 : null,
      // nM-equivalent added by the source beyond the initial free bath.
      netReplenishment: finite ? bound + retained : null,
      equilibriumBound, equilibriumRetained
    }
  };
}
export function simulate(input, mode = 'retention', options = {}) {
  const p = validate(input);
  if (!['sink', 'complete', 'residual', 'retention'].includes(mode)) throw new Error('Unknown mechanism.');
  const state = initializeLoading(p, mode, options.loading, options);
  return simulatePrepared(p, mode, options, state);
}
// A validated loading state is read-only here. The three no-retention washout
// mechanisms share it in an audit; their loading equations are identical.
function simulatePrepared(p, mode, options, state) {
  const tolerance = options.tolerance ?? 1e-8;
  const samples = options.samples ?? 400;
  if (!(tolerance > 0 && tolerance <= 1e-3) || !Number.isInteger(samples) || samples < 2 || samples > 10000)
    throw new Error('Invalid numerical options.');
  const q = mode === 'retention' ? p.partition : 0;
  const {prewash, loading, loadingTrace=null} = state;
  const b0 = prewash.bound, s0 = prewash.retained, initial = prewash.total;
  let y = [prewash.free, b0, s0, 0, 0], t = 0, removed = 0, steps = 0, rejected = 0;
  let h = Math.min(0.02, p.duration / 100);
  let maxMassError = 0;
  const points = [];
  const record = (event) => {
    const massError = Math.abs(y[0] + y[1] + y[2] + removed - initial);
    maxMassError = Math.max(maxMassError, massError);
    points.push({t, event, free: y[0], bound: y[1], retained: y[2], removed,
      occupancy: y[1] / p.receptor, freeAuc: y[3], occupancyAuc: y[4]});
  };
  const grid = Array.from({length: samples + 1}, (_, i) => p.duration * i / samples);
  const stops = [...new Set([...grid, ...p.washes])].sort((a, b) => a - b);
  for (const target of stops) {
    if (mode === 'sink') {
      t = target;
      const decay = Math.exp(-p.koff * t);
      y = [0, b0 * decay, 0, 0, b0 / p.receptor * -Math.expm1(-p.koff * t) / p.koff];
      removed = initial - y[1];
    } else {
      while (target - t > 1e-12 * Math.max(1, target)) {
        if (++steps > 200000) throw new Error('These rates are too stiff for this preview. Reduce the kinetic range or observation window.');
        // Conservative rate bound prevents explicit-step instability at extreme concentrations.
        const rate = p.koff / p.kd * (Math.max(0, y[0]) + p.receptor) +
          p.koff + (q + 1) * p.release;
        h = Math.min(h, target - t, 0.5 / rate);
        const full = rk4(y, h, p, q);
        const half = rk4(rk4(y, h / 2, p, q), h / 2, p, q);
        const err = Math.max(...half.map((v, i) =>
          Math.abs(v - full[i]) / (15 * tolerance * (1 + Math.max(Math.abs(v), Math.abs(y[i]))))));
        const valid = half.every(Number.isFinite) && half.slice(0, 3).every(v => v >= 0) &&
          half[1] <= p.receptor;
        if (valid && err <= 1) {
          y = half; t += h;
          h *= err === 0 ? 2 : Math.min(2, Math.max(0.3, 0.9 * err ** -0.2));
        } else {
          rejected++;
          h *= 0.5;
          if (h < 1e-14) throw new Error('Numerical step became too small. Adjust the parameters.');
        }
      }
      t = target;
    }
    if (p.washes.includes(target) && mode !== 'sink') {
      if (target > 0) record('before wash');
      const fraction = mode === 'complete' ? 0 : p.residual;
      removed += (1 - fraction) * y[0];
      y[0] *= fraction;
      record('after wash');
    } else record(target === 0 ? 'sink initiated' : 'sample');
  }
  return {mode, parameters: p, loading, loadingTrace, prewash, points,
    diagnostics: {maxMassError, relativeMassError: maxMassError / Math.max(1, initial), steps, rejected, tolerance},
    endpoint: points.at(-1)};
}
export function loadingSummary(input, loading, suppliedState=null) {
  const p = validate(input);
  const state = suppliedState ?? initializeLoading(p, 'retention', loading);
  const l = state.loading;
  if(l.mode==='finite-dose')return {
    boundary:'closed-dose',freeFractionRemaining:l.dose>0?state.prewash.free/l.dose:null,
    prewashOccupancy:state.prewash.bound/p.receptor,
    equilibriumFree:l.equilibriumFree,equilibriumBound:l.equilibriumBound,
    equilibriumRetained:l.equilibriumRetained,
    bindingTimeTo95:null,retentionTimeTo95:null,
    note:'Coupled depletion can produce nonmonotonic binding. Clamped-bath filling clocks do not apply.'
  };
  return {
    boundFractionOfEquilibrium: l.equilibriumBound > 0 ? state.prewash.bound / l.equilibriumBound : null,
    retainedFractionOfEquilibrium: l.equilibriumRetained > 0 ? state.prewash.retained / l.equilibriumRetained : null,
    bindingTimeTo95: p.free0 > 0 ? Math.log(20) / (p.koff / p.kd * p.free0 + p.koff) : null,
    retentionTimeTo95: p.partition > 0 && p.free0 > 0 ? Math.log(20) / p.release : null,
    // 95% is an explicit mathematical reference, not an assay acceptance threshold.
    thresholdFraction: 0.95
  };
}
export function runAudit(input, options = {}) {
  const parameters = validate(input);
  const loading=validateLoading(options.loading);
  if(loading.mode==='dose-equilibrium')throw new Error('Dose equilibrium is a reference, not a selectable audit loading mode.');
  const finite = loading.mode !== 'equilibrium',closed=loading.mode==='finite-dose';
  const sharedLoading = closed ? initializeLoading(parameters, 'residual', loading) : null;
  const scenarios = ['sink', 'complete', 'residual', 'retention'].map(mode =>
    sharedLoading && mode !== 'retention'
      ? simulatePrepared(parameters, mode, {loading}, sharedLoading)
      : simulate(parameters, mode, {loading}));
  const equilibriumScenarios = finite
    ? ['sink', 'complete', 'residual', 'retention'].map(mode => simulate(parameters, mode,
      closed?{loading:{mode:'dose-equilibrium',dose:loading.dose}}:{}))
    : scenarios;
  const clampedScenarios=closed?['sink','complete','residual','retention'].map(mode=>
    simulate({...parameters,free0:loading.dose},mode,{loading:{mode:'finite-clamped',duration:loading.duration}})):null;
  return {version: VERSION, schema: 'washout-check/3', synthetic: true,
    units: {time: 'h', inventory: 'nM-equivalent per fixed assay volume', freeAuc: 'nM h', occupancyAuc: 'h'},
    assumptions: [closed?'Finite dose: initially all drug free; binding and retention share a closed conserved inventory':
      finite ? 'Finite loading: initially empty bound/retained pools; external source clamps free concentration' :
      'Prewash equilibrium at specified free concentration', 'Instantaneous well-mixed washes at constant restored volume',
      'Fixed accessible target capacity', 'One reversible binding site; no turnover or pharmacodynamics',
      'Linear exchange reservoir, not an identified organelle', 'Synthetic parameters; not fitted or experimentally validated',
      closed?'Selected mechanisms and dose-equilibrium references match total starting dose, not prewash free concentration or occupancy; clamped counterfactual is not dose matched':
        'Loading comparisons match free concentration, not total dose',
      'Postwash AUC excludes loading; loadingTrace AUC covers loading only'],
    parameters, loading, loadingSummary: loadingSummary(parameters, loading,scenarios[3]),
    scenarios, equilibriumScenarios, clampedScenarios};
}
