#!/usr/bin/env node
// scripts/smart-endpoint/stage1-verify-rpcs.mjs
//
// Stage 1 verification. Run AFTER applying:
//   migrations/2026-09-22a-smart-endpoint-get-latest-sets-for-ai.sql
//   migrations/2026-09-22b-smart-endpoint-get-card-price-summary.sql
//
// Checks:
//   1. Both RPCs exist and return usable rows
//   2. get_latest_sets_for_ai('en', 12) surfaces at least
//      "30th Celebration" and "Perfect Order" among recent EN sets
//   3. get_card_price_summary_for_ai returns a coherent row for a
//      well-observed card, and NO row (zero) for a nonsense slug
//   4. Percentage changes are numeric, not strings, and within a
//      sane -100..500 band (paranoia check)
//
// Exit code 0 = pass; non-zero = fail (blocks Stage 2).

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const sb = createClient(URL, KEY)
const line = (ch = '─') => console.log(ch.repeat(76))

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`)
  } else {
    console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`)
    failures++
  }
}

line('═')
console.log('  Smart-endpoint Stage 1 verification')
line('═')

// --- 1. get_latest_sets_for_ai --------------------------------------

console.log('\n1. rpc get_latest_sets_for_ai(lang="en", limit_count=12, name_filter=null)')
{
  const t0 = Date.now()
  const { data, error } = await sb.rpc('get_latest_sets_for_ai', {
    lang: 'en', limit_count: 12, name_filter: null,
  })
  const ms = Date.now() - t0
  if (error) {
    console.log(`  ERR (${ms}ms): ${error.message}`)
    failures++
  } else {
    console.log(`  latency: ${ms}ms  rows: ${data.length}`)
    if (data[0]) console.log('  columns:', Object.keys(data[0]).sort().join(', '))
    assert(data.length > 0, 'returns at least one row')
    assert(data.length <= 12, 'respects limit_count')
    assert(data.every(r => r.language === 'en'), 'all rows language=en')
    assert(data.every(r => r.set_release_date), 'every row has a release date')
    // ordering check
    const dates = data.map(r => r.set_release_date)
    const sorted = [...dates].sort((a, b) => b.localeCompare(a))
    assert(JSON.stringify(dates) === JSON.stringify(sorted), 'rows ordered by release date desc')
    // v3 semantic-field checks
    assert(data.every(r => 'official_set_size' in r), 'shape has official_set_size')
    assert(data.every(r => 'catalog_total' in r),     'shape has catalog_total')
    assert(data.every(r => 'catalog_rows' in r),      'shape has catalog_rows')
    // presence check — CLAUDE.md-listed recent sets
    for (const [wanted, expOfficial, expCatalog] of [
      ['30th Celebration', 128, 227],
      ['Perfect Order',    88,  219],
      ['Chaos Rising',     83,  201],
      ['Pitch Black',      84,  205],
    ]) {
      const hit = data.find(r => r.set_name === wanted)
      assert(hit != null, `contains "${wanted}"`)
      if (hit) {
        console.log(`      ${wanted}: release=${hit.set_release_date} official_set_size=${hit.official_set_size} catalog_total=${hit.catalog_total} catalog_rows=${hit.catalog_rows}`)
        assert(hit.official_set_size === expOfficial, `${wanted}: official_set_size=${expOfficial}`)
        assert(hit.catalog_total     === expCatalog,  `${wanted}: catalog_total=${expCatalog}`)
      }
    }
    assert(data.every(r => r.catalog_total > 0), 'every catalog_total > 0')
  }
}

console.log('\n1b. rpc get_latest_sets_for_ai(lang="jp", limit_count=8, name_filter=null)')
{
  const { data, error } = await sb.rpc('get_latest_sets_for_ai', {
    lang: 'jp', limit_count: 8, name_filter: null,
  })
  if (error) { console.log('  ERR:', error.message); failures++ }
  else {
    assert(data.length > 0, 'jp returns at least one row')
    assert(data.every(r => r.language === 'jp'), 'jp rows language=jp')
    console.log('  latest 3 JP:')
    for (const r of data.slice(0, 3)) console.log(`      ${r.set_release_date}  ${r.set_name}  official=${r.official_set_size} catalog=${r.catalog_total}`)
  }
}

console.log('\n1c. rpc get_latest_sets_for_ai(name_filter="Perfect Order", no language)')
{
  const { data, error } = await sb.rpc('get_latest_sets_for_ai', {
    lang: null, limit_count: 5, name_filter: 'Perfect Order',
  })
  if (error) { console.log('  ERR:', error.message); failures++ }
  else {
    assert(data.length > 0, 'name_filter returns at least one row')
    const po = data.find(r => r.set_name === 'Perfect Order')
    assert(po != null, 'name_filter finds Perfect Order')
    if (po) {
      assert(po.official_set_size === 88,  'Perfect Order official_set_size=88')
      assert(po.catalog_total     === 219, 'Perfect Order catalog_total=219')
      assert(po.language          === 'en', 'Perfect Order language=en (found without lang param)')
      console.log(`      ${po.set_name}: official=${po.official_set_size} catalog_total=${po.catalog_total} lang=${po.language}`)
    }
  }
}

// --- 2. get_card_price_summary_for_ai -------------------------------

// First find a well-observed card_slug (raw + psa10 data + long history)
console.log('\n2. picking a well-observed card_slug for the summary RPC')
const { data: seed } = await sb.from('card_trends')
  .select('card_slug, card_name, set_name, current_raw, current_psa10, raw_pct_365d')
  .not('raw_pct_365d', 'is', null)
  .not('current_psa10', 'is', null)
  .gt('current_raw', 3000)
  .gt('current_psa10', 5000)
  .limit(1)

const seedSlug = seed?.[0]?.card_slug
console.log(`  seed card: ${seed?.[0]?.card_name} — ${seed?.[0]?.set_name} — card_slug=${seedSlug}`)
if (!seedSlug) {
  console.log('  no seed card found — cannot verify summary RPC')
  failures++
} else {
  console.log('\n2a. rpc get_card_price_summary_for_ai(seedSlug, 90)')
  const t0 = Date.now()
  const { data, error } = await sb.rpc('get_card_price_summary_for_ai', {
    pc_slug: String(seedSlug),
    period_days: 90,
  })
  const ms = Date.now() - t0
  if (error) { console.log(`  ERR (${ms}ms): ${error.message}`); failures++ }
  else {
    console.log(`  latency: ${ms}ms  rows: ${data.length}`)
    if (data[0]) {
      const r = data[0]
      console.log('  row:', JSON.stringify(r, null, 2).split('\n').map(l => '    ' + l).join('\n'))
      assert(data.length === 1, 'returns exactly one row')
      assert(r.observation_count > 0, 'observation_count > 0')
      assert(r.latest_date, 'has latest_date')
      assert(r.first_date, 'has first_date')
      assert(r.first_date <= r.latest_date, 'first_date <= latest_date')
      assert(typeof r.raw_pct_change === 'number' || r.raw_pct_change === null, 'raw_pct_change is number or null (not string)')
      if (typeof r.raw_pct_change === 'number') {
        assert(r.raw_pct_change > -100 && r.raw_pct_change < 5000, `raw_pct_change ${r.raw_pct_change} in sane range`)
      }
      if (r.raw_high_usd && r.raw_low_usd) {
        assert(r.raw_high_usd >= r.raw_low_usd, 'raw_high_usd >= raw_low_usd')
      }
      if (r.latest_raw_usd) {
        assert(r.latest_raw_usd >= r.raw_low_usd && r.latest_raw_usd <= r.raw_high_usd,
          'latest_raw_usd within window low/high')
      }
    } else {
      console.log('  no rows returned for seed card — unexpected'); failures++
    }
  }

  console.log('\n2b. rpc with period_days=365')
  const { data: d365, error: e365 } = await sb.rpc('get_card_price_summary_for_ai', {
    pc_slug: String(seedSlug), period_days: 365,
  })
  if (e365) { console.log('  ERR:', e365.message); failures++ }
  else if (d365?.[0]) {
    console.log(`  365d: obs=${d365[0].observation_count}  raw_pct_change=${d365[0].raw_pct_change}`)
    assert(d365[0].observation_count >= (data[0]?.observation_count || 0), '365d observation_count >= 90d')
  }
}

// nonsense slug -> zero rows
console.log('\n2c. rpc with a nonsense card_slug should return zero rows')
{
  const { data, error } = await sb.rpc('get_card_price_summary_for_ai', {
    pc_slug: 'this-card-slug-does-not-exist-9999999999', period_days: 90,
  })
  if (error) { console.log('  ERR:', error.message); failures++ }
  else {
    assert(Array.isArray(data) && data.length === 0, 'nonsense slug returns [] (empty)')
  }
}

// clamp check — 3000 days clamped to 730
console.log('\n2d. rpc with over-large period_days is clamped, not rejected')
if (seedSlug) {
  const { data, error } = await sb.rpc('get_card_price_summary_for_ai', {
    pc_slug: String(seedSlug), period_days: 3000,
  })
  if (error) { console.log('  ERR:', error.message); failures++ }
  else if (data?.[0]) {
    assert(data[0].period_days === 730, `period_days clamped to 730 (got ${data[0].period_days})`)
  }
}

// --- Summary --------------------------------------------------------
line('═')
if (failures === 0) {
  console.log('  \x1b[32mALL PASS\x1b[0m — Stage 1 verified. Cleared for Stage 2.')
  process.exit(0)
} else {
  console.log(`  \x1b[31m${failures} FAIL\x1b[0m — Stage 1 blocked.`)
  process.exit(1)
}
