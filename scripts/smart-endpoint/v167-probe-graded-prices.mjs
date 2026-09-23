#!/usr/bin/env node
// Confirm what graded-price data actually exists across card_trends
// + daily_prices, and answer the ground-truth question the user gave
// us: what Charizard cards are actually in the DB with a PSA 9 price
// under $100 (10000 cents)? And PSA 8 under $100?

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
)

const line = (ch = '─') => console.log(ch.repeat(78))

// --- 1. card_trends column list ---
line('═'); console.log('  card_trends columns (one row)'); line('═')
{
  const { data } = await sb.from('card_trends').select('*').limit(1)
  if (data?.[0]) console.log('  ', Object.keys(data[0]).sort().join(', '))
}

// --- 2. daily_prices column list (already known but re-confirm) ---
line('═'); console.log('  daily_prices columns (one row)'); line('═')
{
  const { data } = await sb.from('daily_prices').select('*').limit(1)
  if (data?.[0]) console.log('  ', Object.keys(data[0]).sort().join(', '))
}

// --- 3. Does card_latest_prices exist / what does it hold? ---
line('═'); console.log('  card_latest_prices columns (one row)'); line('═')
{
  const { data, error } = await sb.from('card_latest_prices').select('*').limit(1)
  if (error) console.log('  ERR:', error.message)
  else if (data?.[0]) console.log('  ', Object.keys(data[0]).sort().join(', '))
}

// --- 4. Charizard PSA 9 < $100 across ALL sets — using card_trends ---
line('═'); console.log('  Charizard PSA 9 < $100 (via card_trends.current_psa9 < 10000 cents)'); line('═')
{
  // card_trends embeds card_name + set_name so we can filter without joining.
  const { data, error } = await sb.from('card_trends')
    .select('card_slug, card_name, set_name, current_raw, current_psa9, current_psa10')
    .ilike('card_name', '%Charizard%')
    .gt('current_psa9', 0)
    .lte('current_psa9', 10000)
    .order('current_psa9', { ascending: false })
    .limit(20)
  if (error) { console.log('  ERR:', error.message); }
  else {
    console.log(`  rows: ${data.length}`)
    for (const r of data) {
      const raw   = r.current_raw   != null ? '$' + (r.current_raw/100).toFixed(2)   : '-'
      const psa9  = r.current_psa9  != null ? '$' + (r.current_psa9/100).toFixed(2)  : '-'
      const psa10 = r.current_psa10 != null ? '$' + (r.current_psa10/100).toFixed(2) : '-'
      console.log(`    ${psa9.padStart(10)}  psa9  raw=${raw.padStart(8)}  psa10=${psa10.padStart(10)}  ${r.card_name} — ${r.set_name}`)
    }
  }
}

// --- 5. Same but PSA 8 (via daily_prices which is the only place psa8 lives) ---
line('═'); console.log('  Charizard PSA 8 < $100 via daily_prices (need join to cards)'); line('═')
{
  // First get card_slugs from cards where card_name has Charizard.
  const { data: cardRows } = await sb.from('cards')
    .select('card_slug, card_name, set_name')
    .ilike('card_name', '%Charizard%')
    .limit(500)
  const slugMap = new Map(cardRows.map(c => ['pc-' + c.card_slug, c]))
  const slugs = Array.from(slugMap.keys())
  // Split into batches (Postgrest URL length limit)
  const batches = []
  for (let i = 0; i < slugs.length; i += 100) batches.push(slugs.slice(i, i + 100))
  const results = []
  for (const b of batches) {
    // Only latest date per slug — daily_prices has historical dates, so filter to today or the latest.
    const { data } = await sb.from('daily_prices')
      .select('card_slug, date, raw_usd, psa7_usd, psa8_usd, psa9_usd, psa10_usd')
      .in('card_slug', b)
      .gt('psa8_usd', 0)
      .lte('psa8_usd', 10000)
      .order('date', { ascending: false })
      .limit(200)
    if (data) results.push(...data)
  }
  // dedupe to latest per slug
  const latest = new Map()
  for (const r of results) {
    const prev = latest.get(r.card_slug)
    if (!prev || r.date > prev.date) latest.set(r.card_slug, r)
  }
  const rows = [...latest.values()].sort((a, b) => (b.psa8_usd || 0) - (a.psa8_usd || 0))
  console.log(`  rows: ${rows.length}`)
  for (const r of rows.slice(0, 20)) {
    const c = slugMap.get(r.card_slug)
    if (!c) continue
    console.log(`    $${(r.psa8_usd/100).toFixed(2).padStart(8)}  psa8  raw=$${(r.raw_usd/100).toFixed(2).padStart(6)}  ${c.card_name} — ${c.set_name}  (${r.date})`)
  }
}

// --- 6. Also check card_trends for psa_7 / psa_8 columns explicitly ---
line('═'); console.log('  card_trends has PSA 7 / PSA 8 columns?'); line('═')
{
  const { data } = await sb.from('card_trends').select('*').limit(1)
  const cols = Object.keys(data?.[0] || {})
  const psaGradeCols = cols.filter(c => /psa\d+|cgc|bgs|sgc|tag|ace/i.test(c))
  console.log('  psa/cgc/bgs cols:', psaGradeCols.join(', '))
}
