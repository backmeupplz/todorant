/**
 * Promo links land here with `?utm_campaign=…`. This tab keeps it (and nothing else) so that creating an account sends it to
 * our own server, which only counts new accounts per day and campaign. No analytics, nothing about the person
 */
const KEY = 'utm_campaign'
const VALID = /^[A-Za-z0-9_-]{1,64}$/

/** Keeps a valid utm_campaign from the address; anything else is dropped */
export function keepCampaign(search = location.search) {
  const value = new URLSearchParams(search).get(KEY)
  try {
    if (value !== null && VALID.test(value)) sessionStorage.setItem(KEY, value)
  } catch {}
}

/** The campaign this tab arrived with, if any */
export function campaign() {
  try {
    const value = sessionStorage.getItem(KEY)
    return value !== null && VALID.test(value) ? value : undefined
  } catch {}
}

export function forgetCampaign() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {}
}
