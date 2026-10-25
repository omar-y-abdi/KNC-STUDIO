import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminText } from '../../src/i18n/adminStrings'
import { mount, nodes, ref, render, reset } from './helpers/fakeHooks'
// Resolve the mock before resetModules so it keeps this helper's shared state.
import 'preact/hooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('../../src/admin/useTheme', () => ({ useTheme: () => ({ dark: false }) }))
vi.mock('../../src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'local-test-site-key')
  reset()
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
      // The Turnstile widget container element ref.
      ref(0, {})
      const dispose = mount()
      await Promise.resolve()
      const call = widgetRender.mock.calls[0]
      if (!call) throw new Error('Turnstile did not render its widget')
      const options = call[1]
      options.callback('valid-token')
      expect(onToken).toHaveBeenLastCalledWith('valid-token')
      options[failure]()
      expect(onToken).toHaveBeenLastCalledWith('')
      expect(onError).toHaveBeenCalledOnce()
      dispose()
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
