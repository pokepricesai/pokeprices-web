#!/usr/bin/env node
// scripts/smart-endpoint/stage1c-printed-denominator-probe.mjs
//
// Does PokePrices reliably store the OFFICIAL / PRINTED set size (the
// denominator you see printed on a card, e.g. 128 for 30th Celebration,
// where a card reads "12/128")? If yes, expose it as a distinct field
// from catalogue totals in the AI-facing RPC.
//
// Checks:
//   1. cards.set_printed_total  (CLAUDE.md mentions this; is it populated?)
//   2. cards.card_number_display (e.g. "12/128"); can we derive the
//      denominator from it and does it agree per-set?
//   3. Any dedicated set_denominator column on cards / set_metadata?

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

  // Grab up to 500 cards for the set so we can profile the denominators
  const { data } = await sb.from('cards')
    .select('card_number, card_number_display, set_printed_total, variant, is_sealed, language')
    .eq('set_name', setName)
    .limit(800)

  if (!data?.length) { console.log('  no rows'); continue }

  const langs = new Set(data.map(r => r.language))
  console.log(`  languages present in cards: ${JSON.stringify([...langs])}`)

  // 1. set_printed_total  (is it consistent across the set?)
  const printedTotals = new Set(data.map(r => r.set_printed_total).filter(x => x != null && x !== ''))
  console.log(`  distinct set_printed_total values: ${printedTotals.size}`)
  if (printedTotals.size <= 8) console.log(`    values: ${JSON.stringify([...printedTotals])}`)
  const printedTotalPopulation = data.filter(r => r.set_printed_total != null && r.set_printed_total !== '').length
  console.log(`  set_printed_total populated on ${printedTotalPopulation}/${data.length} rows (${Math.round(100*printedTotalPopulation/data.length)}%)`)

  // 2. card_number_display denominator distribution
  const denominators = {}
  for (const r of data) {
    if (typeof r.card_number_display !== 'string') continue
    const m = r.card_number_display.match(/\/(\d+)$/)
    if (m) {
      const d = m[1]
      denominators[d] = (denominators[d] || 0) + 1
    }
  }
  console.log(`  card_number_display denominators (from N/M): ${JSON.stringify(denominators)}`)

  // 3. Split by is_sealed
  const nonSealedDenoms = {}
  for (const r of data.filter(x => !x.is_sealed)) {
    if (typeof r.card_number_display !== 'string') continue
    const m = r.card_number_display.match(/\/(\d+)$/)
    if (m) nonSealedDenoms[m[1]] = (nonSealedDenoms[m[1]] || 0) + 1
  }
  console.log(`  card_number_display denominators (non-sealed only): ${JSON.stringify(nonSealedDenoms)}`)
}

// Also check whether set_metadata has any other size-ish columns we
// missed on first scan.
line('═')
console.log('  set_metadata full row for 30th Celebration')
line('═')
const { data: meta } = await sb.from('set_metadata').select('*').eq('set_name', '30th Celebration')
for (const m of meta || []) console.log('    ', JSON.stringify(m, null, 2))
