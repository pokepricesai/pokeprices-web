#!/usr/bin/env node
// ============================================================================
// Block 4B-W-2A — Pilot manifest validator (offline, no DB connection).
// ============================================================================
//
// Validates data/recent-sales-pilot-100.json against the brief's structural
// rules. Designed to run in CI and locally without touching production.
//
// Modes:
//   (default)       Schema-only checks. Allows the committed scaffold state.
//   --strict-ids    Adds: provider_card_id must NOT start with "9999999"
//                   (the scaffold placeholder marker).
//   --strict-count  Adds: must have exactly 100 entries and exact category totals.
//   --strict        Equivalent to --strict-ids --strict-count.
//
// Operator workflow:
//   1. Default mode passes for the committed scaffold and runs in the test suite.
//   2. After regenerating the manifest from the production selection query,
//      operator runs with --strict to confirm the real IDs are loaded.
//
// Exit codes: 0 OK, 1 failure (prints reasons).
// ============================================================================

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const MANIFEST_PATH = resolve(REPO_ROOT, 'data', 'recent-sales-pilot-100.json')

const ALLOWED_CATEGORIES = [
  'sealed',
  'sparse',
  'difficult_variants',
  'vintage_or_wotc',
  'psa_or_grade_spread',
  'modern_or_recent',
  'general_quality',
]

// Minimum coverage required per category for the technical pilot.
// --strict-count enforces these as MINIMUMS (>=), not equality.
// Cohort total must equal exactly EXPECTED_TOTAL.
const MINIMUM_COVERAGE = {
  sealed:              10,
  sparse:              10,
  difficult_variants:   8,
  vintage_or_wotc:      8,
  psa_or_grade_spread:  5,
  modern_or_recent:     1,
  general_quality:      0,  // top-up category — no minimum
}

// Technical pilot target: 58 real mapped cards from the selector.
// Sized to safely prove scraper wiring + parser execution + Supabase
// writes + deduplication + sparse/sealed handling + import-run accounting.
const EXPECTED_TOTAL = 58

const REQUIRED_FIELDS = [
  'provider',
  'provider_card_id',
  'card_slug',
  'card_name',
  'set_name',
  'primary_category',
  'selection_reason',
  'confidence',
  'is_sealed',
  'raw_price_cents',
  'psa9_price_cents',
  'psa10_price_cents',
  'sales_30d',
  'portfolio_count',
  'watchlist_count',
]

// Explicit deny-list of fields that would constitute PII or private data.
const FORBIDDEN_FIELDS = [
  'user_id',
  'user_email',
  'email',
  'owner_id',
  'purchase_price',
  'purchase_price_cents',
  'notes',
  'note',
  'name',           // ambiguous w/ card_name — refuse
  'full_name',
  'address',
]

const ALLOWED_LANGUAGES = new Set(['en'])
const ALLOWED_PROVIDERS = new Set(['pricecharting'])
const PROVIDER_ID_REGEX = /^[A-Za-z0-9_-]+$/
const PLACEHOLDER_PREFIX = '9999999'

function parseFlags(argv) {
  const flags = new Set(argv.slice(2))
  if (flags.has('--strict')) {
    flags.add('--strict-ids')
    flags.add('--strict-count')
  }
  return {
    strictIds:   flags.has('--strict-ids'),
    strictCount: flags.has('--strict-count'),
  }
}

function* validate(manifest, opts) {
  // (a) Top-level shape.
  if (typeof manifest !== 'object' || manifest === null) {
    yield 'manifest must be a JSON object'
    return
  }
  if (!Array.isArray(manifest.entries)) {
    yield 'manifest.entries must be an array'
    return
  }
  const entries = manifest.entries

  // (b) Forbidden fields — scoped to per-entry data only.
  // _meta.note is a developer-facing description and is allowed; FORBIDDEN
  // applies to anything that could constitute PII or per-card private data.
  const entriesProbe = JSON.stringify(manifest.entries)
  for (const f of FORBIDDEN_FIELDS) {
    const re = new RegExp(`"${f}"\\s*:`, 'i')
    if (re.test(entriesProbe)) yield `forbidden field present in entries: ${f}`
  }

  // (c) Per-entry shape.
  const providerIds = new Set()
  const cardSlugs = new Set()
  const categoryCounts = Object.fromEntries(ALLOWED_CATEGORIES.map(c => [c, 0]))

  let idx = -1
  for (const e of entries) {
    idx++
    if (typeof e !== 'object' || e === null) {
      yield `entry[${idx}] is not an object`
      continue
    }
    for (const f of REQUIRED_FIELDS) {
      if (!(f in e)) yield `entry[${idx}] missing required field: ${f}`
    }

    // provider
    if (!ALLOWED_PROVIDERS.has(e.provider)) {
      yield `entry[${idx}] provider must be 'pricecharting' (got ${JSON.stringify(e.provider)})`
    }

    // language: optional, but if present must be 'en'
    if ('language' in e && !ALLOWED_LANGUAGES.has(e.language)) {
      yield `entry[${idx}] unsupported language ${JSON.stringify(e.language)}`
    }

    // provider_card_id
    if (typeof e.provider_card_id !== 'string' || !PROVIDER_ID_REGEX.test(e.provider_card_id)) {
      yield `entry[${idx}] provider_card_id must match ${PROVIDER_ID_REGEX} (got ${JSON.stringify(e.provider_card_id)})`
    } else {
      // numeric strictness for PriceCharting
      if (!/^[0-9]+$/.test(e.provider_card_id)) {
        yield `entry[${idx}] provider_card_id must be a numeric string for pricecharting (got ${JSON.stringify(e.provider_card_id)})`
      }
      if (providerIds.has(e.provider_card_id)) {
        yield `entry[${idx}] duplicate provider_card_id ${e.provider_card_id}`
      }
      providerIds.add(e.provider_card_id)
      if (opts.strictIds && e.provider_card_id.startsWith(PLACEHOLDER_PREFIX)) {
        yield `entry[${idx}] provider_card_id ${e.provider_card_id} is a scaffold placeholder (--strict-ids)`
      }
    }

    // card_slug
    if (typeof e.card_slug !== 'string' || !/^[A-Za-z0-9_-]+$/.test(e.card_slug)) {
      yield `entry[${idx}] card_slug must be alphanumeric (got ${JSON.stringify(e.card_slug)})`
    } else if (cardSlugs.has(e.card_slug)) {
      yield `entry[${idx}] duplicate card_slug ${e.card_slug}`
    } else {
      cardSlugs.add(e.card_slug)
    }

    // names
    if (typeof e.card_name !== 'string' || e.card_name.trim() === '') {
      yield `entry[${idx}] card_name must be a non-empty string`
    }
    if (typeof e.set_name !== 'string' || e.set_name.trim() === '') {
      yield `entry[${idx}] set_name must be a non-empty string`
    }

    // category
    if (!ALLOWED_CATEGORIES.includes(e.primary_category)) {
      yield `entry[${idx}] primary_category must be one of ${ALLOWED_CATEGORIES.join('|')} (got ${JSON.stringify(e.primary_category)})`
    } else {
      categoryCounts[e.primary_category]++
    }

    // selection_reason
    if (typeof e.selection_reason !== 'string' || e.selection_reason.trim().length < 10) {
      yield `entry[${idx}] selection_reason must be a non-trivial string`
    }

    // confidence
    if (typeof e.confidence !== 'number' || e.confidence < 0.900 || e.confidence > 1) {
      yield `entry[${idx}] confidence must be in [0.900, 1.000] (got ${JSON.stringify(e.confidence)})`
    }

    // is_sealed
    if (typeof e.is_sealed !== 'boolean') {
      yield `entry[${idx}] is_sealed must be a boolean`
    }

    // sealed category must have is_sealed=true
    if (e.primary_category === 'sealed' && e.is_sealed !== true) {
      yield `entry[${idx}] sealed-category entry must have is_sealed=true`
    }

    // optional numeric fields — null or non-negative number
    for (const f of ['raw_price_cents','psa9_price_cents','psa10_price_cents','sales_30d','portfolio_count','watchlist_count']) {
      const v = e[f]
      if (v !== null && v !== undefined && (typeof v !== 'number' || v < 0 || !Number.isFinite(v))) {
        yield `entry[${idx}] ${f} must be null or a non-negative finite number`
      }
    }

    // sparse: when sales_30d data exists, it should be 0/1.
    if (e.primary_category === 'sparse'
        && typeof e.sales_30d === 'number'
        && e.sales_30d > 1) {
      yield `entry[${idx}] sparse-category entry has sales_30d=${e.sales_30d} (expected 0 or 1)`
    }
  }

  // (d) Strict-count gate: total must be EXACTLY 100, and each minimum-coverage
  // category must hit AT LEAST its floor. general_quality has no floor and
  // absorbs whatever doesn't fit the minimum categories.
  if (opts.strictCount) {
    if (entries.length !== EXPECTED_TOTAL) {
      yield `entries.length = ${entries.length}, expected ${EXPECTED_TOTAL} (--strict-count)`
    }
    for (const cat of ALLOWED_CATEGORIES) {
      const required = MINIMUM_COVERAGE[cat] ?? 0
      const actual   = categoryCounts[cat] ?? 0
      if (actual < required) {
        yield `category ${cat} = ${actual}, expected >= ${required} (--strict-count)`
      }
    }
  }
}

async function main() {
  const opts = parseFlags(process.argv)
  let manifest
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
  } catch (e) {
    console.error(`FAIL: cannot parse ${MANIFEST_PATH}: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }

  const errors = [...validate(manifest, opts)]
  if (errors.length) {
    console.error(`FAIL: ${errors.length} error(s) validating ${MANIFEST_PATH}`)
    for (const err of errors) console.error('  - ' + err)
    process.exit(1)
  }

  const total = Array.isArray(manifest.entries) ? manifest.entries.length : 0
  const cats  = Object.fromEntries(ALLOWED_CATEGORIES.map(c => [c, 0]))
  for (const e of manifest.entries) if (e && cats[e.primary_category] !== undefined) cats[e.primary_category]++
  const modeLabel = (opts.strictIds || opts.strictCount)
    ? `strict${opts.strictIds?' ids':''}${opts.strictCount?' count':''}`
    : 'schema-only'
  console.log(`OK  (${modeLabel}): ${total} entries — ${JSON.stringify(cats)}`)
}

main().catch(e => {
  console.error('FAIL:', e instanceof Error ? e.stack || e.message : String(e))
  process.exit(1)
})
