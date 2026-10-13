import { signal } from '@preact/signals'
import en from './en.json'
import { prefs, setPref } from '../data/store'

export const LANGUAGES = { en: 'English', ru: 'Русский', uk: 'Українська', es: 'Español', it: 'Italiano', 'pt-BR': 'Português (Brasil)' } as const
export type Language = keyof typeof LANGUAGES

const loaders = import.meta.glob<{ default: object }>(['./*.json', '!./en.json'])
const messages = signal<Record<string, any>>({})
export const language = signal<Language>('en')

function pick(): Language {
  const saved = prefs.value.language as Language
  if (saved in LANGUAGES) return saved
  const nav = navigator.language?.slice(0, 2)
  return nav === 'ru' ? 'ru' : nav === 'uk' ? 'uk' : 'en'
}

/** Switches the UI language (the caller syncs it to settings) */
export async function setLanguage(lang: Language) {
  messages.value = lang === 'en' ? {} : (await loaders[`./${lang}.json`]?.())?.default ?? {}
  language.value = lang
  document.documentElement.lang = lang
  if (prefs.value.language !== lang) setPref('language', lang)
}
export const initLanguage = () => setLanguage(pick())

const get = (root: any, key: string) => key.split('.').reduce((o, k) => o?.[k], root)

/** Translation with `{name}` params; falls back to English, then the key */
export function t(key: string, params?: Record<string, string | number>): string {
  messages.value // subscribe
  let s = get(messages.value, key) ?? get(en, key)
  if (typeof s !== 'string') return key
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}
/** Arrays and objects (rules, reviews) */
export const tRaw = (key: string): any => get(messages.value, key) ?? get(en, key)
export const locale = () => (language.value === 'uk' ? 'uk-UA' : language.value)
