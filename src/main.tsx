import { render } from 'preact'
import { Root } from './app/Root'
import { NativeSiteProvider } from './cms/NativeSurface'
import './ui/styles/fonts.css'
import './ui/styles/global.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Fatal: #root mount node not found')
if (window.location.pathname === '/cms-public/source') {
  void import('./admin/cms/NativeSource').then(({ NativeSource }) => render(<NativeSource />, root))
} else if (
  root.dataset['cmsPublic'] !== undefined &&
  !root.querySelector('[data-knc-native="1"]')
) {
  void import('./cmsRuntime').then(({ mountCmsRuntime }) => mountCmsRuntime(root))
} else {
  root.replaceChildren()
  render(
    <NativeSiteProvider>
      <Root />
    </NativeSiteProvider>,
    root,
  )
}
