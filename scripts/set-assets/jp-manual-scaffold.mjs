#!/usr/bin/env node
// scripts/set-assets/jp-manual-scaffold.mjs
//
// Block 5A-W-50H — deterministically scaffolds the local staging
// structure for manually-sourced Japanese set logos + symbols.
//
// Read-only against the database. No image bytes touched. No
// Supabase Storage writes. No live UI change. Safe to re-run —
// human-entered index fields survive regeneration.
//
// Usage:
//   npm run scaffold:jp-manual-assets
//   node scripts/set-assets/jp-manual-scaffold.mjs
//   node scripts/set-assets/jp-manual-scaffold.mjs --root manual-assets/jp

import { readFileSync, existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

import { assetKeyForJpSet, detectKeyCollisions, stripJapanesePrefix } from '../../src/lib/set-assets/assetKey.ts'

// ── env ─────────────────────────────────────────────────
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
}
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (checked .env.local + process.env)')
  process.exit(1)
}

const argv = process.argv.slice(2)
const arg = (name, def) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : def }
const ROOT = arg('--root', 'manual-assets/jp')

const INDEX_JSON = join(ROOT, 'asset-index.json')
const INDEX_CSV  = join(ROOT, 'asset-index.csv')
const INBOX      = join(ROOT, 'inbox')

// ── 1. Authoritative catalogue: 127 JP sets from set_metadata ──
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const { data: meta, error: metaErr } = await supabase
  .from('set_metadata')
  .select('set_name, language')
  .eq('language', 'jp')
if (metaErr) throw metaErr

// enrich with card_count + release_date from get_set_list_v2
// (metadata-only sets like "Japanese Old Maid" fall back to zero /
// null — expected).
const { data: rpc, error: rpcErr } = await supabase.rpc('get_set_list_v2')
if (rpcErr) throw rpcErr
const rpcByName = new Map((rpc ?? []).map(r => [r.set_name, r]))

const jpSets = (meta ?? []).map(m => {
  const r = rpcByName.get(m.set_name) ?? {}
  const set_name = m.set_name
  return {
    set_name,                                 // database identifier (PK)
    visible_name: stripJapanesePrefix(set_name),
    language: 'jp',
    set_release_date: r.set_release_date ?? null,
    card_count: r.card_count ?? 0,
    has_imported_cards: (r.card_count ?? 0) > 0,
  }
})

// ── 2. Assertions the block calls out ──
if (jpSets.length !== 127) {
  console.error(`scaffold failed: expected 127 JP sets in set_metadata, found ${jpSets.length}`)
  process.exit(1)
}
if (!jpSets.some(s => s.set_name === 'Japanese Old Maid')) {
  console.error('scaffold failed: "Japanese Old Maid" is missing from set_metadata')
  process.exit(1)
}

// ── 3. Asset keys + collision guard ──
const collisions = detectKeyCollisions(jpSets.map(s => s.set_name))
if (collisions.length > 0) {
  console.error('scaffold failed: asset key collisions:')
  for (const c of collisions) console.error(`  key="${c.key}" → ${JSON.stringify(c.setNames)}`)
  process.exit(1)
}

const withKeys = jpSets.map(s => ({ ...s, asset_key: assetKeyForJpSet(s.set_name) }))

// ── 4. Deterministic sort: by asset_key ASC ──
withKeys.sort((a, b) => a.asset_key.localeCompare(b.asset_key))

// ── 5. Merge with existing human-entered fields ──
const HUMAN_FIELDS = ['logo_source_url','symbol_source_url','notes','approved','logo_content_hash','symbol_content_hash']
let existing = null
if (existsSync(INDEX_JSON)) {
  try { existing = JSON.parse(readFileSync(INDEX_JSON, 'utf8')) }
  catch (e) { console.warn(`could not parse existing ${INDEX_JSON}: ${e.message} — regenerating cleanly`) }
}
const existingByKey = new Map()
const existingBySetName = new Map()
for (const e of existing?.entries ?? []) {
  if (e.asset_key) existingByKey.set(e.asset_key, e)
  if (e.set_name)  existingBySetName.set(e.set_name, e)
}

const entries = withKeys.map(s => {
  const prior = existingByKey.get(s.asset_key) ?? existingBySetName.get(s.set_name) ?? {}
  const merged = {
    set_name:            s.set_name,
    visible_name:        s.visible_name,
    language:            s.language,
    asset_key:           s.asset_key,
    relative_folder:     `inbox/${s.asset_key}`,
    expected_logo:       'logo',
    expected_symbol:     'symbol',
    has_imported_cards:  s.has_imported_cards,
    set_release_date:    s.set_release_date,
    card_count:          s.card_count,
    // Human-entered fields (merged from existing where present).
    logo_source_url:     prior.logo_source_url    ?? '',
    symbol_source_url:   prior.symbol_source_url  ?? '',
    notes:               prior.notes              ?? '',
    approved:            prior.approved === true ? true : false,
    logo_content_hash:   prior.logo_content_hash   ?? null,
    symbol_content_hash: prior.symbol_content_hash ?? null,
  }
  return merged
})

// ── 6. Write outputs ──
await mkdir(ROOT, { recursive: true })
await mkdir(INBOX, { recursive: true })

const now = new Date().toISOString()
const json = {
  generated_at: now,
  source:       'set_metadata WHERE language=\'jp\'',
  count:        entries.length,
  sort:         'asset_key ASC',
  entries,
}
await writeFile(INDEX_JSON, JSON.stringify(json, null, 2), 'utf8')

// CSV — same field set as JSON, deterministic column order.
const CSV_COLS = [
  'set_name','visible_name','language','asset_key','relative_folder',
  'expected_logo','expected_symbol','has_imported_cards','set_release_date','card_count',
  'logo_source_url','symbol_source_url','notes','approved',
  'logo_content_hash','symbol_content_hash',
]
function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
const csvLines = [CSV_COLS.join(',')]
for (const e of entries) csvLines.push(CSV_COLS.map(c => csvCell(e[c])).join(','))
await writeFile(INDEX_CSV, csvLines.join('\n') + '\n', 'utf8')

// ── 7. Per-set inbox folders (idempotent) ──
let created = 0
for (const e of entries) {
  const dir = join(INBOX, e.asset_key)
  if (!existsSync(dir)) { await mkdir(dir, { recursive: true }); created += 1 }
}

console.log(`[jp-manual-scaffold] entries: ${entries.length}`)
console.log(`[jp-manual-scaffold] wrote:  ${INDEX_JSON}`)
console.log(`[jp-manual-scaffold] wrote:  ${INDEX_CSV}`)
console.log(`[jp-manual-scaffold] inbox:  ${INBOX} (created ${created} new folder${created === 1 ? '' : 's'})`)
console.log(`[jp-manual-scaffold] human-entered fields preserved by asset_key+set_name`)
