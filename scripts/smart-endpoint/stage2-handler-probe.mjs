#!/usr/bin/env node
// scripts/smart-endpoint/stage2-handler-probe.mjs
//
// Stage 2 handler probe. Ports the three touched handlers
// (dbGetGradingPop, dbGetLatestSets, dbGetPriceSummary) into Node
// so we can verify the DB-facing behaviour end-to-end WITHOUT
// deploying the edge function or invoking the LLM.
//
// The ported logic here MUST stay behavior-identical to the
// TypeScript in supabase/functions/smart-endpoint/index.ts. If a
// future edit changes one, update the other too.

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

const supabase = createClient(URL, KEY)
const GBP_RATE = 0.79
const usdCentsToUsd = c => (!c || c <= 0) ? '-'
  : c/100 >= 1000 ? `$${(c/100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  : `$${(c/100).toFixed(2)}`
const usdCentsToGbp = c => (!c || c <= 0) ? '-'
  : (c/100)*GBP_RATE >= 1000 ? `£${((c/100)*GBP_RATE).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
  : `£${((c/100)*GBP_RATE).toFixed(2)}`

const PSA_POP_COLS = 'card_name, variant, set_name, card_number, psa_7, psa_8, psa_9, psa_10, total_graded, gem_rate'

// ── Ported handlers ────────────────────────────────────────────────

async function dbGetGradingPop(searchTerm) {
  const raw = String(searchTerm ?? '').trim()
  if (!raw) return { results: [], match_method: 'empty' }

  let resolvedCardName = null
  let resolvedSetName  = null
  try {
    const { data: rpcData } = await supabase.rpc('search_cards_json', { search_text: raw })
    const s = typeof rpcData?.results === 'string' ? rpcData.results : ''
    const first = s.split(' --- ')[0]
    if (first) {
      const parts = first.split(' | ')
      const name = parts[0]?.trim()
      const set  = parts[1]?.trim()
      if (name && set) {
        resolvedCardName = name
          .replace(/\s*\[[^\]]+\]/g, '')
          .replace(/\s*#[A-Za-z0-9/-]+\s*$/, '')
          .trim() || name
        resolvedSetName = set
      }
    }
  } catch {}

  if (resolvedCardName && resolvedSetName) {
    for (const sn of [resolvedSetName, `Pokemon ${resolvedSetName}`]) {
      const { data } = await supabase.from('psa_population')
        .select(PSA_POP_COLS)
        .ilike('card_name', `%${resolvedCardName}%`)
        .eq('set_name', sn)
        .gt('total_graded', 0)
        .order('total_graded', { ascending: false })
        .limit(10)
      if (data?.length) return { results: data, match_method: 'resolved', resolved_card_name: resolvedCardName, resolved_set_name: sn }
    }
  }

  const tokens = raw.split(/\s+/).filter(t => t.length >= 2 && !/^(the|and|of|a)$/i.test(t)).slice(0, 3)
  const pattern = tokens.length ? `%${tokens.join('%')}%` : `%${raw}%`
  const { data } = await supabase.from('psa_population')
    .select(PSA_POP_COLS)
    .ilike('card_name', pattern)
    .gt('total_graded', 0)
    .order('total_graded', { ascending: false })
    .limit(10)
  return { results: data || [], match_method: 'fallback_ilike', tokens }
}

async function dbGetLatestSets(language, limit, nameFilter) {
  const lang = language === 'en' || language === 'jp' ? language : null
  const lim  = Math.max(1, Math.min(Number(limit) || 8, 20))
  const nf   = typeof nameFilter === 'string' && nameFilter.trim().length > 0
    ? nameFilter.trim() : null
  const { data, error } = await supabase.rpc('get_latest_sets_for_ai', {
    lang, limit_count: lim, name_filter: nf,
  })
  if (error || !data) return { results: [], error: error?.message ?? 'no data' }
  return {
    results: data.map(r => ({
      set_name: r.set_name, language: r.language,
      release_date: r.set_release_date, release_year: r.release_year,
      official_set_size: r.official_set_size,
      catalog_total:     r.catalog_total,
      catalog_rows:      r.catalog_rows,
      print_run_era: r.print_run_era,
      set_url: `https://www.pokeprices.io/set/${encodeURIComponent(r.set_name)}`,
    })),
    filter_applied: nf,
  }
}

async function dbGetPriceSummary(cardSlug, periodDays) {
  const bare = String(cardSlug ?? '').replace(/^pc-/, '').trim()
  if (!bare) return { error: 'empty card_slug' }
  const days = Math.max(1, Math.min(Number(periodDays) || 90, 730))
  const { data, error } = await supabase.rpc('get_card_price_summary_for_ai', { pc_slug: bare, period_days: days })
  if (error) return { error: error.message, card_slug: bare }
  if (!Array.isArray(data) || data.length === 0) return { card_slug: bare, period_days: days, message: 'No price observations in this window' }
  const r = data[0]
  return {
    card_slug: r.card_slug, period_days: r.period_days,
    latest_date: r.latest_date, first_date: r.first_date, observation_count: r.observation_count,
    latest_raw_usd: usdCentsToUsd(r.latest_raw_usd), latest_raw_gbp: usdCentsToGbp(r.latest_raw_usd),
    latest_psa9_usd: usdCentsToUsd(r.latest_psa9_usd), latest_psa9_gbp: usdCentsToGbp(r.latest_psa9_usd),
    latest_psa10_usd: usdCentsToUsd(r.latest_psa10_usd), latest_psa10_gbp: usdCentsToGbp(r.latest_psa10_usd),
    raw_high_usd: usdCentsToUsd(r.raw_high_usd), raw_high_gbp: usdCentsToGbp(r.raw_high_usd),
    raw_low_usd: usdCentsToUsd(r.raw_low_usd), raw_low_gbp: usdCentsToGbp(r.raw_low_usd),
    raw_pct_change: r.raw_pct_change,
    psa10_high_usd: usdCentsToUsd(r.psa10_high_usd), psa10_high_gbp: usdCentsToGbp(r.psa10_high_usd),
    psa10_low_usd: usdCentsToUsd(r.psa10_low_usd), psa10_low_gbp: usdCentsToGbp(r.psa10_low_usd),
    psa10_pct_change: r.psa10_pct_change,
  }
}

// ── Test cases ─────────────────────────────────────────────────────

const line = (ch = '─') => console.log(ch.repeat(76))
let failures = 0
function pass(msg) { console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`) }
function fail(msg) { console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`); failures++ }
function chk(cond, msg) { cond ? pass(msg) : fail(msg) }

line('═')
console.log('  Stage 2 handler probe (RPC-side, no LLM)')
line('═')

// --- dbGetGradingPop ---
console.log('\n1. dbGetGradingPop — the first-word bug fix')
{
  console.log('  1a. multi-token: "Umbreon VMAX Evolving Skies"')
  const r = await dbGetGradingPop('Umbreon VMAX Evolving Skies')
  console.log('    match_method:', r.match_method, ' n_results:', r.results?.length)
  if (r.results?.length) console.log('    top result:', r.results[0].card_name, '/', r.results[0].set_name, 'total=', r.results[0].total_graded)
  chk(r.results?.length > 0, 'returns at least one row')
  chk(r.results?.every(x => /umbreon/i.test(x.card_name || '')), 'every row mentions Umbreon')
  const isEvolvingSkies = (r.match_method === 'resolved' && /evolving skies/i.test(r.resolved_set_name || ''))
    || r.results?.some(x => /evolving skies/i.test(x.set_name || ''))
  chk(isEvolvingSkies, 'at least one row anchored to Evolving Skies')

  console.log('\n  1b. single-word (backward compat): "Charizard"')
  const r2 = await dbGetGradingPop('Charizard')
  console.log('    match_method:', r2.match_method, ' n_results:', r2.results?.length)
  chk(r2.results?.length > 0, 'single-word still returns results')

  console.log('\n  1c. empty input')
  const r3 = await dbGetGradingPop('')
  chk(r3.match_method === 'empty', 'empty input returns match_method="empty"')
  chk(r3.results?.length === 0, 'empty input returns no results')
}

// --- dbGetLatestSets ---
console.log('\n2. dbGetLatestSets — new dynamic set retrieval (v3 semantic fields)')
{
  console.log('  2a. EN latest 6')
  const r = await dbGetLatestSets('en', 6)
  chk(r.results?.length === 6, 'returns exactly 6 rows')
  console.log('    ', r.results?.map(x => `${x.release_date}  ${x.set_name}  off=${x.official_set_size} cat=${x.catalog_total}`).join('\n     '))
  chk(r.results?.every(x => x.language === 'en'), 'all language=en')
  chk(r.results?.every(x => x.set_url.startsWith('https://www.pokeprices.io/set/')), 'set_url canonical form')
  chk(r.results?.every(x => x.catalog_total > 0), 'catalog_total > 0')
  const cel = r.results?.find(x => x.set_name === '30th Celebration')
  chk(cel?.official_set_size === 128, '30th Celebration official_set_size=128')
  chk(cel?.catalog_total     === 227, '30th Celebration catalog_total=227')

  console.log('\n  2b. JP latest 4')
  const r2 = await dbGetLatestSets('jp', 4)
  chk(r2.results?.length === 4, 'returns exactly 4 rows')
  chk(r2.results?.every(x => x.language === 'jp'), 'all language=jp')
  console.log('    ', r2.results?.map(x => `${x.release_date}  ${x.set_name}  off=${x.official_set_size} cat=${x.catalog_total}`).join('\n     '))

  console.log('\n  2c. no filter, limit=3')
  const r3 = await dbGetLatestSets(undefined, 3)
  chk(r3.results?.length === 3, 'mixed language returns 3 rows')

  console.log('\n  2d. limit capping (limit=200 → clamped to 20)')
  const r4 = await dbGetLatestSets('en', 200)
  chk(r4.results?.length <= 20, `over-large limit clamped (got ${r4.results?.length})`)

  console.log('\n  2e. name_filter="Perfect Order" (no language)')
  const r5 = await dbGetLatestSets(undefined, 5, 'Perfect Order')
  const po = r5.results?.find(x => x.set_name === 'Perfect Order')
  chk(po != null, 'name_filter finds Perfect Order')
  if (po) {
    chk(po.official_set_size === 88,  'Perfect Order official_set_size=88')
    chk(po.catalog_total     === 219, 'Perfect Order catalog_total=219')
    chk(po.language          === 'en', 'Perfect Order lang=en (found without lang param)')
  }
  chk(r5.filter_applied === 'Perfect Order', 'filter_applied echoed in response')
}

// --- dbGetPriceSummary ---
console.log('\n3. dbGetPriceSummary — new historic summary')
{
  // Find a card with a full year of history + PSA10 data
  const { data: seed } = await supabase.from('card_trends')
    .select('card_slug, card_name, set_name, current_raw, current_psa10, raw_pct_365d')
    .not('raw_pct_365d', 'is', null).not('current_psa10', 'is', null)
    .gt('current_raw', 5000).gt('current_psa10', 10000)
    .limit(1)
  const slug = seed?.[0]?.card_slug
  console.log(`  seed: ${seed?.[0]?.card_name} / ${seed?.[0]?.set_name} / slug=${slug}`)

  console.log('\n  3a. 90d summary')
  const r = await dbGetPriceSummary(slug, 90)
  chk(!r.error, 'no error')
  chk(r.observation_count > 0, 'observation_count > 0')
  chk(typeof r.raw_pct_change === 'number' || r.raw_pct_change === null, 'raw_pct_change is number or null')
  chk(r.latest_raw_usd?.startsWith('$'), 'latest_raw_usd formatted as $')
  chk(r.latest_raw_gbp?.startsWith('£'), 'latest_raw_gbp formatted as £')
  console.log('    latest_raw:', r.latest_raw_usd, '/', r.latest_raw_gbp,
              ' high:', r.raw_high_usd, ' low:', r.raw_low_usd,
              ' pct:', r.raw_pct_change + '%')

  console.log('\n  3b. pc-prefixed slug is also accepted')
  const r2 = await dbGetPriceSummary(`pc-${slug}`, 90)
  chk(r2.observation_count === r.observation_count, 'pc- prefix matches bare')

  console.log('\n  3c. nonsense slug returns polite empty')
  const r3 = await dbGetPriceSummary('not-a-real-card-9999', 90)
  chk(r3.message === 'No price observations in this window', 'polite empty message')
  chk(!r3.error, 'no error on nonsense (RPC returns [] → we handle)')

  console.log('\n  3d. empty slug returns error')
  const r4 = await dbGetPriceSummary('', 90)
  chk(r4.error === 'empty card_slug', 'empty slug → error')
}

line('═')
if (failures === 0) {
  console.log('  \x1b[32mALL PASS\x1b[0m — Stage 2 handlers verified. Cleared for Stage 3.')
  process.exit(0)
} else {
  console.log(`  \x1b[31m${failures} FAIL\x1b[0m — Stage 2 blocked.`)
  process.exit(1)
}
