#!/usr/bin/env node
// scripts/smart-endpoint/stage1-schema-probe.mjs
//
// Read-only probe for the smart-endpoint audit / Stage 1.
// Confirms the exact shape of set_metadata, get_set_list_v2,
// get_card_price_history, daily_prices, and cards.set_release_date
// so the new RPCs (get_latest_sets_for_ai, get_card_price_summary_for_ai)
// can be written against real column names — not guessed ones.
//
// Never mutates. Safe to run against production.

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

if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(URL, KEY)
const line = (ch = '─') => console.log(ch.repeat(76))

async function probe(label, fn) {
  const t0 = Date.now()
  try {
    const res = await fn()
    const ms = Date.now() - t0
    console.log(`\n[${ms}ms] ${label}`)
    if (res?.error) {
      console.log('  ERR:', res.error.message)
      return { ok: false, error: res.error }
    }
    return { ok: true, data: res?.data ?? res }
  } catch (e) {
    console.log(`\n[ERR] ${label}: ${e.message}`)
    return { ok: false, error: e }
  }
}

line('═')
console.log('  Smart-endpoint Stage 1 schema probe')
console.log(`  URL: ${URL}`)
console.log(`  Auth: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon'}`)
line('═')

// 1. set_metadata: what columns exist? try one EN row + one JP row
{
  const en = await probe(
    'set_metadata one EN row (all columns)',
    () => sb.from('set_metadata').select('*').eq('language', 'en').limit(1)
  )
  if (en.ok && en.data?.[0]) {
    console.log('  columns:', Object.keys(en.data[0]).sort().join(', '))
    console.log('  sample:', JSON.stringify(en.data[0], null, 2).split('\n').map(l => '    ' + l).join('\n'))
  }
  const jp = await probe(
    'set_metadata one JP row (all columns)',
    () => sb.from('set_metadata').select('*').eq('language', 'jp').limit(1)
  )
  if (jp.ok && jp.data?.[0]) {
    console.log('  columns:', Object.keys(jp.data[0]).sort().join(', '))
  }
  const count = await probe(
    'set_metadata total row count',
    () => sb.from('set_metadata').select('*', { count: 'exact', head: true })
  )
  if (count.ok) console.log('  total:', count.data ?? '(count returned via header — check n=)')
}

// 2. Does set_metadata carry release_date? Or is it derived from cards?
{
  const bySet = await probe(
    "cards.set_release_date distinct for EN, top 8 latest",
    () => sb.from('cards')
      .select('set_name, language, set_release_date')
      .eq('language', 'en')
      .not('set_release_date', 'is', null)
      .order('set_release_date', { ascending: false })
      .limit(20)
  )
  if (bySet.ok && bySet.data) {
    const seen = new Set()
    const latest = []
    for (const row of bySet.data) {
      if (!seen.has(row.set_name)) {
        seen.add(row.set_name)
        latest.push({ set_name: row.set_name, release: row.set_release_date })
        if (latest.length >= 12) break
      }
    }
    console.log('  latest 12 EN sets by cards.set_release_date:')
    for (const l of latest) console.log(`    ${l.release}  ${l.set_name}`)
  }
}

// 3. get_set_list_v2 shape — a probably-existing "sets by X" RPC
{
  const r = await probe('rpc.get_set_list_v2()', () => sb.rpc('get_set_list_v2'))
  if (r.ok && Array.isArray(r.data)) {
    console.log('  rows:', r.data.length)
    if (r.data[0]) console.log('  columns:', Object.keys(r.data[0]).sort().join(', '))
    // Look for the user-named "latest" sets to confirm they're in the DB
    const wanted = ['Perfect Order', 'Chaos Rising', 'Pitch Black', '30th Celebration',
                    'Ascended Heroes', 'Mega Evolution', 'Journey Together',
                    'Prismatic Evolutions', 'Destined Rivals']
    for (const w of wanted) {
      const hit = r.data.find(x => x.set_name === w)
      console.log(`  present: ${hit ? 'YES' : 'no '}  ${w}${hit ? `  (lang=${hit.language || '?'})` : ''}`)
    }
  }
}

// 4. get_card_price_history shape (already known — just confirm one row)
{
  // Charizard Base Set unlimited — a well-known slug — just to confirm the RPC still exists
  // Pick any card_slug from card_trends to be safe
  const trend = await probe(
    'card_trends first row with pct_365d not null',
    () => sb.from('card_trends')
      .select('card_slug, card_name, set_name, current_raw, current_psa10, raw_pct_30d, raw_pct_365d')
      .not('raw_pct_365d', 'is', null)
      .gt('current_raw', 5000)
      .limit(1)
  )
  const testSlug = trend.ok && trend.data?.[0]?.card_slug
  if (testSlug) {
    console.log(`  testing get_card_price_history for card_slug=${testSlug}`)
    const hist = await probe(
      `rpc.get_card_price_history('${testSlug}')`,
      () => sb.rpc('get_card_price_history', { slug: testSlug })
    )
    if (hist.ok && Array.isArray(hist.data)) {
      console.log('  rows:', hist.data.length)
      if (hist.data[0]) console.log('  first row:', hist.data[0])
      if (hist.data.length > 0) console.log('  last row:', hist.data[hist.data.length - 1])
    }
  }
}

// 5. daily_prices column list (single row)
{
  const dp = await probe(
    'daily_prices one row (all columns)',
    () => sb.from('daily_prices').select('*').limit(1)
  )
  if (dp.ok && dp.data?.[0]) {
    console.log('  columns:', Object.keys(dp.data[0]).sort().join(', '))
  }
}

// 6. cards column list (single row) — confirm set_release_date + variant + is_sealed
{
  const c = await probe(
    'cards one row (all columns)',
    () => sb.from('cards').select('*').limit(1)
  )
  if (c.ok && c.data?.[0]) {
    console.log('  columns:', Object.keys(c.data[0]).sort().join(', '))
  }
}

// 7. Cards count by set for the user-named recent sets — is the DATA loaded?
{
  const wanted = ['Perfect Order', 'Chaos Rising', 'Pitch Black', '30th Celebration',
                  'Mega Evolution', 'Ascended Heroes']
  for (const w of wanted) {
    const r = await probe(
      `cards count for set="${w}"`,
      () => sb.from('cards').select('*', { count: 'exact', head: true }).eq('set_name', w)
    )
    // Supabase-js returns count in the response body when head:true+count:exact
    console.log(`  count: (see line above for n)`)
  }
}

line('═')
console.log('  Done. Use the outputs to shape the Stage 1 migrations.')
line('═')
