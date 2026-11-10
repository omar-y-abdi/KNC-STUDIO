// Moving keyboard focus to a part of the page that is not a control: the main landmark after a
// dialog whose opener is gone, the new view after a view change, the target of the skip link.

/** Marks the container that holds such a focus; global.css removes its focus outline. */
export const QUIET_FOCUS_ATTRIBUTE = 'data-quiet-focus'

/** Only the public shell renders the skip link (app/App.tsx), never inside a Studio frame. */
export const SKIP_LINK_CLASS = 'knc-skip-link'

/** The page's main landmark: the desktop `<main>`, or the mobile container with that role. */
export function mainLandmark(): HTMLElement | null {
  return document.querySelector<HTMLElement>('main,[role="main"]')
}

/** Whether the main landmark is a focus target: a skip link points to it. The staff pages, Studio
 * and its frames have none, and their `<main>` is never focused from code. */
export function hasSkipLink(): boolean {
  return document.querySelector(`a.${SKIP_LINK_CLASS}`) !== null
}

/** Whether keyboard focus has nowhere to act from: nothing holds it (`active` is null or the
 * `body`), or what holds it sits in an inert part of the page. */
export function focusIsStranded(
  active: { closest(selector: string): unknown } | null,
  body: unknown,
): boolean {
  return active === null || active === body || active.closest('[inert]') !== null
}

/** Whether a change to `view` strands keyboard focus: as `focusIsStranded`, or in the mobile hero
 * that booking folds, which turns inert only in a later render. */
export function viewChangeStrandsFocus(
  active: { closest(selector: string): unknown } | null,
  body: unknown,
  view: 'home' | 'booking',
): boolean {
  return (
    focusIsStranded(active, body) ||
    (view === 'booking' && active !== null && active.closest('[data-knc-fold="hero"]') !== null)
  )
}

/** Whether keyboard focus rests on `part` or inside it (null: no such part). A part that is about
 * to be hidden drops the focus it holds to the `body`. */
export function focusIsWithin(
  active: Node | null,
  part: { contains(node: Node): boolean } | null,
): boolean {
  return active !== null && part !== null && part.contains(active)
}

/** Focuses `target` without an outline, and without scrolling unless `scroll`. It is focusable only
 * while it holds the focus: on blur it leaves the tab order and loses the marker. */
export function focusQuietly(target: HTMLElement | null, scroll = false): void {
  if (target === null) return
  const ownTabIndex = target.hasAttribute('tabindex')
  const release = (): void => {
    target.removeAttribute(QUIET_FOCUS_ATTRIBUTE)
    if (!ownTabIndex) target.removeAttribute('tabindex')
  }
  if (!ownTabIndex) target.setAttribute('tabindex', '-1')
  target.setAttribute(QUIET_FOCUS_ATTRIBUTE, '')
  target.addEventListener('blur', release, { once: true })
  target.focus({ preventScroll: !scroll })
  if (document.activeElement !== target) {
    target.removeEventListener('blur', release)
    release()
  }
}
