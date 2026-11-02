// No app imports besides the strings: the build also renders these pages to static HTML (vite.config.ts).
// The text is HTML in src/site/<lang>.json: the English is bundled with this page, a translation comes with the address's language
import { html, ui } from '../site'
import { base } from '../ui/router'
import { tRaw } from '../i18n'
import { html as enHtml, ui as enUi } from '../site/en.json'
import { rules as enRules } from '../i18n/en.json'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const LEGAL = ['privacy', 'terms', 'delete-account']

/** A standalone page: its HTML, with the app's own rules where it lists them and its links pointing into the page's language */
function Page({ file }: { file: string }) {
  const translation = html.value
  const rules: string[] = translation ? tRaw('rules') : enRules
  const words = translation ? ui.value : enUi
  let text = ((translation ?? enHtml) as Record<string, string>)[file].replace('<!--rules-->', rules.map((rule) => `<li>${esc(rule)}</li>`).join(''))
  // A translated policy says that the English text is the binding one
  if (translation && LEGAL.includes(file)) text = text.replace('</h1>', `</h1>\n<p>${words.binding.replace('{en}', `https://todorant.com/${file}`)}</p>`)
  text += `\n<p><a href="/">${words.back}</a></p>`
  return <article class="static" dangerouslySetInnerHTML={{ __html: text.replaceAll('href="/', `href="${base.value}/`) }} />
}

export const Privacy = () => <Page file="privacy" />
export const Terms = () => <Page file="terms" />
export const DeleteAccount = () => <Page file="delete-account" />
/** What Todorant is and how it works, as plain HTML that search engines and AI crawlers can read without running the app */
export const HowItWorks = () => <Page file="how-it-works" />
