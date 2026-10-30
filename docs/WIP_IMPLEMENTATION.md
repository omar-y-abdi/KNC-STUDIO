# Recovered CMS/admin implementation — 2026-10-28

This ledger maps the recovered WIP to current source and regression surfaces. It supplements
[the recovery plan](WIP_RECOVERY_PLAN.md), which owns authorization, integration order and final
gates. The local checkpoint receipts below are bounded evidence; they are not final browser,
startup, pushed-head CI, deployment or production-publication approval.

## Feature ledger

| Scope                | Current behavior and source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Regression anchors                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D2 pages             | Created pages store body/CSS and receive one live header/menu from [site-page.ts](../shared/site-page.ts). [Studio.tsx](../src/admin/cms/Studio.tsx) exposes metadata and confirmed deletion, flushing pending body edits before metadata mutations. Legacy frozen chrome migrates in Studio; Worker classification requires an actual shell element.                                                                                                                                                                 | [cmsSitePage](../tests/unit/cmsSitePage.test.ts), [page metadata](../tools/e2e/cms-page-metadata.spec.mjs), [Worker rendering](../tests/unit/workerLegalMode.test.ts).                                                                                              |
| D4 editor controls   | [Editor.tsx](../src/admin/cms/Editor.tsx), [responsiveStyles.ts](../src/admin/cms/responsiveStyles.ts) and [hierarchicalResize.ts](../src/admin/cms/hierarchicalResize.ts) own device-scoped controls, mapped language geometry and the temporary narrow Desktop view. Synchronization applies to the policy's recognized properties/selectors; it is not a general CSS equivalence claim.                                                                                                                            | [responsive styles](../tests/unit/cmsResponsiveStyles.test.ts), [new pages](../tools/e2e/cms-new-page-mobile.spec.mjs), [hierarchical resize](../tools/e2e/cms-hierarchical-resize.spec.mjs), [marquee zoom](../tools/e2e/cms-marquee-zoom.spec.mjs).               |
| E6 startup           | Initial empty-canvas imports yield between heavy passes; Home's derived About preview materializes after paint or on demand. [Editor.tsx](../src/admin/cms/Editor.tsx) owns readiness spans; [sourceReadCache.ts](../src/admin/cms/sourceReadCache.ts) keeps a capture's reads consistent and evicts failed promises. Stored pages remain editable during optional source failure.                                                                                                                                    | [startup](../tools/e2e/cms-startup.spec.mjs), [workspace failure/retry](../tools/e2e/cms-workspace-edge.spec.mjs). The startup field `cpuMs` measures synchronous editor spans, not OS or edge CPU.                                                                 |
| E1b part 1           | [normalizeDocument](../src/admin/cms/normalizeDocument.ts) repairs adopted Desktop CSS and legacy content through load, recovery, import, history and merge paths. Raw publication bases remain available for conflict checks. Render-time repairs in [nativeCanvas.ts](../src/admin/cms/nativeCanvas.ts), [site-page.ts](../shared/site-page.ts) and [worker.ts](../src/worker.ts) remain enabled.                                                                                                                   | [document adoption](../tests/unit/cmsDocumentAdoption.test.ts), [reported adoption workflows](../tools/e2e/cms-reported.spec.mjs).                                                                                                                                  |
| D3y owner-edit state | [CmsDraft](../src/admin/cms/draft.ts) keeps `dirty` separate from `hasEdits` using the independent `uneditedDocument` baseline. Migration-only state stays publishable without creating recovery offers or enabling Reset. Source adoption migrates the baseline and retained history; publication acknowledgement preserves newer edits.                                                                                                                                                                             | [draft](../tests/unit/cmsDraft.test.ts), [lifecycle](../tools/e2e/cms-lifecycle.spec.mjs), [PR91 recovery guards](../tools/e2e/cms-restore-adoption.spec.mjs).                                                                                                      |
| C4 Contact           | [corePages.ts](../src/admin/cms/corePages.ts) preserves existing Contact bodies and opens pre-Contact publications before optional capture. [nativePages.ts](../src/admin/cms/nativePages.ts) imports shipped templates. [cms-markup.ts](../shared/cms-markup.ts) enforces required slots only for the marked managed template. [LivePreview.tsx](../src/admin/cms/LivePreview.tsx) shares the information base and selected mode.                                                                                    | [source validation](../tests/unit/cmsSourceCss.test.ts), [core adoption](../tests/unit/cmsCorePages.test.ts), [real validation/publication and preview/Worker parity](../tools/e2e/cms-reported.spec.mjs), [Worker Contact](../tests/unit/workerLegalMode.test.ts). |
| E3 admin authority   | [AdminShell.tsx](../src/admin/AdminShell.tsx) retains operational admin views; Studio owns presentation editing. The [authority migration](../supabase/migrations/20261028185110_cms_single_writer_authority.sql) removes authenticated direct content writes, while [SettingsView.tsx](../src/admin/views/SettingsView.tsx) retains operational cancellation editing. The [media retirement](../supabase/migrations/20261028182853_retire_legacy_owner_media_writers.sql) removes obsolete gallery/logo writer RPCs. | [REST owner integration](../tests/integration/admin.owner.test.ts), [database authority](../supabase/tests/70_cms_single_writer_test.sql), [admin sessions](../tools/e2e/admin-state.spec.mjs).                                                                     |
| E3b delivery log     | [DeliveryStatus.tsx](../src/admin/cms/DeliveryStatus.tsx) exposes failed-delivery actions and a paged, sandboxed stored-copy log. [emailSendLog.ts](../supabase/functions/_shared/emailSendLog.ts) records app provider attempts with credential links redacted. Logging is best effort; `sent` means provider acceptance. Native Supabase Auth mail remains outside this log.                                                                                                                                        | [send logging](../tests/unit/emailSendLog.test.ts), [owner adapter](../tests/unit/emailDeliveryAdmin.test.ts), [SQL log contract](../supabase/tests/67_email_send_log_test.sql), [admin UI](../tools/e2e/admin-state.spec.mjs).                                     |

## Write authority and rollout dependencies

The database boundary is authoritative, including for an authenticated owner using REST directly.
After the authority migration, `site_content`, `about_content` and `email_templates` reject direct
authenticated inserts, updates, deletes and upserts. CMS content settings also require publication.
The sole direct owner `site_settings` exception is `cancellation_policy_hours` (1–168 whole hours).
It remains outside CMS history, revision and fingerprint changes. Existing read access and the
staff/profile/photo, schedule, service and booking boundaries remain intact.

Production rollout is a separate owner decision. Preserve the shipped migration history and apply
the four new forward migrations in this order:

1. [20261028100000_email_send_log.sql](../supabase/migrations/20261028100000_email_send_log.sql).
2. [20261028101000_email_send_log_deleted_booking.sql](../supabase/migrations/20261028101000_email_send_log_deleted_booking.sql).
3. [20261028182853_retire_legacy_owner_media_writers.sql](../supabase/migrations/20261028182853_retire_legacy_owner_media_writers.sql), **after deploying the updated upload gateway** by its [WASM deployment procedure](../supabase/functions/upload-image/README.md). Old gallery/logo requests then reject; queued cleanup remains dispatchable.
4. [20261028185110_cms_single_writer_authority.sql](../supabase/migrations/20261028185110_cms_single_writer_authority.sql).

The first two migrations precede deployment of the logged senders: `send-confirmation`,
`send-recovery-email`, `send-email-change`, `admin-create-barber` and `external-cleanup`. The matching
`cms-studio` backend and release digest precede the frontend. Follow [email rollout](operations/EMAIL_DELIVERY.md)
and [CMS compatibility/recovery](operations/CMS_RELEASE.md); these source files do not establish
which migrations or functions are hosted.

## Verification checkpoint and deferred work

Coordinator-reported source checkpoint `49e442b`, before later editor integration:

- [Unit receipt](/tmp/knc-wip-gate4-unit.log): 160 files, 1,865 tests passed.
- [Integration receipt](/tmp/knc-wip-full-integration.log): 12 files, 79 tests passed against the clean local database.
- [Database receipt](/tmp/knc-wip-b5-pgtap.log): 67 files, 1,396 assertions passed at `42f25f3`; its SQL and migrations are unchanged at `49e442b`.
- [Typecheck log](/tmp/knc-wip-gate4-typecheck.log): coordinator reports a successful full typecheck.

These local artifacts are outside version control. They do not certify later source changes,
full browser/startup acceptance, production authentication, delivery, migration or publication.
Final exact-head CI/CodeQL and local acceptance receipts belong in the final PR.

E1b part 2 and render-repair removal remain deferred until the owner's post-rollout publication
and a separate compatibility check of still-supported legacy inputs. Production migration
squashing/history repair, production deployment and CMS publication remain owner-dependent.
`presentation.regions` remains because validators and resource readers consume it. Archived PR90/91
reviews and the [maintenance handoff](MAINTENANCE_HANDOFF.md) remain historical evidence.
