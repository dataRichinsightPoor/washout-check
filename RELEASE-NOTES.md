# Washout Check v0.1.2-alpha

Public model, code, and mathematics  
99 Small Problems: Useful models for assumptions with expensive ambitions.  
No. 03 | Data-Rich, Insight-Poor

Washout Check makes the assumptions before and after a wash inspectable. It is an experimental-design forward model, not a residence-time estimator or therapeutic-response predictor.

## Open the tool

- **Model:** [Washout Check](https://datarichinsightpoor.github.io/washout-check/).
- **Code:** [Versioned source](https://github.com/dataRichinsightPoor/washout-check/tree/v0.1.2-alpha).
- **Math:** [Equations, units, and limitations](https://datarichinsightpoor.github.io/washout-check/methods.html).
- **Examples:** [Synthetic inputs and results](https://github.com/dataRichinsightPoor/washout-check/tree/v0.1.2-alpha/examples).

## Included in this first public prerelease

- **Explicit loading:** assumed prewash equilibrium, finite loading under maintained free concentration, and a closed finite dose.
- **Four washout boundaries:** maintained ideal sink, complete medium exchange, residual medium, and residual medium plus reversible retention.
- **Honest comparisons:** dose-equilibrium references and a labeled, source-replenished clamped counterfactual that is not dose matched.
- **Inspectability:** dark-mode interface, trajectory and inventory views, time inspection, and loading/postwash phase labels.
- **Reproducibility:** JSON import/export with recalculation, CSV trajectories, parameter-bearing PNG figures, scenario URLs, and synthetic worked examples.
- **Verification:** 68 numerical and serialization tests, worker consistency checks, and test-gated GitHub Pages deployment.

The software version remains v0.1.2-alpha after private development. Public availability is not a promotion to a stable or experimentally validated model.

## Start with the finite-dose challenge

Choose **One dose. Two competing destinations.**, then **Load case**. In this synthetic case, retention lowers prewash occupancy from 47.51% to 14.22%, but raises 24-hour postwash occupancy from 8.08% to 11.95%, with the same intrinsic binding constants and total initial dose.

The advantage depends on the window. Across eight hours of loading plus 24 hours of washout, retention lowers integrated fractional occupancy from 5.829 to 4.356 h and free-drug AUC from 9.332 to 5.294 nM·h. Postwash-only AUC ranks the conditions in the opposite order. These are model calculations, not therapeutic effect estimates.

At the late endpoint, the two finite-bath systems are already close to equilibrium. The plateau does not prove a long individual binding event or continued substantial net reservoir release. Increasing retention ratio Q to 20 lowers late occupancy to 4.30%; Q changes both equilibrium partitioning and the entry coefficient.

The synthetic source-clamped counterfactual starts washout with 4.594 nM-equivalent instead of the 1 nM-equivalent closed dose and gives 37.04% final occupancy. It illustrates why maintained free concentration and matched administered inventory are not interchangeable.

## Scientific boundaries

The model represents reversible one-site binding, a well-mixed free pool, fixed target capacity and volume, instantaneous washes, and an optional linear unsaturable retention pool. Bound and retained drug survive each modeled wash unchanged. Bulk reassociation is represented; spatial diffusion and local return probabilities are not.

There is no receptor turnover, trafficking, intracellular access model, covalency, metabolism, active transport, downstream pharmacodynamics, efficacy prediction, or inverse fitting. Numerical tests verify implementation consistency, not biological validity, identifiability, or experimental resolvability.

Rebinding and partitioning motivate the audit ([Vauquelin, 2012](https://pubs.rsc.org/en/content/articlelanding/2012/md/c2md20015e)); mass-balance and depletion principles motivate explicit loading boundaries ([Hulme and Trevethick, 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC3000649/)). Neither reference validates the synthetic parameter settings.

## Run and reproduce

```sh
npm test
node scripts/export-examples.js
python3 -m http.server 8083 --directory web
```

Open `http://localhost:8083/`. No npm dependencies are required; CI uses Node.js 22. Run schema `washout-check/3` preserves loading parameters, while supported legacy files retain their original loading conventions.

## License and distribution

Original code and documentation are MIT licensed; external publications and fonts retain their respective rights. No proprietary sequences, procedures, confidential observations, or fitted therapeutic parameters are supplied. This is not patent or freedom-to-operate clearance.

The companion article, cover, private editorial baseline, annotated review, and private handoff archive are excluded. GitHub Pages follows `main`; the v0.1.2-alpha tag preserves this release's source snapshot. Public article or social posting is a separate action.
