#!/usr/bin/env node
// scripts/scanner/apply-jp-printed-denominator-second-batch.mjs
//
// Block 5A-W-51D.1 applier. Reproduces every per-set assertion from
// migrations/2026-08-05-fix-jp-printed-denominators-second-batch.sql
// via the Supabase JS client so the batch can be applied without
// direct SQL Editor access.
//
// Any assertion failure stops the run BEFORE any UPDATE is issued
// (preflight) or fails loudly after writes and stores rollback
// pointers (postflight).
//
// Usage:
//   node scripts/scanner/apply-jp-printed-denominator-second-batch.mjs --dry-run
//   node scripts/scanner/apply-jp-printed-denominator-second-batch.mjs

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

// ── Expectations table (mirrors the SQL INSERT VALUES) ───
const EXPECTATIONS = [
  { set_name: 'Japanese Abyss Eye',                  old_denom: '118', new_denom: '81',  expected: 118 },
  { set_name: 'Japanese Glory of Team Rocket',       old_denom: '132', new_denom: '98',  expected: 132 },
  { set_name: 'Japanese Nihil Zero',                 old_denom: '117', new_denom: '80',  expected: 117 },
  { set_name: 'Japanese Inferno X',                  old_denom: '116', new_denom: '80',  expected: 116 },
  { set_name: 'Japanese Wild Force',                 old_denom: '100', new_denom: '71',  expected: 100 },
  { set_name: 'Japanese Crimson Haze',               old_denom: '71',  new_denom: '66',  expected: 96  },
  { set_name: 'Japanese Mega Brave',                 old_denom: '92',  new_denom: '63',  expected: 92  },
  { set_name: 'Japanese Mega Dream ex',              old_denom: '250', new_denom: '193', expected: 487 },
  { set_name: 'Japanese Mega Symphonia',             old_denom: '92',  new_denom: '63',  expected: 92  },
  { set_name: 'Japanese Night Wanderer',             old_denom: '66',  new_denom: '64',  expected: 95  },
  { set_name: 'Japanese Stellar Miracle',            old_denom: '100', new_denom: '102', expected: 135 },
  { set_name: 'Japanese Super Electric Breaker',     old_denom: '71',  new_denom: '106', expected: 139 },
  { set_name: 'Japanese Paradise Dragona',           old_denom: '63',  new_denom: '64',  expected: 94  },
  { set_name: 'Japanese VSTAR Universe',             old_denom: '262', new_denom: '172', expected: 351 },
  { set_name: 'Japanese Battle Region',              old_denom: '70',  new_denom: '67',  expected: 135 },
  { set_name: 'Japanese Paradigm Trigger',           old_denom: '100', new_denom: '98',  expected: 126 },
  { set_name: 'Japanese Remix Bout',                 old_denom: '70',  new_denom: '64',  expected: 80  },
  { set_name: 'Japanese Super-Burst Impact',         old_denom: '94',  new_denom: '95',  expected: 111 },
  { set_name: 'Japanese Awakening Psychic King',     old_denom: '51',  new_denom: '78',  expected: 176 },
  { set_name: 'Japanese GX Battle Boost',            old_denom: '125', new_denom: '114', expected: 126 },
  { set_name: 'Japanese Bandit Ring',                old_denom: '84',  new_denom: '81',  expected: 194 },
  { set_name: 'Japanese Wild Blaze',                 old_denom: '90',  new_denom: '80',  expected: 179 },
  { set_name: 'Japanese EX Battle Boost',            old_denom: '99',  new_denom: '93',  expected: 224 },
  { set_name: 'Japanese Rising Fist',                old_denom: '88',  new_denom: '96',  expected: 210 },
  { set_name: 'Japanese Megalo Cannon',              old_denom: '86',  new_denom: '76',  expected: 172 },
  { set_name: 'Japanese Plasma Gale',                old_denom: '79',  new_denom: '70',  expected: 158 },
  { set_name: 'Japanese Cold Flare',                 old_denom: '65',  new_denom: '59',  expected: 130 },
  { set_name: 'Japanese Red Flash',                  old_denom: '65',  new_denom: '59',  expected: 129 },
  { set_name: 'Japanese Rocket Gang Strikes Back',   old_denom: '85',  new_denom: '84',  expected: 167 },
  { set_name: 'Japanese Ninja Spinner',              old_denom: '120', new_denom: '83',  expected: 120 },
  { set_name: 'Japanese Wind from the Sea',          old_denom: '90',  new_denom: '87',  expected: 180 },
  { set_name: 'Japanese Reviving Legends',           old_denom: '81',  new_denom: '80',  expected: 187 },
  { set_name: 'Japanese Split Earth',                old_denom: '91',  new_denom: '88',  expected: 182 },
  { set_name: 'Japanese Mysterious Mountains',       old_denom: '91',  new_denom: '88',  expected: 183 },
  { set_name: "Japanese 2002 McDonald's",            old_denom: '18',  new_denom: '30',  expected: 18  },
]
const COMBINED_EXPECTED = 5351

const HELD_SETS = [
  'Japanese White Flare', 'Japanese Black Bolt',
  'Japanese Holon Phantom', 'Japanese Challenge from the Darkness',
  'Japanese Crossing the Ruins', 'Japanese Darkness, and to Light',
  'Japanese Secret of the Lakes', 'Japanese Awakening Legends',
  "Japanese Leaders' Stadium", 'Japanese Gold, Silver, New World',
  'Japanese Mystery of the Fossils', 'Japanese Rocket Gang',
  'Japanese Expansion Pack',
]

const die = (msg) => { console.error('\nSTOP:', msg); process.exit(1) }

async function pageAll(query) {
  const rows = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await query.range(start, start + 999)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

// ── PREFLIGHT ────────────────────────────────────────────
console.log('=== Preflight (35 sets × 6 checks + combined + snapshot) ===')

// Per-set preflight
for (const e of EXPECTATIONS) {
  const targeted = await pageAll(
    c.from('cards').select('id, card_number, set_printed_total, is_sealed')
     .eq('set_name', e.set_name).eq('language', 'jp').eq('is_sealed', false)
  )
  const numbered = targeted.filter(r => r.card_number != null && String(r.card_number).trim() !== '')
  if (numbered.length === 0) die(`${e.set_name}: zero non-sealed numbered rows`)
  if (numbered.length !== e.expected) die(`${e.set_name}: expected ${e.expected} non-sealed numbered rows, got ${numbered.length}`)
  const denoms = [...new Set(numbered.map(r => r.set_printed_total))]
  if (denoms.length !== 1 || denoms[0] !== e.old_denom) die(`${e.set_name}: expected single current denom [${e.old_denom}], got ${JSON.stringify(denoms)}`)
  if (e.new_denom === e.old_denom) die(`${e.set_name}: target denom equals current`)
  const cnNullCount = targeted.filter(r => r.card_number == null).length
  if (cnNullCount > 0) die(`${e.set_name}: ${cnNullCount} non-sealed rows have card_number IS NULL`)
  const cnEmpty = targeted.filter(r => typeof r.card_number === 'string' && r.card_number.trim() === '').length
  if (cnEmpty > 0) die(`${e.set_name}: ${cnEmpty} non-sealed rows have trim(card_number) = empty string`)
  // is_sealed IS NULL — check via a separate query (JS client can't filter with is null via eq)
  const sealedNullSet = await c.from('cards').select('id', { count: 'exact', head: true })
     .eq('set_name', e.set_name).eq('language', 'jp').is('is_sealed', null)
  if ((sealedNullSet.count ?? 0) > 0) die(`${e.set_name}: ${sealedNullSet.count} rows with is_sealed IS NULL`)
}

// Combined targeted-row count
const targetedSetNames = EXPECTATIONS.map(e => e.set_name)
let combinedTotal = 0
for (const e of EXPECTATIONS) combinedTotal += e.expected
if (combinedTotal !== COMBINED_EXPECTED) die(`Combined expected count mismatch: sum(expected)=${combinedTotal}, COMBINED_EXPECTED=${COMBINED_EXPECTED}`)

// Live combined count — the sum of live per-set counts
const liveCombined = await Promise.all(EXPECTATIONS.map(async e => {
  const { count } = await c.from('cards').select('id', { count: 'exact', head: true })
     .eq('set_name', e.set_name).eq('language', 'jp').eq('is_sealed', false)
     .not('card_number', 'is', null)
  return count ?? 0
}))
const liveTotal = liveCombined.reduce((s, n) => s + n, 0)
if (liveTotal !== COMBINED_EXPECTED) die(`Combined live count expected ${COMBINED_EXPECTED}, got ${liveTotal}`)
console.log(`  Combined live non-sealed numbered rows across 35 sets: ${liveTotal} ✓`)

// Capture pre-snapshots for held + sealed rows in active sets + cross-checks
console.log('  Capturing pre-snapshots (held / sealed-in-active / cross-checks)…')
const preHeld = {}
for (const s of HELD_SETS) {
  preHeld[s] = await pageAll(
    c.from('cards').select('id, set_printed_total, card_number_display, card_number')
     .eq('set_name', s).eq('language', 'jp')
  )
}
const preSealedInActive = {}
for (const e of EXPECTATIONS) {
  preSealedInActive[e.set_name] = await pageAll(
    c.from('cards').select('id, set_printed_total, card_number_display, card_number')
     .eq('set_name', e.set_name).eq('language', 'jp').eq('is_sealed', true)
  )
}
const preNumeratorSnapshot = {}
for (const e of EXPECTATIONS) {
  preNumeratorSnapshot[e.set_name] = await pageAll(
    c.from('cards').select('id, card_number')
     .eq('set_name', e.set_name).eq('language', 'jp').eq('is_sealed', false)
     .not('card_number', 'is', null)
  )
}

console.log('  All preflight checks passed ✓')
if (dryRun) { console.log('\n[apply-second-batch] DRY RUN — no writes performed.'); process.exit(0) }

// ── APPLY ───────────────────────────────────────────────
console.log('\n=== Applying 35 UPDATEs ===')
let totalWritten = 0
const perSetWritten = {}
for (const e of EXPECTATIONS) {
  const pre = preNumeratorSnapshot[e.set_name]
  // Batch by numerator so card_number_display is composed correctly
  const byNum = new Map()
  for (const r of pre) {
    const key = String(r.card_number).trim()
    if (!byNum.has(key)) byNum.set(key, [])
    byNum.get(key).push(r.id)
  }
  let touched = 0
  for (const [num, ids] of byNum) {
    const display = `${num}/${e.new_denom}`
    const { error } = await c.from('cards')
      .update({ set_printed_total: e.new_denom, card_number_display: display })
      .in('id', ids)
    if (error) die(`UPDATE ${e.set_name} numerator ${num} failed: ${error.message}`)
    touched += ids.length
  }
  perSetWritten[e.set_name] = touched
  totalWritten += touched
  console.log(`  ${e.set_name.padEnd(45)} ${String(touched).padStart(4)} rows → /${e.new_denom}`)
}
console.log(`  Total written: ${totalWritten}`)

// ── POSTFLIGHT ──────────────────────────────────────────
console.log('\n=== Postflight (35 sets × 3 checks + numerator preservation + cross-checks) ===')

for (const e of EXPECTATIONS) {
  const rows = await pageAll(
    c.from('cards').select('id, card_number, set_printed_total, card_number_display')
     .eq('set_name', e.set_name).eq('language', 'jp').eq('is_sealed', false)
     .not('card_number', 'is', null)
  )
  if (rows.length !== e.expected) die(`Postflight ${e.set_name}: row count changed from ${e.expected} to ${rows.length}`)
  const denoms = [...new Set(rows.map(r => r.set_printed_total))]
  if (denoms.length !== 1 || denoms[0] !== e.new_denom) die(`Postflight ${e.set_name}: expected single new denom [${e.new_denom}], got ${JSON.stringify(denoms)}`)
  const badDisplay = rows.filter(r => r.card_number_display !== `${String(r.card_number).trim()}/${e.new_denom}`).length
  if (badDisplay > 0) die(`Postflight ${e.set_name}: ${badDisplay} rows have unexpected card_number_display`)
}

// Numerator preservation
for (const e of EXPECTATIONS) {
  const pre = preNumeratorSnapshot[e.set_name]
  const preMap = new Map(pre.map(r => [r.id, String(r.card_number).trim()]))
  const post = await pageAll(
    c.from('cards').select('id, card_number')
     .eq('set_name', e.set_name).eq('language', 'jp').eq('is_sealed', false)
     .not('card_number', 'is', null)
  )
  const postMap = new Map(post.map(r => [r.id, String(r.card_number).trim()]))
  let changed = 0, lost = 0
  for (const [id, before] of preMap) {
    if (!postMap.has(id)) { lost += 1; continue }
    if (postMap.get(id) !== before) changed += 1
  }
  if (lost > 0) die(`Postflight ${e.set_name}: ${lost} rows lost identity`)
  if (changed > 0) die(`Postflight ${e.set_name}: ${changed} rows had card_number altered`)
}
console.log('  Numerator preservation: ✓ for every set')

// Sealed rows in active sets unchanged
let sealedChanges = 0
for (const e of EXPECTATIONS) {
  const preRows = preSealedInActive[e.set_name]
  if (preRows.length === 0) continue
  const preMap = new Map(preRows.map(r => [r.id, r]))
  const postRows = await pageAll(
    c.from('cards').select('id, set_printed_total, card_number_display, card_number')
     .eq('set_name', e.set_name).eq('language', 'jp').eq('is_sealed', true)
  )
  for (const post of postRows) {
    const pre = preMap.get(post.id)
    if (!pre) continue
    if (pre.set_printed_total !== post.set_printed_total ||
        pre.card_number_display !== post.card_number_display ||
        pre.card_number !== post.card_number) sealedChanges += 1
  }
}
if (sealedChanges > 0) die(`Postflight: ${sealedChanges} sealed rows in the 35 active sets were altered`)
console.log('  Sealed rows in active sets: unchanged ✓')

// Held sets unchanged
let heldChanges = 0
for (const s of HELD_SETS) {
  const preRows = preHeld[s]
  const preMap = new Map(preRows.map(r => [r.id, r]))
  const postRows = await pageAll(
    c.from('cards').select('id, set_printed_total, card_number_display, card_number')
     .eq('set_name', s).eq('language', 'jp')
  )
  for (const post of postRows) {
    const pre = preMap.get(post.id)
    if (!pre) continue
    if (pre.set_printed_total !== post.set_printed_total ||
        pre.card_number_display !== post.card_number_display ||
        pre.card_number !== post.card_number) heldChanges += 1
  }
}
if (heldChanges > 0) die(`Postflight: ${heldChanges} held-set rows (Black Bolt/White Flare/vintage aggregates) were altered`)
console.log('  Held sets (Black Bolt, White Flare, 11 vintage aggregates): unchanged ✓')

// Cross-checks: Battle Partners /100, Terastal Festival /187, Ruler /108, Tag All Stars /173, English SV 151 /165
for (const cc of [
  { set_name: 'Japanese Battle Partners',          lang: 'jp', want: '100' },
  { set_name: 'Japanese Terastal Festival',        lang: 'jp', want: '187' },
  { set_name: 'Japanese Ruler of the Black Flame', lang: 'jp', want: '108' },
  { set_name: 'Japanese Tag All Stars',            lang: 'jp', want: '173' },
  { set_name: 'Scarlet & Violet 151',              lang: 'en', want: '165' },
]) {
  const rows = await pageAll(
    c.from('cards').select('set_printed_total')
     .eq('set_name', cc.set_name).eq('language', cc.lang).eq('is_sealed', false)
     .not('card_number', 'is', null)
  )
  const distinct = [...new Set(rows.map(r => r.set_printed_total))]
  if (distinct.length !== 1 || distinct[0] !== cc.want) die(`Cross-check FAILED: ${cc.set_name} (${cc.lang}) expected /${cc.want}, got ${JSON.stringify(distinct)}`)
}
console.log('  Cross-checks (BP/TF/Ruler/Tag All Stars/English SV 151): ✓')

console.log(`\n=== Done. Total rows updated: ${totalWritten} ===`)
