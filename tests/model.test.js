import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS, PRESETS, derivative, simulate, runAudit, validate} from '../web/model.js';
import {WORKER_SOURCE} from '../web/worker-source.js';
import {runInNewContext} from 'node:vm';
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
test('sink matches exponential and analytic occupancy AUC',()=>{
  const s=simulate(DEFAULTS,'sink'),p=DEFAULTS,b0=p.free0/(p.free0+p.kd);
  for(const r of s.points){near(r.occupancy,b0*Math.exp(-p.koff*r.t),1e-12);near(r.free,0);}
  near(s.endpoint.occupancyAuc,b0*(1-Math.exp(-p.koff*p.duration))/p.koff,1e-12);
});
test('all presets conserve mass, stay nonnegative and respect target capacity',()=>{
  for(const p of Object.values(PRESETS))for(const s of runAudit(p).scenarios){
    assert.ok(s.diagnostics.relativeMassError<1e-9);
    for(const r of s.points){assert.ok(r.free>=0&&r.bound>=0&&r.retained>=0&&r.removed>=0);assert.ok(r.bound<=p.receptor);}
  }
});
test('zero ligand stays zero in every mechanism',()=>{
  for(const s of runAudit({...DEFAULTS,free0:0}).scenarios)
    for(const r of s.points) for(const k of ['free','bound','retained','removed','freeAuc','occupancyAuc']) near(r[k],0,0);
});
test('no removal preserves prewash equilibrium with retention',()=>{
  const s=simulate({...DEFAULTS,residual:1},'retention');
  for(const r of s.points){near(r.free,s.prewash.free);near(r.bound,s.prewash.bound);near(r.retained,s.prewash.retained);}
});
test('Q=0 makes retention and residual curves identical',()=>{
  const p={...DEFAULTS,partition:0};
  assert.deepEqual(simulate(p,'retention').points,simulate(p,'residual').points);
});
test('f=0 makes complete and residual curves identical',()=>{
  const p={...DEFAULTS,residual:0};
  assert.deepEqual(simulate(p,'complete').points,simulate(p,'residual').points);
});
test('only the free pool is diluted at wash events',()=>{
  const p={...DEFAULTS,washes:[0,0.123,2,24]},s=simulate(p,'retention');
  for(let i=0;i<s.points.length;i++){
    const a=s.points[i],b=s.points[i+1];
    if(a.event==='before wash'){assert.equal(a.t,b.t);near(b.free,p.residual*a.free,1e-12);near(a.bound,b.bound,0);near(a.retained,b.retained,0);near(b.removed-a.removed,(1-p.residual)*a.free);}
  }
});
test('time zero output follows the first wash and retains prewash metadata',()=>{
  const s=simulate(DEFAULTS,'retention');
  near(s.points[0].free,DEFAULTS.free0*DEFAULTS.residual);
  near(s.prewash.total,s.prewash.free+s.prewash.bound+s.prewash.retained);
});
test('later wash does not reset cumulative exposure',()=>{
  const s=simulate(PRESETS.repeated,'retention');
  for(let i=1;i<s.points.length;i++){
    assert.ok(s.points[i].freeAuc>=s.points[i-1].freeAuc);
    assert.ok(s.points[i].occupancyAuc>=s.points[i-1].occupancyAuc);
  }
});
test('reservoir prewash inventory changes total, not initial occupancy',()=>{
  const [a,b,c,d]=runAudit(DEFAULTS).scenarios;
  near(d.prewash.bound,c.prewash.bound,0);
  near(d.prewash.total-c.prewash.total,DEFAULTS.partition*DEFAULTS.free0);
});
test('vanishing target inventory approximates sink after complete exchange',()=>{
  const p={...PRESETS.sinklike,receptor:.0001},a=simulate(p,'complete'),b=simulate(p,'sink');
  a.points.forEach((r,i)=>near(r.occupancy,b.points[i].occupancy,0.0001));
});
test('tightened tolerance agrees with default',()=>{
  const a=simulate(PRESETS.repeated,'retention'),b=simulate(PRESETS.repeated,'retention',{tolerance:1e-10});
  a.points.forEach((r,i)=>{near(r.free,b.points[i].free,2e-6);near(r.occupancy,b.points[i].occupancy,2e-6);});
});
test('derivative has zero net inventory flux',()=>{
  const d=derivative([3,.1,8,0,0],DEFAULTS,5);near(d[0]+d[1]+d[2],0,1e-14);
});
test('isolated exchange analytic relaxation is reproduced',()=>{
  // Tiny binding inventory isolates a linear two-pool relaxation.
  const p={...DEFAULTS,receptor:.0001,partition:5,residual:0};
  const s=simulate(p,'retention'),total=p.partition*p.free0,rate=(p.partition+1)*p.release;
  for(const r of s.points)near(r.free,total/(p.partition+1)*(1-Math.exp(-rate*r.t)),.0002);
});
test('run schema serializes and revalidates',()=>{
  const r=JSON.parse(JSON.stringify(runAudit(DEFAULTS)));
  assert.equal(r.schema,'washout-check/3');assert.deepEqual(validate(r.parameters),DEFAULTS);
});
test('invalid times, ranges, nonfinite values, types and modes are rejected',()=>{
  for(const washes of [[],[1],[0,0],[0,-1],[0,25],[0,NaN],[0,'2'],[0,2,1]])assert.throws(()=>validate({...DEFAULTS,washes}));
  for(const kd of [0,-1,NaN,Infinity,'1',null])assert.throws(()=>validate({...DEFAULTS,kd}));
  assert.throws(()=>simulate(DEFAULTS,'invalid'));
  assert.throws(()=>simulate(DEFAULTS,'retention',{samples:0}));
  assert.throws(()=>simulate(DEFAULTS,'retention',{tolerance:0}));
});
test('multiple washes decrease terminal free exposure versus one wash in preset',()=>{
  const a=simulate(PRESETS.repeated),b=simulate(DEFAULTS);
  assert.ok(a.endpoint.freeAuc<b.endpoint.freeAuc);
  assert.ok(a.endpoint.occupancy<b.endpoint.occupancy);
});
test('default demonstrates persistence at unchanged intrinsic off-rate',()=>{
  const r=runAudit(DEFAULTS);
  assert.ok(r.scenarios[3].endpoint.occupancy>0.5);
  assert.ok(r.scenarios[0].endpoint.occupancy<1e-8);
  assert.equal(r.scenarios[3].parameters.koff,r.scenarios[0].parameters.koff);
});
test('packaged browser worker produces exactly the tested engine output',()=>{
  let result;
  const self={postMessage:x=>{result=x;}};
  runInNewContext(WORKER_SOURCE,{self});
  self.onmessage({data:DEFAULTS});
  assert.equal(result.error,undefined);
  assert.equal(JSON.stringify(result.result),JSON.stringify(runAudit(DEFAULTS)));
});
