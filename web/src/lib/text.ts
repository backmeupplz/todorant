export type Part = { kind: 'plain' | 'link' | 'hash'; value: string; url?: string }

const HASH = '\\u0400-\\u04FFa-zA-Z_0-9'
const TLDS = 'com|org|net|io|ru|ua|me|co|dev|app|info|biz|edu|gov|uk|de|fr|it|es|br|pt|us|ca|au|in|jp|cn|tv|xyz|ai|ly|gg|so|to|fm|am|by|kz|su|рф|onion|link|site|online|store|blog|news|page|ws|cc|eu|nl|pl|ch|se|no|fi|cz|il|tr'
const pattern = new RegExp(
  `(?<![\\w@/#])(?:(?:https?|ftp)://[^\\s<>"]+|www\\.[^\\s<>"]+|(?:[\\p{L}\\d-]+\\.)+(?:${TLDS})(?![\\p{L}\\d-])(?:[/?#][^\\s<>"]*)?)` +
    `|(?<=^|[^#_\\p{L}\\p{N}])#[${HASH}]+`,
  'giu',
)

const normalize = (raw: string) => (/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`)

/** "host/..." when there's more than a host, like the apps show links */
function display(raw: string) {
  try {
    const u = new URL(normalize(raw))
    return u.pathname.replace(/\//g, '') || u.search || u.hash ? `${u.host}/...` : u.host
  } catch {
    return raw
  }
}

/** Splits text into plain text, links and #hashtags (cached: rows re-render often, texts rarely change) */
const parsed = new Map<string, Part[]>()
export function linkify(text: string): Part[] {
  let parts = parsed.get(text)
  if (!parts) {
    if (parsed.size > 5000) parsed.clear()
    parsed.set(text, (parts = parse(text)))
  }
  return parts
}

function parse(text: string): Part[] {
  const parts: Part[] = []
  let end = 0
  for (const m of text.matchAll(pattern)) {
    let raw = m[0]
    if (!raw.startsWith('#')) raw = raw.replace(/[.,;:!?)\]}'"]+$/, '')
    if (!raw) continue
    if (m.index! > end) parts.push({ kind: 'plain', value: text.slice(end, m.index) })
    parts.push(raw.startsWith('#') ? { kind: 'hash', value: raw } : { kind: 'link', value: display(raw), url: normalize(raw) })
    end = m.index! + raw.length
  }
  if (end < text.length || !parts.length) parts.push({ kind: 'plain', value: text.slice(end) })
  return parts
}

/** Hashtags in a text, without '#' */
export const hashtags = (text: string) => linkify(text).filter((p) => p.kind === 'hash').map((p) => p.value.slice(1))

export const ellipsize = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}...` : s)
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
