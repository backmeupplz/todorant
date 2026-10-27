import { defineConfig } from 'vite'
import { copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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
    // GitHub Pages serves 404.html for unknown paths, so deep links boot the SPA. Pages linked from store
    // listings get their own file with their own title and canonical: Pages serves /privacy from privacy.html
    // with a 200. `npm run prerender` then fills the landing and these pages with their text for crawlers (like
    // Play's privacy policy check) that don't run the app; 404.html stays empty for app routes
    {
      name: 'spa-404',
      closeBundle() {
        copyFileSync('dist/index.html', 'dist/404.html')
        const shell = readFileSync('dist/index.html', 'utf8')
        for (const [file, title] of [
          ['privacy', 'Privacy Policy'],
          ['terms', 'Terms of Use'],
          ['delete-account', 'Delete your account'],
          ['how-it-works', 'How Todorant works'],
        ]) {
          const html = shell
            .replace(/<title>[^<]*<\/title>/, `<title>${title} — Todorant</title>`)
            .replaceAll('"https://todorant.com/"', `"https://todorant.com/${file}"`)
          writeFileSync(`dist/${file}.html`, html)
        }
        // Local QA helpers (a test session, phone frame) live in public/ but must never ship
        for (const f of readdirSync('dist')) if (f.startsWith('qa-')) rmSync(`dist/${f}`)
      },
    },
  ],
  build: { target: 'es2022', cssMinify: true },
})
