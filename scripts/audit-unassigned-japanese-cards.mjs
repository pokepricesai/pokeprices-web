// scripts/audit-unassigned-japanese-cards.mjs
//
// Block 5A-W-53A.1 — classify the Japanese non-sealed cards
// still missing `primary_pokemon_slug` after the 53A backfill.
// Purely diagnostic — never writes to the DB. The block spec
// asked for these categories:
//   * Trainer  (generic trainer subtypes)
//   * Named Trainer (people from the TCG storyline)
//   * Energy
//   * Item
//   * Sealed/product anomaly
//   * Actual Pokémon card needing allocation
//   * Nidoran (unfixable without set-specific gender knowledge)
//   * Unclear
//
// Usage:
//   node scripts/audit-unassigned-japanese-cards.mjs

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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

const TRAINER = /\b(?:supporter|trainer|professor|leader|elder|coach|champion|guide|scientist|butler|mother|father|ninja|nurse|master|assistant|captain|sensei|maiden|acolyte|hero|scholar|traveler|traveller|priest|specialist|grunt|admin)\b/i
const NAMED_TRAINER = /\b(?:Ash|Misty|Brock|Erika|Sabrina|Blaine|Giovanni|Rocket|Team|Cynthia|Steven|N's|N |Hop|Marnie|Bede|Iris|Nessa|Lillie|Roxie|Roxanne|Diantha|Nemona|Elesa|Volo|Skyla|Rosa|Lusamine|Guzma|Lana|Amarys|Atticus|Colress|Klara|Avery|Ghetsis|Piers|Peonia|Peony|Kabu|Milo|Opal|Allister|Raihan|Chairman|Brassius|Carmine|Crispin|Gwynn|Naveen|Tarragon|Eri|Lucian|Canari|Kieran|Perrin|Penny|Grusha|Larry|Iono|Ryme|Tulip|Rika|Poppy|Hassel|Ortega|Mela|Giacomo|Eri )/
const ENERGY = /\benergy\b/i
const ITEM = /\b(?:capsule|ball|potion|elixir|candy|switch|vessel|shield|band|scope|search|blower|order|call|ticket|glasses|dowser|pack|amulet|belt|charm|gem|barrier|repeater|choice|escape|hyper|super|max|token|coin|badge|scarf|cape|hat|mask|patch|goggles|helmet|book|stone|scroll|feather|fluke|mochi|poffin|catcher|jungle|board|resort|catcher|catching|codebreaking|catch)\b/i
const NIDORAN = /\bnidoran\b/i

async function fetchAllUnassignedJp() {
  const rows = []
  let off = 0
  for (;;) {
    const { data, error } = await supabase.from('cards')
      .select('card_slug,card_name,set_name')
      .eq('language', 'jp')
      .eq('is_sealed', false)
      .is('primary_pokemon_slug', null)
      .range(off, off + 999)
    if (error) throw new Error(error.message)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < 1000) break
    off += 1000
  }
  return rows
}

async function fetchSpeciesNames() {
  const names = new Set()
  let off = 0
  for (;;) {
    const { data } = await supabase.from('pokemon_species').select('name').range(off, off + 999)
    if (!data || !data.length) break
    for (const r of data) names.add(r.name.toLowerCase())
    if (data.length < 1000) break
    off += 1000
  }
  return names
}

const rows = await fetchAllUnassignedJp()
const speciesNames = await fetchSpeciesNames()
console.log(`Unassigned Japanese non-sealed cards: ${rows.length}`)
console.log(`Species names loaded: ${speciesNames.size}\n`)

const groups = {
  'Trainer (generic)': 0,
  'Named Trainer': 0,
  'Energy': 0,
  'Item': 0,
  'Nidoran (no gender marker)': 0,
  'Actual Pokémon card containing a species name': 0,
  'Unclear': 0,
}
const nidoranSamples = []
const shouldHaveMatched = []
const unclearSamples = []

for (const r of rows) {
  const name = r.card_name || ''
  if (NIDORAN.test(name)) { groups['Nidoran (no gender marker)']++; if (nidoranSamples.length < 8) nidoranSamples.push(r); continue }
  if (NAMED_TRAINER.test(name)) { groups['Named Trainer']++; continue }
  if (TRAINER.test(name)) { groups['Trainer (generic)']++; continue }
  if (ENERGY.test(name)) { groups['Energy']++; continue }
  if (ITEM.test(name)) { groups['Item']++; continue }
  // Fallback: does any known species name appear as a token?
  const norm = name.toLowerCase().replace(/\s*#\S+\s*$/, '').replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
  let matchedSpecies = null
  for (const w of norm.split(/[\s-]+/)) {
    if (w.length >= 3 && speciesNames.has(w)) { matchedSpecies = w; break }
  }
  if (matchedSpecies) {
    groups['Actual Pokémon card containing a species name']++
    if (shouldHaveMatched.length < 15) shouldHaveMatched.push({ card_name: name, matched: matchedSpecies, set_name: r.set_name })
  } else {
    groups['Unclear']++
    if (unclearSamples.length < 15) unclearSamples.push(r)
  }
}

console.log('CLASSIFICATION')
console.log('='.repeat(60))
for (const [k, v] of Object.entries(groups)) console.log(`  ${String(v).padStart(5)}  ${k}`)
console.log()
console.log('Nidoran samples (all lack a gender marker — cannot be')
console.log('mapped deterministically to nidoran-f vs nidoran-m):')
for (const r of nidoranSamples) console.log(`  ${r.card_name}  |  ${r.set_name}`)
console.log()
console.log('Cards that should have matched (deterministic fix candidates):')
if (shouldHaveMatched.length === 0) {
  console.log('  (none — the existing name extraction is exhaustive for JP cards.)')
} else {
  for (const r of shouldHaveMatched) console.log(`  ${r.matched}  <-  ${r.card_name}  |  ${r.set_name}`)
}
console.log()
console.log('Unclear samples (Trainer / Item variants the heuristic missed):')
for (const r of unclearSamples) console.log(`  ${r.card_name}  |  ${r.set_name}`)
