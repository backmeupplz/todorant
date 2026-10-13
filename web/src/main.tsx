import { render } from 'preact'
import { effect } from '@preact/signals'
import './styles.css'
import { App } from './app'
import { boot } from './data/account'
import { prefs } from './data/store'
import { initLanguage } from './i18n'

effect(() => void document.documentElement.classList.toggle('dark', prefs.value.dark))
await initLanguage()
render(<App />, document.getElementById('app')!)
boot()
