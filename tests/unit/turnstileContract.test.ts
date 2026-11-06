import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import { mount, nodes, ref, render, reset } from './helpers/fakeHooks'
// Resolve the mock before resetModules so it keeps this helper's shared state.
import 'preact/hooks'

vi.mock('preact/hooks', () => import('./helpers/fakeHooks'))
vi.mock('../../modules/staff-admin/src/useTheme', () => ({ useTheme: () => ({ dark: false }) }))
vi.mock('../../modules/public-web/src/ui/pseudo', () => ({ FOCUS_CLS: '', pseudoClass: () => '' }))

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
      const { Turnstile } = await import('../../modules/public-web/src/booking/Turnstile')
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

  it('reserves no placeholder height through loading, success, failure and retry', async () => {
    const { Turnstile } = await import('../../modules/public-web/src/booking/Turnstile')
    const widgetRender = vi.fn<NonNullable<Window['turnstile']>['render']>(() => 'widget')
    vi.stubGlobal('window', { turnstile: { render: widgetRender, remove: vi.fn() } })
    const onToken = vi.fn()
    const draw = () =>
      render(() => Turnstile({ action: 'booking', lang: 'sv', resetNonce: 0, onToken }))
    // The widget container is the wrapper's first child. It carries no inline style, and no node
    // in the tree sizes anything: the widget alone decides the footprint.
    const expectNoPlaceholder = () => {
      const tree = nodes(draw())
      const container = tree[1]
      if (container?.type !== 'div') throw new Error('Missing widget container')
      expect(container.props['style']).toBeUndefined()
      expect(
        tree.filter((node) => {
          const style = node.props['style']
          return (
            typeof style === 'object' &&
            style !== null &&
            ('minHeight' in style || 'height' in style)
          )
        }),
      ).toEqual([])
    }
    expectNoPlaceholder()
    ref(0, {})
    const dispose = mount()
    await Promise.resolve()
    const options = widgetRender.mock.calls[0]?.[1]
    if (!options) throw new Error('Turnstile did not render its widget')
    options.callback('valid-token')
    expectNoPlaceholder()
    options['expired-callback']()
    expect(onToken).toHaveBeenLastCalledWith('')
    expectNoPlaceholder()
    const retry = nodes(draw()).find((node) => node.type === 'button')
    if (!retry) throw new Error('Missing retry button')
    ;(retry.props['onClick'] as () => void)()
    draw()
    dispose()
    const disposeRetry = mount()
    await Promise.resolve()
    expectNoPlaceholder()
    const retried = widgetRender.mock.calls[1]?.[1]
    if (!retried) throw new Error('Turnstile did not retry its widget')
    retried['error-callback']()
    expectNoPlaceholder()
    disposeRetry()
  })

  it.each(['sv', 'en'] as const)(
    'offers a localized password-recovery retry that requests a fresh widget (%s)',
    async (lang) => {
      const { Turnstile } = await import('../../modules/public-web/src/booking/Turnstile')
      const { ForgotPasswordForm } =
        await import('../../modules/staff-admin/src/ForgotPasswordForm')
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
