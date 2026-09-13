# About gallery — 2026-09-13

Root causes: GalleryMarquee used empty CMS alt directly for button labels; empty gallery lists became 8 synthetic interactive tiles per row; the read adapter converted failures into empty lists; missing barber portraits announced prototype alt text.

Changes: preserve real photo tile geometry, two-row loops, drag/pointer handling, keyboard focus/selection and reduced-motion behavior. Remove placeholder gallery data/path entirely. Whitespace-only alt now falls back to localized salon/cut descriptions; authored descriptions remain. useGallery exposes loading/ready/error, catches adapter failures and cancels stale loads. About renders plain localized status text when photos are absent, and neutral decorative person icons for missing portraits. Existing footer, privacy links and hero behavior preserved.

Seam: GalleryPort.list now rejects read failures; [] means successfully loaded with no published photos. Local mock remains empty. Supabase row validation and Storage URL construction unchanged. No dependency, production data, migration or deployment changes.

Verification: `npm run typecheck` PASS; focused ESLint PASS; `npx vitest run tests/unit/galleryMarqueeAccessibility.test.ts tests/unit/performanceLifecycle.test.ts tests/unit/aboutMerge.test.ts` **22/22 PASS**. Tests cover actual photo control trees with blank/custom descriptions in both languages, hidden loop clones, empty output, decorative portrait, successful empty versus failed adapter reads, hook loading/error/ready and deferred I/O. Browser motion/visual confirmation delegated to `/root/launch_partner/ui_validation` and pending at handoff.
