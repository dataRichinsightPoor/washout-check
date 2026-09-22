import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {DEFAULTS, VERSION, runAudit, simulate, loadingSummary} from '../web/model.js';
import {normalizeSettings, settingsFromRun, scenarioPayload, settingsFromScenario, runToCsv} from '../web/serialization.js';
import {WORKER_SOURCE} from '../web/worker-source.js';

const loading = {mode:'finite-clamped',duration:1};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('finite audit compares four selected mechanisms with their own equilibrium references',()=>{
  const r=runAudit(DEFAULTS,{loading});
  assert.equal(r.schema,'washout-check/3');
  assert.equal(r.version,VERSION);
  assert.deepEqual(r.loading,loading);
  for(let i=0;i<4;i++){
    const s=r.scenarios[i],e=r.equilibriumScenarios[i];
    assert.equal(s.mode,e.mode);
    assert.deepEqual(s,simulate(DEFAULTS,s.mode,{loading}));
    assert.deepEqual(e,simulate(DEFAULTS,e.mode));
  }
  assert.ok(r.scenarios[3].endpoint.occupancy<r.equilibriumScenarios[3].endpoint.occupancy);
});
test('equilibrium audit uses identical selected and reference states',()=>{
  const r=runAudit(DEFAULTS);
  assert.deepEqual(r.scenarios,r.equilibriumScenarios);
  assert.equal(r.loadingSummary.boundFractionOfEquilibrium,1);
  assert.equal(r.loadingSummary.retainedFractionOfEquilibrium,1);
});
test('the two filling clocks reach exactly the stated 95 percent reference',()=>{
  const s=loadingSummary(DEFAULTS,loading);
  near(s.bindingTimeTo95,Math.log(20)/11);
  near(s.retentionTimeTo95,Math.log(20)/0.15);
  near(loadingSummary(DEFAULTS,{...loading,duration:s.bindingTimeTo95}).boundFractionOfEquilibrium,.95);
  near(loadingSummary(DEFAULTS,{...loading,duration:s.retentionTimeTo95}).retainedFractionOfEquilibrium,.95);
});
test('zero inventory is not reported as a percentage of a nonexisting equilibrium',()=>{
  const zero=loadingSummary({...DEFAULTS,free0:0},loading);
  for(const key of ['boundFractionOfEquilibrium','retainedFractionOfEquilibrium','bindingTimeTo95','retentionTimeTo95'])
    assert.equal(zero[key],null);
  const noPool=loadingSummary({...DEFAULTS,partition:0},loading);
  assert.equal(noPool.retainedFractionOfEquilibrium,null);
  assert.equal(noPool.retentionTimeTo95,null);
  assert.ok(noPool.boundFractionOfEquilibrium>0);
});
test('finite and equilibrium JSON settings survive serialization and recomputation',()=>{
  for(const l of [loading,{mode:'finite-clamped',duration:0},{mode:'equilibrium'}]){
    const r=runAudit(DEFAULTS,{loading:l});
    const restored=settingsFromRun(JSON.parse(JSON.stringify(r)));
    assert.deepEqual(restored,normalizeSettings(DEFAULTS,l));
    assert.deepEqual(runAudit(restored.parameters,{loading:restored.loading}),r);
  }
});
test('legacy run imports mean equilibrium and never silently mean finite loading',()=>{
  const legacy={schema:'washout-check/1',version:'0.1.0-alpha',parameters:DEFAULTS};
  assert.deepEqual(settingsFromRun(legacy),normalizeSettings(DEFAULTS));
  assert.throws(()=>settingsFromRun({...legacy,loading}));
});
test('new run schemas reject missing loading, incompatible versions and invalid durations',()=>{
  const base={schema:'washout-check/3',version:VERSION,parameters:DEFAULTS};
  assert.throws(()=>settingsFromRun(base));
  assert.throws(()=>settingsFromRun({...base,version:'9.0',loading}));
  for(const duration of [-1,NaN,'1',null])
    assert.throws(()=>settingsFromRun({...base,loading:{...loading,duration}}));
});
test('import reads validated settings, not supplied cached trajectories',()=>{
  const r=runAudit(DEFAULTS,{loading});
  r.scenarios='untrusted cached data';
  assert.deepEqual(settingsFromRun(r),normalizeSettings(DEFAULTS,loading));
});
test('versioned scenario links preserve finite loading and legacy links retain equilibrium',()=>{
  const settings=normalizeSettings(DEFAULTS,loading);
  const encoded=encodeURIComponent(JSON.stringify(scenarioPayload(settings)));
  assert.deepEqual(settingsFromScenario(JSON.parse(decodeURIComponent(encoded))),settings);
  assert.deepEqual(settingsFromScenario(DEFAULTS),normalizeSettings(DEFAULTS));
  assert.throws(()=>settingsFromScenario({schema:'washout-check/scenario/2',parameters:DEFAULTS}));
  assert.throws(()=>settingsFromScenario({schema:'unknown'}));
});
test('CSV labels both loading conditions and carries source accounting on every row',()=>{
  const r=runAudit(DEFAULTS,{loading}),lines=runToCsv(r).split('\n');
  const parse=line=>line.slice(1,-1).split('","');
  const header=parse(lines[0]),rows=lines.slice(1).map(parse);
  const value=(row,key)=>row[header.indexOf(key)];
  assert.equal(rows.length,8*401);
  for(const row of rows){
    assert.equal(row.length,header.length);
    const finite=value(row,'comparisonRole')==='selected';
    assert.equal(value(row,'loadingMode'),finite?'finite-clamped':'equilibrium');
    assert.equal(value(row,'loadingDuration_h'),finite?'1':'');
    assert.equal(value(row,'koff'),'1');
    if(finite)near(Number(value(row,'loadingReplenishment_nMeq')),
      Number(value(row,'prewashBound_nMeq'))+Number(value(row,'prewashRetained_nMeq')));
    else assert.equal(value(row,'loadingReplenishment_nMeq'),'');
  }
  assert.equal(runToCsv(runAudit(DEFAULTS)).split('\n').length,4*401+1);
});
test('structured browser worker requests preserve finite loading and reference curves',()=>{
  let response;
  const self={postMessage:data=>{response=data;}};
  runInNewContext(WORKER_SOURCE,{self});
  self.onmessage({data:{parameters:DEFAULTS,loading}});
  assert.equal(response.error,undefined);
  assert.equal(JSON.stringify(response.result),JSON.stringify(runAudit(DEFAULTS,{loading})));
});
