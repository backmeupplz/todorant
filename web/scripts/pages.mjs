// The pages that get their own HTML file (vite.config.ts) and share card (scripts/og.mjs): title, description,
// the card's one line and its picture (a phone with the app, or a big glyph). The English texts live in
// src/site/en.json, the other languages' in src/site/<code>.json (one folder per language: /de/, /pt-br/)
import { existsSync, readFileSync } from 'node:fs'

export const ORIGIN = 'https://todorant.com'
const GLYPHS = { privacy: '🔒', terms: '📜', 'delete-account': '🗑️' }
/** The pages of the site besides the landing, in sitemap order */
export const FILES = ['how-it-works', 'privacy', 'terms', 'delete-account']
/** Standalone tool pages (public/tools/<name>/index.html), English only, listed in the sitemap by seo.mjs */
export const TOOLS = ['eisenhower-matrix']
/** Every language of the apps: native name, og:locale and direction (the folder is the lower-cased code) */
export const LANGS = {
  en: ['English', 'en_US', 'ltr'], ru: ['Русский', 'ru_RU', 'ltr'], uk: ['Українська', 'uk_UA', 'ltr'], es: ['Español', 'es_ES', 'ltr'],
  it: ['Italiano', 'it_IT', 'ltr'], 'pt-BR': ['Português (Brasil)', 'pt_BR', 'ltr'], 'pt-PT': ['Português (Portugal)', 'pt_PT', 'ltr'],
  de: ['Deutsch', 'de_DE', 'ltr'], fr: ['Français', 'fr_FR', 'ltr'], nl: ['Nederlands', 'nl_NL', 'ltr'], pl: ['Polski', 'pl_PL', 'ltr'],
  tr: ['Türkçe', 'tr_TR', 'ltr'], sv: ['Svenska', 'sv_SE', 'ltr'], ja: ['日本語', 'ja_JP', 'ltr'], ko: ['한국어', 'ko_KR', 'ltr'],
  'zh-Hans': ['简体中文', 'zh_CN', 'ltr'], 'zh-Hant': ['繁體中文', 'zh_TW', 'ltr'], ar: ['العربية', 'ar_AR', 'rtl'], hi: ['हिन्दी', 'hi_IN', 'ltr'],
  id: ['Bahasa Indonesia', 'id_ID', 'ltr'], vi: ['Tiếng Việt', 'vi_VN', 'ltr'], th: ['ไทย', 'th_TH', 'ltr'],
}
export const folder = (code) => (code === 'en' ? '' : code.toLowerCase())
/** The address of a page ('home' or one of FILES) in a language */
export const urlOf = (code, file) => `${ORIGIN}/${folder(code) && folder(code) + '/'}${file === 'home' ? '' : file}`

const read = (code) => JSON.parse(readFileSync(new URL(`../src/site/${code}.json`, import.meta.url), 'utf8'))
const strings = {}
/** A language's site strings ({ui, meta, html}), or undefined when it has none yet */
export const site = (code) =>
  (strings[code] ??= existsSync(new URL(`../src/site/${code}.json`, import.meta.url)) ? read(code) : undefined)
/** The languages that have their strings, English first */
export const translated = () => Object.keys(LANGS).filter((code) => site(code))

export const PAGES = FILES.map((file) => ({ file, ...site('en').meta[file], glyph: GLYPHS[file] }))

/** Every address that gets a prerendered HTML file, as a route: the landing and the pages of each language that has strings */
export const routes = () => translated().flatMap((code) => ['home', ...FILES].map((file) => new URL(urlOf(code, file)).pathname))

