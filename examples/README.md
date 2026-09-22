# Synthetic worked examples

These files contain original model calculations, not experimental data. Import either complete run JSON through the browser application's JSON import control to recompute it.

`article-finite-dose.json` reproduces “Washed Out. Still There.” with Q = 5; `higher-retention-q20.json` changes Q to 20 with all other parameters held fixed. Each file includes selected mechanisms, dose-equilibrium references, and the explicitly non-dose-matched clamped counterfactual.

The corresponding CSVs label the comparison role, mechanism, loading condition, and phase. Loading and postwash times each start at zero; shift postwash time by eight hours if a continuous full-protocol axis is needed.

`summary.json` reports fractional occupancy and both phase-specific and whole-protocol AUCs. Multiply occupancy by 100 for percent. Integrated fractional occupancy is measured in hours, not percent-hours.

Regenerate all examples with `node scripts/export-examples.js` from the repository root. The companion article is distributed separately; these files contain the numerical worked cases, not editorial drafts or review materials.
