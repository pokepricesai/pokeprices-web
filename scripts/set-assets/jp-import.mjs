#!/usr/bin/env node
// scripts/set-assets/jp-import.mjs
//
// Block 5A-W-50G — asset import scaffolding. Dry-run by default. NO
// production writes without explicit flags.
//
// Reads a review-approved manifest (produced from the HTML report by
// hand or by a future review-tool block) and, for each entry:
//   1. downloads the logo + symbol from the recorded source URL;
//   2. validates HTTP 200 and image MIME;
//   3. computes SHA-256 content hash (dedup check);
//   4. uploads to Supabase Storage under set-assets/jp/{key}/...;
//   5. updates set_metadata with the new URL + provenance columns.
//
// Manifest shape (JSON array):
//   [
//     {
//       "set_name":         "Japanese Battle Partners",   // primary key
//       "stable_set_key":   "battle-partners",            // storage path segment
//       "logo_source_url":  "https://assets.tcgdex.net/.../logo.webp",
//       "symbol_source_url":"https://assets.tcgdex.net/.../symbol.webp",
//       "logo_source":      "tcgdex",                     // enum
//       "logo_source_id":   "sv08a",
//       "logo_confidence":  "confirmed",
//       "review_status":    "confirmed",                  // set by human review
//       "notes":            "..."
//     },
//     ...
//   ]
//
// Usage:
//   node scripts/set-assets/jp-import.mjs                                          # dry run
//   node scripts/set-assets/jp-import.mjs --manifest reports/jp-approved.json      # dry run against manifest
//   node scripts/set-assets/jp-import.mjs --manifest ... --single-set "Japanese Battle Partners"
//   node scripts/set-assets/jp-import.mjs --manifest ... --confirmed-only          # skip probable/ambiguous
//   node scripts/set-assets/jp-import.mjs --manifest ... --write                   # ACTUAL production writes
//
// A rollback manifest is written to reports/jp-import-rollback.json before
// any write occurs, capturing every previous set_metadata value that
// this run would overwrite.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const argv = process.argv.slice(2)
const arg = (name, def = null) => {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : def
}
const has = (name) => argv.includes(name)

const MANIFEST_PATH    = arg('--manifest', 'reports/jp-approved.json')
const SINGLE_SET       = arg('--single-set', null)
const CONFIRMED_ONLY   = has('--confirmed-only')
const WRITE            = has('--write')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
if (WRITE && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('set SUPABASE_URL and SUPABASE_SERVICE_KEY when using --write')
  process.exit(1)
}

const BUCKET = 'set-assets'

// ── Load + filter manifest ───────────────────────────
let manifest = []
try { manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) }
catch (e) { console.error(`could not read manifest ${MANIFEST_PATH}: ${e.message}`); process.exit(1) }

let filtered = manifest
if (SINGLE_SET)     filtered = filtered.filter(m => m.set_name === SINGLE_SET)
if (CONFIRMED_ONLY) filtered = filtered.filter(m => m.review_status === 'confirmed')

console.log(`[jp-import] ${WRITE ? 'WRITE' : 'DRY-RUN'} — ${filtered.length} of ${manifest.length} entries selected`)
if (!WRITE) console.log('[jp-import] no writes will occur without --write')

// ── Fetch previous values (for rollback) ────────────
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null
const rollback = []

for (const entry of filtered) {
  const previous = supabase
    ? (await supabase
        .from('set_metadata')
        .select('set_name, logo_url, symbol_url, logo_source, symbol_source, logo_source_id, logo_confidence, logo_review_status, logo_retrieved_at')
        .eq('set_name', entry.set_name)
        .maybeSingle()).data
    : null
  rollback.push({ set_name: entry.set_name, previous })
}

await mkdir('reports', { recursive: true })
await writeFile('reports/jp-import-rollback.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  entries:      rollback,
}, null, 2), 'utf8')
console.log(`[jp-import] rollback manifest → reports/jp-import-rollback.json`)

// ── Per-entry download + validate ────────────────────
async function downloadAndValidate(url, label) {
  const r = await fetch(url, { headers: { 'User-Agent': 'pokeprices-web/set-assets-import' } })
  if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}`)
  const mime = r.headers.get('content-type') || ''
  if (!/^image\/(webp|png|jpeg|svg\+xml)/.test(mime)) {
    throw new Error(`${label} MIME rejected: ${mime}`)
  }
  const buf = new Uint8Array(await r.arrayBuffer())
  const hash = createHash('sha256').update(buf).digest('hex')
  return { buf, mime, hash, contentLength: buf.length }
}

const summary = { attempted: 0, uploaded: 0, updated: 0, failed: 0, skipped: 0 }

for (const entry of filtered) {
  console.log(`\n[jp-import] ${entry.set_name}  (${entry.stable_set_key})`)
  summary.attempted += 1
  try {
    const assets = {}
    if (entry.logo_source_url) {
      const { buf, mime, hash, contentLength } = await downloadAndValidate(entry.logo_source_url, 'logo')
      const ext = mime.includes('webp') ? 'webp' : mime.includes('png') ? 'png' : mime.includes('svg') ? 'svg' : 'jpg'
      const key = `jp/${entry.stable_set_key}/logo.${ext}`
      assets.logo = { buf, mime, hash, contentLength, key }
      console.log(`  logo   ${contentLength}B ${mime} sha256=${hash.slice(0,12)}… → ${BUCKET}/${key}`)
    }
    if (entry.symbol_source_url) {
      const { buf, mime, hash, contentLength } = await downloadAndValidate(entry.symbol_source_url, 'symbol')
      const ext = mime.includes('webp') ? 'webp' : mime.includes('png') ? 'png' : mime.includes('svg') ? 'svg' : 'jpg'
      const key = `jp/${entry.stable_set_key}/symbol.${ext}`
      assets.symbol = { buf, mime, hash, contentLength, key }
      console.log(`  symbol ${contentLength}B ${mime} sha256=${hash.slice(0,12)}… → ${BUCKET}/${key}`)
    }

    if (!WRITE) { summary.skipped += 1; continue }

    // Upload to Supabase Storage
    for (const asset of Object.values(assets)) {
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(asset.key, asset.buf, {
        contentType: asset.mime, upsert: true, cacheControl: '31536000',
      })
      if (upErr) throw upErr
    }
    summary.uploaded += 1

    // Update set_metadata (upsert on set_name)
    const publicUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
    const patch = {
      set_name: entry.set_name,
      logo_url:            assets.logo   ? publicUrl(assets.logo.key)   : null,
      symbol_url:          assets.symbol ? publicUrl(assets.symbol.key) : null,
      logo_source:         entry.logo_source ?? null,
      symbol_source:       entry.symbol_source ?? entry.logo_source ?? null,
      logo_source_id:      entry.logo_source_id ?? null,
      logo_confidence:     entry.logo_confidence ?? 'confirmed',
      logo_review_status:  entry.review_status ?? 'confirmed',
      logo_retrieved_at:   new Date().toISOString(),
    }
    const { error: metaErr } = await supabase.from('set_metadata').upsert(patch, { onConflict: 'set_name' })
    if (metaErr) throw metaErr
    summary.updated += 1
    console.log(`  set_metadata updated`)
  } catch (e) {
    summary.failed += 1
    console.error(`  FAILED: ${e.message}`)
  }
}

console.log(`\n[jp-import] summary: attempted=${summary.attempted} uploaded=${summary.uploaded} updated=${summary.updated} skipped=${summary.skipped} failed=${summary.failed}`)
if (!WRITE) console.log('[jp-import] DRY-RUN complete — pass --write for actual uploads')
