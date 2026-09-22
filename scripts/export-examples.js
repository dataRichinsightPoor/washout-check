// Reproduce the synthetic article case and its higher-retention sensitivity.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DEFAULTS, runAudit, simulate} from '../web/model.js';
import {runToCsv, settingsFromRun} from '../web/serialization.js';

const folder = fileURLToPath(new URL('../examples/', import.meta.url));
mkdirSync(folder, {recursive:true});
const loading = {mode:'finite-dose', dose:1, duration:8};
const rows = [];
for (const [name, q] of [['article-finite-dose',5], ['higher-retention-q20',20]]) {
  const run = runAudit({...DEFAULTS, partition:q}, {loading});
  settingsFromRun(JSON.parse(JSON.stringify(run)));
  writeFileSync(`${folder}/${name}.json`, JSON.stringify(run,null,2)+'\n');
  writeFileSync(`${folder}/${name}.csv`, runToCsv(run)+'\n');
  for (const mode of ['residual','retention']) {
    const s = run.scenarios.find(s=>s.mode===mode);
    rows.push({
      case:name, mechanism:mode, retentionRatio:mode==='retention'?q:0,
      prewashOccupancy:s.prewash.bound/s.parameters.receptor,
      postwash24hOccupancy:s.endpoint.occupancy,
      loadingFreeAuc_nMh:s.loadingTrace.endpoint.freeAuc,
      postwashFreeAuc_nMh:s.endpoint.freeAuc,
      wholeProtocolFreeAuc_nMh:s.loadingTrace.endpoint.freeAuc+s.endpoint.freeAuc,
      loadingOccupancyAuc_h:s.loadingTrace.endpoint.occupancyAuc,
      postwashOccupancyAuc_h:s.endpoint.occupancyAuc,
      wholeProtocolOccupancyAuc_h:s.loadingTrace.endpoint.occupancyAuc+s.endpoint.occupancyAuc
    });
  }
}
const clamped=simulate({...DEFAULTS,free0:1},'retention',{
  loading:{mode:'finite-clamped',duration:8}
});
writeFileSync(`${folder}/summary.json`,JSON.stringify({
  status:'Synthetic model calculations; not experimental measurements or efficacy predictions.',
  loading, followUp_h:24, totalProtocol_h:32,
  note:'Occupancy is a fraction, not percent. Add phase integrals, not their zero-based time axes.',
  comparisons:rows,
  clampedCounterfactual:{
    doseMatched:false,
    prewashInventory_nMeq:clamped.prewash.total,
    postwash24hOccupancy:clamped.endpoint.occupancy
  }
},null,2)+'\n');
console.log('Generated two importable runs, two CSVs, and the numerical article summary.');
