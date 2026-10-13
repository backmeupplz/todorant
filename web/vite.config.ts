import { defineConfig } from 'vite'
import { copyFileSync } from 'node:fs'

export default defineConfig({
  // Preact's JSX runtime, straight from Vite's transformer (no framework plugin needed)
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  plugins: [
    // GitHub Pages serves 404.html for unknown paths, so deep links boot the SPA
    { name: 'spa-404', closeBundle: () => copyFileSync('dist/index.html', 'dist/404.html') },
  ],
  build: { target: 'es2022', cssMinify: true },
})
