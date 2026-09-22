#!/usr/bin/env node
// scripts/smart-endpoint/stage1b-set-count-audit.mjs
//
// Trace the "194 vs 227" discrepancy for 30th Celebration and a few
// other sets. Reports:
//   * set_metadata.total_cards
//   * COUNT(*) of cards rows
//   * COUNT(*) of cards where is_sealed=false
//   * COUNT(DISTINCT card_number) — printed slots
//   * COUNT(DISTINCT card_number) where is_sealed=false
//   * COUNT(DISTINCT card_number_display) if that column disambiguates
//   * per-variant breakdown (how many cards share each card_number)
//   * my current get_latest_sets_for_ai returns
//
// This decides what "card_count" should mean.

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

const SETS = [
  '30th Celebration',
  'Perfect Order',
  'Chaos Rising',
  'Pitch Black',
  'Ascended Heroes',
  'Prismatic Evolutions',
  'Journey Together',
  'Base Set',
  'Evolving Skies',
]

const line = (ch = '─') => console.log(ch.repeat(78))

for (const setName of SETS) {
  line('═')
  console.log(`  ${setName}`)
  line('═')

  // 1. set_metadata (both languages)
  const { data: meta } = await sb.from('set_metadata')
    .select('language, total_cards, release_year, has_first_edition, print_run_era, updated_at')
    .eq('set_name', setName)
  console.log(`  set_metadata (${meta?.length || 0} rows):`)
  for (const m of (meta || [])) console.log(`     lang=${m.language}  total_cards=${m.total_cards}  year=${m.release_year}  era=${m.print_run_era || '-'}`)

  // 2. cards raw row count
  const { count: allRows } = await sb.from('cards')
    .select('*', { count: 'exact', head: true }).eq('set_name', setName)
  const { count: nonSealedRows } = await sb.from('cards')
    .select('*', { count: 'exact', head: true }).eq('set_name', setName).eq('is_sealed', false)
  const { count: sealedRows } = await sb.from('cards')
    .select('*', { count: 'exact', head: true }).eq('set_name', setName).eq('is_sealed', true)
  console.log(`  cards rows total: ${allRows}   is_sealed=false: ${nonSealedRows}   is_sealed=true: ${sealedRows}`)

  // 3. distinct card_number
  const { data: numRows } = await sb.from('cards')
    .select('card_number, card_number_display, variant, is_sealed, language')
    .eq('set_name', setName).limit(1500)
  if (numRows) {
    const distinctNum = new Set(numRows.map(r => r.card_number).filter(Boolean))
    const distinctDisplay = new Set(numRows.map(r => r.card_number_display).filter(Boolean))
    const distinctNumNonSealed = new Set(numRows.filter(r => !r.is_sealed).map(r => r.card_number).filter(Boolean))
    console.log(`  distinct card_number: ${distinctNum.size}   distinct card_number_display: ${distinctDisplay.size}   distinct card_number (non-sealed): ${distinctNumNonSealed.size}`)

    // Group by language
    const byLang = {}
    for (const r of numRows) { byLang[r.language] = (byLang[r.language] || 0) + 1 }
    console.log(`  by language: ${JSON.stringify(byLang)}`)

    // Variant breakdown for non-sealed
    const variants = {}
    for (const r of numRows.filter(x => !x.is_sealed)) {
      const v = r.variant || '(none)'
      variants[v] = (variants[v] || 0) + 1
    }
    console.log(`  variant breakdown (non-sealed): ${JSON.stringify(variants)}`)
  }

  // 4. What our new RPC currently returns
  const { data: rpc } = await sb.rpc('get_latest_sets_for_ai', { lang: null, limit_count: 40 })
  const hit = (rpc || []).find(r => r.set_name === setName)
  if (hit) {
    console.log(`  get_latest_sets_for_ai says: card_count=${hit.card_count}  release=${hit.set_release_date}  lang=${hit.language}  release_year=${hit.release_year}`)
  } else {
    console.log(`  get_latest_sets_for_ai: not in top-40 result`)
  }
  console.log()
}

// Also probe: does the JP set_name convention include "Japanese " prefix?
line('═')
console.log('  Japanese set_metadata name convention check')
line('═')
const { data: jpMeta } = await sb.from('set_metadata').select('set_name, language').eq('language', 'jp').limit(20)
console.log('  JP set_metadata sample:')
for (const m of jpMeta || []) console.log('    ', m.set_name)
