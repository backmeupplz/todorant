import { defineConfig } from 'vite'
import { copyFileSync, readdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { buildPages } from './scripts/seo.mjs'

// Content-Security-Policy for the built page (GitHub Pages can't send headers). Scripts only from here, the
// page's own inline script (by hash) and Telegram's login script; network only to the backend (and Telegram's login check).
const api = new URL(process.env.VITE_API ?? 'https://backend.todorant.com')
const csp = (inline: string) => [
  "default-src 'self'",
  `script-src 'self' 'sha256-${createHash('sha256').update(inline).digest('base64')}' https://telegram.org`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self' ${api.origin} ${api.origin.replace(/^http/, 'ws')} https://oauth.telegram.org`,
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

// Preact's JSX runtime, straight from Vite's transformer (no framework plugin needed)
const jsx = { runtime: 'automatic', importSource: 'preact' } as const

export default defineConfig({
  oxc: { jsx },
  plugins: [
    {
      name: 'csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp(html.match(/<script>([\s\S]*?)<\/script>/)![1])}" />`),
    },
    // GitHub Pages serves 404.html for unknown paths, so deep links boot the SPA. Every page and language gets its own
    // file with its own title and canonical (scripts/seo.mjs: Pages serves /de/privacy from de/privacy.html with a 200), plus
    // sitemap.xml and llms.txt. `npm run prerender` then fills them with their text for crawlers (like Play's privacy policy
    // check) that don't run the app; 404.html stays empty for app routes
    {
      name: 'spa-404',
      closeBundle() {
        copyFileSync('dist/index.html', 'dist/404.html')
        buildPages('dist')
        // Local QA helpers (a test session, phone frame) live in public/ but must never ship
        for (const f of readdirSync('dist')) if (f.startsWith('qa-')) rmSync(`dist/${f}`)
      },
    },
  ],
  build: { target: 'es2022', cssMinify: true },
})
