import { signal } from '../lib/state'
import en from './en.json'
import { prefs, setPref } from '../data/store'

export const LANGUAGES = {
  en: 'English', ru: 'Русский', uk: 'Українська', es: 'Español', it: 'Italiano', 'pt-BR': 'Português (Brasil)',
  'pt-PT': 'Português (Portugal)', de: 'Deutsch', fr: 'Français', nl: 'Nederlands', pl: 'Polski', tr: 'Türkçe',
  sv: 'Svenska', ja: '日本語', ko: '한국어', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', ar: 'العربية', hi: 'हिन्दी',
  id: 'Bahasa Indonesia', vi: 'Tiếng Việt', th: 'ไทย',
} as const
export type Language = keyof typeof LANGUAGES

const loaders = import.meta.glob<{ default: object }>(['./*.json', '!./en.json'])
const messages = signal<Record<string, any>>({})
export const language = signal<Language>('en')

/** The supported language for a BCP 47 tag such as "pt-PT", "zh-TW" or "de-AT"; also normalizes the apps' "pt-br" */
export function match(tag?: string): Language | undefined {
  const lower = tag?.toLowerCase() ?? ''
  const exact = Object.keys(LANGUAGES).find((l) => l.toLowerCase() === lower)
  if (exact) return exact as Language
  const [base, rest = ''] = lower.split(/-(.*)/)
  if (base === 'pt') return rest === '' || rest.startsWith('br') ? 'pt-BR' : 'pt-PT'
  if (base === 'zh') return /^(hant|tw|hk|mo)/.test(rest) ? 'zh-Hant' : 'zh-Hans'
  return base in LANGUAGES ? (base as Language) : undefined
}

/** The language in the first segment of an address, the way the translated pages are served (/de/privacy), and the route behind it */
export function splitPath(p: string): { lang?: Language; rest: string } {
  const [, segment, rest] = p.match(/^\/([\w-]+)(\/.*)?$/) ?? []
  const lang = (Object.keys(LANGUAGES) as Language[]).find((l) => l !== 'en' && l.toLowerCase() === segment)
  return lang ? { lang, rest: rest ?? '/' } : { rest: p }
}
/** The address folder of a language ("/de", "" for English) */
export const folder = (lang: Language) => (lang === 'en' ? '' : `/${lang.toLowerCase()}`)
/** The language the address asks for; it wins over the saved and the device language, and is never saved */
export const urlLanguage = () => splitPath(location.pathname).lang

function pick(): Language {
  const saved = match(prefs.value.language)
  if (saved) return saved
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lang = match(tag)
    if (lang) return lang
  }
  return 'en'
}

/** Switches the UI language (the caller syncs it to settings) */
export async function setLanguage(lang: Language, save = true) {
  messages.value = lang === 'en' ? {} : (await loaders[`./${lang}.json`]?.())?.default ?? {}
  language.value = lang
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
  if (save && prefs.value.language !== lang) setPref('language', lang)
}
export const initLanguage = () => {
  const fromUrl = urlLanguage()
  return setLanguage(fromUrl ?? pick(), !fromUrl)
}

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
