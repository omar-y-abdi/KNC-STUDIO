import type { JSX } from 'preact'
import { lazy } from 'preact/compat'
import type {
  MyBookingsDialog as MyBookingsDialogComponent,
  MyBookingsDialogProps,
} from './MyBookingsDialog'

interface DialogModule {
  readonly MyBookingsDialog: typeof MyBookingsDialogComponent
}
let resolved: DialogModule | undefined
const loadMyBookingsDialog = (): Promise<DialogModule> =>
  import('./MyBookingsDialog').then((module) => (resolved = module))

const LazyDialog = lazy(() =>
  loadMyBookingsDialog().then((module) => ({ default: module.MyBookingsDialog })),
)

/** Renders the dialog synchronously once its chunk is resolved, so an awaited preload opens it
 * without a Suspense fallback; an unresolved chunk still suspends and reports its failure. */
export function LazyMyBookingsDialog(props: MyBookingsDialogProps): JSX.Element {
  const loaded = resolved
  return loaded ? <loaded.MyBookingsDialog {...props} /> : <LazyDialog {...props} />
}

/** Resolve the dialog chunk ahead of opening. A rejected import resolves as well: the lazy
 * element renders that failure through its LazySurface error and reload controls. */
export function preloadMyBookingsDialog(): Promise<void> {
  return loadMyBookingsDialog().then(
    () => undefined,
    () => undefined,
  )
}
