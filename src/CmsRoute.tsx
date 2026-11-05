import type { JSX } from 'preact'
import { lazy } from 'preact/compat'
import { useEffect } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useAdminSession } from '@bladeblend/staff-admin/session'
import { LazySurface } from '@bladeblend/public-web/lazy-surface'

const CmsStudio = lazy(() =>
  import('@bladeblend/studio/entry').then((module) => ({ default: module.CmsStudio })),
)

export function CmsRoute(): JSX.Element {
  const [, navigate] = useLocation()
  const { gate, error } = useAdminSession(navigate)
  useEffect(() => {
    if (gate.kind === 'authed' && gate.profile.role !== 'owner')
      navigate('/admin', { replace: true })
  }, [gate, navigate])

  if (gate.kind !== 'authed' || gate.profile.role !== 'owner')
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        {error ?? 'Laddar Studio…'}
      </div>
    )

  return (
    <LazySurface
      loadingLabel="Laddar Studio…"
      errorLabel="Studion kunde inte öppnas."
      retryLabel="Ladda om"
      minHeight="100vh"
    >
      <CmsStudio onExit={() => navigate('/admin', { replace: false })} />
    </LazySurface>
  )
}
