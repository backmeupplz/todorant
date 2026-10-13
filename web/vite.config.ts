import { defineConfig } from 'vite'
import { copyFileSync, readdirSync, rmSync } from 'node:fs'

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

export default defineConfig({
  // Preact's JSX runtime, straight from Vite's transformer (no framework plugin needed)
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  plugins: [
    { name: 'csp', apply: 'build', transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`) },
    // GitHub Pages serves 404.html for unknown paths, so deep links boot the SPA
    {
      name: 'spa-404',
      closeBundle() {
        copyFileSync('dist/index.html', 'dist/404.html')
        // Local QA helpers (a test session, phone frame) live in public/ but must never ship
        for (const f of readdirSync('dist')) if (f.startsWith('qa-')) rmSync(`dist/${f}`)
      },
    },
  ],
  build: { target: 'es2022', cssMinify: true },
})
