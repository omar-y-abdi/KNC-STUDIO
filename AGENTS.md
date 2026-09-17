# AGENTS.md
## Project
- Blade & Blend Studio website
- Stack: Vite + Preact + TypeScript
- Backend: Supabase + Cloudflare Workers/Static Assets
- Default language: Swedish. English also exists

## Read First
- [README.md](README.md)
- [CODEBASE-MAP.md](CODEBASE-MAP.md) **THIS IS THE ARCHITECTURAL INDEX OF THE REPO READ IT BEFORE READING/GREP SEARCHING AND EDITING CODE: ALWAYS UPDATE WHEN CHANGING ARCHITECTURE**
- [BACKEND.md](BACKEND.md)
- [LAUNCH_READINESS_PLAN.md](LAUNCH_READINESS_PLAN.md)
- [docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md](docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md)
- [docs/operations/BACKUP_RESTORE.md](docs/operations/BACKUP_RESTORE.md)

## Quick Commands
- `npm run build` - typecheck + production build
- `npm run lint` - ESLint
- `npm test` - unit tests
- `npm run test:integration` - live adapter tests against local Supabase
- `npm run deploy:dry-run` - Cloudflare deploy check
- `npx supabase test db` - pgTAP
- `npm run test:e2e` - browser smoke

## Repo Map
- `src/app/` - root, router, desktop/mobile shell, app state
- `src/booking/` - booking domain, slots, pricing, validation, ICS, adapters
- `src/admin/` - staff panel, auth, settings, admin adapters
- `src/cancellation/` - cancel flow
- `src/about/` - gallery, reviews, public content
- `src/mybookings/` - customer lookup flow
- `src/site/` - site chrome and CMS content
- `src/backend/` - Supabase seam, config, RPC schemas
- `src/ui/` - shared UI primitives
- `supabase/migrations/` - schema, RLS, RPCs, outbox, launch gates
- `supabase/functions/` - Edge Functions
- `supabase/tests/` - pgTAP for DB rules
- `tests/unit/` - pure logic
- `tests/integration/` - live flow tests
- `tools/` - backup, smoke, seed, visual, e2e helpers

## Work Rules
- Keep domain logic pure
- Put effects at edges: adapters, Edge Functions, Worker, UI I/O
- Booking truth lives server-side. Do not trust browser values for price, duration, or business rules
- Reuse existing seams and adapters. Do not add abstraction unless needed
- Keep TypeScript strict, ESLint clean, Prettier clean, security rules intact
- Touch only files needed for the task

## Supabase Rules
- Use migrations, not manual schema drift
- If changing schema, RLS, RPCs, triggers, or outbox behavior, check `supabase/tests/`
- Public booking changes must follow [docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md](docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md)
- Only `VITE_*` env values are public. Keep secrets server-side

## Launch Hotspots
- Booking gateway: `supabase/functions/submit-booking/`, `public-booking-actions/`, related migrations/tests
- Email and reminders: `send-confirmation`, reminder flow, mail templates
- Storage/image upload: `upload-image/`, outbox cleanup, admin gallery paths
- Auth/admin: invite, password reset, email change, account lifecycle
- Discovery/CMS: site content, SEO, ACP metadata, public business info
- Backup/restore: `tools/backup/*`, [docs/operations/BACKUP_RESTORE.md](docs/operations/BACKUP_RESTORE.md)

## Session Flow
1. Read the docs above
2. Inspect nearest code and tests before editing
3. Make smallest correct change
4. Run smallest useful verification first
5. Broaden only if needed

## Engineering Principles

Operate with senior-level engineering judgment. Optimize for the correct, durable solution—not LOC, diff size, speed, or superficial completeness

### 1. Understand Before Editing

- Inspect the relevant code, tests, docs, and existing seams before changing anything
- Search before building; reuse established patterns where they fit
- Surface material ambiguity, tradeoffs, and assumptions. *Ask when the answer would meaningfully change the implementation;* otherwise state the assumption and proceed with the best possible outcome, always striving for senior-level judgment and engineering density.
- Solve the actual user problem, including its difficult cases. Do not quietly narrow scope because a weaker version is easier to implement

### 2. Earn Complexity

- Prefer the simplest design that fully solves the problem
- Add abstractions, subsystems, configurability, or specialized paths only when the requirements justify them
- Do not optimize for low or high LOC. Optimize for engineering density: every meaningful piece of code and complexity should earn its existence
- Refactor first when the existing architecture prevents a clean solution
- Split responsibilities when a subsystem deserves a clear boundary
- Do not preserve weak designs because of sunk cost

### 3. Keep Changes Focused

- Touch only what the task or its necessary solution requires
- Do not refactor, reformat, or clean unrelated code
- Match established repository conventions unless changing them is part of the task
- Remove dead code, imports, and other leftovers created by your changes
- Mention unrelated problems you discover; do not silently expand scope to fix them

### 4. Build for Verifiable Outcomes

Define success in observable terms and verify it

- Bug fix → reproduce the failure, fix it, prove the regression is covered
- Validation change → test accepted and rejected inputs
- Refactor → preserve behavior before and after
- New behavior → test the important happy path, failure modes, boundaries, and materially different cases

Tests must justify the claims being made. If correctness depends on adversarial, integration, migration, security, or end-to-end behavior, test at that level

After editing, run the smallest useful verification first, then broaden based on risk and affected surface area

### 5. Finish the Whole Requested Scope

- Deliver the implementation, tests, and documentation needed for the requested outcome
- Make sure all documentation is accurate, up-to-date, and true to source after all changes. Prune any outdated or misleading content
- Prefer permanent fixes over workarounds when the permanent fix is reasonably within scope
- Do not leave known dangling work that is required for the solution to function correctly
- Do not defer necessary work merely because it is larger than expected
- Conversely, do not add speculative features or infrastructure unrelated to the requested outcome

Completeness means **the requested problem is actually solved**, not that every adjacent opportunity has been pursued

### 6. Review at the Problem Level

Implementation correctness does not guarantee problem correctness

Before declaring work complete, verify:

- The behavior solves the user's real problem, not a convenient approximation
- The architecture remains appropriate under the difficult cases the requirements imply
- Server-side and security boundaries remain authoritative where required
- Tests cover the claims being made
- No necessary integration, migration, operational, or documentation work was omitted
- Every significant addition or refactor has a concrete reason to exist

**Target: a complete, maintainable solution with high engineering density and no unnecessary complexity**
