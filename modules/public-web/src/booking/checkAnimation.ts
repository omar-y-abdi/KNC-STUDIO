import type { Motion } from './pendingHold'

/** Whether the confirmation's check plays its entrance: not in a Studio scene of it. */
export type CheckEntrance = 'animate' | 'still'

/** A page of the site, or a Studio source or capture frame (`useNativeSource`). */
export type CheckFrame = 'site' | 'source'

export function checkMoves(entrance: CheckEntrance, motion: Motion, frame: CheckFrame): boolean {
  return entrance === 'animate' && motion === 'full' && frame === 'site'
}

export interface CheckMotion {
  readonly keyframes: readonly Keyframe[]
  readonly timing: KeyframeAnimationOptions
}

export const DISC_POP: CheckMotion = {
  keyframes: [
    { offset: 0, transform: 'scale(0.3)', opacity: 0, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    { offset: 0.55, transform: 'scale(1.12)', opacity: 1, easing: 'ease-in-out' },
    { offset: 0.78, transform: 'scale(0.96)', opacity: 1, easing: 'ease-out' },
    { offset: 1, transform: 'scale(1)', opacity: 1 },
  ],
  timing: { delay: 140, duration: 560, fill: 'backwards', easing: 'linear' },
}

/** `ink`: the red, green and blue of the card's text colour, as `r,g,b`. */
export function discRipple(ink: string): CheckMotion {
  return {
    keyframes: [
      { offset: 0, boxShadow: `0 0 0 0 rgba(${ink},0.30), 0 0 0 0 rgba(${ink},0.16)` },
      { offset: 1, boxShadow: `0 0 0 14px rgba(${ink},0), 0 0 0 28px rgba(${ink},0)` },
    ],
    timing: { delay: 440, duration: 700, fill: 'none', easing: 'cubic-bezier(0.16, 0.84, 0.3, 1)' },
  }
}

export const CHECK_LAND: CheckMotion = {
  keyframes: [
    { offset: 0, clipPath: 'inset(0 100% 0 0)', transform: 'scale(0.6)' },
    { offset: 0.6, clipPath: 'inset(0 0 0 0)', transform: 'scale(1.14)' },
    { offset: 1, clipPath: 'inset(0 0 0 0)', transform: 'scale(1)' },
  ],
  timing: {
    delay: 360,
    duration: 460,
    fill: 'backwards',
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
}

const RGB = /^rgba?\(\s*(\d{1,3})(?:,\s*|\s+)(\d{1,3})(?:,\s*|\s+)(\d{1,3})(?=[\s,/)])[^)]*\)$/

/** `r,g,b` of a computed `rgb()`/`rgba()` colour; undefined for any other spelling. */
export function inkOf(color: string): string | undefined {
  const match = RGB.exec(color.trim())
  if (match === null) return undefined
  const channels = match.slice(1, 4).map(Number)
  return channels.every((channel) => channel <= 255) ? channels.join(',') : undefined
}

export interface CheckTargets {
  readonly disc: Element
  readonly check: Element
}

/** The disc right above the title and the check image that is its only child, as the dialog
 * renders them; undefined once a presentation has rearranged them. */
export function checkTargets(card: Element, titleId: string): CheckTargets | undefined {
  const disc = card.querySelector(`[id="${titleId}"]`)?.previousElementSibling
  const check = disc?.firstElementChild
  if (!disc || !check) return undefined
  return disc.tagName === 'DIV' && disc.childElementCount === 1 && check.tagName === 'IMG'
    ? { disc, check }
    : undefined
}

/** Starts the entrance on the resting elements; without an ink the ripple is left out. */
export function playCheck(targets: CheckTargets, ink: string | undefined): readonly Animation[] {
  const play = (element: Element, motion: CheckMotion): Animation =>
    element.animate([...motion.keyframes], motion.timing)
  return [
    play(targets.disc, DISC_POP),
    ...(ink === undefined ? [] : [play(targets.disc, discRipple(ink))]),
    play(targets.check, CHECK_LAND),
  ]
}
