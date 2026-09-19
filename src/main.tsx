import { render } from 'preact'
import { Root } from './app/Root'
import './ui/styles/fonts.css'
import './ui/styles/global.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Fatal: #root mount node not found')
if (root.dataset['cmsPublic'] !== undefined) {
  void import('./cmsRuntime').then(({ mountCmsRuntime }) => mountCmsRuntime(root))
} else {
  // Legacy shell remains until a canonical CMS page has been published.
  root.replaceChildren()
  render(<Root />, root)
}
