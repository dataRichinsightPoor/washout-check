import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {DEFAULTS,VERSION,simulate,runAudit,doseEquilibrium,integrateDoseLoading,validateLoading} from '../web/model.js';
import {normalizeSettings,settingsFromRun,settingsFromScenario,scenarioPayload,runToCsv} from '../web/serialization.js';
import {WORKER_SOURCE} from '../web/worker-source.js';
const near=(a,b,tol=1e-7)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const loading={mode:'finite-dose',dose:1,duration:8};
const modes=['sink','complete','residual','retention'];
// Independent fixed-step midpoint reference: use conservation to eliminate free drug.
function reference(p,dose,time,q){
  let b=0,s=0;const steps=100000,h=time/steps;
  const rhs=(b,s)=>{const f=dose-b-s;return [p.koff/p.kd*f*(p.receptor-b)-p.koff*b,q*p.release*f-p.release*s];};
  for(let i=0;i<steps;i++){const a=rhs(b,s),m=rhs(b+h*a[0]/2,s+h*a[1]/2);b+=h*m[0];s+=h*m[1];}
  return [dose-b-s,b,s];
}
test('closed-dose loading agrees with an independent reduced-system integrator',()=>{
  for(const p of [DEFAULTS,{...DEFAULTS,receptor:3,partition:2,koff:.2}]){
    const r=integrateDoseLoading(p,1,8,p.partition).endpoint,ref=reference(p,1,8,p.partition);
    [r.free,r.bound,r.retained].forEach((v,i)=>near(v,ref[i],2e-7));
  }
});
test('dose equilibrium closes mass and satisfies both zero-flux relations',()=>{
  for(const dose of [0,.001,1,1000])for(const q of [0,5,100]){
    const e=doseEquilibrium(DEFAULTS,dose,q);
    near(e.free+e.bound+e.retained,dose,1e-9);
    near(e.retained,q*e.free);
    near(DEFAULTS.koff/DEFAULTS.kd*e.free*(DEFAULTS.receptor-e.bound),DEFAULTS.koff*e.bound);
    assert.ok(e.free>=0&&e.free<=dose&&e.bound<=DEFAULTS.receptor);
  }
});
test('long closed loading approaches its dose equilibrium, not nominal-free equilibrium',()=>{
  const r=integrateDoseLoading(DEFAULTS,1,80,5).endpoint,e=doseEquilibrium(DEFAULTS,1);
  for(const k of ['free','bound','retained'])near(r[k],e[k],2e-7);
  assert.ok(e.free<.2);
});
test('zero duration retains the initial free dose and zero preload',()=>{
  for(const mode of modes){
    const s=simulate(DEFAULTS,mode,{loading:{...loading,duration:0}});
    assert.equal(s.prewash.free,1);assert.equal(s.prewash.bound,0);assert.equal(s.prewash.retained,0);
    assert.equal(s.loadingTrace.points.length,1);assert.equal(s.loadingTrace.endpoint.freeAuc,0);
    if(['sink','complete'].includes(mode))assert.equal(s.endpoint.occupancy,0);
    else assert.ok(s.endpoint.occupancy>0);
  }
});
test('zero dose remains zero throughout both phases and references',()=>{
  const r=runAudit(DEFAULTS,{loading:{...loading,dose:0}});
  for(const s of [...r.scenarios,...r.equilibriumScenarios,...r.clampedScenarios])
    for(const pt of [...s.points,...(s.loadingTrace?.points??[])])
      for(const k of ['free','bound','retained','occupancy','freeAuc','occupancyAuc'])assert.equal(pt[k],0);
});
test('every mechanism shares total dose while retention changes the prewash distribution',()=>{
  const r=runAudit(DEFAULTS,{loading});
  for(const s of r.scenarios){assert.equal(s.prewash.total,1);assert.equal(s.loading.netReplenishment,0);}
  assert.ok(r.scenarios[3].prewash.bound<r.scenarios[2].prewash.bound);
  assert.ok(r.scenarios[3].endpoint.occupancy>r.scenarios[2].endpoint.occupancy);
});
test('closed loading conserves mass, respects capacity, and hands off exactly to washout',()=>{
  for(const mode of modes){
    const s=simulate({...DEFAULTS,washes:[0,.37,2]},mode,{loading});
    for(const pt of s.loadingTrace.points){
      near(pt.free+pt.bound+pt.retained,1,1e-10);
      assert.ok(pt.free>=0&&pt.bound>=0&&pt.bound<=DEFAULTS.receptor&&pt.retained>=0);
    }
    for(const pt of s.points)near(pt.free+pt.bound+pt.retained+pt.removed,1,1e-10);
    near(s.points[0].bound,s.loadingTrace.endpoint.bound);
    near(s.points[0].retained,s.loadingTrace.endpoint.retained);
    const f=mode==='sink'||mode==='complete'?0:DEFAULTS.residual;
    near(s.points[0].free,f*s.prewash.free);
    assert.equal(s.points[0].freeAuc,0);assert.equal(s.points[0].occupancyAuc,0);
  }
});
test('loading trajectories can overshoot equilibrium binding without violating mass balance',()=>{
  const s=simulate(DEFAULTS,'retention',{loading});
  const peak=Math.max(...s.loadingTrace.points.map(p=>p.bound));
  assert.ok(peak>2*s.loading.equilibriumBound);
  assert.ok(s.prewash.bound<peak);
});
test('tightened tolerance preserves finite-dose loading and washout outputs',()=>{
  const a=simulate(DEFAULTS,'retention',{loading}),b=simulate(DEFAULTS,'retention',{loading,tolerance:1e-10});
  for(const k of ['free','bound','retained'])near(a.prewash[k],b.prewash[k],2e-7);
  near(a.endpoint.freeAuc,b.endpoint.freeAuc,2e-6);
});
test('clamped counterfactual shares initial free concentration and time, but supplies more drug',()=>{
  const r=runAudit(DEFAULTS,{loading});
  for(const s of r.clampedScenarios){
    assert.equal(s.parameters.free0,1);assert.equal(s.loading.duration,8);
    near(s.prewash.total,1+s.loading.netReplenishment);
    assert.ok(s.prewash.total>1);
  }
  assert.equal(r.clampedScenarios[3].parameters.koff,r.scenarios[3].parameters.koff);
});
test('finite-dose JSON and scenario links preserve dose and loading mode',()=>{
  const r=runAudit(DEFAULTS,{loading}),settings=normalizeSettings(DEFAULTS,loading);
  assert.deepEqual(settingsFromRun(JSON.parse(JSON.stringify(r))),settings);
  assert.deepEqual(settingsFromScenario(JSON.parse(JSON.stringify(scenarioPayload(settings)))),settings);
  assert.throws(()=>settingsFromRun({...r,schema:'washout-check/2',version:'0.1.1-alpha'}));
  const legacy={schema:'washout-check/2',version:'0.1.1-alpha',parameters:DEFAULTS,loading:{mode:'finite-clamped',duration:1}};
  assert.equal(settingsFromRun(legacy).loading.mode,'finite-clamped');
});
test('CSV distinguishes loading and postwash phases and both reference types',()=>{
  const csv=runToCsv(runAudit(DEFAULTS,{loading}));
  assert.ok(csv.includes('\"selected\",\"loading\"'));
  assert.ok(csv.includes('\"selected\",\"postwash\"'));
  assert.ok(csv.includes('\"equilibrium-reference\",\"postwash\"'));
  assert.ok(csv.includes('\"clamped-counterfactual\",\"postwash\"'));
  assert.ok(csv.includes('\"initialDose_nMeq\"'));
});
test('invalid dose, duration and contradictory boundaries are rejected without integration',()=>{
  for(const dose of [-1,1001,NaN,null,'1'])assert.throws(()=>validateLoading({...loading,dose}));
  assert.throws(()=>validateLoading({...loading,duration:169}));
  assert.throws(()=>validateLoading({mode:'finite-clamped',duration:1,dose:1}));
  assert.throws(()=>normalizeSettings(DEFAULTS,{mode:'dose-equilibrium',dose:1}));
  assert.throws(()=>settingsFromRun({schema:'washout-check/3',version:VERSION,parameters:DEFAULTS,loading:{mode:'finite-dose',duration:1}}));
});
test('packaged worker computes the same finite-dose audit',()=>{
  let response;const self={postMessage:r=>{response=r;}};
  runInNewContext(WORKER_SOURCE,{self});self.onmessage({data:{parameters:DEFAULTS,loading}});
  assert.equal(response.error,undefined);
  assert.equal(JSON.stringify(response.result),JSON.stringify(runAudit(DEFAULTS,{loading})));
});
test('shared nonretention loading reproduces independently run mechanisms exactly',()=>{
  const r=runAudit(DEFAULTS,{loading});
  for(const s of r.scenarios)assert.deepEqual(s,simulate(DEFAULTS,s.mode,{loading}));
  assert.equal(r.scenarios[0].loadingTrace,r.scenarios[1].loadingTrace);
  assert.equal(r.scenarios[1].loadingTrace,r.scenarios[2].loadingTrace);
  assert.notEqual(r.scenarios[2].loadingTrace,r.scenarios[3].loadingTrace);
});
test('article worked values agree with the reproducible synthetic audit',()=>{
  const r=runAudit(DEFAULTS,{loading}),a=r.scenarios[2],b=r.scenarios[3],c=r.clampedScenarios[3];
  near(a.prewash.bound/DEFAULTS.receptor,.4750621423,1e-8);
  near(b.prewash.bound/DEFAULTS.receptor,.1421973780,1e-8);
  near(a.endpoint.occupancy,.08079984116,1e-8);
  near(b.endpoint.occupancy,.11948654073,1e-8);
  near(c.endpoint.occupancy,.37040578196,1e-8);
  near(c.prewash.total,4.59402892919,1e-8);
  const peak=b.loadingTrace.points.reduce((best,p)=>p.occupancy>best.occupancy?p:best);
  near(peak.occupancy,.31046888550,1e-8);near(peak.t,1.06,1e-12);
  near(a.endpoint.freeAuc,2.04564701608,1e-7);
  near(b.endpoint.freeAuc,3.11595135037,1e-7);
  near(c.endpoint.freeAuc,13.51157669531,1e-7);
});
test('equilibrium reservoir sensitivity matches the article derivative',()=>{
  const q=5,delta=1e-4,F=doseEquilibrium(DEFAULTS,1,q).free;
  const numerical=(doseEquilibrium(DEFAULTS,1,q+delta).free-doseEquilibrium(DEFAULTS,1,q-delta).free)/(2*delta);
  const analytical=-F/(1+q+DEFAULTS.receptor*DEFAULTS.kd/(DEFAULTS.kd+F)**2);
  near(numerical,analytical,1e-10);assert.ok(analytical<0);
});
test('article late endpoints agree with equilibrium of the inventory surviving the wash',()=>{
  const r=runAudit(DEFAULTS,{loading});
  for(const i of [2,3]){
    const s=r.scenarios[i],remaining=s.prewash.total-(1-DEFAULTS.residual)*s.prewash.free;
    const e=doseEquilibrium(DEFAULTS,remaining,i===3?DEFAULTS.partition:0);
    near(s.endpoint.occupancy,e.bound/DEFAULTS.receptor,1e-7);
    near(s.points[0].free+s.points[0].bound+s.points[0].retained,remaining,1e-12);
  }
});
test('article whole-protocol AUC ranking differs from the postwash ranking',()=>{
  const r=runAudit(DEFAULTS,{loading}),a=r.scenarios[2],b=r.scenarios[3];
  const total=(s,key)=>s.loadingTrace.endpoint[key]+s.endpoint[key];
  near(total(a,'freeAuc'),9.331734720677488,1e-7);
  near(total(b,'freeAuc'),5.294454539732304,1e-7);
  near(total(a,'occupancyAuc'),5.828802897822255,1e-7);
  near(total(b,'occupancyAuc'),4.355588404957004,1e-7);
  for(const key of ['freeAuc','occupancyAuc']){
    assert.ok(b.endpoint[key]>a.endpoint[key]);
    assert.ok(total(b,key)<total(a,key));
  }
});
test('larger retention ratio can lower late occupancy in the fixed-dose article case',()=>{
  const a=simulate({...DEFAULTS,partition:0},'retention',{loading});
  const b=simulate({...DEFAULTS,partition:5},'retention',{loading});
  const c=simulate({...DEFAULTS,partition:20},'retention',{loading});
  near(c.endpoint.occupancy,.04304751813982368,1e-8);
  assert.ok(b.endpoint.occupancy>a.endpoint.occupancy);
  assert.ok(c.endpoint.occupancy<a.endpoint.occupancy);
});
