import { render } from 'preact'
import { App } from './app/App'
import './ui/styles/fonts.css'
import './ui/styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Fatal: #root mount node not found')
render(<App />, root)
