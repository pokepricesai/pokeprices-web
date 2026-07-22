#!/usr/bin/env node
// scripts/seo/build-url-manifest.mjs
// Block 5A-W-46B — read-only SEO URL manifest sampler.
//
// Fetches a bounded sample of PokePrices pages and records:
//   * HTTP status
//   * redirect chain destination
//   * canonical (parsed from initial HTML)
//   * robots meta (index / follow)
//   * BreadcrumbList JSON-LD present + item count
//   * Dataset JSON-LD present
//   * Product JSON-LD present (should be absent — we are not the merchant)
//   * Article JSON-LD present
//   * <h1> presence + first title / meta description length
//   * server-rendered text length (rough)
//
// USAGE
//   node scripts/seo/build-url-manifest.mjs --dry-run
//   node scripts/seo/build-url-manifest.mjs --limit 20 \
//        --concurrency 2 --out seo/reports/2026-07-22-url-manifest.tsv
//
// SAFETY
//   * Read-only. No writes to any DB, no non-GET requests.
//   * Concurrency default = 2; delay between requests = 500ms.
//     A `--limit 30` run against production takes ~30 seconds.
//   * Output ONLY to seo/reports/ or seo/experiments/ — those dirs
//     are gitignored, so nothing this script writes ever gets
//     committed.
//   * On any http status >= 500 the script sleeps 5 seconds before
//     the next request as a courtesy backoff.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CANONICAL_HOST = 'www.pokeprices.io'
const DEFAULT_UA     = 'PokePricesSEOManifestBot/1.0 (+read-only audit; contact lukejosephpierce@gmail.com)'

function parseArgs(argv) {
  const opts = {
    dryRun:      false,
    concurrency: 2,
    limit:       0,       // 0 = no cap; sample sets pick their own defaults
    delayMs:     500,
    ua:          DEFAULT_UA,
    out:         null,
    seedFile:    null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run')       opts.dryRun = true
    else if (a === '--concurrency') opts.concurrency = Number(argv[++i]) || 2
    else if (a === '--limit')    opts.limit = Number(argv[++i]) || 0
    else if (a === '--delay-ms') opts.delayMs = Number(argv[++i]) || 500
    else if (a === '--ua')       opts.ua = argv[++i] || DEFAULT_UA
    else if (a === '--out')      opts.out = argv[++i] || null
    else if (a === '--seed')     opts.seedFile = argv[++i] || null
    else if (a === '--help')     { printHelp(); process.exit(0) }
    else if (a.startsWith('--')) { console.error(`Unknown flag: ${a}`); process.exit(2) }
  }
  return opts
}

function printHelp() {
  console.log(`SEO URL manifest sampler — usage:
  node scripts/seo/build-url-manifest.mjs [flags]

Flags:
  --dry-run          List the URL sample and exit; no HTTP requests.
  --seed <path>      Read one URL per line as the seed set.
  --concurrency <n>  Parallel in-flight requests (default 2).
  --limit <n>        Cap the total sample size to n URLs.
  --delay-ms <n>     Delay between sequential requests (default 500).
  --ua <string>      Override the User-Agent (default is polite bot UA).
  --out <path>       Write TSV output here. Must be under seo/reports/
                     or seo/experiments/. Default:
                     seo/reports/YYYY-MM-DD-url-manifest.tsv.
  --help             This message.
`)
}

function todayIso() { return new Date().toISOString().slice(0, 10) }

function defaultOutPath() {
  return resolve(ROOT, 'seo', 'reports', `${todayIso()}-url-manifest.tsv`)
}

function assertOutPathSafe(out) {
  const rel = out.replace(/\\/g, '/')
  const okPrefixes = ['seo/reports/', 'seo/experiments/']
  if (!okPrefixes.some(p => rel.includes('/' + p) || rel.startsWith(p))) {
    throw new Error(`--out must be under seo/reports/ or seo/experiments/ (got ${out}). These directories are gitignored so nothing this script writes is ever committed.`)
  }
}

// ── Seed set — a small curated list of representative URLs. Callers
//   can override with --seed. Intentionally short so a dry-run print
//   fits on one screen and a live run doesn't hammer production.
const SEED = [
  ['home',      'https://www.pokeprices.io/'],
  ['browse',    'https://www.pokeprices.io/browse'],
  ['pokemon',   'https://www.pokeprices.io/pokemon'],
  ['insights',  'https://www.pokeprices.io/insights'],
  ['insight',   'https://www.pokeprices.io/insights/may-2026-pokemon-card-market-trends'],
  ['set',       'https://www.pokeprices.io/set/Chaos%20Rising'],
  ['set',       'https://www.pokeprices.io/set/Perfect%20Order'],
  ['card',      'https://www.pokeprices.io/set/Perfect%20Order/card/jacinthe-122'],
  ['card',      'https://www.pokeprices.io/set/Celebrations/card/greninja-gold-star-swsh144'],
  ['card',      'https://www.pokeprices.io/set/Base%20Set/card/charizard-4'],
  ['pokemon-species', 'https://www.pokeprices.io/pokemon/greninja'],
  ['pokemon-species', 'https://www.pokeprices.io/pokemon/pikachu'],
]

function readSeedFile(p) {
  if (!p) return SEED
  const raw = readFileSync(p, 'utf8')
  const rows = []
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const tab = s.indexOf('\t')
    if (tab < 0) rows.push(['unknown', s])
    else          rows.push([s.slice(0, tab).trim(), s.slice(tab + 1).trim()])
  }
  return rows
}

// ── HTML probe helpers ─────────────────────────────────────────────

function extractMeta(html, name) {
  const re = new RegExp(`<meta[^>]+name=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i')
  const m = re.exec(html)
  return m ? m[1] : null
}
function extractLinkRel(html, rel) {
  const re = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]*href=["']([^"']*)["']`, 'i')
  const m = re.exec(html)
  return m ? m[1] : null
}
function extractTitle(html) {
  const m = /<title>([\s\S]*?)<\/title>/i.exec(html)
  return m ? m[1].trim() : null
}
function extractFirstH1(html) {
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)
  if (!m) return null
  return m[1].replace(/<[^>]+>/g, '').trim().slice(0, 200)
}
function findAllLdJson(html) {
  const scripts = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) scripts.push(m[1])
  return scripts
}
function schemaTypes(html) {
  const found = new Set()
  let itemCount = 0
  for (const raw of findAllLdJson(html)) {
    try {
      const parsed = JSON.parse(raw)
      const flat = Array.isArray(parsed) ? parsed
                 : parsed['@graph']       ? parsed['@graph']
                 : [parsed]
      for (const node of flat) {
        const t = node?.['@type']
        if (typeof t === 'string')         found.add(t)
        else if (Array.isArray(t))         for (const x of t) if (typeof x === 'string') found.add(x)
        if (t === 'BreadcrumbList' && Array.isArray(node.itemListElement)) {
          itemCount = node.itemListElement.length
        }
      }
    } catch { /* ignore malformed JSON-LD */ }
  }
  return { types: [...found], breadcrumbItems: itemCount }
}

async function probe(u, opts) {
  const t0 = Date.now()
  let res
  try {
    res = await fetch(u, {
      method:  'GET',
      redirect: 'manual',
      headers: { 'User-Agent': opts.ua, 'Accept': 'text/html' },
    })
  } catch (err) {
    return {
      url: u, status: 0, ms: Date.now() - t0, error: err.message || 'fetch failed',
    }
  }
  const status   = res.status
  const location = res.headers.get('location') || ''
  const contentType = res.headers.get('content-type') || ''
  let body = ''
  try { body = await res.text() } catch { body = '' }

  const canonical = extractLinkRel(body, 'canonical')
  const robots    = extractMeta(body, 'robots')
  const desc      = extractMeta(body, 'description')
  const title     = extractTitle(body)
  const h1        = extractFirstH1(body)
  const { types, breadcrumbItems } = schemaTypes(body)

  return {
    url:              u,
    status,
    ms:               Date.now() - t0,
    contentType,
    redirect:         location || null,
    canonical:        canonical || null,
    robotsMeta:       robots    || null,
    title,
    titleLength:      title ? title.length : 0,
    descriptionLength: desc  ? desc.length  : 0,
    h1,
    hasBreadcrumb:    types.includes('BreadcrumbList'),
    breadcrumbItems,
    hasDataset:       types.includes('Dataset'),
    hasArticle:       types.includes('Article'),
    hasProduct:       types.includes('Product') || types.includes('ProductGroup') || types.includes('Offer') || types.includes('AggregateOffer'),
    hasWebPage:       types.includes('WebPage'),
    hasCollection:    types.includes('CollectionPage'),
    schemaTypes:      types.join(','),
    bodyLength:       body.length,
  }
}

function toTsvRow(row) {
  const cols = [
    row.classification, row.url, row.status, row.ms, row.redirect || '',
    row.canonical || '', row.robotsMeta || '', (row.title || '').replace(/\t/g, ' '),
    row.titleLength, row.descriptionLength, (row.h1 || '').replace(/\t/g, ' '),
    row.hasBreadcrumb ? '1' : '0', row.breadcrumbItems,
    row.hasDataset    ? '1' : '0',
    row.hasArticle    ? '1' : '0',
    row.hasProduct    ? '1' : '0',
    row.hasWebPage    ? '1' : '0',
    row.hasCollection ? '1' : '0',
    row.schemaTypes || '',
    row.bodyLength,
    row.error || '',
  ]
  return cols.join('\t')
}

const TSV_HEADER = [
  'classification', 'url', 'status', 'ms', 'redirect',
  'canonical', 'robots', 'title', 'title_length', 'meta_desc_length', 'h1',
  'has_breadcrumb', 'breadcrumb_items',
  'has_dataset', 'has_article', 'has_product',
  'has_webpage', 'has_collection', 'schema_types', 'body_length', 'error',
].join('\t')

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const rawSample = readSeedFile(opts.seedFile)
  const sample = opts.limit > 0 ? rawSample.slice(0, opts.limit) : rawSample

  if (opts.dryRun) {
    console.log(`DRY RUN — would probe ${sample.length} URL(s):`)
    for (const [cls, u] of sample) console.log(`  [${cls}] ${u}`)
    console.log('\nNo HTTP requests were made. No output file was written.')
    return
  }

  const outPath = opts.out ? resolve(process.cwd(), opts.out) : defaultOutPath()
  assertOutPathSafe(outPath)
  mkdirSync(dirname(outPath), { recursive: true })

  const rows = [TSV_HEADER]
  console.log(`Probing ${sample.length} URL(s) with concurrency ${opts.concurrency}, ${opts.delayMs}ms delay.`)

  const queue = sample.slice()
  const workers = Array.from({ length: opts.concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) break
      const [classification, u] = item
      const r = await probe(u, opts)
      r.classification = classification
      rows.push(toTsvRow(r))
      console.log(`  ${classification.padEnd(18)} ${r.status} ${u}${r.hasBreadcrumb ? ' ✓crumb' : ''}${r.hasDataset ? ' ✓data' : ''}${r.hasArticle ? ' ✓art' : ''}`)
      // Courtesy backoff on server errors.
      if (r.status >= 500) await new Promise(res => setTimeout(res, 5000))
      else                 await new Promise(res => setTimeout(res, opts.delayMs))
    }
  })
  await Promise.all(workers)

  writeFileSync(outPath, rows.join('\n') + '\n', 'utf8')
  console.log(`\nWrote ${outPath} (${rows.length - 1} rows).`)
  // Absolute guarantee: verify the file lives under seo/{reports,experiments}/
  // even after resolve — belt + braces so a future edit can't slip.
  if (!existsSync(outPath)) throw new Error('output file not written')
}

main().catch(err => {
  console.error('FATAL:', err && err.stack ? err.stack : err)
  process.exit(1)
})
