#!/usr/bin/env node
// scripts/scanner/verify-tier-a-candidates.mjs
//
// Block 5A-W-51D — per-set verification of the 37 Tier A candidates
// from the earlier 51C audit. For each candidate, collect exact
// counts + 3 representative rows and classify against the block spec's
// stricter criteria.
//
// Classifications:
//   APPLY_SAFE                — every criterion satisfied
//   HOLD_AGGREGATE_OR_SPLIT   — DB appears to aggregate multiple sources
//   HOLD_SOURCE_MAPPING       — source-name mapping uncertain
//   NOT_APPLICABLE            — set does not use N/M numbering
//
// Read-only.

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

// The 37 Tier A candidates + their sourced printed base
const CANDIDATES = [
  { set_name: 'Japanese White Flare',              base: 86,  bulba: 'White Flare',                 jp_name: 'ホワイトフレア', paired_with: 'Japanese Black Bolt' },
  { set_name: 'Japanese Black Bolt',               base: 86,  bulba: 'Black Bolt',                  jp_name: 'ブラックボルト', paired_with: 'Japanese White Flare' },
  { set_name: 'Japanese Abyss Eye',                base: 81,  bulba: 'Abyss Eye',                   jp_name: 'アビスアイ' },
  { set_name: 'Japanese Glory of Team Rocket',     base: 98,  bulba: 'Glory of the Rocket Gang',    jp_name: 'ロケット団の栄光' },
  { set_name: 'Japanese Nihil Zero',               base: 80,  bulba: 'Nihil Zero',                  jp_name: 'ムニキスゼロ' },
  { set_name: 'Japanese Inferno X',                base: 80,  bulba: 'Inferno X',                   jp_name: 'インフェルノX' },
  { set_name: 'Japanese Mysterious Mountains',     base: 88,  bulba: 'Mysterious Mountains',        jp_name: '神秘なる山' },
  { set_name: 'Japanese Wild Force',               base: 71,  bulba: 'Wild Force',                  jp_name: 'ワイルドフォース', paired_with: 'Japanese Cyber Judge' },
  { set_name: 'Japanese Crimson Haze',             base: 66,  bulba: 'Crimson Haze',                jp_name: 'クリムゾンヘイズ' },
  { set_name: 'Japanese Mega Brave',               base: 63,  bulba: 'Mega Brave',                  jp_name: 'メガブレイブ', paired_with: 'Japanese Mega Symphonia' },
  { set_name: 'Japanese Mega Dream ex',            base: 193, bulba: 'Mega Dream ex',               jp_name: 'MEGAドリームex' },
  { set_name: 'Japanese Mega Symphonia',           base: 63,  bulba: 'Mega Symphonia',              jp_name: 'メガシンフォニア', paired_with: 'Japanese Mega Brave' },
  { set_name: 'Japanese Night Wanderer',           base: 64,  bulba: 'Night Wanderer',              jp_name: 'ナイトワンダラー', paired_with: 'Japanese Paradise Dragona' },
  { set_name: 'Japanese Stellar Miracle',          base: 102, bulba: 'Stellar Miracle',             jp_name: 'ステラミラクル' },
  { set_name: 'Japanese Super Electric Breaker',   base: 106, bulba: 'Super Electric Breaker',      jp_name: '超電ブレイカー' },
  { set_name: 'Japanese Paradise Dragona',         base: 64,  bulba: 'Paradise Dragona',            jp_name: '楽園ドラゴーナ', paired_with: 'Japanese Night Wanderer' },
  { set_name: 'Japanese VSTAR Universe',           base: 172, bulba: 'VSTAR Universe',              jp_name: 'VSTARユニバース' },
  { set_name: 'Japanese Battle Region',            base: 67,  bulba: 'Battle Region',               jp_name: 'バトルリージョン' },
  { set_name: 'Japanese Paradigm Trigger',         base: 98,  bulba: 'Paradigm Trigger',            jp_name: 'パラダイムトリガー' },
  { set_name: 'Japanese Remix Bout',               base: 64,  bulba: 'Remix Bout',                  jp_name: 'リミックスバウト' },
  { set_name: 'Japanese Super-Burst Impact',       base: 95,  bulba: 'Super-Burst Impact',          jp_name: '超爆インパクト' },
  { set_name: 'Japanese Awakening Psychic King',   base: 78,  bulba: 'Awakening Psychic King',      jp_name: 'めざめる超王' },
  { set_name: 'Japanese GX Battle Boost',          base: 114, bulba: 'GX Battle Boost',             jp_name: 'GXバトルブースト' },
  { set_name: 'Japanese Bandit Ring',              base: 81,  bulba: 'Bandit Ring',                 jp_name: 'バンデットリング' },
  { set_name: 'Japanese Wild Blaze',               base: 80,  bulba: 'Wild Blaze',                  jp_name: 'ワイルドブレイズ' },
  { set_name: 'Japanese EX Battle Boost',          base: 93,  bulba: 'EX Battle Boost',             jp_name: 'EXバトルブースト' },
  { set_name: 'Japanese Rising Fist',              base: 96,  bulba: 'Rising Fist',                 jp_name: 'ライジングフィスト' },
  { set_name: 'Japanese Megalo Cannon',            base: 76,  bulba: 'Megalo Cannon',               jp_name: 'メガロキャノン' },
  { set_name: 'Japanese Plasma Gale',              base: 70,  bulba: 'Plasma Gale',                 jp_name: 'プラズマゲイル' },
  { set_name: 'Japanese Cold Flare',               base: 59,  bulba: 'Cold Flare',                  jp_name: 'コールドフレア', paired_with: 'Japanese Freeze Bolt' },
  { set_name: 'Japanese Rocket Gang Strikes Back', base: 84,  bulba: 'Rocket Gang Strikes Back',    jp_name: 'ロケット団の逆襲' },
  { set_name: 'Japanese Ninja Spinner',            base: 83,  bulba: 'Ninja Spinner',               jp_name: 'ニンジャスピナー' },
  { set_name: 'Japanese Wind from the Sea',        base: 87,  bulba: 'Wind from the Sea',           jp_name: '海からの風' },
  { set_name: "Japanese 2002 McDonald's",          base: 30,  bulba: "McDonald's Original Minimum Pack", jp_name: 'マクドナルドオリジナル' },
  { set_name: 'Japanese Reviving Legends',         base: 80,  bulba: 'Reviving Legends',            jp_name: 'よみがえる伝説' },
  { set_name: 'Japanese Split Earth',              base: 88,  bulba: 'Split Earth',                 jp_name: '裂けた大地' },
  { set_name: 'Japanese Red Flash',                base: 59,  bulba: 'Red Flash',                   jp_name: '赤い閃光', paired_with: 'Japanese Blue Shock' },
]

const results = []
for (const cand of CANDIDATES) {
  // Non-sealed cards only
  const rows = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await c.from('cards').select('id, card_name, card_number, card_number_display, set_printed_total, is_sealed, pc_url')
      .eq('set_name', cand.set_name).eq('language', 'jp').eq('is_sealed', false)
      .range(start, start + 999)
    if (error) { console.error(error.message); process.exit(1) }
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  // Sealed rows in this set
  const { count: sealedCount } = await c.from('cards').select('id', { count: 'exact', head: true })
    .eq('set_name', cand.set_name).eq('language', 'jp').eq('is_sealed', true)

  const nums = rows.filter(r => r.card_number).map(r => parseInt(r.card_number, 10)).filter(n => !isNaN(n))
  const uniqueNums = new Set(nums)
  const denoms = [...new Set(rows.map(r => r.set_printed_total).filter(Boolean))]
  const storedDenom = denoms.length === 1 ? parseInt(denoms[0], 10) : null
  const minNum = nums.length ? Math.min(...nums) : null
  const maxNum = nums.length ? Math.max(...nums) : null
  const rowsAtBase = rows.filter(r => r.card_number && parseInt(r.card_number, 10) === cand.base)
  const rowsBelowBase = rows.filter(r => r.card_number && parseInt(r.card_number, 10) < cand.base)
  const secretsAboveBase = rows.filter(r => r.card_number && parseInt(r.card_number, 10) > cand.base)
  const numeratorsWithoutBase = [...uniqueNums].filter(n => n > cand.base).length
  const numeratorsBaseOrBelow = [...uniqueNums].filter(n => n <= cand.base).length

  // 3 representative rows: earliest normal + at-base + secret
  const sortedRows = [...rows].sort((a, b) => parseInt(a.card_number || '99999') - parseInt(b.card_number || '99999'))
  const sampleEarly = sortedRows.find(r => r.card_number && parseInt(r.card_number, 10) <= 5) ?? sortedRows.find(r => r.card_number)
  const sampleAtBase = sortedRows.find(r => r.card_number && parseInt(r.card_number, 10) === cand.base) ??
                       sortedRows.filter(r => r.card_number).slice(-1)[0]
  const sampleSecret = [...secretsAboveBase].sort((a, b) => parseInt(b.card_number) - parseInt(a.card_number))[0] ?? null

  // Heuristics for classification. Each is a REASON for holding, not automatic APPLY_SAFE.
  const holdReasons = []
  const numNotAtBase = numeratorsBaseOrBelow === 0
  const secretsFarBeyondBase = maxNum && cand.base && (maxNum > cand.base * 1.6)
  const uniqueBeyondBaseRatio = numeratorsWithoutBase / Math.max(1, cand.base)

  if (rows.length === 0) holdReasons.push('no imported non-sealed cards')
  if (denoms.length > 1) holdReasons.push(`multiple stored denominators: ${denoms.join(',')}`)
  if (storedDenom === cand.base) holdReasons.push('stored already matches reference — no correction needed')
  if (numNotAtBase) holdReasons.push('no cards at or below the sourced base — base may be wrong or DB may not represent this set')
  if (secretsFarBeyondBase) holdReasons.push(`max_num ${maxNum} is > 1.6× base ${cand.base} — likely aggregate`)
  if (uniqueBeyondBaseRatio > 0.6) holdReasons.push(`>60% of unique numerators are above the sourced base — likely aggregate or wrong source`)

  // Also: paired expansion — the two halves must map to same base per Bulbapedia
  // (they already do in the reference list); no additional check needed unless
  // PokePrices merged them, which we handle above via numerator distribution.

  let classification
  if (holdReasons.length === 0) classification = 'APPLY_SAFE'
  else if (holdReasons.some(r => r.includes('aggregate') || r.includes('above'))) classification = 'HOLD_AGGREGATE_OR_SPLIT'
  else if (holdReasons.some(r => r.includes('no cards at or below'))) classification = 'HOLD_SOURCE_MAPPING'
  else classification = 'HOLD_SOURCE_MAPPING'

  results.push({
    set_name: cand.set_name,
    bulbapedia_name: cand.bulba,
    jp_name: cand.jp_name,
    paired_with: cand.paired_with ?? null,
    reference_base: cand.base,
    stored_denominator: storedDenom,
    non_sealed_row_count: rows.length,
    sealed_row_count: sealedCount,
    unique_numerators: uniqueNums.size,
    min_numerator: minNum,
    max_numerator: maxNum,
    rows_at_or_below_base: rowsBelowBase.length + rowsAtBase.length,
    rows_above_base: secretsAboveBase.length,
    unique_numerators_above_base: numeratorsWithoutBase,
    reaches_base: uniqueNums.has(cand.base) || rowsAtBase.length > 0,
    has_secrets_above_base: secretsAboveBase.length > 0,
    sample_early_row: sampleEarly ? { card_number: sampleEarly.card_number, display: sampleEarly.card_number_display, name: sampleEarly.card_name } : null,
    sample_at_base_row: sampleAtBase ? { card_number: sampleAtBase.card_number, display: sampleAtBase.card_number_display, name: sampleAtBase.card_name } : null,
    sample_secret_row: sampleSecret ? { card_number: sampleSecret.card_number, display: sampleSecret.card_number_display, name: sampleSecret.card_name } : null,
    hold_reasons: holdReasons,
    classification,
  })
}

await mkdir('reports', { recursive: true })
await writeFile('reports/jp-tier-a-verification.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  candidate_count: CANDIDATES.length,
  totals: results.reduce((s, r) => ({ ...s, [r.classification]: (s[r.classification] ?? 0) + 1 }), {}),
  results,
}, null, 2), 'utf8')

// Compact table for console
console.log('=== Tier A verification ===')
console.log('set_name'.padEnd(45) + 'stored ref base_rows above unique_above cls'.padStart(60))
for (const r of results) {
  console.log(
    r.set_name.padEnd(45) +
    String(r.stored_denominator).padStart(5) + ' ' +
    String(r.reference_base).padStart(3) + ' ' +
    String(r.rows_at_or_below_base).padStart(4) + ' ' +
    String(r.rows_above_base).padStart(4) + ' ' +
    String(r.unique_numerators_above_base).padStart(4) + '     ' +
    r.classification
  )
}
console.log('')
const totals = results.reduce((s, r) => ({ ...s, [r.classification]: (s[r.classification] ?? 0) + 1 }), {})
console.log('Totals:', totals)
