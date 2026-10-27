# PR #90 replacement: review and repair map

This is the working entry point for the replacement of [PR #90](https://github.com/omar-y-abdi/KNC-STUDIO/pull/90). It records verified defects, rejected suspicions, implementation decisions and verification receipts. Earlier maintenance handoffs are historical evidence, not instructions for this work.

## Frozen review boundary

- Base: `f15b79b5131848d43e888e9841d14a7d71d50177` (`main`).
- Original head: `aadb123dcd19d412a357a8e83ffc7603f3d55b0c` (`maintenance`).
- Scope: 447 changed paths across 238 original commits.
- Mapping: six Max-reasoning reviewers; all 447 paths have explicit completed review dispositions. Source review, visual inspection and test execution are separate evidence categories.
- Replacement branch: `fix/pr90-reviewed-maintenance`. Its first commit has the exact maintenance tree and main as its only parent. Original main and maintenance history remains unchanged.

## Working documents

| Document                                                      | Responsibility                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [Execution plan](task_plan.md)                                | Coordinator decisions, accepted findings, integration and current-head CI |
| [Changed-path map](00-path-coverage.md)                       | Every original changed path, review owner and completed evidence          |
| [Legal and privacy](01-legal-privacy.md)                      | Legal source import, preserved policy/consent behavior and factual limits |
| [Backend and security](02-backend-security.md)                | Authorization, SQL, retention and deletion integrity                      |
| [CI and verification](03-verification-ci.md)                  | Full browser gates, diagnostics, dependencies and test integrity          |
| [Frontend runtime](04-frontend-runtime.md)                    | Editor, recovery, real browser lifecycle and authored-layout limits       |
| [Architecture and documentation](05-architecture-coverage.md) | Moves, deletions, recovery instructions and image review                  |
| [Independent challenges](06-independent-review.md)            | Reproductions, variant attacks, cross-review and coverage closure         |

Each document remains its owner's working plan during repair. A finding marked reviewed or reproduced is not automatically fixed or approved. The execution plan tracks implementation and independent review separately. Temporary local reproduction paths in historical receipts identify the original runs; committed regression tests and exact CI run links will provide the durable verification path as fixes land.

## Review order

Start with the accepted-finding ledger in the execution plan. Review the scoped repair commits against their owner documents, then use the changed-path map to inspect the retained maintenance changes. The first snapshot commit preserves the reviewed baseline; subsequent commits explain each correction.

No production migration, deployment, CMS publication or merge is part of this repair. Existing authored English tablet overflow and operational legal facts are explicitly documented limits, not represented as newly introduced defects or silently rewritten content.

## Repair review closure and final CI receipt

### Follow-up review and acceptance

The owner's subsequent adversarial review of PR91 at `d800bad` identified additional CMS
backup/adoption and layout-provenance scenarios. The follow-up repairs and two additional integration findings have completed independent source and browser review. Its findings, rejected hypotheses and exact receipts are tracked in the [PR91 follow-up plan](../pr91-followup/task_plan.md). The earlier source review and CI remain historical checkpoints; the final exact-head release receipt is recorded on PR91.

At the `d800bad` checkpoint, implementation and independent review were complete for that checkpoint's accepted findings. The execution plan records the author/reviewer matrix and combined local checks. The final release gate is the **exact combined head** of [replacement PR #91](https://github.com/omar-y-abdi/KNC-STUDIO/pull/91): its body records the final workflow receipt and its checks show current status. Earlier head checks are not substituted for later repairs. Keeping that receipt on the PR avoids changing the source commit merely to name its own completed CI run. The branch is not merged by this work.
