// Share cards (1200×630) for the pages that have their own HTML file, in the landing's look: the orange
// gradient, the white logo, the page's title and one line about it. Renders each card in headless Chrome and
// writes public/img/og-<page>.jpg; vite.config.ts points each page's og:image and twitter:image at its card.
// Usage: node scripts/og.mjs   (Chrome from CHROME_PATH or the usual places; commit the images it writes)
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { PAGES } from './pages.mjs'

const chrome = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((f) => f && existsSync(f))
if (!chrome) throw new Error('No Chrome found: set CHROME_PATH')

const dataUrl = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`
const logo = dataUrl('public/img/logo-small.svg', 'image/svg+xml')
const phone = dataUrl('public/img/screenshots/en.webp', 'image/webp')
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

const card = (p) => `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0 }
  body { width: 1200px; height: 630px; overflow: hidden; color: #fff; font-family: -apple-system, "SF Pro Display", Inter, system-ui, sans-serif;
    background: radial-gradient(800px 640px at 0% 0%, #ff5310, transparent 70%), linear-gradient(115deg, #ff5d1c, #ff7d3f 55%, #ffaa80) }
  main { position: absolute; inset: 0; padding: 70px 76px; display: flex; flex-direction: column }
  .logo { height: 46px; width: auto; align-self: flex-start; filter: brightness(0) invert(1) }
  h1 { margin-top: auto; font-size: 78px; line-height: 1.02; letter-spacing: -2.5px; font-weight: 800; max-width: 660px }
  p { margin-top: 22px; font-size: 29px; line-height: 1.36; max-width: 640px; opacity: .96 }
  .url { margin-top: 32px; align-self: flex-start; padding: 12px 20px; border-radius: 14px; background: rgba(255,255,255,.22); font-size: 25px; font-weight: 600 }
  .phone { position: absolute; right: 70px; top: 52px; width: 300px; padding: 12px; border-radius: 48px; background: #111; transform: rotate(6deg);
    box-shadow: 0 34px 90px rgba(80, 20, 0, .35) }
  .phone img { display: block; width: 100%; border-radius: 37px }
  .glyph { position: absolute; right: 120px; top: 150px; width: 330px; height: 330px; border-radius: 50%; background: rgba(255,255,255,.17);
    display: flex; align-items: center; justify-content: center; font-size: 150px }
</style><main>
  <img class="logo" src="${logo}" alt="">
  <h1>${esc(p.card || p.title)}</h1>
  <p>${esc(p.line)}</p>
  <div class="url">todorant.com/${p.file}</div>
</main>${p.glyph ? `<div class="glyph">${p.glyph}</div>` : `<div class="phone"><img src="${phone}" alt=""></div>`}`

const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 630 })
  for (const p of PAGES) {
    await page.setContent(card(p), { waitUntil: 'load' })
    writeFileSync(`public/img/og-${p.file}.jpg`, await page.screenshot({ type: 'jpeg', quality: 90 }))
    console.log(`public/img/og-${p.file}.jpg`)
  }
} finally {
  await browser.close()
}
