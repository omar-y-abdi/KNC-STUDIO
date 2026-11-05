// The offline (mock) AboutContentPort: returns an EMPTY overlay for either language, so the About
// section renders entirely from its i18n `aboutStrings(lang)` base — byte-identical to today. The
// merge `{ ...i18n, ...overlay }` with an empty overlay is a no-op. Resolves synchronously-wrapped
// so the section's copy paints immediately (no flash).

import type { AboutContentPort, AboutOverlay } from './port'

const EMPTY: AboutOverlay = {}

export const mockAboutContentAdapter: AboutContentPort = {
  // The mock ignores `lang` (no DB copy for either) — implemented with no param, which structurally
  // satisfies `AboutContentPort.overlay(lang)`.
  overlay(): Promise<AboutOverlay> {
    return Promise.resolve(EMPTY)
  },
}
