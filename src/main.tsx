import { render } from 'preact'
import { Root } from './app/Root'
import './ui/styles/fonts.css'
import './ui/styles/global.css'

const root = document.getElementById('root')
if (!root) throw new Error('Fatal: #root mount node not found')
render(<Root />, root)
