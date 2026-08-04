#!/usr/bin/env node
// scripts/scanner/audit-second-batch-preflight.mjs
//
// Block 5A-W-51D.1 — per-set data-quality inventory for the 35
// APPLY_SAFE sets. Read-only. Feeds the strengthened preflight
// assertions in the second-batch migration.
//
// For every active set:
//   * count is_sealed = true / false / NULL
//   * count card_number IS NULL / trim = ''
//   * distinct set_printed_total (all rows and non-sealed only)
//   * exact non-sealed numbered-row count (this is what the migration
//     asserts against pre-write)
//   * min / max stored numerator

import { readFileSync, existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
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

// The 35 APPLY_SAFE sets from Block 5A-W-51D verification
const ACTIVE = [
  { set_name: 'Japanese Abyss Eye',                  old: 118, new_val: 81 },
  { set_name: 'Japanese Glory of Team Rocket',       old: 132, new_val: 98 },
  { set_name: 'Japanese Nihil Zero',                 old: 117, new_val: 80 },
  { set_name: 'Japanese Inferno X',                  old: 116, new_val: 80 },
  { set_name: 'Japanese Wild Force',                 old: 100, new_val: 71 },
  { set_name: 'Japanese Crimson Haze',               old: 71,  new_val: 66 },
  { set_name: 'Japanese Mega Brave',                 old: 92,  new_val: 63 },
  { set_name: 'Japanese Mega Dream ex',              old: 250, new_val: 193 },
  { set_name: 'Japanese Mega Symphonia',             old: 92,  new_val: 63 },
  { set_name: 'Japanese Night Wanderer',             old: 66,  new_val: 64 },
  { set_name: 'Japanese Stellar Miracle',            old: 100, new_val: 102 },
  { set_name: 'Japanese Super Electric Breaker',     old: 71,  new_val: 106 },
  { set_name: 'Japanese Paradise Dragona',           old: 63,  new_val: 64 },
  { set_name: 'Japanese VSTAR Universe',             old: 262, new_val: 172 },
  { set_name: 'Japanese Battle Region',              old: 70,  new_val: 67 },
  { set_name: 'Japanese Paradigm Trigger',           old: 100, new_val: 98 },
  { set_name: 'Japanese Remix Bout',                 old: 70,  new_val: 64 },
  { set_name: 'Japanese Super-Burst Impact',         old: 94,  new_val: 95 },
  { set_name: 'Japanese Awakening Psychic King',     old: 51,  new_val: 78 },
  { set_name: 'Japanese GX Battle Boost',            old: 125, new_val: 114 },
  { set_name: 'Japanese Bandit Ring',                old: 84,  new_val: 81 },
  { set_name: 'Japanese Wild Blaze',                 old: 90,  new_val: 80 },
  { set_name: 'Japanese EX Battle Boost',            old: 99,  new_val: 93 },
  { set_name: 'Japanese Rising Fist',                old: 88,  new_val: 96 },
  { set_name: 'Japanese Megalo Cannon',              old: 86,  new_val: 76 },
  { set_name: 'Japanese Plasma Gale',                old: 79,  new_val: 70 },
  { set_name: 'Japanese Cold Flare',                 old: 65,  new_val: 59 },
  { set_name: 'Japanese Red Flash',                  old: 65,  new_val: 59 },
  { set_name: 'Japanese Rocket Gang Strikes Back',   old: 85,  new_val: 84 },
  { set_name: 'Japanese Ninja Spinner',              old: 120, new_val: 83 },
  { set_name: 'Japanese Wind from the Sea',          old: 90,  new_val: 87 },
  { set_name: 'Japanese Reviving Legends',           old: 81,  new_val: 80 },
  { set_name: 'Japanese Split Earth',                old: 91,  new_val: 88 },
  { set_name: 'Japanese Mysterious Mountains',       old: 91,  new_val: 88 },
  { set_name: "Japanese 2002 McDonald's",            old: 18,  new_val: 30 },
]

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

const findings = []
for (const s of ACTIVE) {
  const q = c.from('cards').select('id, is_sealed, card_number, set_printed_total, card_number_display').eq('set_name', s.set_name).eq('language', 'jp')
  const rows = await pageAll(q)

  const sealedTrue  = rows.filter(r => r.is_sealed === true).length
  const sealedFalse = rows.filter(r => r.is_sealed === false).length
  const sealedNull  = rows.filter(r => r.is_sealed == null).length
  const cnNull      = rows.filter(r => r.card_number == null).length
  const cnEmpty     = rows.filter(r => typeof r.card_number === 'string' && r.card_number.trim() === '').length

  // Non-sealed numbered rows — target of the UPDATE
  const nsNumbered = rows.filter(r =>
    r.is_sealed === false &&
    r.card_number != null &&
    typeof r.card_number === 'string' &&
    r.card_number.trim() !== ''
  )
  const nsNumberedCount = nsNumbered.length

  // Distinct stored denominators
  const denomsAll   = [...new Set(rows.map(r => r.set_printed_total).filter(Boolean))]
  const denomsNsNum = [...new Set(nsNumbered.map(r => r.set_printed_total).filter(Boolean))]

  // Numerator range on non-sealed numbered
  const nums = nsNumbered.map(r => parseInt(r.card_number.trim(), 10)).filter(n => !isNaN(n))
  const minNum = nums.length ? Math.min(...nums) : null
  const maxNum = nums.length ? Math.max(...nums) : null

  findings.push({
    set_name: s.set_name,
    expected_old: s.old,
    target_new: s.new_val,
    total_rows: rows.length,
    is_sealed_true: sealedTrue,
    is_sealed_false: sealedFalse,
    is_sealed_null: sealedNull,
    card_number_null: cnNull,
    card_number_empty: cnEmpty,
    non_sealed_numbered_count: nsNumberedCount,
    distinct_denoms_all: denomsAll,
    distinct_denoms_non_sealed_numbered: denomsNsNum,
    stored_denom_matches_expected_old: denomsNsNum.length === 1 && parseInt(denomsNsNum[0], 10) === s.old,
    min_numerator: minNum,
    max_numerator: maxNum,
  })
}

await mkdir('reports', { recursive: true })
await writeFile('reports/jp-second-batch-preflight.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  active_set_count: ACTIVE.length,
  findings,
}, null, 2), 'utf8')

// Compact console table
console.log('set_name'.padEnd(45), 'sealed=null cn=null cn=empty  ns_num  denoms_ns_num  expected_old->stored_ok')
for (const f of findings) {
  console.log(
    f.set_name.padEnd(45),
    String(f.is_sealed_null).padStart(3),
    '        ',
    String(f.card_number_null).padStart(3),
    '     ',
    String(f.card_number_empty).padStart(3),
    '     ',
    String(f.non_sealed_numbered_count).padStart(4),
    '   ',
    JSON.stringify(f.distinct_denoms_non_sealed_numbered).padEnd(10),
    '     ',
    `${f.expected_old}→${f.distinct_denoms_non_sealed_numbered.join(',')}`,
    f.stored_denom_matches_expected_old ? '✓' : '✗',
  )
}
// Aggregate anomalies
const anomalies = {
  any_sealed_null: findings.filter(f => f.is_sealed_null > 0).length,
  any_cn_empty: findings.filter(f => f.card_number_empty > 0).length,
  any_multi_denom: findings.filter(f => f.distinct_denoms_non_sealed_numbered.length > 1).length,
  any_wrong_stored_denom: findings.filter(f => !f.stored_denom_matches_expected_old).length,
  any_zero_ns_numbered: findings.filter(f => f.non_sealed_numbered_count === 0).length,
}
console.log('\nAnomaly counts:', anomalies)
