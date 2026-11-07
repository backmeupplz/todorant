// What makes each language of each page its own indexable address (run by vite.config.ts after the build): a copy of
// the shell with the language's title, description, share card, canonical, og:locale and the full hreflang set,
// plus sitemap.xml with the alternates and llms.txt with the translations
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { FILES, LANGS, ORIGIN, TOOLS, folder, site, translated, urlOf } from './pages.mjs'

const attr = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const text = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const meta = (html, key, value) => html.replace(new RegExp(`(<meta (?:name|property)="${key}" content=")[^"]*"`), (_, head) => `${head}${attr(value)}"`)
/** The share card of a page: the English landing's is a picture (og.png), every other one is drawn from the page's words */
const imageOf = (code, file) => `${ORIGIN}/img/${code === 'en' ? (file === 'home' ? 'og.png' : `og-${file}.jpg`) : `og-${folder(code)}-${file}.jpg`}`
const alternates = (file) => [
  ...translated().map((code) => `<link rel="alternate" hreflang="${code}" href="${urlOf(code, file)}">`),
  `<link rel="alternate" hreflang="x-default" href="${urlOf('en', file)}">`,
].join('\n    ')

/** The shell as the page `file` ('home' or one of FILES) in language `code` */
function page(shell, code, file) {
  const s = site(code)
  const m = s.meta[file]
  const home = file === 'home'
  const url = urlOf(code, file)
  const image = imageOf(code, file)
  const [, locale, dir] = LANGS[code]
  const imageAlt = home ? m.ogAlt : m.alt
  const title = home ? m.ogTitle : m.title
  const description = home ? m.ogDescription : m.description
  let html = shell
    .replace('<html lang="en">', `<html lang="${code}" dir="${dir}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${text(m.title)}</title>`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, `$1${url}"`)
  for (const [key, value] of [['description', m.description], ['og:url', url], ['og:title', title], ['og:description', description], ['og:image', image],
    ['og:image:type', image.endsWith('.png') ? 'image/png' : 'image/jpeg'], ['og:image:alt', imageAlt], ['twitter:title', title], ['twitter:description', description],
    ['twitter:image', image], ['twitter:image:alt', imageAlt]]) html = meta(html, key, value)
  // og:locale and its alternates, then the hreflang set, which lists every language including this one
  const locales = translated().filter((c) => c !== code).map((c) => `<meta property="og:locale:alternate" content="${LANGS[c][1]}">`)
  html = html.replace(/(<meta property="og:site_name"[^>]*>)/, `$1\n    <meta property="og:locale" content="${locale}">\n    ${locales.join('\n    ')}`)
  html = html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n    ${alternates(file)}`)
  // The structured data says what the page says, in its language
  html = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, (_, open, json, close) => {
    const ld = JSON.parse(json)
    Object.assign(ld, { description: s.meta.home.ogDescription, inLanguage: code, url: urlOf(code, 'home'), image: imageOf(code, 'home') })
    return `${open}\n    ${JSON.stringify(ld, null, 1).replace(/\n/g, '\n    ')}\n    ${close}`
  })
  return html
}

export function buildPages(dist) {
  const shell = readFileSync(`${dist}/index.html`, 'utf8')
  const write = (path, html) => (mkdirSync(dirname(path), { recursive: true }), writeFileSync(path, html))
  for (const code of translated()) {
    const dir = code === 'en' ? dist : `${dist}/${folder(code)}`
    write(`${dir}/index.html`, page(shell, code, 'home'))
    for (const file of FILES) write(`${dir}/${file}.html`, page(shell, code, file))
  }
  // sitemap.xml: the pages worth finding (not the account deletion page) with each one's alternates
  const urls = ['home', ...FILES.filter((f) => f !== 'delete-account')].flatMap((file) =>
    translated().map((code) => `  <url>\n    <loc>${urlOf(code, file)}</loc>\n${[...translated().map((c) => [c, urlOf(c, file)]), ['x-default', urlOf('en', file)]]
      .map(([hreflang, href]) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`).join('\n')}\n  </url>`))
  // Tools are single English pages (public/tools/<name>/index.html), listed without alternates
  urls.push(...TOOLS.map((tool) => `  <url>\n    <loc>${ORIGIN}/tools/${tool}/</loc>\n  </url>`))
  write(`${dist}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`)
  // llms.txt: the English file, then every translation
  const others = translated().filter((c) => c !== 'en')
  const lines = others.map((code) => {
    const m = site(code).meta
    return `- [${LANGS[code][0]}](${urlOf(code, 'home')}): ${FILES.map((f) => `[${m[f].card ?? m[f].title}](${urlOf(code, f)})`).join(', ')}`
  })
  write(`${dist}/llms.txt`, `${readFileSync('public/llms.txt', 'utf8').trimEnd()}\n\n## Translations\n\nThe landing page, the explanation of how Todorant works, the privacy policy, the terms and the account deletion page in each language of the apps. In a translated policy, the English text is the binding one.\n\n${lines.join('\n')}\n`)
}

