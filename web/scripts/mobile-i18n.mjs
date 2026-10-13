// Copies the mobile app's strings that the web uses ('m.<key>' literals in src/) into src/i18n/<lang>.json under "m",
// so both apps share one set of translations. Run after adding or removing an m.* key: node scripts/mobile-i18n.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const web = new URL('..', import.meta.url).pathname
const mobile = join(web, '../android/app/src/main/assets/translations')
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]))
const keys = new Set()
for (const file of files(join(web, 'src')).filter((f) => /\.tsx?$/.test(f)))
  // Any 'm.<key>' string literal: keys are also passed around (info="m.infoCurrent", ternaries)
  for (const [, key] of readFileSync(file, 'utf8').matchAll(/['"`]m\.([\w.-]+)['"`]/g)) keys.add(key)

const get = (o, path) => path.split('.').reduce((v, k) => v?.[k], o)
const set = (o, path, value) => {
  const parts = path.split('.')
  parts.slice(0, -1).reduce((v, k) => (v[k] ??= {}), o)[parts.at(-1)] = value
}
const LANGS = { en: 'en', ru: 'ru', uk: 'uk', es: 'es', it: 'it', 'pt-BR': 'pt-br' }
for (const [lang, source] of Object.entries(LANGS)) {
  const from = JSON.parse(readFileSync(join(mobile, `${source}.json`), 'utf8'))
  const target = join(web, `src/i18n/${lang}.json`)
  const json = JSON.parse(readFileSync(target, 'utf8'))
  json.m = {}
  for (const key of [...keys].sort()) {
    const value = get(from, key)
    if (value !== undefined) set(json.m, key, value)
    else if (lang === 'en') console.warn(`missing in mobile en.json: ${key}`)
  }
  writeFileSync(target, JSON.stringify(json, null, 2) + '\n')
}
console.log(`${keys.size} mobile keys synced`)
