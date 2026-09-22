# Washout Check v0.1.2-alpha: Verification Record

This record distinguishes numerical verification, public-host checks, and scientific validity. The checks below do not establish biological predictiveness, parameter identifiability, or legal clearance.

## Numerical verification

All 68 tests passed locally under Node.js 20.20.1 and in the initial [GitHub numerical-validation workflow](https://github.com/dataRichinsightPoor/washout-check/actions/runs/35679020574) under Node.js 22. The initial [test-gated Pages deployment](https://github.com/dataRichinsightPoor/washout-check/actions/runs/35679020597) also completed successfully.

Coverage includes analytical sink behavior, independently integrated loading equations, conservation, physical bounds, wash events, finite versus equilibrium loading, tolerance refinement, schema validation, legacy compatibility, worker parity, whole-protocol AUC ranking, and late equilibrium. Numerical equality is conditional on the implemented assumptions.

The calculation engine and application controller were preserved byte-for-byte from the verified private model. Public changes concern distribution, navigation, documentation, and automated workflows; no scientific parameters or equations were changed.

## Live GitHub Pages checks

The public host was tested in Chromium at desktop width 1440 px and mobile width 375 px. Dark mode is the default, and the light/dark toggle completed a full cycle.

All seven presets loaded successfully. The finite-dose case displayed 11.9% retained-case occupancy at 24 hours and 3.12 nM·h postwash free AUC, consistent with the regression-tested values. All six chart views, four comparison mechanisms, both reference conditions, and endpoint inspection were exercised.

JSON, CSV, and PNG downloads succeeded. The bundled finite-dose JSON imported successfully, and a generated public scenario URL restored finite-dose loading and dose = 1. A negative dose produced an explicit error and disabled stale exports; zero dose produced zero occupancy and exposure.

No page-level horizontal overflow or JavaScript errors were observed. The trajectory inspection table intentionally scrolls horizontally on small screens. The methods page loaded with eight equation blocks, including the whole-protocol AUC and equilibrium-sensitivity definitions.

## Scope of public distribution

The repository uses a clean public history and does not contain the private article, editorial baseline, annotated review, or private release archive. Included inputs and outputs are synthetic calculations, not experimental data.

The MIT license governs original code and documentation; cited publications and external fonts retain their respective rights. Content separation and numerical testing are not a patent search or freedom-to-operate opinion.
