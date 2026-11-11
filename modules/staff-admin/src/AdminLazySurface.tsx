import type { ComponentChildren, JSX } from 'preact'
import { Suspense } from 'preact/compat'
import { LazyLoadingMessage, LazySurface } from '@bladeblend/public-web/lazy-surface'
import { INVISIBLE } from './adminStyles'

export interface AdminLazySurfaceProps {
  readonly children: ComponentChildren
  readonly loadingLabel: string
  readonly errorLabel: string
  readonly retryLabel: string
}

/** A full-page `LazySurface` whose loading state is announced but paints nothing. */
export function AdminLazySurface(props: AdminLazySurfaceProps): JSX.Element {
  return (
    <LazySurface errorLabel={props.errorLabel} retryLabel={props.retryLabel} minHeight="100vh">
      <Suspense
        fallback={
          <div style={INVISIBLE}>
            <LazyLoadingMessage label={props.loadingLabel} overlay={false} minHeight="100vh" />
          </div>
        }
      >
        {props.children}
      </Suspense>
    </LazySurface>
  )
}
