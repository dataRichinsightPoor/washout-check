import {validate, validateLoading, VERSION} from './model.js';

export function normalizeSettings(parameters, loading = {mode: 'equilibrium'}) {
  const p = validate(parameters);
  const l = validateLoading(loading);
  if(l.mode==='dose-equilibrium')throw new Error('Dose equilibrium is only a reference.');
  return {parameters:p,loading:l};
}
export function settingsFromRun(data) {
  if (!data || typeof data !== 'object') throw new Error('Expected a run object.');
  if (data.schema === 'washout-check/1' && data.version === '0.1.0-alpha') {
    if (data.loading && data.loading.mode !== 'equilibrium')
      throw new Error('Legacy run cannot specify finite loading.');
    return normalizeSettings(data.parameters);
  }
  const legacy=data.schema==='washout-check/2'&&data.version==='0.1.1-alpha';
  if (!legacy && (data.schema !== 'washout-check/3' || data.version !== VERSION))
    throw new Error('Unsupported run schema or model version.');
  if (!data.loading) throw new Error('Loading metadata is required for this run schema.');
  if(legacy&&!['equilibrium','finite-clamped'].includes(data.loading.mode))
    throw new Error('Legacy run cannot specify finite-dose loading.');
  return normalizeSettings(data.parameters, data.loading);
}
export function scenarioPayload(settings) {
  return {schema:'washout-check/scenario/3',...normalizeSettings(settings.parameters,settings.loading)};
}
export function settingsFromScenario(data) {
  if (['washout-check/scenario/2','washout-check/scenario/3'].includes(data?.schema)) {
    if (!data.loading) throw new Error('Scenario loading metadata is missing.');
    if(data.schema.endsWith('/2')&&!['equilibrium','finite-clamped'].includes(data.loading.mode))
      throw new Error('Legacy scenario cannot specify finite-dose loading.');
    return normalizeSettings(data.parameters,data.loading);
  }
  if (data?.schema || data?.parameters || data?.loading)
    throw new Error('Unsupported scenario schema.');
  return normalizeSettings(data); // Original parameter-only URLs mean equilibrium.
}
export function runToCsv(run) {
  const settings = settingsFromRun(run);
  const keys=['t','event','free','bound','retained','removed','occupancy','freeAuc','occupancyAuc'];
  const pk=Object.keys(settings.parameters);
  const quote=x=>`"${String(x ?? '').replaceAll('"','""')}"`;
  const header=['version','comparisonRole','phase','mechanism','loadingMode','loadingDuration_h','initialDose_nMeq',
    'prewashFree_nM','prewashBound_nMeq','prewashRetained_nMeq','prewashTotal_nMeq','loadingReplenishment_nMeq',
    ...pk,...keys];
  const rows=[header.map(quote).join(',')];
  const groups=[['selected',run.scenarios]];
  if(settings.loading.mode!=='equilibrium') groups.push(['equilibrium-reference',run.equilibriumScenarios]);
  if(run.clampedScenarios)groups.push(['clamped-counterfactual',run.clampedScenarios]);
  for(const [role,scenarios] of groups)for(const s of scenarios) {
    const phases=[['postwash',s.points]];
    if(s.loadingTrace)phases.unshift(['loading',s.loadingTrace.points]);
    for(const [phase,points] of phases)for(const point of points)rows.push([run.version,role,phase,s.mode,s.loading.mode,s.loading.duration,s.loading.dose,
      s.prewash.free,s.prewash.bound,s.prewash.retained,s.prewash.total,s.loading.netReplenishment,
      ...pk.map(k=>Array.isArray(s.parameters[k])?s.parameters[k].join(';'):s.parameters[k]),
      ...keys.map(k=>point[k])].map(quote).join(','));
  }
  return rows.join('\n');
}
