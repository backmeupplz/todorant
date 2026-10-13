import { render } from 'preact'
import './fonts.css'
import './styles.css'
import { App } from './app'
import { boot } from './data/account'
import { prefs } from './data/store'
import { initLanguage } from './i18n'
import { onRerender } from './lib/state'

prefs.subscribe((p) => document.documentElement.classList.toggle('dark', p.dark))
await initLanguage()
const root = document.getElementById('app')!
const draw = () => render(<App />, root)
onRerender(draw)
draw()
boot()
