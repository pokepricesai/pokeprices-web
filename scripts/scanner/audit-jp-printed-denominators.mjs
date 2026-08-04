#!/usr/bin/env node
// scripts/scanner/audit-jp-printed-denominators.mjs
//
// Block 5A-W-51C — read-only per-set audit of Japanese printed
// denominators. Uses the same reference file as 51B
// (scripts/scanner/data/jp-printed-denominators.reference.json) but
// produces the JSON / CSV / Markdown triple the block spec requires
// and adds per-set imported-row + sample display fields.
//
// Reuses the English model: `cards.set_printed_total` IS the printed
// denominator (already verified against English secret-rare sets like
// Scarlet & Violet 151 → set_printed_total=165 with numerators up to
// 207). No new column is required. This audit checks whether each
// Japanese set's stored `cards.set_printed_total` matches the
// authoritative printed base for that set.
//
// NO writes.

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

const REFERENCE_PATH = 'scripts/scanner/data/jp-printed-denominators.reference.json'
const REFERENCE = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8'))
const REF_ENTRIES = REFERENCE.entries ?? {}
const REF_DEFAULT_SOURCE = REFERENCE.source_default ?? { name: 'unknown', url: null }

// ── Load DB catalogue ───────────────────────────────────
const { data: meta } = await supabase
  .from('set_metadata').select('set_name, total_cards, release_year').eq('language', 'jp')

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

// ── Analyse each set ────────────────────────────────────
const results = []
for (const m of meta) {
  const setName = m.set_name
  const rows = cardsBySet.get(setName)?.rows ?? []
  const nums = rows.filter(r => r.card_number).map(r => parseInt(r.card_number, 10)).filter(n => !isNaN(n))
  const uniqueCount = new Set(nums).size
  const rowCount = rows.length
  const denoms = [...new Set(rows.map(r => r.card_number_display?.split('/')[1]).filter(Boolean))]
  const totals = [...new Set(rows.map(r => r.set_printed_total).filter(Boolean))]
  const storedPrinted = totals.length === 1 ? parseInt(totals[0], 10) : null
  const maxNum = nums.length ? Math.max(...nums) : null

  // Sample display strings (first + last + one secret if present)
  const sampleFirst = rows.find(r => r.card_number_display && r.card_number === String(Math.min(...nums)))
  const sampleLast  = rows.find(r => r.card_number_display && r.card_number === String(maxNum))

  const ref = REF_ENTRIES[setName] ?? null
  const referenceDenom = ref?.printed_denominator ?? null
  const referenceSource = ref?.source ?? null

  let status, notes = ''
  const affectedCount = referenceDenom != null && storedPrinted != null && storedPrinted !== referenceDenom
    ? rows.filter(r => r.card_number != null).length
    : 0

  if (rowCount === 0) {
    status = 'REFERENCE_NOT_AVAILABLE'
    notes = 'No imported cards.'
  } else if (referenceDenom == null) {
    status = 'REFERENCE_NOT_AVAILABLE'
    notes = 'No authoritative printed denominator on file. Add per-set entry to scripts/scanner/data/jp-printed-denominators.reference.json.'
  } else if (denoms.length > 1 || totals.length > 1) {
    status = 'AMBIGUOUS_MAPPING'
    notes = `Multiple stored denominators (display: ${denoms.join(',')}; printed_total: ${totals.join(',')}). Cannot classify a single set-wide value.`
  } else if (storedPrinted == null) {
    status = 'AMBIGUOUS_MAPPING'
    notes = 'set_printed_total could not be parsed.'
  } else if (storedPrinted === referenceDenom) {
    status = 'CONFIRMED_MATCH'
  } else {
    status = 'CONFIRMED_MISMATCH'
    notes = `Stored /${storedPrinted} but authoritative printed base is /${referenceDenom}. Would rewrite ${affectedCount} card rows.`
  }

  results.push({
    set_name: setName,
    visible_name: setName.replace(/^Japanese\s+/, ''),
    release_year: m.release_year,
    set_metadata_total_cards: m.total_cards ?? null,
    stored_printed_denominator: storedPrinted,
    stored_display_denominator: denoms[0] ?? null,
    reference_printed_denominator: referenceDenom,
    reference_source: referenceSource,
    reference_source_url: REF_DEFAULT_SOURCE.url,
    total_imported_card_rows: rowCount,
    affected_card_rows: affectedCount,
    unique_numerators: uniqueCount,
    max_numerator: maxNum,
    sample_current_display: sampleFirst?.card_number_display ?? null,
    sample_proposed_display: (referenceDenom != null && sampleFirst?.card_number) ? `${sampleFirst.card_number}/${referenceDenom}` : null,
    sample_current_display_max: sampleLast?.card_number_display ?? null,
    sample_proposed_display_max: (referenceDenom != null && sampleLast?.card_number) ? `${sampleLast.card_number}/${referenceDenom}` : null,
    status,
    notes,
  })
}

const CLASS_ORDER = { CONFIRMED_MISMATCH: 0, AMBIGUOUS_MAPPING: 1, REFERENCE_NOT_AVAILABLE: 2, CONFIRMED_MATCH: 3 }
results.sort((a, b) => {
  const c = CLASS_ORDER[a.status] - CLASS_ORDER[b.status]
  if (c !== 0) return c
  return (b.release_year ?? 0) - (a.release_year ?? 0)
})

const totals = { CONFIRMED_MATCH: 0, CONFIRMED_MISMATCH: 0, AMBIGUOUS_MAPPING: 0, REFERENCE_NOT_AVAILABLE: 0 }
for (const r of results) totals[r.status] += 1
const totalAffectedRows = results.reduce((s, r) => s + r.affected_card_rows, 0)

await mkdir('reports', { recursive: true })

// JSON
await writeFile('reports/jp-printed-denominator-audit.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  reference_source_default: REF_DEFAULT_SOURCE,
  reference_entry_count: Object.keys(REF_ENTRIES).length,
  set_metadata_row_count: meta.length,
  jp_card_row_total: seen,
  totals,
  total_affected_card_rows_across_mismatches: totalAffectedRows,
  results,
}, null, 2), 'utf8')

// CSV
const CSV_COLS = [
  'set_name','visible_name','release_year','set_metadata_total_cards',
  'stored_printed_denominator','reference_printed_denominator',
  'total_imported_card_rows','affected_card_rows','unique_numerators','max_numerator',
  'sample_current_display','sample_proposed_display',
  'sample_current_display_max','sample_proposed_display_max',
  'reference_source','status','notes',
]
const csvCell = (v) => v == null ? '' : (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g,'""')}"` : String(v))
const csvLines = [CSV_COLS.join(',')]
for (const r of results) csvLines.push(CSV_COLS.map(c => csvCell(r[c])).join(','))
await writeFile('reports/jp-printed-denominator-audit.csv', csvLines.join('\n') + '\n', 'utf8')

// Markdown
const md = [
  '# Japanese printed-denominator audit',
  '',
  `_Generated: ${new Date().toISOString()}_`,
  '',
  '## Method',
  '',
  '- Scope: every `set_metadata` row with `language = \'jp\'`.',
  `- Reference: **${Object.keys(REF_ENTRIES).length}** hand-verified per-set printed denominators in \`${REFERENCE_PATH}\`.`,
  `- Source: [${REF_DEFAULT_SOURCE.name}](${REF_DEFAULT_SOURCE.url}).`,
  '- **No denominator is inferred from arithmetic over imported cards.** A stored denominator is only classified against a sourced reference value.',
  '- Model: reuses the English scheme — `cards.set_printed_total` IS the printed denominator; `set_metadata.total_cards` remains the catalogue count. Confirmed by probing English Scarlet & Violet 151 (`total_cards=411, set_printed_total=165`).',
  '',
  '## Totals',
  '',
  '| Classification | Sets | Card rows in mismatched sets |',
  '|----------------|-----:|----------------------------:|',
  `| CONFIRMED_MATCH | ${totals.CONFIRMED_MATCH} | 0 |`,
  `| CONFIRMED_MISMATCH | ${totals.CONFIRMED_MISMATCH} | ${totalAffectedRows} |`,
  `| AMBIGUOUS_MAPPING | ${totals.AMBIGUOUS_MAPPING} | 0 |`,
  `| REFERENCE_NOT_AVAILABLE | ${totals.REFERENCE_NOT_AVAILABLE} | 0 |`,
  '',
  '## Confirmed mismatches (proposed corrections)',
  '',
  '| set_name | stored | reference | rows | sample current | sample proposed |',
  '|----------|-------:|----------:|-----:|----------------|-----------------|',
  ...results.filter(r => r.status === 'CONFIRMED_MISMATCH').map(r =>
    `| ${r.set_name} | /${r.stored_printed_denominator} | /${r.reference_printed_denominator} | ${r.affected_card_rows} | ${r.sample_current_display_max ?? r.sample_current_display} | ${r.sample_proposed_display_max ?? r.sample_proposed_display} |`
  ),
  '',
  '## Confirmed matches',
  '',
  '| set_name | stored + reference | source |',
  '|----------|-------------------:|--------|',
  ...results.filter(r => r.status === 'CONFIRMED_MATCH').map(r =>
    `| ${r.set_name} | /${r.stored_printed_denominator} | ${r.reference_source ?? ''} |`
  ),
  '',
  '## Ambiguous mappings',
  '',
  results.filter(r => r.status === 'AMBIGUOUS_MAPPING').length === 0
    ? '_None._'
    : ['| set_name | notes |','|----------|-------|', ...results.filter(r => r.status === 'AMBIGUOUS_MAPPING').map(r => `| ${r.set_name} | ${r.notes} |`)].join('\n'),
  '',
  '## Reference not available',
  '',
  `${totals.REFERENCE_NOT_AVAILABLE} JP sets have no authoritative per-set entry yet. They are NOT classified as suspicious. Add entries to \`${REFERENCE_PATH}\` to bring them under audit.`,
  '',
  '## Schema decision',
  '',
  'The existing English implementation ALREADY separates catalogue count from printed denominator via two distinct columns:',
  '',
  '```',
  'set_metadata.total_cards   — catalogue / row count (e.g. 411 for English SV 151)',
  'cards.set_printed_total    — printed denominator  (e.g. 165 for English SV 151)',
  'cards.card_number_display  — composed as card_number || "/" || set_printed_total',
  '```',
  '',
  'No new `set_metadata.printed_denominator` column is required. Correcting Japanese sets means writing the true printed base into `cards.set_printed_total` and regenerating `cards.card_number_display` for the affected rows. `set_metadata.total_cards` remains as-is (catalogue count).',
].join('\n')
await writeFile('reports/jp-printed-denominator-audit.md', md, 'utf8')

console.log('Wrote reports/jp-printed-denominator-audit.{json,csv,md}')
console.log('Totals:', totals)
console.log(`Card rows that would be rewritten by a correction migration: ${totalAffectedRows}`)
