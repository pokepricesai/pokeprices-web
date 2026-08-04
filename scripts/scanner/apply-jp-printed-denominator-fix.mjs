#!/usr/bin/env node
// scripts/scanner/apply-jp-printed-denominator-fix.mjs
//
// Block 5A-W-51C Stage 1 — applies the two CONFIRMED_MISMATCH data
// corrections from migrations/2026-08-05-fix-jp-printed-denominators.sql
// via the Supabase JS client, since the SQL Editor requires manual
// paste and the JS client can execute the same UPDATEs safely.
//
// Preflight + postflight assertions match the DO blocks in the SQL
// file: fail loudly if reality has drifted.

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
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const dryRun = process.argv.includes('--dry-run')

const TARGETS = [
  { set_name: 'Japanese Battle Partners',   expected_current: '130', new_denom: '100' },
  { set_name: 'Japanese Terastal Festival', expected_current: '128', new_denom: '187' },
]

async function pagedCount(setName) {
  // count via HEAD select
  const { count, error } = await c.from('cards').select('id', { count: 'exact', head: true })
    .eq('set_name', setName).eq('language', 'jp').not('card_number', 'is', null)
  if (error) throw new Error(`count(${setName}) failed: ${error.message}`)
  return count
}

async function distinctDenoms(setName) {
  const denoms = new Set()
  for (let start = 0; ; start += 1000) {
    const { data, error } = await c.from('cards').select('set_printed_total')
      .eq('set_name', setName).eq('language', 'jp').not('card_number', 'is', null)
      .range(start, start + 999)
    if (error) throw new Error(`sample(${setName}) failed: ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data) if (r.set_printed_total) denoms.add(r.set_printed_total)
    if (data.length < 1000) break
  }
  return [...denoms]
}

console.log('=== Preflight ===')
for (const t of TARGETS) {
  const denoms = await distinctDenoms(t.set_name)
  const count = await pagedCount(t.set_name)
  if (denoms.length !== 1 || denoms[0] !== t.expected_current) {
    console.error(`PREFLIGHT FAILED: ${t.set_name} expected single stored denom [${t.expected_current}], got ${JSON.stringify(denoms)}`)
    process.exit(1)
  }
  console.log(`  ${t.set_name.padEnd(30)}  denom=[${denoms[0]}] rows_with_number=${count}  → will rewrite to /${t.new_denom}`)
}

if (dryRun) { console.log('\n[apply-jp-printed-denominator-fix] DRY RUN — no writes.'); process.exit(0) }

console.log('\n=== Applying ===')
// UPDATE ... SET card_number_display = card_number || '/' || new_denom
// Supabase PostgREST does not natively support column-expression UPDATE
// (needs client-side compose). We iterate the rows for each target,
// updating in bulk by primary key list.
for (const t of TARGETS) {
  // Fetch every row id + card_number for this set
  const rows = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await c.from('cards').select('id, card_number')
      .eq('set_name', t.set_name).eq('language', 'jp').not('card_number', 'is', null)
      .range(start, start + 999)
    if (error) { console.error(error.message); process.exit(1) }
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  // Batch update: group by card_number so each unique numerator maps
  // to one update statement.
  const byNum = new Map()
  for (const r of rows) {
    const num = String(r.card_number)
    if (!byNum.has(num)) byNum.set(num, [])
    byNum.get(num).push(r.id)
  }
  let touched = 0
  for (const [num, ids] of byNum) {
    const display = `${num}/${t.new_denom}`
    const { error } = await c.from('cards')
      .update({ set_printed_total: t.new_denom, card_number_display: display })
      .in('id', ids)
    if (error) { console.error(`UPDATE ${t.set_name} #${num} failed:`, error.message); process.exit(1) }
    touched += ids.length
  }
  console.log(`  ${t.set_name.padEnd(30)}  rows updated: ${touched} across ${byNum.size} unique numerators`)
}

console.log('\n=== Postflight ===')
for (const t of TARGETS) {
  const denoms = await distinctDenoms(t.set_name)
  if (denoms.length !== 1 || denoms[0] !== t.new_denom) {
    console.error(`POSTFLIGHT FAILED: ${t.set_name} expected single stored denom [${t.new_denom}], got ${JSON.stringify(denoms)}`)
    process.exit(1)
  }
  console.log(`  ${t.set_name.padEnd(30)}  new denom=[${denoms[0]}] ✓`)
}

// Explicit N's Reshiram check — the scan that motivated this block.
const { data: rr } = await c.from('cards').select('card_name, card_number, card_number_display, set_printed_total')
  .eq('set_name', 'Japanese Battle Partners').eq('card_number', '109')
console.log('\n=== N\'s Reshiram check ===')
console.log(' ', JSON.stringify(rr, null, 2))
if (rr?.[0]?.card_number_display !== '109/100') {
  console.error('POSTFLIGHT FAILED: N\'s Reshiram should now show 109/100, got', rr?.[0]?.card_number_display)
  process.exit(1)
}
console.log('\nDone.')
