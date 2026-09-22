# Washout Check

99 Small Problems: Useful models for assumptions with expensive ambitions.  
No. 03 | Data-Rich, Insight-Poor | v0.1.2-alpha

**Did the drug leave, or did the protocol merely stop adding it?**

A browser-based, mass-balanced forward model of reversible target binding, wash carryover, bulk reassociation, and reversible retention. It helps test explanations for persistent occupancy without pretending that a persistent curve identifies a molecular residence time.

## Open the model

- **[Try Washout Check](https://datarichinsightpoor.github.io/washout-check/):** no installation or sign-in; dark mode by default.
- **[Read the mathematics](https://datarichinsightpoor.github.io/washout-check/methods.html):** equations, units, numerical methods, boundaries, and scientific limitations.
- **[Inspect the engine](https://github.com/dataRichinsightPoor/washout-check/blob/main/web/model.js):** original dependency-free JavaScript.
- **[Use the versioned release](https://github.com/dataRichinsightPoor/washout-check/releases/tag/v0.1.2-alpha):** fixed source snapshot and release notes.

Choose **One dose. Two competing destinations.** and click **Load case** for the finite-dose worked example. The default state instead assumes prewash equilibrium; these are different experimental boundaries.

## What the model compares

Three loading choices define the state before the first wash: assumed equilibrium at specified free concentration, finite loading under a clamped free-drug bath, or a closed finite dose with initially empty binding and retention pools. Four postwash boundaries then share the intrinsic binding constants: maintained ideal sink, complete medium exchange followed by closed incubation, residual medium, and residual medium plus reversible retention.

Only the finite-dose selected conditions match initial total inventory. Clamped-free comparisons can start washout with different amounts of drug. A separate clamped counterfactual reports source replenishment explicitly rather than disguising extra inventory as improved molecular persistence.

Change dose or free concentration, loading time, target capacity, K_D, k_off, retention ratio Q, release rate, residual medium, wash times, and follow-up. Compare trajectories and inventories, inspect time points, and export PNG, CSV, or complete run JSON. Imported runs are recalculated from validated inputs.

## A worked ranking reversal

The synthetic finite-dose case uses 1 nM-equivalent drug, eight-hour loading, 1% residual medium, and 24-hour follow-up. K_D = 1 nM, k_off = 1 h⁻¹, and accessible target capacity is 0.2 nM-equivalent; retention uses Q = 5 and k_rel = 0.15 h⁻¹.

With retention, prewash occupancy is lower: 14.22% versus 47.51%. At 24 hours after washing it is higher: 11.95% versus 8.08%. Both late values are already near their closed-system equilibria.

Yet integrating across the full 32-hour protocol reverses the apparent advantage. Free-drug AUC is 5.294 versus 9.332 nM·h, and integrated fractional occupancy is 4.356 versus 5.829 h, with versus without retention. Postwash-only AUC ranks the conditions in the opposite order. Neither endpoint nor integrated occupancy is an efficacy model.

Raising Q to 20 at otherwise unchanged settings lowers late occupancy to 4.30%. More preserved inventory can mean less accessible drug; Q also changes entry kinetics because the entry coefficient is Qk_rel. This is not a pure compartment-volume experiment.

Reproduce these calculations from the importable [worked examples](examples/README.md) and [numerical summary](examples/summary.json). All values are synthetic model results, not experimental observations.

## Run locally

Use a modern browser with JavaScript modules and Web Workers. Serve `web/` over HTTP rather than double-clicking the model HTML:

```sh
python3 -m http.server 8083 --directory web
# Open http://localhost:8083/
```

Node.js 20 or 22 supports the built-in test suite; CI uses Node.js 22. There are no npm runtime or test dependencies to install.

```sh
npm test
node scripts/export-examples.js
```

Use the engine independently:

```js
import {DEFAULTS, runAudit} from './web/model.js';
const run = runAudit(DEFAULTS, {
  loading: {mode:'finite-dose', dose:1, duration:8}
});
const retained = run.scenarios.find(s => s.mode === 'retention');
console.log(retained.prewash, retained.endpoint);
```

The suite contains 68 numerical and serialization tests. They cover analytical limits, an independent loading integrator, mass conservation, physical bounds, wash handoff, finite versus equilibrium loading, tolerance refinement, worker parity, round-trips, and the worked ranking reversals. Passing tests establishes implementation consistency, not biological validity.

## Mathematics and interpretation

All inventory variables refer to the same fixed assay volume. With free drug F, target-bound drug B, retained drug S, target capacity R, and removed inventory W:

\[
J_B=k_{\mathrm{on}}F(R-B)-k_{\mathrm{off}}B,\qquad
J_S=k_{\mathrm{rel}}(QF-S),\qquad k_{\mathrm{on}}=k_{\mathrm{off}}/K_D.
\]

\[
\dot F=-J_B-J_S,\qquad \dot B=J_B,\qquad \dot S=J_S.
\]

At a wash, \(F^+=fF^-\) and \(W^+=W^-+(1-f)F^-\); bound and retained inventories remain unchanged. Between washes the finite-bath conditions have no elimination. The ideal sink is a different boundary: free drug remains zero as dissociated drug is immediately removed.

Q is a dimensionless equilibrium inventory ratio, not a measured compartment size or membrane partition coefficient. The linear reservoir is unsaturable. Bulk reassociation is represented, but spatial return to a nearby receptor is not.

Postwash AUC begins at the first wash; finite-dose loading carries separate AUCs. To obtain full-protocol AUC, add the two phase integrals. Do not concatenate their separately zero-based time axes without shifting postwash time by the loading duration.

Run schema `washout-check/3` preserves the loading boundary and dose metadata. Supported older runs retain their equilibrium or clamped-loading conventions. JSON import does not trust stored trajectories.

## Scientific scope and privacy

This research-use alpha is not a parameter estimator, residence-time assay, pharmacodynamic model, or therapeutic-response predictor. It omits target turnover, trafficking, spatial diffusion, intracellular access barriers, metabolism, active transport, covalency, signaling, and efficacy. It does not establish parameter identifiability or assign the retention pool to a biological compartment.

Calculations run locally in the browser. Hosting and the external presentation font generate ordinary network requests; the app has no analysis backend. Exported files and scenario links contain entered parameters, so do not put confidential information in shared URLs.

Original code and documentation are MIT licensed. Cited publications and external fonts retain their respective rights. The release contains generic equations and synthetic examples, not proprietary sequences, procedures, experimental observations, or fitted therapeutic parameter sets. Neither source screening nor licensing establishes freedom to operate.

The companion article and private editorial/review materials are not included in this software release. GitHub Pages follows `main`; use the tagged source for a fixed reproduction target.

## Published foundations

Rebinding and reversible partitioning complicate washout interpretation ([Vauquelin, 2012](https://pubs.rsc.org/en/content/articlelanding/2012/md/c2md20015e)). Binding mass balance and ligand depletion distinguish nominal dose from free concentration ([Hulme and Trevethick, 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC3000649/)). These methodological principles motivate the model; the cited papers do not validate this implementation or its synthetic parameter values.
