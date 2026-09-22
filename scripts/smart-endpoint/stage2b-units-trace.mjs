#!/usr/bin/env node
// scripts/smart-endpoint/stage2b-units-trace.mjs
//
// Trace: what UNITS does every monetary field in the smart-endpoint
// data path actually use? The AFTER eval surfaced "raw 40127" and
// "$67 = 67 cents" answers, which point at a units-mixing bug in
// the raw_results fallback path of dbSearchCards.
//
// This probe pulls REAL data from every source dbSearchCards can
// return and prints:
//   * search_cards_json  — raw RPC output shape + units
//   * cards row + card_trends + card_volume — the enrichment path
//   * enrichCards emitted object shape (mimics the edge function)
//   * The fallback string that gets sent to the model when
//     cards.in() and the fuzzy fallback both miss
//
// Never mutates state.

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

const CASES = [
  'Charizard Base Set',                  // V-trend-accuracy probe
  'Umbreon VMAX Evolving Skies',         // H-historical probe
  'Umbreon VMAX alt art Evolving Skies', // the specific alt-art phrasing
]

for (const term of CASES) {
  console.log('\n════════════════════════════════════════════════════')
  console.log('  QUERY:', term)
  console.log('════════════════════════════════════════════════════')

  // 1. search_cards_json — raw RPC output
  const { data: rpc, error } = await sb.rpc('search_cards_json', { search_text: term })
  if (error) { console.log('  RPC ERR:', error.message); continue }
  const raw = typeof rpc?.results === 'string' ? rpc.results : JSON.stringify(rpc?.results)
  console.log('\n[1] search_cards_json raw response type:', typeof rpc?.results)
  console.log('    raw length:', raw?.length, 'chars')
  console.log('    first 800 chars:')
  console.log('    ' + (raw?.slice(0, 800) || '(empty)'))
  console.log('    delimiter " --- " count:', (raw?.match(/ --- /g) || []).length)

  // Split into lines exactly as dbSearchCards does
  const lines = (raw || '')
    .split(' --- ')
    .filter(l => l && !/1999 Topps|2000 Topps|Topps TV|Topps Chrome|Topps Movie/.test(l))
  console.log('    line count (after Topps filter):', lines.length)
  if (lines[0]) {
    console.log('    first line pipe-split:')
    const parts = lines[0].split(' | ')
    parts.forEach((p, i) => console.log(`      [${i}] "${p.trim()}"`))
  }

  // 2. Parse card+set pair as dbSearchCards does
  const parsedCards = lines
    .slice(0, 8)
    .map(line => {
      const parts = line.split(' | ')
      return { cardName: parts[0]?.trim(), setName: parts[1]?.trim() }
    })
    .filter(p => p.cardName && p.setName)
  const setNames = [...new Set(parsedCards.map(p => p.setName))]
  const cardNames = [...new Set(parsedCards.map(p => p.cardName))]
  console.log('\n[2] parsed pairs -> setNames:', setNames.length, ' cardNames:', cardNames.length)

  // 3. cards.in() using exact set_name + card_name
  const { data: cardRows } = await sb.from('cards')
    .select('id, card_slug, card_name, set_name, card_url_slug, card_number, card_number_display, language, variant, image_url')
    .in('set_name', setNames)
    .in('card_name', cardNames)
    .limit(20)
  console.log('[3] cards.in() matched rows:', cardRows?.length || 0)
  if (!cardRows?.length && parsedCards.length) {
    // Fallback: ilike on baseName
    const baseName = parsedCards[0].cardName.split('[')[0].split('#')[0].trim()
    console.log('    (falling back to ilike on baseName=' + baseName + ')')
    const { data: fallbackRows } = await sb.from('cards')
      .select('id, card_slug, card_name, set_name, card_url_slug, card_number, card_number_display, language, variant, image_url')
      .in('set_name', setNames)
      .ilike('card_name', `%${baseName}%`)
      .limit(20)
    console.log('    fallback rows:', fallbackRows?.length || 0)
    if (!fallbackRows?.length) {
      console.log('    *** dbSearchCards would return raw_results here (THE BUG PATH) ***')
      console.log('    raw_results content (what the model sees):')
      console.log('    ' + lines.join(' --- ').slice(0, 800))
    }
  }

  // 4. If cardRows populated, show card_trends units
  const slugs = (cardRows || []).map(c => String(c.card_slug))
  if (slugs.length) {
    const { data: trends } = await sb.from('card_trends')
      .select('card_slug, card_name, set_name, current_raw, current_psa10, current_psa9, raw_pct_30d, raw_pct_90d')
      .in('card_slug', slugs.map(s => s.replace(/^pc-/, '')))
    console.log('\n[4] card_trends rows for these slugs:', trends?.length || 0)
    if (trends?.[0]) {
      console.log('    sample row (raw integers = cents per CLAUDE.md):')
      console.log('    ', JSON.stringify(trends[0], null, 2).split('\n').map(l => '      ' + l).join('\n'))
    }
  }
}

// Additional probe: raw RPC output for a card known to trigger the bug
console.log('\n════════════════════════════════════════════════════')
console.log('  EXTRA: what does search_cards_json ACTUALLY return')
console.log('  for "Umbreon VMAX alt art Evolving Skies" line-by-line')
console.log('════════════════════════════════════════════════════')
const { data: extra } = await sb.rpc('search_cards_json', { search_text: 'Umbreon VMAX alt art Evolving Skies' })
const rawX = typeof extra?.results === 'string' ? extra.results : JSON.stringify(extra?.results)
const linesX = (rawX || '').split(' --- ').slice(0, 5)
linesX.forEach((l, i) => {
  console.log(`\n  line[${i}]:`)
  console.log('    ' + l)
})
