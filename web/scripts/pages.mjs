// The pages that get their own HTML file (vite.config.ts) and share card (scripts/og.mjs): title, description,
// the card's one line and its picture (a phone with the app, or a big glyph)
export const PAGES = [
  {
    file: 'how-it-works',
    title: 'How Todorant works',
    description: 'The four ideas and the rules behind Todorant: one task at a time, a date for every todo, unpleasant tasks first and an empty inbox.',
    line: 'Four ideas and 17 rules that turn a todo list into finished work.',
    alt: 'How Todorant works: four ideas and 17 rules, next to the app on a phone',
  },
  {
    file: 'privacy',
    title: 'Privacy Policy — Todorant',
    card: 'Privacy Policy',
    description: 'What Todorant collects when you sign in, why, who else sees it and how to delete it. Without an account, the apps keep your todos on your device.',
    line: 'What Todorant collects, why, and how to delete it.',
    alt: "Todorant's Privacy Policy",
    glyph: '🔒',
  },
  {
    file: 'terms',
    title: 'Terms of Use — Todorant',
    card: 'Terms of Use',
    description: 'The terms for using Todorant on the web at todorant.com and in the Android and iPhone apps.',
    line: 'The terms for using Todorant on the web, Android and iPhone.',
    alt: "Todorant's Terms of Use",
    glyph: '📜',
  },
  {
    file: 'delete-account',
    title: 'Delete your Todorant account',
    card: 'Delete your account',
    description: 'How to delete your Todorant account and everything in it, from the apps, the web or by email, and exactly what gets deleted.',
    line: 'From the apps, the web or by email, whenever you want.',
    alt: 'Delete your Todorant account',
    glyph: '🗑️',
  },
]
