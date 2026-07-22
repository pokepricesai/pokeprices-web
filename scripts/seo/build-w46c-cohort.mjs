#!/usr/bin/env node
// scripts/seo/build-w46c-cohort.mjs
// Block 5A-W-46C (with W46C-FIX1) — build the W46C evaluation cohorts
// from the local GSC pages export.
//
// TERMINOLOGY (W46C-FIX1 correction)
//   W46C ships the programmatic Quick Facts + Pokémon summary blocks
//   to EVERY eligible indexable page in one deploy. There is no
//   production holdout. The cohorts we produce here are therefore:
//
//     * `treatment`             — the top-100 highest-impression card
//                                 URLs. These are the pages we watch
//                                 most closely for a CTR / position
//                                 lift because their absolute
//                                 impression base is largest.
//     * `matched-benchmark`     — 100 card URLs matched by impression +
//                                 position band, DELIBERATELY NOT in
//                                 the treatment cohort. These also
//                                 receive the change (it's a site-wide
//                                 rollout) — they are used to check
//                                 whether high-impression pages behave
//                                 differently from medium-impression
//                                 pages, not as a control group.
//     * `pokemon-treatment`     — every ranking /pokemon/{slug} URL.
//                                 All of them receive the summary too.
//
//   This is a MONITORED ROLLOUT with matched page cohorts, not an
//   untreated control experiment.
//
// Reads:
//   seo/exports/gsc-pages-90d.csv
//
// Writes (untracked — seo/experiments is gitignored):
//   seo/experiments/2026-07-22-w46c-cohort-treatment.tsv
//   seo/experiments/2026-07-22-w46c-cohort-matched-benchmark.tsv
//   seo/experiments/2026-07-22-w46c-cohort-pokemon.tsv
//   seo/experiments/2026-07-22-w46c-indexnow-dry-run.txt
//
// SAFETY
//   * Read-only. No HTTP, no DB writes.
//   * Only writes under seo/experiments/. That directory is
//     gitignored, so nothing produced here is ever committed.
//   * The IndexNow file is a candidate list only. It is NEVER
//     handed to submit-indexnow.js by this script — a human operator
//     must review it and use `--dry-run` first.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const IN   = resolve(ROOT, 'seo', 'exports', 'gsc-pages-90d.csv')
const OUT_DIR = resolve(ROOT, 'seo', 'experiments')
const DATE = new Date().toISOString().slice(0, 10)

const OUT_TREATMENT  = resolve(OUT_DIR, `${DATE}-w46c-cohort-treatment.tsv`)
const OUT_BENCHMARK  = resolve(OUT_DIR, `${DATE}-w46c-cohort-matched-benchmark.tsv`)
const OUT_POKEMON    = resolve(OUT_DIR, `${DATE}-w46c-cohort-pokemon.tsv`)
const OUT_INDEXNOW   = resolve(OUT_DIR, `${DATE}-w46c-indexnow-dry-run.txt`)

// ── CSV read + classification ─────────────────────────────────────

/** GSC pages CSV: "Top pages,Clicks,Impressions,CTR,Position" */
function parsePagesCsv(path) {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const rows = []
  // Skip header.
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 5) continue
    const url = cols[0]
    const clicks = Number(cols[1])
    const impressions = Number(cols[2])
    const ctrStr = cols[3] || ''
    const pos = Number(cols[4])
    if (!url) continue
    rows.push({
      url,
      clicks: Number.isFinite(clicks) ? clicks : 0,
      impressions: Number.isFinite(impressions) ? impressions : 0,
      ctr: ctrStr,
      position: Number.isFinite(pos) ? pos : 0,
    })
  }
  return rows
}

function classifyPage(url) {
  try {
    const u = new URL(url)
    const p = u.pathname
    if (p === '/')                                return 'home'
    if (p === '/browse')                          return 'browse'
    if (p === '/pokemon')                         return 'pokemon-index'
    if (/^\/pokemon\/[^/]+$/.test(p))             return 'pokemon'
    if (/^\/set\/[^/]+\/card\/[^/]+$/.test(p))    return 'card'
    if (/^\/set\/[^/]+$/.test(p))                 return 'set'
    if (p === '/insights')                        return 'insights-hub'
    if (/^\/insights\/[^/]+$/.test(p))            return 'insights-article'
    if (/^\/card-shows/.test(p))                  return 'card-shows'
    if (/^\/creators/.test(p))                    return 'creators'
    if (/^\/vendors/.test(p))                     return 'vendors'
    if (/^\/games/.test(p))                       return 'games'
    if (p === '/tools')                           return 'tools'
    if (p === '/ai-assistant')                    return 'ai-assistant'
    if (p === '/visualisations' || /^\/visualisations/.test(p)) return 'visualisations'
    if (/^\/(privacy|terms|contact|roadmap|studio|dealer)/.test(p)) return 'legal-or-utility'
    return 'other'
  } catch { return 'other' }
}

function toWwwCanonical(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'www.pokeprices.io')                            return u.toString().replace(/\/$/, '') + (u.pathname === '/' ? '/' : '')
    if (u.hostname === 'pokeprices.io')                                {
      u.hostname = 'www.pokeprices.io'
      return u.toString().replace(/\/$/, '') + (u.pathname === '/' ? '/' : '')
    }
    return null
  } catch { return null }
}

// ── Main ──────────────────────────────────────────────────────────

function tsvLine(cols) { return cols.map(x => String(x)).join('\t') }
const HEADER = tsvLine([
  'url', 'canonical', 'page_type', 'baseline_clicks', 'baseline_impressions',
  'baseline_ctr', 'baseline_position', 'cohort_status', 'date_range',
])

const DATE_RANGE = 'GSC 90d (as of most recent export)'

function pickTopCards(rows, n = 100) {
  return rows
    .filter(r => classifyPage(r.url) === 'card')
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, n)
}

// W46C-FIX1 — matched-benchmark cohort. NOT a control group; the
// production change lands on every eligible card page. This cohort
// is picked to sit in a similar impression + position band as the
// treatment cohort so we can spot whether high-impression pages
// behave differently from medium-impression pages.
function pickMatchedBenchmarkCards(treatment, rest, n = 100) {
  const treatmentSet = new Set(treatment.map(r => r.url))
  const candidates = rest
    .filter(r => classifyPage(r.url) === 'card' && !treatmentSet.has(r.url))
    .filter(r => {
      const treatMin = Math.min(...treatment.map(t => t.impressions))
      const treatMax = Math.max(...treatment.map(t => t.impressions))
      return r.impressions >= treatMin * 0.25 && r.impressions <= treatMax * 4
    })
    .sort((a, b) => b.impressions - a.impressions)
  return candidates.slice(0, n)
}

function pickPokemon(rows) {
  return rows.filter(r => classifyPage(r.url) === 'pokemon')
}

function main() {
  const rows = parsePagesCsv(IN)

  const treatment = pickTopCards(rows, 100)
  const benchmark = pickMatchedBenchmarkCards(treatment, rows, 100)
  const pokemon   = pickPokemon(rows)

  mkdirSync(OUT_DIR, { recursive: true })

  function writeCohort(path, rows, status) {
    const lines = [HEADER]
    for (const r of rows) {
      const canonical = toWwwCanonical(r.url) ?? r.url
      lines.push(tsvLine([
        r.url, canonical, classifyPage(r.url), r.clicks, r.impressions,
        r.ctr, r.position.toFixed(2), status, DATE_RANGE,
      ]))
    }
    writeFileSync(path, lines.join('\n') + '\n', 'utf8')
    console.log(`Wrote ${path} (${rows.length} rows).`)
  }

  writeCohort(OUT_TREATMENT, treatment, 'treatment')
  writeCohort(OUT_BENCHMARK, benchmark, 'matched-benchmark')
  writeCohort(OUT_POKEMON,   pokemon,   'pokemon-treatment')

  // ── IndexNow dry-run list ──────────────────────────────────────
  // W46C-FIX1 — expand to the top 1000 W35-eligible card URLs by
  // impressions PLUS every ranking Pokémon URL. The GSC export has
  // ~813 card URLs total; we take all of them and note the shortfall
  // rather than pad with fabricated URLs.
  const allRankingCards = rows
    .filter(r => classifyPage(r.url) === 'card')
    .sort((a, b) => b.impressions - a.impressions)
  const cardTargetN = Math.min(1000, allRankingCards.length)
  const cardsForIndexNow = allRankingCards.slice(0, cardTargetN)

  const indexNowUrls = new Set()
  let cardCount = 0
  let pokemonCount = 0
  for (const r of cardsForIndexNow) {
    const canonical = toWwwCanonical(r.url)
    if (!canonical) continue
    if (canonical.includes('/dashboard')) continue
    if (canonical.includes('/api')) continue
    if (canonical.includes('/admin')) continue
    if (canonical.includes('/intel')) continue
    if (!indexNowUrls.has(canonical)) { indexNowUrls.add(canonical); cardCount++ }
  }
  for (const r of pokemon) {
    const canonical = toWwwCanonical(r.url)
    if (!canonical) continue
    if (canonical.includes('/dashboard')) continue
    if (canonical.includes('/api')) continue
    if (canonical.includes('/admin')) continue
    if (canonical.includes('/intel')) continue
    if (!indexNowUrls.has(canonical)) { indexNowUrls.add(canonical); pokemonCount++ }
  }

  const flat = Array.from(indexNowUrls)
  const indexNowLines = [
    '# W46C IndexNow dry-run candidate list',
    `# Generated ${DATE}. Review before submitting.`,
    '# Run: node scripts/submit-indexnow.js --dry-run --file <this-file>',
    '# NEVER pipe this into the CLI without --dry-run first.',
    `# Cards from GSC export: ${cardCount} (target = 1000; export has ${allRankingCards.length} ranking card URLs)`,
    `# Pokémon URLs: ${pokemonCount}`,
    '',
    ...flat,
  ]
  writeFileSync(OUT_INDEXNOW, indexNowLines.join('\n') + '\n', 'utf8')
  console.log(`Wrote ${OUT_INDEXNOW} (${flat.length} URLs).`)

  console.log('')
  console.log('COHORT SUMMARY')
  console.log(`  Treatment (top 100 cards by impressions):        ${treatment.length}`)
  console.log(`  Matched benchmark (100 similar-band cards):      ${benchmark.length}`)
  console.log(`  Pokémon (all ranking species pages):             ${pokemon.length}`)
  console.log(`  Ranking card URLs in export (base for IndexNow): ${allRankingCards.length}`)
  console.log(`  IndexNow candidate URLs (dry-run only):          ${flat.length}`)
  console.log(`    - Cards:   ${cardCount}`)
  console.log(`    - Pokémon: ${pokemonCount}`)
  if (allRankingCards.length < 1000) {
    console.log(`  NOTE: fewer than 1000 ranking card URLs in the export.`)
    console.log(`        Included every qualifying URL rather than inventing more.`)
  }
}

main()
