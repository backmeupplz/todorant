import { signal } from '../lib/state'
import { ui as enUi } from './en.json'
import { urlLanguage } from '../i18n'

export type Ui = typeof enUi
export type Site = { ui: Ui; html: Record<string, string> }

const loaders = import.meta.glob<{ default: Site }>(['./*.json', '!./en.json'])
/** The words around the pages of the site (footer links, the switcher's label): English until a translation is loaded */
export const ui = signal<Ui>(enUi)
/** The text of the standalone pages in the language of the address; undefined on the English pages (static.tsx has those) */
export const html = signal<Record<string, string> | undefined>(undefined)

/** Loads the strings of the translated pages for the language in the address, before the first render, so the page draws once */
export async function loadSite() {
  const lang = urlLanguage()
  if (!lang) return
  const site = (await loaders[`./${lang}.json`]?.())?.default
  if (!site) return
  ui.value = site.ui
  html.value = site.html
}
