import { render } from 'preact'
import { Root } from './Root'
import { NativeSiteProvider } from '@bladeblend/public-web/native-rendering'
import '@bladeblend/public-web/styles/fonts.css'
import '@bladeblend/public-web/styles/global.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Fatal: #root mount node not found')
if (window.location.pathname === '/cms-public/source') {
  void import('@bladeblend/public-web/preview-runtime').then(({ NativeSource }) =>
    render(
      <NativeSource
        interactive={new URLSearchParams(window.location.search).get('preview') === '1'}
      />,
      root,
    ),
  )
} else if (
  root.dataset['cmsPublic'] !== undefined &&
  !root.querySelector('[data-knc-native="1"]')
) {
  void import('@bladeblend/public-web/content-runtime').then(({ mountCmsRuntime }) =>
    mountCmsRuntime(root),
  )
} else {
  // Server CSS is only the first paint. Native surfaces own the current mode after mounting;
  // leaving the initial styles active leaks old colors/layout into subsequent theme switches.
  for (const id of ['cms-page-light', 'cms-page-dark', 'cms-theme'])
    document.getElementById(id)?.remove()
  root.replaceChildren()
  render(
    <NativeSiteProvider>
      <Root />
    </NativeSiteProvider>,
    root,
  )
}
