import { render } from 'preact'
import { Root } from './app/Root'
import './ui/styles/fonts.css'
import './ui/styles/global.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Fatal: #root mount node not found')
// The Worker supplies readable initial business HTML; this app uses render, not hydration.
// Clear that fallback explicitly so Preact never leaves a second main/heading beside the app.
root.replaceChildren()
render(<Root />, root)
