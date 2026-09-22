import {DEFAULTS, PRESETS, VERSION} from './model.js';
import {WORKER_SOURCE} from './worker-source.js';
import {normalizeSettings, settingsFromRun, settingsFromScenario, scenarioPayload, runToCsv} from './serialization.js';
const $ = id => document.getElementById(id);
const names = {sink:'Ideal sink', complete:'Complete exchange', residual:'Residual medium', retention:'Residual + retention'};
const colors = () => document.documentElement.dataset.theme === 'dark'
  ? ['#adbbc6','#76a7e6','#ebba75','#7dd5ca'] : ['#526472','#295caf','#95591c','#14695e'];
const dash = [[8,5],[2,4],[10,4],[]];
let result, worker, workerURL, dirty = true;
function stopWorker() {
  worker?.terminate();worker=null;
  if(workerURL)URL.revokeObjectURL(workerURL);
  workerURL=null;
}
const fmt = (n, d=3) => Number.isFinite(n) ? Number(n.toPrecision(d)).toString() : '—';
const status = (text, error=false) => { $('status').textContent=text; $('status').className=error?'error':''; };
function markDirty() {
  dirty = true; stopWorker();
  document.querySelectorAll('.export').forEach(b=>b.disabled=true);
  $('share-box').hidden=true;
  status('Inputs changed. Run again; displayed curves belong to the previous run.');
}
function syncLoading() {
  const closed=$('loadingMode').value==='finite-dose',finite=$('loadingMode').value!=='equilibrium';
  $('loading-duration-wrap').hidden=!finite;$('loadingDuration').disabled=!finite;
  $('dose-wrap').hidden=!closed;$('dose').disabled=!closed;
  $('free-wrap').hidden=closed;$('free0').disabled=closed;
  $('loadingDuration').max=closed?168:1000000;
  $('loading-help').textContent=closed
    ? 'No source, no wash, no loss during loading. Free drug can fall as binding and retention redistribute the finite dose. Maximum loading window: 168 h.'
    : 'Initially empty sites and reservoir. An external source replenishes free drug during loading; this is not a fixed-dose pulse.';
}
function fill(p, loading={mode:'equilibrium'}) {
  for (const k of Object.keys(DEFAULTS)) $(k).value = k==='washes'?p[k].join(', '):k==='residual'?100*p[k]:p[k];
  $('loadingMode').value=loading.mode;$('loadingDuration').value=loading.duration??1;$('dose').value=loading.dose??1;syncLoading();
  markDirty();
}
function read() {
  const p={};
  for(const k of Object.keys(DEFAULTS)) {
    // In closed-dose mode this control has no physical role. A stale blank or
    // invalid clamped-bath entry must not block an otherwise valid dose run.
    if(k==='free0'&&$('loadingMode').value==='finite-dose'){p[k]=DEFAULTS.free0;continue;}
    const v=$(k).value.trim();
    if(!v) throw new Error(`${k} cannot be blank.`);
    p[k]=k==='washes'?v.split(',').map(s=>s.trim()===''?NaN:Number(s)):Number(v);
  }
  p.residual/=100;
  const loading={mode:$('loadingMode').value};
  if(loading.mode!=='equilibrium') {
    if(!$('loadingDuration').value.trim())throw new Error('Loading duration cannot be blank.');
    loading.duration=Number($('loadingDuration').value);
  }
  if(loading.mode==='finite-dose'){
    if(!$('dose').value.trim())throw new Error('Finite dose cannot be blank.');
    loading.dose=Number($('dose').value);
  }
  return normalizeSettings(p,loading);
}
function run() {
  markDirty();
  let p;
  try { p=read(); } catch(e) {status(e.message,true);return;}
  status('Computing the selected loading condition and equilibrium reference…');
  workerURL=URL.createObjectURL(new Blob([WORKER_SOURCE],{type:'application/javascript'}));
  worker=new Worker(workerURL);
  worker.onmessage=({data})=>{
    if(data.error){status(data.error,true);stopWorker();return;}
    result=data.result;dirty=false;
    document.querySelectorAll('.export').forEach(b=>b.disabled=false);
    status('Audit complete. Inputs and displayed results match.');
    render();stopWorker();
  };
  worker.onerror=()=>{status('The calculation could not start. Reload the page and retry.',true);stopWorker();};
  worker.postMessage(p);
}
function render() {
  const p=result.parameters;
  const closed=result.loading.mode==='finite-dose';
  for(const v of ['loading','loadingOccupancy'])$('view').querySelector(`[value="${v}"]`).disabled=!closed;
  if(!closed&&$('view').value.startsWith('loading'))$('view').value='occupancy';
  if(!closed)$('reference').value='equilibrium';
  const [sink,complete,residual,retention]=result.scenarios;
  $('metrics').innerHTML=[
    [fmt(Math.log(2)/p.koff)+' h','Intrinsic dissociation half-life'],
    [fmt(retention.endpoint.occupancy*100)+'%','Retention-case occupancy at '+fmt(p.duration)+' h'],
    [fmt(retention.endpoint.freeAuc),'Retention-case free AUC · nM·h']
  ].map(([v,l])=>`<div class="metric"><strong>${v}</strong><span>${l}</span></div>`).join('');
  const excess=(retention.endpoint.occupancy-sink.endpoint.occupancy)*100;
  $('interpretation').textContent=`At ${fmt(p.duration)} h, the retention scenario has ${fmt(excess)} percentage points more target occupancy than the ideal sink, despite the same intrinsic k_off (${fmt(p.koff)} h⁻¹). The initial retention inventory is ${fmt(retention.prewash.retained)} nM-equivalent; total prewash inventory is ${fmt(retention.prewash.total)} versus ${fmt(residual.prewash.total)} without retention. `+(closed
    ? `Here the dose is matched. Retention reallocates that dose rather than adding drug: prewash occupancy is ${fmt(100*retention.prewash.bound/p.receptor)}% with retention versus ${fmt(100*residual.prewash.bound/p.receptor)}% without it.`
    : 'This comparison matches prewash free concentration, not total dose.');
  const all=[...result.scenarios,...result.equilibriumScenarios,...(result.clampedScenarios??[])];
  const error=Math.max(...all.flatMap(s=>[s.diagnostics.relativeMassError,s.loadingTrace?.diagnostics.relativeMassError??0]));
  $('diagnostics').textContent=`Numerical audit: maximum mass-closure error ${error.toExponential(2)} relative to max(1 nM, initial inventory). Adaptive RK4 with step doubling; tolerance 10⁻⁸. No curve fitting. Version ${VERSION}.`;
  renderLoading();draw();inspect();
}
function comparisonPair() {
  const mode=$('compareMode').value;
  const reference=result.loading.mode==='finite-dose'&&$('reference').value==='clamped'
    ?result.clampedScenarios:result.equilibriumScenarios;
  return [result.scenarios.find(s=>s.mode===mode),reference.find(s=>s.mode===mode)];
}
function referenceName(){
  return result.loading.mode==='finite-dose'
    ?($('reference').value==='clamped'?'Clamped counterfactual':'Dose-matched equilibrium'):'Equilibrium reference';
}
function renderLoading() {
  if(!result)return;
  const finite=result.loading.mode==='finite-clamped',summary=result.loadingSummary;
  const closed=result.loading.mode==='finite-dose',[a,b]=comparisonPair(),clamped=closed&&$('reference').value==='clamped';
  $('loading-title').textContent=closed?'A reservoir is not an extra dose.':'Binding can be ready before the reservoir.';
  $('loading-context').textContent=closed
    ? `${fmt(result.loading.dose)} nM-equivalent initially free, loaded for ${fmt(result.loading.duration)} h without replenishment. All four mechanisms start with the same total dose; prewash free drug and occupancy need not match. The loading plot and table follow the selected mechanism.`
    : finite
    ? `${fmt(result.loading.duration,5)} h loading at clamped ${fmt(result.parameters.free0)} nM free drug. Binding sites and the reservoir start empty. Free concentration is replenished during loading, then the source is removed before washing.`
    : 'Equilibrium is assumed, not established by a loading simulation. Select finite loading or load the one-hour case to test the effect of incomplete filling.';
  $('loading-readiness').innerHTML=closed?[
    ['Prewash free drug',fmt(a.prewash.free,5)+' nM',result.loading.dose>0?fmt(100*a.prewash.free/result.loading.dose,4)+'% of initial dose remains free.':'Zero initial dose.'],
    ['Prewash target occupancy',fmt(100*a.prewash.bound/result.parameters.receptor,5)+'%',`Retained inventory: ${fmt(a.prewash.retained,5)} nM-equivalent.`]
  ].map(([label,value,note])=>`<div><span>${label}</span><strong>${value}</strong><p class="hint">${note}</p></div>`).join(''):[
    ['Target binding',summary.boundFractionOfEquilibrium,summary.bindingTimeTo95],
    ['Retention pool',summary.retainedFractionOfEquilibrium,summary.retentionTimeTo95]
  ].map(([label,fraction,t95])=>`<div><span>${label}</span><strong>${fraction===null?'Not applicable':fmt(100*fraction,6)+'%'}</strong>
    <p class="hint">${fraction===null?'No nonzero equilibrium inventory.':'of its own equilibrium inventory'}</p>
    ${fraction===null?'':`<progress max="1" value="${fraction}" aria-label="${label} fraction of equilibrium"></progress>`}
    <p class="hint">Time to 95%: ${t95===null?'not applicable':fmt(t95,4)+' h'}</p></div>`).join('');
  const delta=(a.endpoint.occupancy-b.endpoint.occupancy)*100;
  $('loading-caption').textContent=`${names[a.mode]}: selected loading versus ${referenceName().toLowerCase()}`;
  $('reference-heading').textContent=closed&&$('reference').value==='clamped'?'Clamped bath':referenceName();
  const rows=[
    ['Prewash free · nM',a.prewash.free,b.prewash.free],
    ['Prewash bound · nM-eq',a.prewash.bound,b.prewash.bound],
    ['Prewash retained · nM-eq',a.prewash.retained,b.prewash.retained],
    ['Prewash total · nM-eq',a.prewash.total,b.prewash.total],
    ['Net replenishment during loading · nM-eq',a.loading.netReplenishment,b.loading.netReplenishment],
    [`Occupancy at ${fmt(result.parameters.duration)} h · %`,100*a.endpoint.occupancy,100*b.endpoint.occupancy],
    ['Postwash free AUC · nM·h',a.endpoint.freeAuc,b.endpoint.freeAuc],
    ['Postwash occupancy AUC · h',a.endpoint.occupancyAuc,b.endpoint.occupancyAuc]
  ];
  $('loading-comparison').innerHTML=rows.map(([label,x,y])=>`<tr><td>${label}</td><td>${x===null?'Not specified':fmt(x,5)}</td><td>${y===null?'Not specified':fmt(y,5)}</td></tr>`).join('');
  $('loading-consequence').textContent=closed
    ? `Final occupancy changes by ${fmt(delta,4)} percentage points versus ${referenceName().toLowerCase()}. `+(clamped
      ?'The counterfactual holds free drug at the initial dose concentration for the same duration and adds drug to do so. It is not dose matched.'
      :'Both conditions contain the same total drug before washing. The reference is the conserved-dose equilibrium, not the assumption that nominal dose stayed free.')
    :finite
    ? `For ${names[a.mode].toLowerCase()}, finite loading changes final occupancy by ${fmt(delta,4)} percentage points versus assumed equilibrium. The intrinsic off-rate is unchanged. These conditions match free concentration, not total supplied drug.`
    : 'The selected state and reference coincide because both assume equilibrium. Their agreement is a boundary-condition identity, not evidence that an experimental incubation equilibrated.';
  $('clock-note').textContent=closed
    ? 'Binding can rise and then fall during closed loading. A first crossing of 95% is not proof of equilibration; clamped-bath filling times do not apply. Loading AUC and postwash AUC are separate.'
    : '95% is a mathematical filling reference, not an experimentally validated acceptance threshold. Postwash AUC begins at the first wash.';
}
function nearest(s,t) {
  // Last point at or before t, so event-aligned inspection uses postwash values.
  let answer=s.points[0];for(const pt of s.points){if(pt.t>t+1e-9)break;answer=pt;}return answer;
}
function inspect() {
  if(!result)return;
  const loadingView=$('view').value.startsWith('loading'),loadingOccupancy=$('view').value==='loadingOccupancy';
  const t=Number($('inspect').value)/400*(loadingView?result.loading.duration:result.parameters.duration);
  $('time-label').textContent=fmt(t,4)+' h';
  const comparison=$('view').value==='comparison';
  const scenarios=loadingOccupancy?[result.scenarios[2],result.scenarios[3]]:loadingView?[comparisonPair()[0]]:comparison?comparisonPair():result.scenarios;
  $('inspection-caption').textContent=loadingView?'Loading phase only: time since dose addition; loading AUC resets at the first wash.':'Postwash phase: values after any wash at the selected time.';
  $('inspection').innerHTML=scenarios.map((s,i)=>{
    const label=loadingOccupancy?(i?'With retention':'No retention'):comparison?(i?referenceName():'Selected loading'):names[s.mode];
    const r=nearest(loadingView?s.loadingTrace:s,t);return `<tr><td>${label}</td><td>${fmt(r.occupancy*100,4)}%</td><td>${fmt(r.free,4)}</td><td>${fmt(r.freeAuc,4)}</td></tr>`;
  }).join('');
  draw();
}
function chartConfig() {
  const view=$('view').value, cs=colors();
  if(view==='loadingOccupancy'){
    return {title:'Loading · target occupancy %',max:100,xMax:result.loading.duration||1,loading:true,
      series:[result.scenarios[2],result.scenarios[3]].map((s,i)=>({name:i?'With retention':'No retention',
        color:cs[i?3:1],dash:i?[]:[8,5],points:s.loadingTrace.points.map(pt=>[pt.t,100*pt.occupancy])})),
      note:'Same initial total dose, target capacity and binding kinetics. Retention competes for free drug during loading; occupancy can peak and then decline while incubation continues. No washes occur in this panel.'+
        (result.loading.duration===0?' Zero loading time: only the initial point is defined.':'')};
  }
  if(view==='loading'){
    const s=comparisonPair()[0];
    return {title:'Finite-dose loading · nM-equivalent',max:Math.max(1e-6,result.loading.dose),
      xMax:result.loading.duration||1,loading:true,
      series:['free','bound','retained'].map((key,i)=>({name:['Free F','Target-bound B','Retained S'][i],
        color:cs[i===2?3:i],dash:dash[i],points:s.loadingTrace.points.map(pt=>[pt.t,pt[key]])})),
      note:`${names[s.mode]}. Before the first wash: F + B + S = ${fmt(result.loading.dose)} nM-equivalent. No replenishment. Time starts at dose addition; washout begins only after ${fmt(result.loading.duration)} h. `+
        (result.loading.duration===0?'Zero-duration loading has one initial point; the 0–1 h axis is display-only.':'')};
  }
  if(view==='comparison') {
    const [a,b]=comparisonPair();
    return {title:'Loading comparison · occupancy %',max:100,
      series:[{name:result.loading.mode!=='equilibrium'?`${fmt(result.loading.duration)} h loading`:'Selected equilibrium',color:cs[3],dash:[],points:a.points.map(p=>[p.t,p.occupancy*100])},
        {name:referenceName(),color:cs[2],dash:[8,5],points:b.points.map(p=>[p.t,p.occupancy*100])}],
      note:`${names[a.mode]}. Same binding kinetics and wash protocol. Total prewash inventory: ${fmt(a.prewash.total,5)} versus ${fmt(b.prewash.total,5)} nM-equivalent. `+
        (result.loading.mode==='finite-dose'&&$('reference').value==='equilibrium'?'Dose matched, not prewash free-concentration matched.':'Not dose matched.')};
  }
  if(view==='inventory'){
    const s=result.scenarios[3],keys=['free','bound','retained','removed'];
    return {title:'Retention-case inventory · nM-equivalent',max:Math.max(1e-6,s.prewash.total),
      series:keys.map((k,i)=>({name:['Free F','Bound B','Retained S','Removed W'][i],color:cs[i],dash:dash[i],points:s.points.map(p=>[p.t,p[k]])})),
      note:`Inventory reference: ${fmt(s.prewash.total,5)} nM-equivalent before the first wash. F + B + S + W is conserved. A wash changes F and W, not B or S.`};
  }
  return {title:view==='occupancy'?'Target occupancy · %':'Extracellular free drug · nM',
    max:view==='occupancy'?100:Math.max(1e-6,...result.scenarios.flatMap(s=>s.points.map(p=>p.free)))*1.08,
    series:result.scenarios.map((s,i)=>({name:names[s.mode],color:cs[i],dash:dash[i],points:s.points.map(p=>[p.t,view==='occupancy'?p.occupancy*100:p.free])})),
    note:view==='occupancy'?'All four curves share K_D and k_off. Dashed vertical lines are wash times. A complete exchange removes free drug once; an ideal sink removes it continuously.':'Shown from immediately after the first wash. Retained and newly dissociated drug can replenish the free pool; a low residual percentage need not mean negligible free exposure.'};
}
function paint(canvas, config, exportMode=false) {
  const ctx=canvas.getContext('2d');
  const css=getComputedStyle(document.documentElement);
  const w=canvas.width,h=canvas.height,left=75,right=22,top=w<500?70:48,bottom=56;
  const pw=w-left-right,ph=h-top-bottom;
  const xMax=config.xMax??result.parameters.duration;
  const X=t=>left+t/xMax*pw,Y=v=>top+ph-v/config.max*ph;
  ctx.fillStyle=css.getPropertyValue('--surface');ctx.fillRect(0,0,w,h);
  ctx.font='16px "General Sans", sans-serif';ctx.fillStyle=css.getPropertyValue('--text');
  if(w<500) {
    let line='',y=24;
    for(const word of config.title.split(' ')) {
      const next=line?line+' '+word:word;
      if(line&&ctx.measureText(next).width>w-32){ctx.fillText(line,16,y);line=word;y+=20;}
      else line=next;
    }
    ctx.fillText(line,16,y);
  } else ctx.fillText(config.title,left,24);
  ctx.font='13px "General Sans", sans-serif';
  for(let i=0;i<=4;i++){
    const value=config.max*i/4,y=Y(value);
    ctx.strokeStyle=css.getPropertyValue('--line');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();
    ctx.fillStyle=css.getPropertyValue('--muted');ctx.textAlign='right';ctx.fillText(fmt(value),left-10,y+4);
    const t=xMax*i/4;
    ctx.textAlign='center';ctx.fillText(fmt(t),X(t),h-30);
  }
  ctx.fillText(config.loading?'Time since dose addition · h':'Time after first wash · h',left+pw/2,h-8);
  for(const t of config.loading?[]:result.parameters.washes){
    ctx.setLineDash([3,5]);ctx.strokeStyle=css.getPropertyValue('--muted');
    ctx.beginPath();ctx.moveTo(X(t),top);ctx.lineTo(X(t),top+ph);ctx.stroke();
  }
  ctx.save();ctx.beginPath();ctx.rect(left,top,pw,ph);ctx.clip();
  for(const s of config.series){
    ctx.strokeStyle=s.color;ctx.lineWidth=2.5;ctx.setLineDash(s.dash);ctx.beginPath();
    s.points.forEach(([t,v],i)=>i?ctx.lineTo(X(t),Y(v)):ctx.moveTo(X(t),Y(v)));ctx.stroke();
    if(s.points.length===1){ctx.fillStyle=s.color;ctx.beginPath();ctx.arc(X(s.points[0][0]),Y(s.points[0][1]),4,0,2*Math.PI);ctx.fill();}
  }
  ctx.restore();ctx.setLineDash([]);
  if(!exportMode) {
    const t=Number($('inspect').value)/400*(config.loading?result.loading.duration:xMax);
    ctx.strokeStyle=css.getPropertyValue('--text');ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X(t),top);ctx.lineTo(X(t),top+ph);ctx.stroke();
  }
}
function draw(){
  if(!result)return;
  const canvas=$('plot'), config=chartConfig();
  const width=Math.max(310,canvas.clientWidth);
  // Higher-resolution native canvas; CSS determines a mobile-specific aspect ratio.
  canvas.width=Math.round(width*2);canvas.height=Math.round(canvas.clientHeight*2);
  // Paint in logical pixels to keep typography legible on both viewports.
  const ctx=canvas.getContext('2d');ctx.scale(2,2);
  const proxy={width:canvas.width/2,height:canvas.height/2,getContext:()=>ctx};
  paint(proxy,config);
  $('legend').innerHTML=config.series.map(s=>`<span><i style="border-color:${s.color};border-top-style:${s.dash.length?'dashed':'solid'}"></i>${s.name}</span>`).join('');
  $('plot-note').textContent=config.note;
  $('comparison-choice').hidden=!['comparison','loading'].includes($('view').value);
  $('reference-wrap').hidden=result.loading.mode!=='finite-dose'||$('view').value!=='comparison';
}
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function exportFigure(){
  if(dirty)return;
  const config=chartConfig(),canvas=document.createElement('canvas');
  canvas.width=1400;canvas.height=1040;
  const ctx=canvas.getContext('2d'),css=getComputedStyle(document.documentElement);
  ctx.fillStyle=css.getPropertyValue('--surface');ctx.fillRect(0,0,1400,1040);
  ctx.fillStyle=css.getPropertyValue('--text');ctx.font='600 24px sans-serif';
  ctx.fillText('Washout Check · No. 03 | Data-Rich, Insight-Poor',55,42);
  ctx.font='16px sans-serif';ctx.fillText('99 Small Problems: Useful models for assumptions with expensive ambitions.',55,75);
  ctx.save();ctx.translate(0,105);
  paint({width:1400,height:640,getContext:()=>ctx},config,true);ctx.restore();
  ctx.font='16px sans-serif';
  config.series.forEach((s,i)=>{
    const x=55+i*335;
    ctx.strokeStyle=s.color;ctx.lineWidth=3;ctx.setLineDash(s.dash);
    ctx.beginPath();ctx.moveTo(x,779);ctx.lineTo(x+30,779);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=s.color;ctx.fillText(s.name,x+42,785);
  });
  ctx.fillStyle=css.getPropertyValue('--text');
  const p=result.parameters;
  const lines=[
    `Synthetic scenario, not a fit. v${VERSION}. Loading: ${result.loading.mode}${result.loading.duration===undefined?'':'; duration='+result.loading.duration+' h'}. Constant restored volume.`,
    `${result.loading.mode==='finite-dose'?'Initial dose='+result.loading.dose+' nM-eq':'F₀='+p.free0+' nM'}; K_D=${p.kd} nM; k_off=${p.koff} h⁻¹; target=${p.receptor} nM; Q=${p.partition}; release=${p.release} h⁻¹.`,
    `Residual=${p.residual*100}% per wash; wash times (h): ${p.washes.join(', ')}; follow-up=${p.duration} h.`,
    $('view').value==='loadingOccupancy'?'Before-wash occupancy: no retention versus retention, same initial total dose. Loading/postwash AUC are separate.':
      $('view').value==='comparison'?`Postwash comparison: ${names[$('compareMode').value]}; reference: ${referenceName()}. Loading/postwash AUC are separate.`:
      $('view').value==='loading'?`Before-wash inventory: ${names[$('compareMode').value]}. Loading/postwash AUC are separate.`:
      `View: ${$('view').value}. Loading/postwash AUC are separate.`,
    result.loading.mode==='finite-dose'?'Finite-dose loading conserves F+B+S. Its clamped counterfactual is replenished and NOT dose matched.':'Clamped free drug is replenished during finite loading. Not a fixed-dose or total-dose-matched experiment.',
    'Synthetic, well-mixed reversible pools. Occupancy is not functional recovery. Export JSON/CSV to reproduce.'
  ];
  lines.forEach((s,i)=>ctx.fillText(s,55,830+i*28,1290));
  canvas.toBlob(blob=>download(blob,`washout-check-${$('view').value}.png`),'image/png');
}
$('controls').addEventListener('submit',e=>{e.preventDefault();run();});
$('controls').addEventListener('input',markDirty);
$('load').onclick=()=>{
  const finite=$('preset').value==='finite',closed=$('preset').value==='dose';
  fill(finite||closed?DEFAULTS:PRESETS[$('preset').value],closed?{mode:'finite-dose',dose:1,duration:8}:finite?{mode:'finite-clamped',duration:1}:{mode:'equilibrium'});
  $('compareMode').value='retention';$('reference').value='equilibrium';
  $('view').value=closed?'loading':finite?'comparison':'occupancy';run();
};
$('reset').onclick=()=>{$('preset').value='retention';$('view').value='occupancy';$('compareMode').value='retention';fill(DEFAULTS);run();};
$('loadingMode').onchange=()=>{syncLoading();markDirty();};
$('view').onchange=inspect;$('inspect').oninput=inspect;
$('compareMode').onchange=()=>{renderLoading();inspect();};
$('reference').onchange=()=>{renderLoading();inspect();};
$('theme').onclick=()=>{const r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark';$('theme').textContent=r.dataset.theme==='dark'?'Light mode':'Dark mode';draw();};
$('json').onclick=()=>{if(!dirty)download(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),'washout-check-run.json');};
$('csv').onclick=()=>{
  if(dirty)return;
  download(new Blob([runToCsv(result)],{type:'text/csv'}),'washout-check-curves.csv');
};
$('png').onclick=exportFigure;
$('share').onclick=()=>{
  if(dirty)return;
  const url=new URL(location.href);url.hash='scenario='+encodeURIComponent(JSON.stringify(scenarioPayload(result)));
  $('share-url').value=url.href;$('share-box').hidden=false;$('share-url').select();
};
$('import').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>5e6)throw new Error('Import file is too large (maximum 5 MB).');
    const data=JSON.parse(await file.text());
    const settings=settingsFromRun(data);fill(settings.parameters,settings.loading);
    $('reference').value='equilibrium';$('view').value=settings.loading.mode!=='equilibrium'?'comparison':'occupancy';run();
  }catch(err){status('Import failed: '+err.message,true);}
  e.target.value='';
};
new ResizeObserver(()=>draw()).observe($('plot'));
let start=normalizeSettings(DEFAULTS);
try {
  if(location.hash.startsWith('#scenario=')) start=settingsFromScenario(JSON.parse(decodeURIComponent(location.hash.slice(10))));
  fill(start.parameters,start.loading);
  if(start.loading.mode!=='equilibrium')$('view').value='comparison';
  run();
} catch(e){fill(DEFAULTS);status('Scenario link rejected: '+e.message+' Reset to start a new run.',true);}
// Stable identifiers for interactive QA; no tracking or analytics.
document.querySelectorAll('[id]').forEach(el=>el.dataset.testid=el.id);
