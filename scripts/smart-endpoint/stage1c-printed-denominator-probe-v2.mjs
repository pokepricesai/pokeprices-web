#!/usr/bin/env node
// v2: minimal columns to avoid the earlier "no rows" surprise (any
// select of an unknown column silently returns 0 rows via PostgREST).

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
  'Japanese Battle Partners',
  'Japanese Abyss Eye',
]

for (const setName of SETS) {
  console.log('\n══ ' + setName + ' ══')
  const { data, error } = await sb.from('cards')
    .select('card_number,card_number_display,set_printed_total,is_sealed,language')
    .eq('set_name', setName)
    .limit(800)
  if (error) { console.log('  ERR:', error.message); continue }
  if (!data?.length) { console.log('  no rows'); continue }
  console.log(`  cards rows: ${data.length}`)

  // set_printed_total distribution
  const spt = {}
  for (const r of data) {
    const k = r.set_printed_total ?? '(null)'
    spt[k] = (spt[k] || 0) + 1
  }
  console.log(`  set_printed_total distribution: ${JSON.stringify(spt)}`)

  // denominator from card_number_display  N/M
  const den = {}
  for (const r of data) {
    if (typeof r.card_number_display !== 'string') continue
    const m = r.card_number_display.match(/\/(\d+)$/)
    if (m) den[m[1]] = (den[m[1]] || 0) + 1
  }
  console.log(`  card_number_display denominators: ${JSON.stringify(den)}`)

  // Do the two agree?  Modal denominator vs modal set_printed_total
  const topSpt = Object.entries(spt).filter(([k]) => k !== '(null)')
    .sort((a,b) => b[1]-a[1])[0]?.[0]
  const topDen = Object.entries(den).sort((a,b) => b[1]-a[1])[0]?.[0]
  console.log(`  modal set_printed_total="${topSpt}"  modal denominator="${topDen}"  ${topSpt === topDen ? 'MATCH' : 'DIFFER'}`)

  // Non-sealed rows count
  const nonSealed = data.filter(x => !x.is_sealed).length
  console.log(`  non-sealed rows: ${nonSealed}`)
}
