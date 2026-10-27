import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { CMS_THEME_SCRIPT } from '../../src/site/cmsThemeScript'

const scriptSources = (): readonly string[] => {
  const headers = readFileSync(new URL('../../public/_headers', import.meta.url), 'utf8')
  const policy = headers.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1] ?? ''
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('script-src '))
  return directive?.split(/\s+/).slice(1) ?? []
}

type Surface = 'html' | 'body' | 'shell'
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/** Runs the script against the few DOM members it reads, recording every inline style write. */
function runThemeScript(mode: string, backgrounds: Partial<Record<Surface, string>>) {
  const writes: string[] = []
  const element = (name: Surface) => ({
    name,
    style: new Proxy<Record<string, string>>(
      {},
      {
        set(target, key, value: string) {
          writes.push(`${name}.${String(key)}=${value}`)
          target[String(key)] = value
          return true
        },
      },
    ),
  })
  const html = element('html')
  const body = element('body')
  const root = { dataset: { cmsMode: mode }, firstElementChild: element('shell') }
  const themeColor = { content: '#f4f3f0' }
  const listeners = { resize: [] as (() => void)[], change: [] as (() => void)[] }
  const frames: (() => void)[] = []
  const state = { osDark: false, backgrounds: { ...backgrounds } }
  runInNewContext(CMS_THEME_SCRIPT, {
    document: {
      documentElement: html,
      body,
      getElementById: (id: string) => (id === 'root' ? root : null),
      querySelectorAll: (selector: string) =>
        selector === 'meta[name="theme-color"]'
          ? [{ setAttribute: (_name: string, value: string) => (themeColor.content = value) }]
          : [],
    },
    getComputedStyle: (target: { readonly name: Surface }) => ({
      backgroundColor: state.backgrounds[target.name] ?? TRANSPARENT,
    }),
    matchMedia: () => ({
      get matches() {
        return state.osDark
      },
      addEventListener: (_type: string, listener: () => void) => listeners.change.push(listener),
    }),
    addEventListener: (type: 'resize', listener: () => void) => listeners[type].push(listener),
    requestAnimationFrame: (frame: () => void) => frames.push(frame),
    cancelAnimationFrame: () => undefined,
    URL,
  })
  const settle = (): void => {
    for (const frame of frames.splice(0)) frame()
  }
  return { writes, themeColor, listeners, state, settle }
}

describe('CMS page theme script', () => {
  it('runs under the production CSP through its exact hash, without unsafe-inline', () => {
    const hash = createHash('sha256').update(CMS_THEME_SCRIPT, 'utf8').digest('base64')
    expect(scriptSources()).toContain(`'sha256-${hash}'`)
    expect(scriptSources()).not.toContain("'unsafe-inline'")
  })

  it('cannot close its own script element', () => {
    expect(CMS_THEME_SCRIPT).not.toMatch(/<\/script/i)
  })

  it('leaves html and body styles to the page CSS (gradients, breakpoints) in auto mode', () => {
    const page = runThemeScript('auto', { html: 'rgb(244, 243, 240)' })
    page.state.osDark = true
    for (const listener of [...page.listeners.change, ...page.listeners.resize]) listener()
    page.settle()
    expect(page.writes).toEqual([])
  })

  it('pins only the colour scheme for an explicit mode, and ignores OS changes', () => {
    const page = runThemeScript('dark', { html: 'rgb(28, 28, 30)' })
    expect(page.writes).toEqual(['html.colorScheme=dark'])
    expect(page.listeners.change).toHaveLength(0)
  })

  it.each([
    [{ body: 'rgb(255, 255, 255)', html: 'rgb(1, 2, 3)' }, 'rgb(255, 255, 255)'],
    [{ html: 'rgb(244, 243, 240)', shell: 'rgb(1, 2, 3)' }, 'rgb(244, 243, 240)'],
    [{ shell: 'rgb(28, 28, 30)' }, 'rgb(28, 28, 30)'],
  ] as const)('takes theme-color from the first visible surface %j', (backgrounds, expected) => {
    expect(runThemeScript('auto', backgrounds).themeColor.content).toBe(expected)
  })

  it('keeps the shell theme-color when no surface is painted', () => {
    expect(runThemeScript('auto', {}).themeColor.content).toBe('#f4f3f0')
  })

  it('re-derives theme-color when a resize changes the active rules', () => {
    const page = runThemeScript('light', { body: 'rgb(28, 28, 30)' })
    expect(page.themeColor.content).toBe('rgb(28, 28, 30)')
    page.state.backgrounds.body = 'rgb(255, 255, 255)'
    for (const listener of page.listeners.resize) listener()
    page.settle()
    expect(page.themeColor.content).toBe('rgb(255, 255, 255)')
  })

  it('re-derives theme-color when the OS scheme flips in auto mode', () => {
    const page = runThemeScript('auto', { html: 'rgb(244, 243, 240)' })
    page.state.osDark = true
    page.state.backgrounds.html = 'rgb(28, 28, 30)'
    for (const listener of page.listeners.change) listener()
    page.settle()
    expect(page.themeColor.content).toBe('rgb(28, 28, 30)')
  })
})
