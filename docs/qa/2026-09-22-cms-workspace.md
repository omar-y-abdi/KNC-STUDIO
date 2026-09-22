# CMS workspace refinement

Scope: PR #71, `codex/cms-flow-scenes`. Refine the real `/admin/cms/` editor; preserve flow scenes, publishing, owner data and public-site identity.

## Direction and acceptance

Keep the established paper/sage/ink workspace and cobalt selection. Improve hierarchy, spacing, control consistency and task navigation, not decorate the public website. Keep the canvas mounted and avoid new product dependencies.

1. Responsive shell: publication status at every width; touch-sized controls; explicit drawer dismissal and focus return; no hidden final dock actions.
2. Workspace surfaces: coherent headers, grouped forms, readable resource metadata, useful empty states, native modal handling and scrollable long content.
3. Editor: panel header and proper tab semantics; preserve plugin-owned managers, selection, undo and canvas behavior.
4. Verification: all execution, hypothesis probes and screenshots run on `verify/cms-visual-20260922`, not the local workstation. Capture complete surfaces and scroll states in Chromium/WebKit, test 320–1920px and short landscape layouts. Download and visually inspect the resulting files.
5. Publication: compare the locally authored product tree to the remotely verified tree, re-read the PR head before updating it, and retain every pre-existing change. Final PR CI must pass. Do not merge or publish live content.

## Evidence ledger

- Baseline source: `c47fff39948823dd9651d2d72e002f3daa7cd2e2`.
- Initial CI evidence: run 35655731580. Frontend, database and Edge passed; CMS shell failed. This is not a green starting point.
- Baseline browser images show hidden mobile publication status, sub-44px command controls, horizontally clipped dock actions and constrained page navigation. The remote baseline contract checks these independently of the visual review.
- Verification and final screenshot manifest: pending. This document is not a completion claim.
