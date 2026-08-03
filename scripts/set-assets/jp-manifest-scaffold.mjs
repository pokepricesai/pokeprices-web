#!/usr/bin/env node
// scripts/set-assets/jp-manifest-scaffold.mjs
//
// Block 5A-W-50G — generates a blank manifest with one entry per
// Japanese set in production. You then hand-fill logo_source_url +
// symbol_source_url (from Bulbapedia / pokemon-card.com) per row.
//
// Loads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local.
//
// Usage:
//   npx tsx scripts/set-assets/jp-manifest-scaffold.mjs
//   npx tsx scripts/set-assets/jp-manifest-scaffold.mjs --out reports/jp-manifest.json
//
// Output shape (per entry — matches jp-import.mjs expectations):
//   {
//     "set_name":          "Japanese Battle Partners",   <- KEEP
//     "visible_name":      "Battle Partners",             <- reference only
//     "stable_set_key":    "battle-partners",             <- KEEP
//     "release_date":      "2025-01-24",                  <- reference
//     "card_count":        120,                           <- reference
//     "logo_source_url":   "",                            <- FILL IN
//     "symbol_source_url": "",                            <- FILL IN (may stay empty)
//     "logo_source":       "bulbapedia",                  <- edit to actual source
//     "logo_source_id":    "",                            <- optional (e.g. wiki page)
//     "logo_confidence":   "confirmed",                   <- your call after review
//     "review_status":     "pending",                     <- flip to "confirmed" when ready
//     "notes":             ""
//   }

import { readFileSync, existsSync } from 'node:fs'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Load .env.local
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val
  }
}

const argv = process.argv.slice(2)
const outFlag = argv.indexOf('--out')
const outPath = outFlag !== -1 ? argv[outFlag + 1] : 'reports/jp-manifest.json'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (checked .env.local and process.env)')
  process.exit(1)
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[’‘`ʼ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled'
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// FIX (Block 5A-W-50G-B) — source directly from set_metadata, not
// from get_set_list_v2. The RPC only projects sets that have cards
// imported, so any JP set metadata row without imported cards (e.g.
// "Japanese Old Maid") is silently omitted. set_metadata is the
// authoritative language='jp' catalogue.
const { data: meta, error: metaErr } = await supabase
  .from('set_metadata')
  .select('set_name, language')
  .eq('language', 'jp')
if (metaErr) throw metaErr

// Enrich with card_count from get_set_list_v2 where available (best-
// effort reference metadata; missing when the set has no cards yet).
const { data: rpc, error: rpcErr } = await supabase.rpc('get_set_list_v2')
if (rpcErr) throw rpcErr
const rpcByName = new Map((rpc ?? []).map(r => [r.set_name, r]))

const jp = (meta ?? [])
  .map(m => ({
    set_name:         m.set_name,
    set_release_date: rpcByName.get(m.set_name)?.set_release_date ?? null,
    card_count:       rpcByName.get(m.set_name)?.card_count ?? null,
    language:         'jp',
  }))
  .sort((a, b) => (b.set_release_date || '').localeCompare(a.set_release_date || ''))  // newest first

const manifest = jp.map(s => {
  const visible = (s.set_name || '').replace(/^Japanese\s+/, '')
  return {
    set_name:          s.set_name,
    visible_name:      visible,
    stable_set_key:    slugify(visible),
    release_date:      s.set_release_date ?? null,
    card_count:        s.card_count ?? null,
    logo_source_url:   '',
    symbol_source_url: '',
    logo_source:       'bulbapedia',
    logo_source_id:    '',
    logo_confidence:   'confirmed',
    review_status:     'pending',
    notes:             '',
  }
})

await mkdir(dirname(outPath), { recursive: true })
await writeFile(outPath, JSON.stringify(manifest, null, 2), 'utf8')
console.log(`[jp-manifest-scaffold] wrote ${manifest.length} entries → ${outPath}`)
console.log(`[jp-manifest-scaffold] first 3 stable_set_keys: ${manifest.slice(0,3).map(e => e.stable_set_key).join(', ')}`)
