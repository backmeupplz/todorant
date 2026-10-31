# Search page: eat the frog

A custom product page that App Store search shows instead of the default page for "eat the frog" and "frog"
(prime-radiant experiments/2026-10-28-todorant-keyword-cpp.md, agentboard #262). appstore/cpp.py renders its
screenshots, assigns its keywords and sends it to App Review. The live keywords are per locale: 2.2.11 has
"eat the frog" in en-US, while appstore/listing.md and en-GB/listing.md split it into "eat" and "frog" from the next
release, so each localization gets the ones its locale has: "eat the frog" now, "frog" from the next release (not
"eat", which would show this page for every "eat" search). The 22 storefronts of #262 with their own language reach
the page through their en-GB index, so frog/<locale>.md gives it their texts and screenshots (agentboard #264); the
keywords stay English.

## Name
Eat the frog

## Promotional text (max 170)
Eat the frog first: Todorant puts your hardest task at the top and shows one task at a time.

## Locales
en-GB

## Keywords
eat the frog, frog

## Screenshots
frog/02-planning: Eat the frog: your hardest task always comes first
frog/01-current: See only the one task to do right now
frog/06-rules: 17 simple rules that beat procrastination
frog/03-add: Mark the tasks you dread as frogs
frog/05-dark: Plan your day in dark mode too
