import { LANGUAGES, language, folder, urlLanguage, type Language } from '../i18n'
import { ui } from '../site'

/** Every language of a page as a plain link, in the language's own name: how search engines and people find the translations. `file` is the page's name ('' for the landing) */
export function LangNav({ file }: { file: string }) {
  const here = urlLanguage() ?? 'en'
  return (
    <nav class="langs" aria-label={ui.value.language}>
      {(Object.entries(LANGUAGES) as [Language, string][]).map(([code, name]) => (
        <a key={code} href={`${folder(code)}/${file}`} lang={code} hreflang={code} aria-current={code === here ? 'page' : undefined}>{name}</a>
      ))}
    </nav>
  )
}
