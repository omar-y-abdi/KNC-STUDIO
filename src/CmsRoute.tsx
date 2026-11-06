import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { useAdminSession } from '@bladeblend/staff-admin/session'
import { LazyLoadingMessage } from '@bladeblend/public-web/lazy-surface'
import type { CmsStudio } from '@bladeblend/studio/entry'

/** The Studio chunk once it has arrived. */
interface StudioEntry {
  readonly CmsStudio: typeof CmsStudio
}

export function CmsRoute(): JSX.Element {
  const [, navigate] = useLocation()
  const { gate, error } = useAdminSession(navigate)
  const owner = gate.kind === 'authed' && gate.profile.role === 'owner'
  // The Studio chunk is requested only for an owner session, and through state rather than
  // `lazy()`: suspending into Root's CmsEntry would tear down the session hook above while the
  // chunk is in flight. Meanwhile this route shows the same loading message as that boundary, so
  // the user sees one unchanged screen. A failed request is thrown into that same CmsEntry
  // boundary, which owns the one error and reload UI.
  const [studio, setStudio] = useState<StudioEntry | Error | null>(null)
  useEffect(() => {
    if (gate.kind === 'authed' && gate.profile.role !== 'owner')
      navigate('/admin', { replace: true })
  }, [gate, navigate])
  useEffect(() => {
    if (!owner || studio !== null) return
    let live = true
    import('@bladeblend/studio/entry').then(
      (entry) => {
        if (live) setStudio(entry)
      },
      (reason: unknown) => {
        if (live) setStudio(reason instanceof Error ? reason : new Error(String(reason)))
      },
    )
    return () => {
      live = false
    }
  }, [owner, studio])
  if (studio instanceof Error) throw studio

  if (!owner)
    return error === null ? (
      <LazyLoadingMessage label="Laddar Studio…" overlay={false} minHeight="100vh" />
    ) : (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>{error}</div>
    )
  if (studio === null)
    return <LazyLoadingMessage label="Laddar Studio…" overlay={false} minHeight="100vh" />

  return <studio.CmsStudio onExit={() => navigate('/admin', { replace: false })} />
}
