#!/usr/bin/env node
// scripts/scanner/audit-jp-denominators.mjs
//
// Block 5A-W-51B (corrected) — read-only audit of Japanese set stored
// denominators vs an AUTHORITATIVE per-set reference.
//
// The pre-correction version of this script inferred a "likely
// correct" denominator of 100 based on secret-card counts. Luke
// corrected that assumption in 51B's review: modern high-class /
// enhanced Japanese sets frequently have printed base denominators
// well above 100 (e.g. Tag All Stars /173, Shiny Treasure ex /190,
// Terastal Festival /187). Inferring 100 was wrong.
//
// This version classifies each set purely against
// scripts/scanner/data/jp-printed-denominators.reference.json.
// Sets absent from the reference are labelled REFERENCE_NOT_AVAILABLE
// and NOT flagged as suspicious. No denominator is inferred from
// arithmetic over imported cards.
//
// Produces:
//   reports/jp-denominator-audit.json
//   reports/jp-denominator-audit.md
//
// NO writes. This is evidence-gathering.

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
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ── Reference data ────────────────────────────────────
const REFERENCE_PATH = 'scripts/scanner/data/jp-printed-denominators.reference.json'
if (!existsSync(REFERENCE_PATH)) {
  console.error(`ERROR: reference file missing at ${REFERENCE_PATH}`)
  process.exit(1)
}
const REFERENCE = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'))
const REF_ENTRIES = REFERENCE.entries ?? {}
const REF_DEFAULT_SOURCE = REFERENCE.source_default ?? { name: 'unknown', url: null }

// ── DB catalogue: every JP set + card rows ──────────────
const { data: meta, error: mErr } = await supabase.from('set_metadata').select('set_name, total_cards, release_year').eq('language', 'jp')
if (mErr) { console.error(mErr.message); process.exit(1) }

const cardsBySet = new Map()
let seen = 0
for (let start = 0; ; start += 1000) {
  const { data: page, error } = await supabase
    .from('cards')
    .select('set_name, card_number, card_number_display, set_printed_total')
    .eq('language', 'jp')
    .range(start, start + 999)
  if (error) { console.error(error.message); process.exit(1) }
  if (!page || page.length === 0) break
  for (const r of page) {
    const b = cardsBySet.get(r.set_name) ?? { rows: [] }
    b.rows.push(r)
    cardsBySet.set(r.set_name, b)
  }
  seen += page.length
  if (page.length < 1000) break
}

// ── Analyse each set ──────────────────────────────────
const results = []
for (const m of meta) {
  const setName = m.set_name
  const rows = cardsBySet.get(setName)?.rows ?? []

  // Observed values (facts, not inferences)
  const nums = rows.filter(r => r.card_number).map(r => parseInt(r.card_number, 10)).filter(n => !isNaN(n))
  const uniqueCount = new Set(nums).size
  const rowCount = rows.length
  const displayDenoms = [...new Set(rows.map(r => r.card_number_display?.split('/')[1]).filter(Boolean))]
  const printedTotals = [...new Set(rows.map(r => r.set_printed_total).filter(Boolean))]
  const storedDenom = displayDenoms.length === 1 ? parseInt(displayDenoms[0], 10) : null
  const maxNum = nums.length ? Math.max(...nums) : null

  // Reference lookup
  const ref = REF_ENTRIES[setName] ?? null
  const referenceDenom = ref?.printed_denominator ?? null
  const referenceSource = ref?.source ?? null

  // Classification — ONLY from the reference
  let classification, notes = ''
  if (rows.length === 0) {
    classification = 'REFERENCE_NOT_AVAILABLE'
    notes = 'No imported cards to compare against.'
  } else if (referenceDenom == null) {
    classification = 'REFERENCE_NOT_AVAILABLE'
    notes = 'No authoritative printed denominator on file for this set. Add one to scripts/scanner/data/jp-printed-denominators.reference.json before classifying.'
  } else if (displayDenoms.length > 1) {
    classification = 'AMBIGUOUS_MAPPING'
    notes = `Set contains multiple stored denominators: ${displayDenoms.join(', ')}. Cannot classify a single set-wide match.`
  } else if (storedDenom == null) {
    classification = 'AMBIGUOUS_MAPPING'
    notes = 'card_number_display denominator could not be parsed from any row.'
  } else if (storedDenom === referenceDenom) {
    classification = 'CONFIRMED_MATCH'
  } else {
    classification = 'CONFIRMED_MISMATCH'
    notes = `Stored /${storedDenom} but authoritative printed base is /${referenceDenom}.`
  }

  results.push({
    set_name: setName,
    release_year: m.release_year,
    imported_row_count: rowCount,
    imported_unique_numerators: uniqueCount,
    imported_numerator_max: maxNum,
    stored_denominator: storedDenom,
    stored_printed_total: printedTotals[0] ?? null,
    reference_printed_denominator: referenceDenom,
    reference_source: referenceSource,
    reference_source_url: REF_DEFAULT_SOURCE.url,
    classification,
    notes,
  })
}

// Sort: mismatches first (they need action), then references not available, then matches.
const CLASS_ORDER = { CONFIRMED_MISMATCH: 0, AMBIGUOUS_MAPPING: 1, REFERENCE_NOT_AVAILABLE: 2, CONFIRMED_MATCH: 3 }
results.sort((a, b) => {
  const c = CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification]
  if (c !== 0) return c
  return (b.release_year ?? 0) - (a.release_year ?? 0)
})

// ── Write reports ─────────────────────────────────────
await mkdir('reports', { recursive: true })

const totals = {
  CONFIRMED_MATCH: 0,
  CONFIRMED_MISMATCH: 0,
  AMBIGUOUS_MAPPING: 0,
  REFERENCE_NOT_AVAILABLE: 0,
}
for (const r of results) totals[r.classification] += 1

await writeFile('reports/jp-denominator-audit.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  reference_source_default: REF_DEFAULT_SOURCE,
  reference_entry_count: Object.keys(REF_ENTRIES).length,
  set_metadata_row_count: meta.length,
  jp_card_row_total: seen,
  totals,
  results,
}, null, 2), 'utf8')

const md = [
  '# Japanese denominator audit',
  '',
  `_Generated: ${new Date().toISOString()}_`,
  '',
  '## Method',
  '',
  '- Scope: every `set_metadata` row with `language = \'jp\'`.',
  `- Reference: **${Object.keys(REF_ENTRIES).length}** hand-verified per-set printed denominators in \`scripts/scanner/data/jp-printed-denominators.reference.json\`.`,
  `- Default reference source: [${REF_DEFAULT_SOURCE.name}](${REF_DEFAULT_SOURCE.url}).`,
  '- **No denominator is inferred from arithmetic over imported cards.** A stored denominator is only classified as MATCH or MISMATCH against a sourced reference value.',
  '',
  '## Totals',
  '',
  '| Classification | Count |',
  '|----------------|------:|',
  `| CONFIRMED_MATCH | ${totals.CONFIRMED_MATCH} |`,
  `| CONFIRMED_MISMATCH | ${totals.CONFIRMED_MISMATCH} |`,
  `| AMBIGUOUS_MAPPING | ${totals.AMBIGUOUS_MAPPING} |`,
  `| REFERENCE_NOT_AVAILABLE | ${totals.REFERENCE_NOT_AVAILABLE} |`,
  '',
  '## Confirmed mismatches',
  '',
  '| set_name | stored | reference | max numerator | secrets | source | notes |',
  '|----------|-------:|----------:|--------------:|--------:|--------|-------|',
  ...results.filter(r => r.classification === 'CONFIRMED_MISMATCH').map(r =>
    `| ${r.set_name} | ${r.stored_denominator ?? ''} | ${r.reference_printed_denominator ?? ''} | ${r.imported_numerator_max ?? ''} | ${(r.imported_numerator_max ?? 0) > (r.stored_denominator ?? 0) ? ((r.imported_numerator_max ?? 0) - (r.stored_denominator ?? 0)) : 0} | ${r.reference_source ?? ''} | ${r.notes ?? ''} |`
  ),
  '',
  '## Confirmed matches',
  '',
  '| set_name | stored + reference | source |',
  '|----------|-------------------:|--------|',
  ...results.filter(r => r.classification === 'CONFIRMED_MATCH').map(r =>
    `| ${r.set_name} | ${r.stored_denominator} | ${r.reference_source ?? ''} |`
  ),
  '',
  '## Ambiguous mappings',
  '',
  '| set_name | stored (raw) | notes |',
  '|----------|--------------|-------|',
  ...results.filter(r => r.classification === 'AMBIGUOUS_MAPPING').map(r =>
    `| ${r.set_name} | ${r.stored_denominator ?? ''} | ${r.notes ?? ''} |`
  ),
  '',
  '## Reference not available',
  '',
  `${totals.REFERENCE_NOT_AVAILABLE} sets do not yet have an authoritative denominator entry. These are NOT classified as suspicious — they simply haven't been verified against a source. Add per-set entries to \`scripts/scanner/data/jp-printed-denominators.reference.json\` to classify them.`,
  '',
  '<details><summary>List of REFERENCE_NOT_AVAILABLE sets (release year, stored denom, max numerator)</summary>',
  '',
  '| set_name | release_year | stored | max num |',
  '|----------|-------------:|-------:|--------:|',
  ...results.filter(r => r.classification === 'REFERENCE_NOT_AVAILABLE').map(r =>
    `| ${r.set_name} | ${r.release_year ?? ''} | ${r.stored_denominator ?? ''} | ${r.imported_numerator_max ?? ''} |`
  ),
  '',
  '</details>',
  '',
  '## Interpretation',
  '',
  'The scanner-side 51B fix (see `migrations/2026-08-04-scan-card-match-denominator-tolerance.sql`) makes the RPC tolerant of a mismatch between the scanned and stored denominator by returning candidates with a `denominator_conflict` flag rather than dropping them.',
  '',
  'A `denominator_conflict` flag ONLY means the two values differ. It does NOT prove the stored value is wrong — the OCR may have misread the denominator, or the reference may not cover this printing. Use the classifications above to decide whether the STORED value should be corrected.',
  '',
  '**Data correction for the CONFIRMED_MISMATCH sets is NOT part of this block.** A separate review-first block should:',
  '',
  '1. Cross-check each mismatch against at least a second authoritative source per set.',
  '2. Identify the import-pipeline logic that produced the wrong value.',
  '3. Prepare a dry-run correction migration.',
  '4. Return that migration for review before applying.',
].join('\n')

await writeFile('reports/jp-denominator-audit.md', md, 'utf8')

console.log('Wrote reports/jp-denominator-audit.json + .md')
console.log('Totals:', totals)
