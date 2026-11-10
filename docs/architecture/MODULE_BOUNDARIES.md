# Module ownership and boundaries

Base: `fix/mobile-booking-polish`, including CI repair `a719093`. Work happens on `refactor/module-boundaries`; further CI repairs on the base branch are integrated before final qualification. No production deployment or migration is part of this task.

## Intended outcome

The repository has real npm workspaces with restricted source interfaces. Every pull request, push to `main` and manual run executes every CI job.

## Boundaries

| Workspace                    | Implementation owner                                                                                                     | Explicit interfaces                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/public-web`         | Public site, customer booking/history, public browser adapters, native public rendering, visual primitives, localization | Public app; a complete read-only preview runtime/protocol; named scheduling/design/business/server-rendering interfaces used by other modules |
| `modules/staff-admin`        | Staff authentication/session lifecycle, protected client, scheduling/personnel/services/bookings and staff UI            | Lazy staff entry; owner-session gate and narrowly named Studio access/delivery/confirmation capabilities                                      |
| `modules/studio`             | Editor, authoring, resources, drafts/history, preview controller and publication client                                  | Lazy Studio entry; internal editor interfaces stay private                                                                                    |
| `supabase`                   | Database, RLS/authorization, Edge Functions, mail delivery/integrations, Worker/gateway                                  | Worker entry and deployment/configuration; browser consumers receive only contracts, never server implementation                              |
| `packages/content-contracts` | CMS document and authored content protocol: schema, validation, markup, resources, CSS/page/email rendering              | Explicit named subpath exports; no generic miscellaneous utilities                                                                            |
| `packages/backend-contracts` | Backend-owned browser-safe RPC schemas, timestamps and delivery-log wire types                                           | Explicit schema/type exports; CSP-safe Zod initialization remains authoritative                                                               |

The root owns composition, bundling, deployment and test orchestration. `src/main.tsx`, root routing and the CMS owner gate compose public/staff/Studio exports. Moving the gate out of staff prevents a staff↔Studio package cycle while retaining `useAdminSession` as the authority. UI/native rendering remains public-owned rather than creating a falsely neutral shared UI package.

Workspace `exports` and dependency declarations are enforced for production imports. Relative imports across workspace boundaries are forbidden except Deno imports targeting an explicitly exported source file; Deno retains explicit `.ts` paths and deployed function names/maps. Tests can inspect implementation within their declared responsibility. Export barrels must not eagerly pull Studio/admin code or CSS into public startup.

## Preview contract

Move NativeSource and its source-cache/draft/example helpers into public-owned preview implementation. Keep same-origin messaging, endpoint, readiness/failure markers, inert capture, navigation containment and denied customer/write capabilities. Studio uses the named preview protocol/rendering interface. App remains an implementation detail. Persisted native IDs, JSX structure and public rendering must remain unchanged.

## Verification model

- `boundaries.mjs` generates and validates source import edges with the installed TypeScript parser, including dynamic imports, exports and `new URL(..., import.meta.url)` worker edges. It resolves npm exports and explicit Deno targets.
- CI does not select by change: every event runs every job (`.github/workflows/ci.yml`), and the boundary graph is not used to select tests.
- The unit suite and each browser group run whole. Browser discovery and execution use identical arguments. Existing exact case accounting, no skips/retries and source/artifact checks remain in force.

## Delivery slices

1. Record the source/CI inventory and implement workspace layout, explicit exports, preview ownership and executable import boundaries. Preserve source behavior and package/deploy resolution.
2. Implement module-local commands.
3. Independent adversarial review, integration of parent CI repairs, full baseline verification, documentation and PR with exact evidence.

## Risks and verification

Relocations affect literal test imports/file reads, Deno bundling, Wrangler entrypoints, release digest paths and source-based contracts. Update consumers atomically; preserve security checks, actual case counts and deployed URLs. Compare public render/native-ID evidence and budget before/after; do not interpret lint alone as parity. The manual CMS release dependency set must remain complete when exports or paths change. No unrelated visual/product behavior changes.

The mapping found no static value-import SCCs, but there are folder-level bootstrap/auth/preview cycles. Root composition and public-owned preview eliminate those package cycles rather than grandfathering them. The existing shared browser harness statically imports all surfaces, so each browser group runs whole.
