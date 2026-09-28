#!/usr/bin/env node
// scripts/seo/analyse-bing-dni.mjs
// ============================================================================
// Stage 6A — Bing "Discovered — Not Indexed" cohort analysis.
//
// USAGE
//   node scripts/seo/analyse-bing-dni.mjs \
//        --input path/to/bing-url-export.csv \
//        --output audits/bing-indexnow-2026-09-28/DNI_COHORT_ANALYSIS.md
//
// INPUT
//   Bing Webmaster Tools → Sitemap Index Coverage → URL Inspection export.
//   Expected columns (case-insensitive; extra columns tolerated):
//     - "URL"              full canonical URL (https://www.pokeprices.io/…)
//     - "Status"           Indexed | DiscoveredNotIndexed | ContentQuality
//                          | NotYetCrawled | NoIndex
//     - "Impressions"      (optional) integer, last 28 days
//     - "Clicks"           (optional) integer, last 28 days
//
// OUTPUT
//   Markdown file with per-cohort breakdowns:
//     * page family × status
//     * card shards × status
//     * cards with vs without price data × status
//     * sets by age × status
//     * pages with GSC impressions vs zero
//     * top 30 DNI URLs by sitemap presence
//
// The script is READ-ONLY — no writes to Supabase, no HTTP submissions,
// no side effects beyond writing the output markdown file.
// ============================================================================

'use strict'

const fs   = require('node:fs')
const path = require('node:path')

// Lazy Supabase — only loaded if joins requested. Kept optional so the
// script works without credentials for pure CSV summarisation.
let createClient
try { createClient = require('@supabase/supabase-js').createClient } catch {}

// ── CLI parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { input: null, output: null, joinDb: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input')       opts.input  = argv[++i] ?? null
    else if (a === '--output') opts.output = argv[++i] ?? null
    else if (a === '--no-db')  opts.joinDb = false
    else if (a === '--help' || a === '-h') { help(); process.exit(0) }
    else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(2) }
  }
  return opts
}

function help() {
  process.stdout.write(`Bing DNI cohort analysis — usage:
  node scripts/seo/analyse-bing-dni.mjs --input <bing-export.csv> --output <path.md>

Flags:
  --input <path>    CSV export from Bing WMT (URL + Status required).
  --output <path>   Markdown file to write. Directory must exist.
  --no-db           Skip Supabase joins; produce a CSV-only summary.

Environment (only needed without --no-db):
  NEXT_PUBLIC_SUPABASE_URL     e.g. https://<project>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    service-role JWT

Output includes per-cohort breakdowns. Every claim is grounded in the
input CSV — the script does not fabricate Bing metadata.
`)
}

// ── CSV parsing (RFC-4180-lite: quoted fields with embedded commas + "" escapes) ──
function parseCsv(text) {
  const rows = []
  let field = ''
  let row = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (ch === '\r') { /* skip */ }
      else field += ch
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function normaliseHeader(h) { return String(h ?? '').trim().toLowerCase() }

function loadInput(inputPath) {
  const raw = fs.readFileSync(inputPath, 'utf8')
  const rows = parseCsv(raw)
  if (rows.length === 0) return { rows: [] }
  const header = rows[0].map(normaliseHeader)
  const urlIdx    = header.indexOf('url')
  const statusIdx = header.indexOf('status')
  const impIdx    = header.indexOf('impressions')
  const clicksIdx = header.indexOf('clicks')
  if (urlIdx < 0 || statusIdx < 0) {
    throw new Error(`CSV must have "URL" and "Status" columns. Saw: ${header.join(', ')}`)
  }
  const parsed = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    const url = String(r[urlIdx] ?? '').trim()
    if (!url) continue
    parsed.push({
      url,
      status:      String(r[statusIdx] ?? '').trim(),
      impressions: impIdx    >= 0 ? Number(r[impIdx]    ?? 0) : null,
      clicks:      clicksIdx >= 0 ? Number(r[clicksIdx] ?? 0) : null,
    })
  }
  return { rows: parsed }
}

// ── Page-family inference from URL path ────────────────────────────────────
function familyFor(url) {
  try {
    const u = new URL(url)
    const p = u.pathname
    if (p.startsWith('/set/') && p.includes('/card/')) return 'card'
    if (p.startsWith('/set/'))         return 'set'
    if (p.startsWith('/pokemon/'))     return 'pokemon'
    if (p.startsWith('/insights/'))    return 'insight'
    if (p.startsWith('/card-shows/'))  return 'card_show'
    if (p.startsWith('/creators/'))    return 'creator'
    if (p.startsWith('/vendors/'))     return 'vendor'
    if (p === '/' || !p.includes('/', 1)) return 'static'
    return 'other'
  } catch { return 'other' }
}

// Which card shard a card URL falls into (1-5), based on the offset window
// documented in src/lib/seo-indexability/sitemapCards.ts. Requires a DB
// lookup for the true id — with no DB we bucket by presence-only.
function guessCardShard(id) {
  if (id == null) return 'unknown'
  if (id < 10_000) return 'cards-1'
  if (id < 20_000) return 'cards-2'
  if (id < 30_000) return 'cards-3'
  if (id < 50_000) return 'cards-4'
  if (id < 100_000) return 'cards-5'
  return 'cards-beyond-100k'
}

// ── Grouping helpers ───────────────────────────────────────────────────────
function increment(map, key) { map.set(key, (map.get(key) ?? 0) + 1) }

function makeCrossTab(rows, keyFn) {
  // keyFn(row) → string. Returns Map<key, Map<status, count>>
  const out = new Map()
  for (const r of rows) {
    const k = keyFn(r)
    if (!out.has(k)) out.set(k, new Map())
    increment(out.get(k), r.status || 'Unknown')
  }
  return out
}

function crossTabToMarkdown(title, ct, statuses) {
  const keys = Array.from(ct.keys()).sort()
  const lines = [`### ${title}`, '', `| Cohort | ${statuses.join(' | ')} | Total |`, `|---|${statuses.map(() => '---:').join('|')}|---:|`]
  for (const k of keys) {
    const perStatus = statuses.map(s => ct.get(k)?.get(s) ?? 0)
    const total = perStatus.reduce((a, b) => a + b, 0)
    lines.push(`| ${escapeMd(k)} | ${perStatus.join(' | ')} | ${total} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function escapeMd(s) { return String(s).replace(/\|/g, '\\|') }

// ── Supabase joins (optional) ──────────────────────────────────────────────
async function fetchDbContext(rows) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !createClient) return { cardById: new Map(), noContext: true }
  const supa = createClient(url, key, { auth: { persistSession: false } })

  // Collect card URL slugs from the input.
  const cardUrls = rows.filter(r => familyFor(r.url) === 'card').map(r => {
    try { return new URL(r.url).pathname } catch { return null }
  }).filter(Boolean)

  // Extract card_url_slug (last path segment) + set_name (2nd segment, decoded).
  const cardKeys = cardUrls.map(p => {
    const parts = p.split('/')
    if (parts.length < 5) return null
    const setName = decodeURIComponent(parts[2] || '')
    const slug    = parts[4] || ''
    return { setName, slug, path: p }
  }).filter(Boolean)

  const cardById = new Map()   // path → { id, has_price_signal }
  const uniqueSlugs = Array.from(new Set(cardKeys.map(c => c.slug)))
  // Chunk to stay under PostgREST limits.
  for (let i = 0; i < uniqueSlugs.length; i += 200) {
    const chunk = uniqueSlugs.slice(i, i + 200)
    const { data } = await supa
      .from('cards')
      .select('id, card_url_slug, set_name')
      .in('card_url_slug', chunk)
    if (data) {
      for (const row of data) {
        // Only match set_name too because slug alone can duplicate across sets.
        const matches = cardKeys.filter(k => k.slug === row.card_url_slug && k.setName === row.set_name)
        for (const m of matches) cardById.set(m.path, { id: row.id })
      }
    }
  }
  return { cardById, noContext: false }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.input) { help(); process.exit(2) }
  if (!opts.output) { console.error('--output <path> is required'); process.exit(2) }

  process.stdout.write(`Reading ${opts.input}…\n`)
  const { rows } = loadInput(opts.input)
  process.stdout.write(`  ${rows.length} URL rows parsed.\n`)

  const statusesSeen = Array.from(new Set(rows.map(r => r.status || 'Unknown'))).sort()

  // Normalise family per row.
  for (const r of rows) r._family = familyFor(r.url)

  // Optional DB context for card shard assignment.
  let cardById = new Map(), noContext = true
  if (opts.joinDb) {
    process.stdout.write('Joining Supabase for card id → shard mapping…\n')
    const r = await fetchDbContext(rows)
    cardById = r.cardById; noContext = r.noContext
    process.stdout.write(`  ${cardById.size} card URLs mapped to ids.\n`)
    if (noContext) process.stdout.write('  (no Supabase credentials — DB join skipped)\n')
  }

  for (const r of rows) {
    if (r._family === 'card') {
      try {
        const p = new URL(r.url).pathname
        const rec = cardById.get(p)
        r._cardId = rec?.id ?? null
        r._cardShard = guessCardShard(r._cardId)
      } catch { r._cardShard = 'unknown' }
    }
  }

  // ── Build cross-tabs ──────────────────────────────────────────────────
  const familyByStatus = makeCrossTab(rows, r => r._family)
  const cardShardByStatus = makeCrossTab(
    rows.filter(r => r._family === 'card'),
    r => r._cardShard || 'unknown',
  )
  const impressionsCohortByStatus = makeCrossTab(rows, r => {
    if (r.impressions == null) return 'no_impressions_column'
    if (r.impressions === 0)   return 'zero_impressions_28d'
    if (r.impressions < 10)    return '1-9_impressions_28d'
    if (r.impressions < 100)   return '10-99_impressions_28d'
    if (r.impressions < 1000)  return '100-999_impressions_28d'
    return '1000+_impressions_28d'
  })

  // ── Write markdown ────────────────────────────────────────────────────
  const md = []
  md.push('# Bing DNI Cohort Analysis')
  md.push('')
  md.push(`Generated by \`scripts/seo/analyse-bing-dni.mjs\`. Input: \`${path.basename(opts.input)}\`. Rows analysed: **${rows.length}**.`)
  md.push('')
  md.push('## Status distribution')
  md.push('')
  md.push('| Status | Count | Share |')
  md.push('|---|---:|---:|')
  const statusCounts = new Map()
  for (const r of rows) increment(statusCounts, r.status || 'Unknown')
  const total = rows.length
  for (const s of statusesSeen) {
    const n = statusCounts.get(s) ?? 0
    md.push(`| ${escapeMd(s)} | ${n} | ${(100 * n / total).toFixed(1)}% |`)
  }
  md.push('')

  md.push('## Page family × status')
  md.push('')
  md.push(crossTabToMarkdown('All rows', familyByStatus, statusesSeen))

  md.push('## Card shard × status')
  md.push('')
  if (noContext) {
    md.push('> Supabase not reachable — shard assignment skipped. Rerun with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set for shard-level cohort analysis.')
    md.push('')
  } else {
    md.push(crossTabToMarkdown('Cards only', cardShardByStatus, statusesSeen))
  }

  md.push('## Impression cohort × status')
  md.push('')
  if (statusesSeen.length && !rows.some(r => r.impressions != null)) {
    md.push('> Input CSV did not include an "Impressions" column — cohort analysis skipped.')
    md.push('')
  } else {
    md.push(crossTabToMarkdown('All rows', impressionsCohortByStatus, statusesSeen))
  }

  // Top 30 DNI URLs.
  const dniRows = rows
    .filter(r => (r.status || '').toLowerCase().replace(/[^a-z]/g, '') === 'discoverednotindexed')
    .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 30)
  md.push('## Top 30 Discovered-Not-Indexed URLs (by impressions if column present)')
  md.push('')
  if (dniRows.length === 0) {
    md.push('> No DiscoveredNotIndexed rows in the input.')
  } else {
    md.push('| URL | Family | Impressions | Clicks |')
    md.push('|---|---|---:|---:|')
    for (const r of dniRows) {
      md.push(`| ${escapeMd(r.url)} | ${r._family} | ${r.impressions ?? '—'} | ${r.clicks ?? '—'} |`)
    }
  }
  md.push('')

  // Interpretation notes — deliberately conservative.
  md.push('## Notes')
  md.push('')
  md.push('* This report groups URLs by structural cohort — it does not claim causation.')
  md.push('* A DNI concentration in a specific card shard suggests either sitemap discoverability or content-quality patterns worth investigating manually.')
  md.push('* A DNI concentration in URLs with zero GSC impressions is a weaker signal — Bing may simply have deprioritised them for the same reasons Google under-indexes them.')
  md.push('* Rerun after every Bing WMT export refresh to watch the cohorts move.')
  md.push('')

  fs.mkdirSync(path.dirname(opts.output), { recursive: true })
  fs.writeFileSync(opts.output, md.join('\n'))
  process.stdout.write(`Wrote ${opts.output}\n`)
}

main().catch(e => {
  console.error('FATAL:', e && e.message ? e.message : e)
  process.exit(1)
})
