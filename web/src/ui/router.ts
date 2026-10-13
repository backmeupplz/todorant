import { signal } from '../lib/state'

/** The current location; history API routing (GitHub Pages serves 404.html = index.html for deep links) */
export const path = signal(location.pathname)
export const query = signal(new URLSearchParams(location.search))
export const hash = signal(decodeURIComponent(location.hash.slice(1)))

function read() {
  path.value = location.pathname
  query.value = new URLSearchParams(location.search)
  hash.value = decodeURIComponent(location.hash.slice(1))
}
addEventListener('popstate', read)
addEventListener('hashchange', read)

export function go(to: string, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  read()
}

/** Planning's hashtag filter lives in the URL hash ("#a,#b") like the old site */
export const hashTags = () => hash.value.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean)
export function setHashTags(tags: string[]) {
  history.replaceState(null, '', location.pathname + location.search + (tags.length ? '#' + tags.map((x) => '#' + x).join(',') : ''))
  read()
}

export type TabName = 'current' | 'planning' | 'delegation' | 'settings'
/** App screens: /current, /planning, /delegation, /settings[/page]; /superpower is the old site's address for Current */
export function appRoute(p = path.value): { tab: TabName; page?: string } | null {
  if (p === '/superpower' || p === '/current') return { tab: 'current' }
  const m = p.match(/^\/(planning|delegation|settings)(?:\/([\w-]+))?\/?$/)
  return m ? { tab: m[1] as TabName, page: m[2] } : null
}

/** Opens Planning filtered by a hashtag (added to the current filter when already there) */
export function filterByTag(name: string) {
  const tags = path.value === '/planning' ? hashTags() : []
  if (!tags.includes(name)) tags.push(name)
  go('/planning#' + tags.map((x) => '#' + x).join(','))
}
