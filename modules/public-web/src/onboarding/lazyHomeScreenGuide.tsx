import type { JSX } from 'preact'
import type {
  HomeScreenGuide as HomeScreenGuideComponent,
  HomeScreenGuideProps,
} from './HomeScreenGuide'

interface GuideModule {
  readonly HomeScreenGuide: typeof HomeScreenGuideComponent
}
let resolved: GuideModule | undefined

/** True once the guide's chunk is in; false when it could not be loaded. */
export function loadHomeScreenGuide(): Promise<boolean> {
  return import('./HomeScreenGuide').then(
    (module) => {
      resolved = module
      return true
    },
    () => false,
  )
}

export function homeScreenGuideLoaded(): boolean {
  return resolved !== undefined
}

/** Nothing until `loadHomeScreenGuide` has resolved. */
export function LazyHomeScreenGuide(props: HomeScreenGuideProps): JSX.Element | null {
  const loaded = resolved
  return loaded ? <loaded.HomeScreenGuide {...props} /> : null
}
