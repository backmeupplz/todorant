// Never run inside someone else's frame (clickjacking); GitHub Pages can't send frame-ancestors
if (top !== self) {
  document.documentElement.style.display = 'none'
  top!.location.href = location.href
}
import { render } from 'preact'
import './styles.css'
import { App } from './app'
import { boot } from './data/account'
import { isDark, onSystemTheme, prefs, session } from './data/store'
import { initLanguage } from './i18n'
import { onRerender } from './lib/state'
import { appRoute } from './ui/router'
import { TAB_SKELETONS } from './ui/skeletons'

const theme = () => document.documentElement.classList.toggle('dark', isDark())
prefs.subscribe(theme)
onSystemTheme(theme)
const root = document.getElementById('app')!
// Legal pages arrive with their text prerendered for crawlers (vite.config.ts); the app draws its own copy
const prerendered = [...root.childNodes]
// Signed-in users see the screen's skeleton while the language loads
const tab = appRoute()?.tab
if (session.value && tab) render(TAB_SKELETONS[tab](), root)
await initLanguage()
prerendered.forEach((node) => node.remove())
const draw = () => render(<App />, root)
onRerender(draw)
draw()
boot()
