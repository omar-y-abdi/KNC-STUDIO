/** Public widget metadata must match the site key's Cloudflare configuration. Invisible widgets
 * have no footprint, including while loading; visible modes reserve their normal 65px height. */
export type TurnstileWidgetMode = 'managed' | 'non-interactive' | 'invisible'

export function configuredTurnstileWidgetMode(
  siteKey: string | undefined,
  value: string | undefined,
): TurnstileWidgetMode | null {
  if (!siteKey?.trim()) return null
  const mode = value?.trim()
  if (mode === 'managed' || mode === 'non-interactive' || mode === 'invisible') return mode
  throw new Error(
    'VITE_TURNSTILE_WIDGET_MODE must match the configured site key: managed, non-interactive, or invisible',
  )
}
