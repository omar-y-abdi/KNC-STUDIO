import type { VNode } from 'preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminText } from '../../src/i18n/adminStrings'

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateCursor: 0,
  refCursor: 0,
  effects: [] as (() => undefined | (() => void))[],
}))
vi.mock('preact/hooks', () => ({
  useState: (initial: unknown) => {
    const index = hooks.stateCursor++
    if (!(index in hooks.states))
      hooks.states[index] = typeof initial === 'function' ? initial() : initial
    return [
      hooks.states[index],
      (next: unknown) => {
        hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next
      },
    ]
  },
  useRef: (current: unknown) => {
    const index = hooks.refCursor++
    return (hooks.refs[index] ??= { current })
  },
  useEffect: (effect: () => undefined | (() => void)) => {
    hooks.effects.push(effect)
  },
}))
vi.mock('../../src/admin/useTheme', () => ({ useTheme: () => ({ dark: false }) }))
vi.mock('../../src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))

function nodes(node: unknown): VNode<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (typeof node !== 'object' || node === null) return []
  const vnode = node as VNode<Record<string, unknown>>
  return [vnode, ...nodes(vnode.props.children)]
}
function render<T>(component: () => T): T {
  hooks.stateCursor = 0
  hooks.refCursor = 0
  hooks.effects = []
  return component()
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'local-test-site-key')
  hooks.states = []
  hooks.refs = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Turnstile widget recovery', () => {
  it.each(['error-callback', 'timeout-callback', 'expired-callback'] as const)(
    'invalidates the token and notifies its parent on %s; ignores callbacks after disposal',
    async (failure) => {
      const { Turnstile } = await import('../../src/booking/Turnstile')
      const widgetRender = vi.fn<NonNullable<Window['turnstile']>['render']>(() => 'widget')
      const remove = vi.fn()
      vi.stubGlobal('window', { turnstile: { render: widgetRender, remove } })
      const onToken = vi.fn()
      const onError = vi.fn()
      render(() =>
        Turnstile({ action: 'password_recovery', lang: 'sv', resetNonce: 0, onToken, onError }),
      )
      const container = hooks.refs[0]
      if (!container) throw new Error('Missing widget container')
      container.current = {}
      const cleanups = hooks.effects.map((effect) => effect())
      await Promise.resolve()
      const call = widgetRender.mock.calls[0]
      if (!call) throw new Error('Turnstile did not render its widget')
      const options = call[1]
      options.callback('valid-token')
      expect(onToken).toHaveBeenLastCalledWith('valid-token')
      options[failure]()
      expect(onToken).toHaveBeenLastCalledWith('')
      expect(onError).toHaveBeenCalledOnce()
      for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
      expect(remove).toHaveBeenCalledWith('widget')
      options[failure]()
      expect(onError).toHaveBeenCalledOnce()
    },
  )

  it.each(['sv', 'en'] as const)(
    'offers a localized password-recovery retry that requests a fresh widget (%s)',
    async (lang) => {
      const { Turnstile } = await import('../../src/booking/Turnstile')
      const { ForgotPasswordForm } = await import('../../src/admin/ForgotPasswordForm')
      const form = () => nodes(render(() => ForgotPasswordForm({ lang, onBackToSignIn: vi.fn() })))
      const challenge = () => {
        const node = form().find((node) => Object.is(node.type, Turnstile))
        if (!node) throw new Error('Missing recovery challenge')
        return node
      }
      const initialNonce = challenge().props.resetNonce
      ;(challenge().props.onError as () => void)()
      expect(JSON.stringify(form())).toContain(adminText(lang).forgotPwChallengeError)
      const retry = form().find(
        (node) =>
          node.type === 'button' && node.props.children === adminText(lang).forgotPwRetryChallenge,
      )
      if (!retry) throw new Error('Missing localized challenge retry')
      ;(retry.props.onClick as () => void)()
      expect(challenge().props.resetNonce).toBe(Number(initialNonce) + 1)
      expect(JSON.stringify(form())).not.toContain(adminText(lang).forgotPwChallengeError)
    },
  )
})
