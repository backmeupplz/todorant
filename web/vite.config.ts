import { defineConfig, runnerImport } from 'vite'
import { copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'

// Content-Security-Policy for the built page (GitHub Pages can't send headers). Scripts only from here and
// Telegram's login script; network only to the backend (and Telegram's login check).
const api = new URL(process.env.VITE_API ?? 'https://backend.todorant.com')
const csp = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
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
    { name: 'csp', apply: 'build', transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`) },
    // GitHub Pages serves 404.html for unknown paths, so deep links boot the SPA. Pages linked from store
    // listings get their own copy with the text already in it: Pages serves /privacy from privacy.html with a
    // 200, and crawlers (like Play's privacy policy check) read it without running the app
    {
      name: 'spa-404',
      async closeBundle() {
        copyFileSync('dist/index.html', 'dist/404.html')
        const { module: pages } = await runnerImport<typeof import('./src/views/static')>('./src/views/static.tsx', { configFile: false, oxc: { jsx } })
        const shell = readFileSync('dist/index.html', 'utf8')
        for (const [file, title, Page] of [
          ['privacy', 'Privacy Policy', pages.Privacy],
          ['terms', 'Terms of Use', pages.Terms],
          ['delete-account', 'Delete your account', pages.DeleteAccount],
        ] as const) {
          const html = shell
            .replace(/<title>[^<]*<\/title>/, `<title>${title} — Todorant</title>`)
            .replaceAll('"https://todorant.com/"', `"https://todorant.com/${file}"`)
            .replace('<div id="app"></div>', `<div id="app">${renderToString(h(Page, null))}</div>`)
          writeFileSync(`dist/${file}.html`, html)
        }
        // Local QA helpers (a test session, phone frame) live in public/ but must never ship
        for (const f of readdirSync('dist')) if (f.startsWith('qa-')) rmSync(`dist/${f}`)
      },
    },
  ],
  build: { target: 'es2022', cssMinify: true },
})
