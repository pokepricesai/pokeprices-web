#!/usr/bin/env node
// scripts/seo/build-card-shows-indexnow.mjs
//
// Block 5A-W-54C — permanent helper for card-show IndexNow submissions.
// Read-only. No network I/O unless --check-live is passed. Two modes:
//
//   MODE 1 — audit (default)
//     node scripts/seo/build-card-shows-indexnow.mjs --check-live
//     Prints per-country counts + verifies sitemap-card-shows.xml
//     health on production.
//
//   MODE 2 — emit URLs (pipe into npm run indexnow)
//     Whichever of these fits your situation:
//       --emit-urls                 Emit URLs added on the most recent
//                                   lastChecked date in cardShows.ts.
//                                   Convenient for "after adding a
//                                   batch of shows today, submit them".
//       --emit-urls --all-upcoming  Emit ALL upcoming non-cancelled
//                                   event URLs + the six hub/country
//                                   URLs. Use when unsure what changed
//                                   or when the calendar was updated
//                                   in several passes.
//       --emit-urls --since YYYY-MM-DD
//                                   Emit URLs whose lastChecked >= the
//                                   given ISO date.
//
//     Piping example:
//       node scripts/seo/build-card-shows-indexnow.mjs --emit-urls \
//         --all-upcoming > /tmp/card-show-urls.txt \
//         && npm run indexnow -- --file /tmp/card-show-urls.txt
//
// The emitted list always includes the six hub + country pages so
// their live count / freshness updates get re-pinged too.

import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const args = new Set(argv)
const CHECK_LIVE  = args.has('--check-live')
const EMIT_ONLY   = args.has('--emit-urls')
const ALL_UPCOMING = args.has('--all-upcoming')
const sinceIdx = argv.indexOf('--since')
const SINCE = sinceIdx >= 0 && argv[sinceIdx + 1] ? argv[sinceIdx + 1] : null

const src = readFileSync('src/data/cardShows.ts', 'utf8')

// Parse each event object literal for id / country / slug / lastChecked.
const arrStart = src.indexOf('export const cardShows: CardShow[] = [')
const arrEnd   = src.indexOf('\n]\n', arrStart)
const body     = src.slice(arrStart, arrEnd)

const re = /\{\s*id:\s*'([^']+)',[\s\S]*?country:\s*'([a-z]{2})',[\s\S]*?slug:\s*'([^']+)',[\s\S]*?startDate:\s*'(\d{4}-\d{2}-\d{2})',[\s\S]*?(?:endDate:\s*'(\d{4}-\d{2}-\d{2})',)?[\s\S]*?status:\s*'([a-z]+)',[\s\S]*?lastChecked:\s*'(\d{4}-\d{2}-\d{2})',/g
// The `id`/`slug` order varies (some entries have slug before country);
// fall back to a per-object parser.
const entries = []
// Split at "  {\n" (2-space indented object start) — crude but works
// because the file's inner formatting is consistent.
const objRe = /\{\s*id:\s*'([^']+)',[\s\S]*?\},/g
let m
while ((m = objRe.exec(body)) !== null) {
  const block = m[0]
  const id       = /id:\s*'([^']+)'/.exec(block)?.[1]
  const country  = /country:\s*'([a-z]{2})'/.exec(block)?.[1]
  const slug     = /slug:\s*'([^']+)'/.exec(block)?.[1]
  const startDate= /startDate:\s*'(\d{4}-\d{2}-\d{2})'/.exec(block)?.[1]
  const endDate  = /endDate:\s*'(\d{4}-\d{2}-\d{2})'/.exec(block)?.[1] ?? null
  const status   = /status:\s*'([a-z]+)'/.exec(block)?.[1]
  const lastChecked = /lastChecked:\s*'(\d{4}-\d{2}-\d{2})'/.exec(block)?.[1]
  if (id && country && slug && startDate && lastChecked) {
    entries.push({ id, country, slug, startDate, endDate, status, lastChecked })
  }
}
void re, m

const todayIso = new Date().toISOString().slice(0, 10)
const upcoming  = entries.filter(e => (e.endDate || e.startDate) >= todayIso && e.status === 'upcoming')

// Most-recent lastChecked in the file — used as the default cohort
// selector so a same-day script/npm run picks up the events you just
// finished importing.
const mostRecentLastChecked = entries.reduce((acc, e) =>
  !acc || e.lastChecked > acc ? e.lastChecked : acc, /** @type {string|null} */ (null))

const url = (e) => `https://www.pokeprices.io/card-shows/${e.country}/${e.slug}`

const hubAndCountryUrls = [
  'https://www.pokeprices.io/card-shows',
  'https://www.pokeprices.io/card-shows/uk',
  'https://www.pokeprices.io/card-shows/us',
  'https://www.pokeprices.io/card-shows/ca',
  'https://www.pokeprices.io/card-shows/au',
  'https://www.pokeprices.io/card-shows/nz',
]

// ── Emit mode ──
if (EMIT_ONLY) {
  let cohort
  if (ALL_UPCOMING) {
    cohort = upcoming
  } else if (SINCE) {
    cohort = entries.filter(e => e.lastChecked >= SINCE)
  } else if (mostRecentLastChecked) {
    cohort = entries.filter(e => e.lastChecked === mostRecentLastChecked)
  } else {
    cohort = []
  }
  const submitList = [...cohort.map(url), ...hubAndCountryUrls]
  for (const u of submitList) console.log(u)
  process.exit(0)
}

// ── Audit mode (default) ──
const mostRecentCohort = mostRecentLastChecked
  ? entries.filter(e => e.lastChecked === mostRecentLastChecked)
  : []
const upcomingEventUrls = upcoming.map(url)
console.log('── Card-show IndexNow helper ──')
console.log(`Total entries parsed:                              ${entries.length}`)
console.log(`Upcoming non-cancelled (as of ${todayIso}):          ${upcomingEventUrls.length}`)
console.log(`Most recent lastChecked cohort (${mostRecentLastChecked ?? 'n/a'}): ${mostRecentCohort.length}`)
console.log('')
console.log('Most-recent cohort by country:')
for (const c of ['uk', 'us', 'ca', 'au', 'nz']) {
  const cnt = mostRecentCohort.filter(e => e.country === c).length
  console.log(`  ${c.toUpperCase()}: ${cnt}`)
}
console.log('')
console.log('IndexNow emit modes (see file header for full usage):')
console.log(`  --emit-urls                → most-recent cohort + 6 hub URLs = ${mostRecentCohort.length + hubAndCountryUrls.length}`)
console.log(`  --emit-urls --all-upcoming → every upcoming URL + 6 hub URLs = ${upcomingEventUrls.length + hubAndCountryUrls.length}`)
console.log('')

if (CHECK_LIVE) {
  console.log('── Live sitemap-card-shows.xml audit ──')
  const res = await fetch('https://www.pokeprices.io/sitemap-card-shows.xml')
  const xml = await res.text()
  console.log(`  status:             ${res.status}`)
  const liveUrls = new Set(Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), m => m[1]))
  console.log(`  <url> count in map: ${liveUrls.size}`)
  const missing = upcomingEventUrls.filter(u => !liveUrls.has(u))
  console.log(`  Upcoming URLs missing from sitemap: ${missing.length}`)
  if (missing.length > 0) for (const u of missing) console.log(`    MISSING: ${u}`)
  console.log('')

  console.log('── Live sitemap.xml + sitemap-pages.xml audit ──')
  const r2 = await fetch('https://www.pokeprices.io/sitemap.xml')
  const idxXml = await r2.text()
  console.log(`  sitemap.xml status: ${r2.status}`)
  console.log(`  references sitemap-card-shows.xml: ${idxXml.includes('sitemap-card-shows.xml') ? 'YES' : 'NO'}`)
  const r3 = await fetch('https://www.pokeprices.io/sitemap-pages.xml')
  const pagesXml = await r3.text()
  console.log(`  sitemap-pages.xml status: ${r3.status}`)
  for (const c of ['uk','us','ca','au','nz']) {
    console.log(`  includes /card-shows/${c}: ${pagesXml.includes(`/card-shows/${c}<`) ? 'YES' : 'NO'}`)
  }
  console.log(`  includes /card-shows: ${pagesXml.includes('/card-shows<') ? 'YES' : 'NO'}`)
}
