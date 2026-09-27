# CMS context latency

Goal: remove reproduced CMS stalls while preserving published output and the fixes in #79.
Baseline product tree: main f84abc4. Requested branch: latency-fixes.
Raw profiles and the read-only public presentation are outside tracked source at
../cms-latency-round2. Browser mutations use isolated fixture APIs, never production.

## Evidence and coverage

The initial audit exercised all five visible core pages; language, theme and device
on each; text, undo/redo/reset; zoom, fit, comparison and inspector tabs; business,
email, palette, resource and history workspace transitions (before-audit.json).
The public presentation (revision 42, about 1.43 MB) reproduced Home context switches
of 2.4–3.1 seconds without network requests. CSS was exported three times per switch,
each costing about 330–600 ms. The CPU profile identifies full component style scans,
full canvas replacement and redundant GrapesJS project serialization. In pinned
0.23.6, storageManager:false removes the destination but leaves autosave enabled.
Hidden workspace language switches also rebuild the canvas. Reset re-runs all
legacy/source repairs over already-complete core pages.

## Execution and verification

- [ ] Pin storage/style-scan, clean-flush and immediate-edit contracts in browser CI.
- [ ] Eliminate redundant storage and exports using existing GrapesJS capabilities.
- [ ] Minimize context/reset work; preserve canonical About and responsive ownership.
- [ ] Repeat the broad audit and inspect exact-head full CI before completion.

No speculative refactors, dependencies, increased timeouts, skipped assertions or
production changes. Operation counts complement timings, not cross-machine SLAs.
