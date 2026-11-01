# Search page: eat the frog

A custom product page that App Store search shows instead of the default page for "eat the frog" and "frog"
(prime-radiant experiments/2026-10-28-todorant-keyword-cpp.md, agentboard #262). appstore/cpp.py renders its
screenshots, assigns its keywords and sends it to App Review. Apple assigns a localization only the keywords its
locale's app keyword field has on the live version, so each one gets those of them its locale has there: 2.2.12 splits
the phrase into "eat" and "frog", so en-US and en-GB have "frog" (not "eat", which would show this page for every "eat"
search), and appstore/listing.md and en-GB/listing.md carry "eat the frog" whole again from the release after it
(agentboard #358). The 22 storefronts of #262 with their own language reach the page through their en-GB index, so
frog/<locale>.md gives it their texts and screenshots (agentboard #264), and the frog keyword its own field already
has (#358): the frog word, or the phrase in ja, zh-Hans and zh-Hant. de-DE, es-ES, es-MX, fr-FR and ru have none,
because people there search for it in English (prime-radiant projects/todorant/drafts/aso-<locale>.md), so they take
no keywords of their own.

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
