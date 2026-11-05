import { setTimeout as delay } from 'node:timers/promises'

/** Native touchscreen movement for the paint tests' 390×844 viewport.
 * Linux Chromium's synthesizeScrollGesture can resolve without delivering touchmove or scrolling.
 * Keep each stroke between y=200 and y=600; 10px per 60Hz step retains the nominal 600px/s input.
 * A stationary contact before lifting ends the pan without adding a fling. No DOM scrolling.
 */
export async function nativeMobileScroll(cdp, distance) {
  let remaining = Math.abs(distance)
  while (remaining > 0) {
    const travel = Math.min(400, remaining)
    const start = distance < 0 ? 600 : 200
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 200, y: start, id: 0 }],
    })
    const steps = Math.ceil(travel / 10)
    for (let step = 1; step <= steps; step++) {
      await delay(1000 / 60)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 200, y: start + (Math.sign(distance) * travel * step) / steps, id: 0 }],
      })
    }
    await delay(120)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    remaining -= travel
  }
}
