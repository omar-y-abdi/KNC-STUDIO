import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  capInputZoom,
  cappedViewport,
  onIos,
  type DeviceTraits,
  type ViewportPage,
} from '../../modules/staff-admin/src/inputZoom'

const VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover'
const CAPPED = `${VIEWPORT}, maximum-scale=1`

const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Version/18.6 Safari/605.1.15'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15'

const devices = {
  iPhoneSafari: {
    userAgent: `${IPHONE} (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1`,
    platform: 'iPhone',
    maxTouchPoints: 5,
  },
  iPhoneChrome: {
    userAgent: `${IPHONE} (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1`,
    platform: 'iPhone',
    maxTouchPoints: 5,
  },
  iPad: {
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
      'Version/18.6 Mobile/15E148 Safari/604.1',
    platform: 'iPad',
    maxTouchPoints: 5,
  },
  iPadDesktopSite: { userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 },
  mac: { userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 },
  macOneTouchPoint: { userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 1 },
  androidChrome: {
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/140.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv81',
    maxTouchPoints: 5,
  },
  windowsTouch: {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/140.0.0.0 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 10,
  },
} satisfies Record<string, DeviceTraits>

function page(content: string | null, meta = true) {
  const state = { content }
  const setAttribute = vi.fn((_: 'content', value: string) => {
    state.content = value
  })
  const viewport: ViewportPage = {
    querySelector: () => (meta ? { getAttribute: () => state.content, setAttribute } : null),
  }
  return { state, setAttribute, viewport }
}

afterEach(() => vi.unstubAllGlobals())

describe('onIos', () => {
  it.each([
    ['iPhone Safari', devices.iPhoneSafari, true],
    ['iPhone Chrome', devices.iPhoneChrome, true],
    ['iPad', devices.iPad, true],
    ['iPadOS asking for the desktop site', devices.iPadDesktopSite, true],
    ['a Mac without touch', devices.mac, false],
    ['a Mac reporting one touch point', devices.macOneTouchPoint, false],
    ['Android Chrome', devices.androidChrome, false],
    ['a Windows touch laptop', devices.windowsTouch, false],
  ] as const)('%s', (_, device, expected) => {
    expect(onIos(device)).toBe(expected)
  })
})

describe('cappedViewport', () => {
  it('appends the scale cap to the page’s own viewport', () => {
    expect(cappedViewport(VIEWPORT)).toBe(CAPPED)
  })
})

describe('capInputZoom', () => {
  const iPhone = devices.iPhoneSafari
  const android = devices.androidChrome

  it('caps the viewport on iOS and the undo restores the exact original', () => {
    const { state, viewport } = page(VIEWPORT)

    const undo = capInputZoom(viewport, iPhone)
    expect(state.content).toBe(CAPPED)

    undo()
    expect(state.content).toBe(VIEWPORT)
  })

  it('undoes once however often the undo runs', () => {
    const { state, setAttribute, viewport } = page(VIEWPORT)

    const undo = capInputZoom(viewport, iPhone)
    undo()
    undo()

    expect(state.content).toBe(VIEWPORT)
    expect(setAttribute).toHaveBeenCalledTimes(2)
  })

  it('leaves a later writer’s viewport alone', () => {
    const { state, viewport } = page(VIEWPORT)

    const undo = capInputZoom(viewport, iPhone)
    state.content = 'width=device-width'
    undo()

    expect(state.content).toBe('width=device-width')
  })

  it('changes nothing on other devices, and its undo changes nothing', () => {
    const { state, setAttribute, viewport } = page(VIEWPORT)

    const undo = capInputZoom(viewport, android)
    undo()

    expect(state.content).toBe(VIEWPORT)
    expect(setAttribute).not.toHaveBeenCalled()
  })

  it('changes nothing on a page without a viewport meta or its content', () => {
    expect(() => capInputZoom(page(VIEWPORT, false).viewport, iPhone)()).not.toThrow()

    const empty = page(null)
    capInputZoom(empty.viewport, iPhone)()
    expect(empty.setAttribute).not.toHaveBeenCalled()
  })

  it('reads the real page and device when called without arguments', () => {
    const { state, viewport } = page(VIEWPORT)
    vi.stubGlobal('document', viewport)
    vi.stubGlobal('navigator', iPhone)

    const undo = capInputZoom()
    expect(state.content).toBe(CAPPED)
    undo()
    expect(state.content).toBe(VIEWPORT)
  })
})
