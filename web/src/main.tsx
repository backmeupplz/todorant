// Never run inside someone else's frame (clickjacking); GitHub Pages can't send frame-ancestors
if (top !== self) {
  document.documentElement.style.display = 'none'
  top!.location.href = location.href
}
import { hydrate, render } from 'preact'
import './styles.css'
import { App, preloadPage } from './app'
import { boot } from './data/account'
import { isDark, onSystemTheme, prefs, session } from './data/store'
import { initLanguage, language } from './i18n'
import { onRerender } from './lib/state'
import { appRoute } from './ui/router'
import { TAB_SKELETONS } from './ui/skeletons'

const theme = () => document.documentElement.classList.toggle('dark', isDark())
prefs.subscribe(theme)
onSystemTheme(theme)
const root = document.getElementById('app')!
// The landing and legal pages arrive with their text prerendered for crawlers (npm run prerender)
const prerendered = [...root.childNodes]
// Signed-in users see the screen's skeleton while the language loads
const tab = appRoute()?.tab
if (session.value && tab) render(TAB_SKELETONS[tab](), root)
// A prerendered page (how it works, privacy, terms) swaps to the app's copy only once its code is here, so it
// never flashes to its skeleton and back
await Promise.all([initLanguage(), prerendered.length ? preloadPage() : undefined])
document.documentElement.classList.remove('signed-in')
const draw = () => render(<App />, root)
onRerender(draw)
// The prerendered page is the app's own render for a signed-out visitor in English and light mode: for them the app
// takes over its nodes (hydration), so nothing visible is drawn a second time. Anyone else gets the app's own copy
// (hydration wouldn't fix attributes such as the dark screenshot's src)
if (prerendered.length && !session.value && language.value === 'en' && !isDark()) hydrate(<App />, root)
else {
  prerendered.forEach((node) => node.remove())
  draw()
}
boot()
