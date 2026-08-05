// scripts/backfill-japanese-pokemon-slug.mjs
//
// Block 5A-W-53A — one-off backfill of `cards.primary_pokemon_slug`
// + `card_pokemon` rows for Japanese (language='jp') non-sealed
// cards. Ports the deterministic regex extraction from
// `backfill_card_pokemon.py` in the sister scraper repo so the
// results match the English matching exactly. The block's rule
// "Do not overwrite correct English mappings" is enforced by
// filtering the entire pipeline to language='jp' — English rows
// are never read or written.
//
// Usage:
//   node scripts/backfill-japanese-pokemon-slug.mjs [--dry-run] [--audit]
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (both read from
// .env.local). Idempotent.

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const argv = new Set(process.argv.slice(2))
const DRY_RUN = argv.has('--dry-run')
const AUDIT_ONLY = argv.has('--audit')

if (existsSync('.env.local')) {
  for (const l of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !(m[1] in process.env)) {
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ── Normalisation + matching (mirror of backfill_card_pokemon.py) ──

const TRAILING_NUM_RE = /\s*#\S+\s*$/
const APOS_RE = /['’ʼ]+/g
const PUNCT_TO_SPACE_RE = /[.,:;!?()\[\]/\\]+/g

function normalizeForMatch(cardName) {
  if (!cardName) return ''
  let text = cardName.replace(TRAILING_NUM_RE, '')
  text = text.toLowerCase()
  text = text.replace(/♀/g, ' f').replace(/♂/g, ' m')
  text = text.replace(APOS_RE, '')
  text = text.replace(PUNCT_TO_SPACE_RE, ' ')
  // Drop stray non-[a-z0-9-\s] to space
  text = text.replace(/[^a-z0-9\s-]/g, ' ')
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function speciesPattern(speciesSlug) {
  const parts = speciesSlug.split('-').map(escapeRegex)
  const body = parts.join('[-\\s]+')
  return new RegExp(`\\b${body}\\b`, 'i')
}

// ── DB helpers ──

async function fetchAll(table, select, filters = {}) {
  const pageSize = 1000
  let offset = 0
  const rows = []
  for (;;) {
    let q = supabase.from(table).select(select)
    for (const [k, v] of Object.entries(filters)) q = q[v.op](k, v.val)
    const { data, error } = await q.range(offset, offset + pageSize - 1)
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return rows
}

async function main() {
  const t0 = Date.now()
  console.log(`Backfill target: Japanese (language='jp') non-sealed cards.`)
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : AUDIT_ONLY ? 'AUDIT' : 'WRITE'}`)

  console.log('Loading pokemon_species...')
  const species = await fetchAll('pokemon_species', 'id,name', {})
  console.log(`  ${species.length} species`)

  console.log('Loading Japanese non-sealed cards...')
  const cards = await fetchAll('cards', 'card_slug,card_name,primary_pokemon_slug', {
    language: { op: 'eq', val: 'jp' },
    is_sealed: { op: 'eq', val: false },
  })
  console.log(`  ${cards.length} cards`)

  const patterns = species.map(s => ({ slug: s.name, re: speciesPattern(s.name) }))

  // ── Match phase ──
  const joinRows = []          // card_pokemon inserts
  const primaryGroups = {}     // { species_slug: [card_slug, ...] }
  const alreadyAssigned = cards.filter(c => c.primary_pokemon_slug).length
  const unmatchedNames = new Map()
  let matched = 0
  let multi = 0

  for (const c of cards) {
    const norm = normalizeForMatch(c.card_name)
    if (!norm) {
      unmatchedNames.set(c.card_name, (unmatchedNames.get(c.card_name) ?? 0) + 1)
      continue
    }
    const matches = []
    for (const { slug, re } of patterns) {
      const m = re.exec(norm)
      if (m) matches.push({ slug, pos: m.index })
    }
    if (!matches.length) {
      unmatchedNames.set(c.card_name, (unmatchedNames.get(c.card_name) ?? 0) + 1)
      continue
    }
    matches.sort((a, b) => a.pos - b.pos)
    const primary = matches[0].slug
    if (!primaryGroups[primary]) primaryGroups[primary] = []
    primaryGroups[primary].push(c.card_slug)
    matched += 1
    if (matches.length > 1) multi += 1
    for (let i = 0; i < matches.length; i++) {
      joinRows.push({
        card_slug: c.card_slug,
        species_slug: matches[i].slug,
        is_primary: i === 0,
      })
    }
  }

  console.log(`\n${'='.repeat(60)}\nMATCH SUMMARY\n${'='.repeat(60)}`)
  console.log(`Total Japanese non-sealed cards:        ${cards.length}`)
  console.log(`Already carried primary_pokemon_slug:   ${alreadyAssigned}`)
  console.log(`Matched to >=1 species:                 ${matched} (${(100 * matched / Math.max(1, cards.length)).toFixed(1)}%)`)
  console.log(`Multi-Pokemon cards:                    ${multi}`)
  console.log(`Unmatched (Trainer / Energy / etc):     ${cards.length - matched}`)
  console.log(`card_pokemon rows to write:             ${joinRows.length}`)
  console.log(`Distinct primary species landed on:     ${Object.keys(primaryGroups).length}`)

  const topUnmatched = [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  console.log(`\nTop 20 unmatched Japanese card names (Trainer/Energy/promo audit):`)
  for (const [name, count] of topUnmatched) console.log(`  ${String(count).padStart(4)}  ${name}`)

  if (AUDIT_ONLY || DRY_RUN) {
    console.log(`\n${AUDIT_ONLY ? 'AUDIT' : 'DRY-RUN'} complete, no writes made. Elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s.`)
    return
  }

  // ── Write phase ──
  //
  // Insert card_pokemon rows in bulk with upsert semantics on the
  // (card_slug, species_slug) PK. English rows are already present
  // and untouched — this only writes JP card_slugs.
  console.log(`\nUpserting ${joinRows.length} card_pokemon rows (chunked)...`)
  const CHUNK = 500
  let cpUpserted = 0
  for (let i = 0; i < joinRows.length; i += CHUNK) {
    const batch = joinRows.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('card_pokemon')
      .upsert(batch, { onConflict: 'card_slug,species_slug' })
    if (error) {
      console.error(`  ! upsert batch ${i}: ${error.message}`)
    } else {
      cpUpserted += batch.length
    }
    if (i % 5000 === 0 && i > 0) console.log(`  ...upserted ${cpUpserted}/${joinRows.length}`)
  }
  console.log(`  ${cpUpserted} card_pokemon rows upserted`)

  // Patch cards.primary_pokemon_slug by species group. Only Japanese
  // card_slugs are touched — the language='jp' filter on the SELECT
  // already scoped the input set.
  console.log(`\nPatching cards.primary_pokemon_slug across ${Object.keys(primaryGroups).length} species...`)
  let patched = 0
  const CHUNK_PATCH = 200
  for (const [speciesSlug, slugs] of Object.entries(primaryGroups)) {
    for (let i = 0; i < slugs.length; i += CHUNK_PATCH) {
      const batch = slugs.slice(i, i + CHUNK_PATCH)
      const { error } = await supabase
        .from('cards')
        .update({ primary_pokemon_slug: speciesSlug })
        .in('card_slug', batch)
        .eq('language', 'jp')     // safety belt — never touch English
      if (error) {
        console.error(`  ! patch ${speciesSlug} batch ${i}: ${error.message}`)
      } else {
        patched += batch.length
      }
    }
  }
  console.log(`  ${patched} Japanese cards patched with primary_pokemon_slug`)

  // Refresh species aggregates so the pokemon_species.total_cards
  // and related fields include the newly-linked Japanese rows.
  console.log(`\nRefreshing pokemon_species aggregates via recompute_pokemon_species_stats()...`)
  const { data: rpcData, error: rpcErr } = await supabase.rpc('recompute_pokemon_species_stats')
  if (rpcErr) console.error(`  ! rpc failed: ${rpcErr.message}`)
  else console.log(`  refresh ok`, rpcData ?? '')

  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)}s.`)
}

main().catch(e => { console.error(e); process.exit(1) })
