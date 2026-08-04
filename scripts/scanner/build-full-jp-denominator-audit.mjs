#!/usr/bin/env node
// scripts/scanner/build-full-jp-denominator-audit.mjs
//
// Block 5A-W-51C Stage 2 — builds the complete 127-set JP printed-
// denominator audit from a per-set PokePrices → Bulbapedia mapping.
// The mapping is hand-authored below and reviewed against the
// verbatim Bulbapedia extract in scripts/scanner/data/bulbapedia-
// jp-expansions.json.
//
// Produces:
//   reports/jp-printed-denominator-audit.json  (overwrite)
//   reports/jp-printed-denominator-audit.csv   (overwrite)
//   reports/jp-printed-denominator-audit.md    (overwrite)
//
// Classifications used:
//   CONFIRMED_MATCH     stored denom == sourced printed base
//   CONFIRMED_MISMATCH  stored denom != sourced printed base
//   NOT_APPLICABLE      set does not use N/M printed numbering
//                       (promo aggregates, Carddass, Vending,
//                        Meiji, Topsun, McDonald's promos, CD Promo,
//                        Old Maid, ex Starter Decks — these use
//                        Pokedex numbers, standalone numbers or
//                        no printed number at all)
//   AMBIGUOUS_MAPPING   stored denom is uncertain (multi-denom set,
//                       source-name variant not resolved, or the
//                       set covers multiple original printings)
//   REFERENCE_NOT_AVAILABLE  no sourced base yet
//
// NO writes. Read-only.

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

// ── Hand-authored PokePrices → Bulbapedia mapping ────────
// Each key is the exact PokePrices `set_name` (with "Japanese "
// prefix). Value: {base: <int>|null, source: "bulbapedia_luke_...", status_hint?, notes?}.
// Sets with base=null and status_hint='NOT_APPLICABLE' don't use
// printed N/M numbering (Vending, Carddass, Meiji, promo aggregates).
const SRC = 'bulbapedia_luke_2026-08-04'
const NA = { base: null, status_hint: 'NOT_APPLICABLE' }
const AMB = (note) => ({ base: null, status_hint: 'AMBIGUOUS_MAPPING', notes: note })

const MAPPING = {
  // ── Modern / SV era ──────────────────────────────────
  'Japanese Battle Partners':               { base: 100, source: SRC },
  'Japanese Glory of Team Rocket':          { base: 98,  source: SRC, bulbapedia: 'Glory of the Rocket Gang' },
  'Japanese Black Bolt':                    { base: 86,  source: SRC },
  'Japanese White Flare':                   { base: 86,  source: SRC },
  'Japanese Mega Brave':                    { base: 63,  source: SRC },
  'Japanese Mega Symphonia':                { base: 63,  source: SRC },
  'Japanese Inferno X':                     { base: 80,  source: SRC },
  'Japanese Nihil Zero':                    { base: 80,  source: SRC },
  'Japanese Ninja Spinner':                 { base: 83,  source: SRC },
  'Japanese Abyss Eye':                     { base: 81,  source: SRC },
  'Japanese Storm Emeralda':                { base: 76,  source: SRC },
  'Japanese Mega Dream ex':                 { base: 193, source: SRC },
  'Japanese 30th Celebration':              { base: 103, source: SRC },
  'Japanese Terastal Festival':             { base: 187, source: SRC },
  'Japanese Wild Force':                    { base: 71,  source: SRC },
  'Japanese Cyber Judge':                   { base: 71,  source: SRC },
  'Japanese Transformation Mask':           { base: 101, source: SRC },
  'Japanese Stellar Miracle':               { base: 102, source: SRC },
  'Japanese Super Electric Breaker':        { base: 106, source: SRC },
  'Japanese Ancient Roar':                  { base: 66,  source: SRC },
  'Japanese Future Flash':                  { base: 66,  source: SRC },
  'Japanese Ruler of the Black Flame':      { base: 108, source: SRC },
  'Japanese Snow Hazard':                   { base: 71,  source: SRC },
  'Japanese Clay Burst':                    { base: 71,  source: SRC },
  'Japanese Scarlet ex':                    { base: 78,  source: SRC },
  'Japanese Violet ex':                     { base: 78,  source: SRC },
  'Japanese Scarlet & Violet 151':          { base: 165, source: SRC, bulbapedia: 'Pokémon Card 151' },
  'Japanese Raging Surf':                   { base: 62,  source: SRC },
  'Japanese Crimson Haze':                  { base: 66,  source: SRC },
  'Japanese Night Wanderer':                { base: 64,  source: SRC },
  'Japanese Paradise Dragona':              { base: 64,  source: SRC },
  'Japanese Hot Wind Arena':                { base: 63,  source: SRC },
  'Japanese Shiny Treasure ex':             { base: 190, source: SRC },
  'Japanese Triplet Beat':                  { base: 73,  source: SRC },

  // ── Sword & Shield era ──────────────────────────────
  'Japanese Sword':                         { base: 60,  source: SRC },
  'Japanese Shield':                        { base: 60,  source: SRC },
  'Japanese Rebellion Crash':               { base: 96,  source: SRC },
  'Japanese Infinity Zone':                 { base: 100, source: SRC },
  'Japanese Amazing Volt Tackle':           { base: 100, source: SRC },
  'Japanese Single Strike Master':          { base: 70,  source: SRC },
  'Japanese Rapid Strike Master':           { base: 70,  source: SRC },
  'Japanese Silver Lance':                  { base: 70,  source: SRC },
  'Japanese Jet-Black Spirit':              { base: 70,  source: SRC },
  'Japanese Skyscraping Perfection':        { base: 67,  source: SRC },
  'Japanese Blue Sky Stream':               { base: 67,  source: SRC },
  'Japanese Fusion Arts':                   { base: 100, source: SRC },
  'Japanese Star Birth':                    { base: 100, source: SRC },
  'Japanese Time Gazer':                    { base: 67,  source: SRC },
  'Japanese Space Juggler':                 { base: 67,  source: SRC },
  'Japanese Lost Abyss':                    { base: 100, source: SRC },
  'Japanese Paradigm Trigger':              { base: 98,  source: SRC },
  'Japanese VMAX Rising':                   { base: 70,  source: SRC },
  'Japanese Explosive Walker':              { base: 70,  source: SRC },
  'Japanese Legendary Heartbeat':           { base: 76,  source: SRC },
  'Japanese Peerless Fighters':             { base: 70,  source: SRC },
  'Japanese Eevee Heroes':                  { base: 69,  source: SRC },
  'Japanese Battle Region':                 { base: 67,  source: SRC },
  'Japanese Dark Phantasma':                { base: 71,  source: SRC },
  'Japanese Pokemon Go':                    { base: 71,  source: SRC, bulbapedia: 'Pokémon GO' },
  'Japanese Incandescent Arcana':           { base: 68,  source: SRC },
  'Japanese Shiny Star V':                  { base: 190, source: SRC },
  'Japanese VMAX Climax':                   { base: 184, source: SRC },
  'Japanese VSTAR Universe':                { base: 172, source: SRC },
  'Japanese 25th Anniversary Collection':   { base: 28,  source: SRC },
  'Japanese 25th Anniversary Promo':        { base: 25,  source: SRC, bulbapedia: 'Promo Card Pack 25th Anniversary Edition' },

  // ── Sun & Moon era ──────────────────────────────────
  'Japanese Collection Sun':                { base: 60,  source: SRC },
  'Japanese Collection Moon':               { base: 60,  source: SRC },
  'Japanese Islands Await You':             { base: 50,  source: SRC },
  'Japanese Alolan Moonlight':              { base: 50,  source: SRC },
  'Japanese To Have Seen the Battle Rainbow': { base: 51,  source: SRC },
  'Japanese Darkness that Consumes Light':  { base: 51,  source: SRC },
  'Japanese Awakened Heroes':               { base: 50,  source: SRC },
  'Japanese Ultradimensional Beasts':       { base: 50,  source: SRC },
  'Japanese Ultra Sun':                     { base: 66,  source: SRC },
  'Japanese Ultra Moon':                    { base: 66,  source: SRC },
  'Japanese Forbidden Light':               { base: 94,  source: SRC },
  'Japanese Sky-Splitting Charisma':        { base: 96,  source: SRC },
  'Japanese Super-Burst Impact':            { base: 95,  source: SRC },
  'Japanese Tag Bolt':                      { base: 95,  source: SRC },
  'Japanese Double Blaze':                  { base: 95,  source: SRC },
  'Japanese Miracle Twin':                  { base: 94,  source: SRC },
  'Japanese Alter Genesis':                 { base: 95,  source: SRC },
  'Japanese Enhanced Expansion Pack Sun & Moon': { base: 51, source: SRC },
  'Japanese Facing a New Trial':            { base: 49,  source: SRC },
  'Japanese Shining Legends':               { base: 72,  source: SRC },
  'Japanese Ultra Force':                   { base: 50,  source: SRC },
  'Japanese Dragon Storm':                  { base: 53,  source: SRC },
  'Japanese Champion Road':                 { base: 66,  source: SRC },
  'Japanese Thunderclap Spark':             { base: 60,  source: SRC },
  'Japanese Fairy Rise':                    { base: 50,  source: SRC },
  'Japanese Dark Order':                    { base: 52,  source: SRC },
  'Japanese Night Unison':                  { base: 55,  source: SRC },
  'Japanese Full Metal Wall':               { base: 54,  source: SRC },
  'Japanese GG End':                        { base: 54,  source: SRC },
  'Japanese Sky Legend':                    { base: 54,  source: SRC },
  'Japanese Remix Bout':                    { base: 64,  source: SRC },
  'Japanese Dream League':                  { base: 49,  source: SRC },
  'Japanese GX Battle Boost':               { base: 114, source: SRC },
  'Japanese GX Ultra Shiny':                { base: 150, source: SRC },
  'Japanese Tag All Stars':                 { base: 173, source: SRC },

  // ── XY era ─────────────────────────────────────────
  'Japanese Collection X':                  { base: 60,  source: SRC },
  'Japanese Collection Y':                  { base: 60,  source: SRC },
  'Japanese Wild Blaze':                    { base: 80,  source: SRC },
  'Japanese Rising Fist':                   { base: 96,  source: SRC },
  'Japanese Phantom Gate':                  { base: 88,  source: SRC },
  'Japanese Gaia Volcano':                  { base: 70,  source: SRC },
  'Japanese Tidal Storm':                   { base: 70,  source: SRC },
  'Japanese Emerald Break':                 { base: 78,  source: SRC },
  'Japanese Bandit Ring':                   { base: 81,  source: SRC },
  'Japanese Blue Shock':                    { base: 59,  source: SRC },
  'Japanese Red Flash':                     { base: 59,  source: SRC },
  'Japanese Rage of the Broken Heavens':    { base: 80,  source: SRC },
  'Japanese Awakening Psychic King':        { base: 78,  source: SRC },
  'Japanese Fever-Burst Fighter':           { base: 54,  source: SRC },
  'Japanese Cruel Traitor':                 { base: 54,  source: SRC },
  'Japanese EX Battle Boost':               { base: 93,  source: SRC },
  'Japanese Best of XY':                    { base: 171, source: SRC, bulbapedia: 'THE BEST OF XY' },
  'Japanese Legendary Shine Collection':    { base: 27,  source: SRC },
  'Japanese PokéKyun Collection':           { base: 32,  source: SRC },
  'Japanese Mythical & Legendary Dream Shine Collection': { base: 36, source: SRC },
  'Japanese Premium Champion Pack EX × M × BREAK': { base: 131, source: SRC },
  'Japanese 20th Anniversary':              { base: 87,  source: SRC, bulbapedia: 'Expansion Pack 20th Anniversary' },

  // ── Black & White era ──────────────────────────────
  'Japanese Black Collection':              { base: 53,  source: SRC },
  'Japanese White Collection':              { base: 53,  source: SRC },
  'Japanese Red Collection':                { base: 66,  source: SRC },
  'Japanese Psycho Drive':                  { base: 52,  source: SRC },
  'Japanese Hail Blizzard':                 { base: 52,  source: SRC },
  'Japanese Dark Rush':                     { base: 69,  source: SRC },
  'Japanese Dragon Blast':                  { base: 50,  source: SRC },
  'Japanese Dragon Blade':                  { base: 50,  source: SRC },
  'Japanese Freeze Bolt':                   { base: 59,  source: SRC },
  'Japanese Cold Flare':                    { base: 59,  source: SRC },
  'Japanese Plasma Gale':                   { base: 70,  source: SRC },
  'Japanese Spiral Force':                  { base: 51,  source: SRC },
  'Japanese Thunder Knuckle':               { base: 51,  source: SRC },
  'Japanese Megalo Cannon':                 { base: 76,  source: SRC },
  'Japanese Shiny Collection':              { base: 20,  source: SRC },
  'Japanese Dragon Selection':              { base: 20,  source: SRC },

  // ── HGSS / Diamond & Pearl / Platinum era ─────────
  'Japanese HeartGold Collection':          { base: 70,  source: SRC },
  'Japanese SoulSilver Collection':         { base: 70,  source: SRC },
  'Japanese Reviving Legends':              { base: 80,  source: SRC },
  'Japanese Clash at the Summit':           { base: 80,  source: SRC },
  'Japanese Lost Link':                     { base: 40,  source: SRC },
  'Japanese Bonds to the End of Time':      { base: 90,  source: SRC },
  'Japanese Beat of the Frontier':          { base: 100, source: SRC },
  'Japanese Advent of Arceus':              { base: 90,  source: SRC },
  'Japanese Diamond Collection':            { base: 117, source: SRC, bulbapedia: 'Space-Time Creation: Diamond Collection' },
  'Japanese Pearl Collection':              { base: 119, source: SRC, bulbapedia: 'Space-Time Creation: Pearl Collection' },
  'Japanese Secret of the Lakes':           { base: 123, source: SRC },
  'Japanese Shining Darkness':              { base: 119, source: SRC },
  'Japanese Moonlit Pursuit':               { base: 70,  source: SRC },
  'Japanese Dawn Dash':                     { base: 70,  source: SRC },
  'Japanese Cry from the Mysterious':       { base: 65,  source: SRC },
  'Japanese Temple of Anger':               { base: 65,  source: SRC },
  'Japanese Intense Fight in the Destroyed Sky': { base: 92, source: SRC },
  'Japanese Galactic\'s Conquest':           { base: 96,  source: SRC },

  // ── EX era ─────────────────────────────────────────
  'Japanese ADV Expansion Pack':            { base: 55,  source: SRC },
  'Japanese Miracle of the Desert':         { base: 53,  source: SRC },
  'Japanese Rulers of the Heavens':         { base: 54,  source: SRC },
  'Japanese Undone Seal':                   { base: 83,  source: SRC },
  'Japanese Flight of Legends':             { base: 82,  source: SRC },
  'Japanese Clash of the Blue Sky':         { base: 82,  source: SRC },
  'Japanese Rocket Gang Strikes Back':      { base: 84,  source: SRC },
  'Japanese Golden Sky, Silvery Ocean':     { base: 106, source: SRC },
  'Japanese Mirage Forest':                 { base: 86,  source: SRC },
  'Japanese Holon Research Tower':          { base: 86,  source: SRC },
  'Japanese Holon Phantom':                 { base: 52,  source: SRC },
  'Japanese Miracle Crystal':               { base: 75,  source: SRC },
  'Japanese Offense and Defense of the Furthest Ends': { base: 68, source: SRC },
  'Japanese World Champions Pack':          { base: 108, source: SRC },
  'Japanese Magma VS Aqua: Two Ambitions':  { base: 80,  source: SRC },
  'Japanese Double Crisis':                 { base: 34,  source: SRC, bulbapedia: 'Magma Gang VS Aqua Gang: Double Crisis' },

  // ── e-Card era ────────────────────────────────────
  'Japanese Base Expansion Pack':           { base: 128, source: SRC },
  'Japanese The Town on No Map':            { base: 92,  source: SRC },
  'Japanese Wind from the Sea':             { base: 87,  source: SRC },
  'Japanese Split Earth':                   { base: 88,  source: SRC },
  'Japanese Mysterious Mountains':          { base: 88,  source: SRC },

  // ── WotC / Neo era ────────────────────────────────
  'Japanese Expansion Pack':                { base: 102, source: SRC },
  'Japanese Pokémon Jungle':                { base: 48,  source: SRC },
  'Japanese Mystery of the Fossils':        { base: 48,  source: SRC },
  'Japanese Rocket Gang':                   { base: 65,  source: SRC },
  'Japanese Leaders\' Stadium':              { base: 96,  source: SRC },
  'Japanese Challenge from the Darkness':   { base: 98,  source: SRC },
  'Japanese Gold, Silver, New World':       { base: 96,  source: SRC, bulbapedia: 'Gold, Silver, to a New World...' },
  'Japanese Crossing the Ruins':            { base: 56,  source: SRC, bulbapedia: 'Crossing the Ruins...' },
  'Japanese Awakening Legends':             { base: 57,  source: SRC },
  'Japanese Darkness, and to Light':        { base: 113, source: SRC, bulbapedia: 'Darkness, and to Light...' },
  'Japanese Pokémon Card VS':               { base: 141, source: SRC, bulbapedia: 'Pokémon Card★VS' },
  'Japanese Pokémon Card web':              { base: 48,  source: SRC, bulbapedia: 'Pokémon Card★web' },

  // ── Promotional / special ─────────────────────────
  'Japanese Southern Islands':              { base: 18,  source: SRC },
  'Japanese Great Detective Pikachu':       { base: 24,  source: SRC },
  'Japanese Movie Commemoration':           { base: 9,   source: SRC, bulbapedia: 'Movie Commemoration Premium Sheet' },
  'Japanese Movie 10 Anniversary':          { base: 11,  source: SRC, bulbapedia: 'Movie 10 Anniversary Premium Sheet' },
  'Japanese World Collection':              { base: 10,  source: SRC },
  'Japanese Collection Sheet Journey Partners': { base: 9, source: SRC },
  'Japanese Pikachu\'s New Friends':         { base: 4,   source: SRC },
  'Japanese 2002 McDonald\'s':               { base: 30,  source: SRC, bulbapedia: 'McDonald\'s Original Minimum Pack' },

  // ── Name variants: DB name differs from Bulbapedia; resolved by
  //    inspecting stored denom + max_num against the Bulbapedia base.
  //    Only added when stored denom already MATCHES the Bulbapedia base
  //    (so classification will be CONFIRMED_MATCH, not a speculative
  //    correction).
  'Japanese Go':                             { base: 71, source: SRC, bulbapedia: 'Pokémon GO' },
  'Japanese Miracle Twins':                  { base: 94, source: SRC, bulbapedia: 'Miracle Twin' },
  'Japanese PokeKyun Collection':            { base: 32, source: SRC, bulbapedia: 'PokéKyun Collection' },
  'Japanese Holon Research':                 { base: 86, source: SRC, bulbapedia: 'Holon Research Tower' },
  'Japanese Magma VS Aqua Two Ambitions':    { base: 80, source: SRC, bulbapedia: 'Magma VS Aqua: Two Ambitions' },
  'Japanese Web':                            { base: 48, source: SRC, bulbapedia: 'Pokémon Card★web' },
  'Japanese Expedition Expansion Pack':      { base: 128, source: SRC, bulbapedia: 'Base Expansion Pack' },

  // ── Ambiguous mappings: DB stored denom / max_num diverges
  //    significantly from any Bulbapedia set — likely aggregates or
  //    variant packs that need manual investigation before assigning
  //    a printed base.
  'Japanese Heat Wave Arena':                AMB('DB stored /92 with max_num 92; nearest Bulbapedia entry "Hot Wind Arena" = 63. Discrepancy: could be different set or aggregate.'),
  'Japanese Mask of Change':                 AMB('DB stored /66 with max_num 133; nearest Bulbapedia entry "Transformation Mask" = 101. Discrepancy.'),
  'Japanese Violet Ex':                      AMB('DB stored /108 with max_num 108; Bulbapedia "Violet ex" = 78. Likely aggregate of SV1a + SV2a or includes variants.'),
  'Japanese Scarlet Ex':                     AMB('DB stored /108 with max_num 108; Bulbapedia "Scarlet ex" = 78. Likely aggregate of SV1a + SV2a or includes variants.'),
  'Japanese VS':                             AMB('DB stored /142 max 142 vs Bulbapedia Pokémon Card★VS = 141. 1-card discrepancy — could be a single-card catalogue variant.'),
  'Japanese Jungle':                         AMB('DB stored /143 max 143 vs Bulbapedia Pokémon Jungle = 48. Massive discrepancy — PokePrices data appears to aggregate later Neo-era reprints or includes multiple original prints.'),
  'Japanese Space-Time':                     AMB('DB has no stored denom, max_num 453. Bulbapedia splits into Diamond Collection (117) + Pearl Collection (119). PokePrices may be aggregating; likely needs a set-split before printed base can be assigned.'),
  'Japanese Temple of Anger':                AMB('DB has no stored denom, max_num 446. Bulbapedia Temple of Anger = 65. PokePrices likely aggregates additional sets.'),
  'Japanese Shining Darkness':               AMB('DB has no stored denom, max_num 488. Bulbapedia Shining Darkness = 119. PokePrices likely aggregates additional sets.'),

  // ── Not applicable — no printed N/M numbering ─────
  'Japanese 1996 Carddass':                 NA,
  'Japanese 1997 Carddass':                 NA,
  'Japanese 1998 Carddass':                 NA,
  'Japanese 1999 Merlin':                   NA,
  'Japanese Meiji Promo':                   NA,
  'Japanese CD Promo':                      NA,
  'Japanese Topsun':                        NA,
  'Japanese Vending':                       NA,
  'Japanese Vending 1':                     NA,
  'Japanese Vending 2':                     NA,
  'Japanese Vending 3':                     NA,
  'Japanese Promo':                         NA,
  'Japanese Neo Premium File':              NA,
  'Japanese Old Maid':                      NA,
  'Japanese ex Starter Decks':              NA,
  'Japanese Start Deck 100':                NA,
  'Japanese Start Deck 100 Battle Collection': NA,
}

// ── Load DB ─────────────────────────────────────────────
const { data: meta } = await c.from('set_metadata').select('set_name, total_cards, release_year').eq('language', 'jp')

const cardsBySet = new Map()
let seen = 0
for (let start = 0; ; start += 1000) {
  const { data: page } = await c.from('cards')
    .select('set_name, card_number, card_number_display, set_printed_total')
    .eq('language', 'jp').range(start, start + 999)
  if (!page || page.length === 0) break
  for (const r of page) {
    const b = cardsBySet.get(r.set_name) ?? { rows: [] }
    b.rows.push(r)
    cardsBySet.set(r.set_name, b)
  }
  seen += page.length
  if (page.length < 1000) break
}

const results = []
for (const m of meta) {
  const setName = m.set_name
  const rows = cardsBySet.get(setName)?.rows ?? []
  const nums = rows.filter(r => r.card_number).map(r => parseInt(r.card_number, 10)).filter(n => !isNaN(n))
  const denoms = [...new Set(rows.map(r => r.set_printed_total).filter(Boolean))]
  const displayDenoms = [...new Set(rows.map(r => r.card_number_display?.split('/')[1]).filter(Boolean))]
  const storedDenom = denoms.length === 1 ? parseInt(denoms[0], 10) : null
  const uniqueCount = new Set(nums).size
  const maxNum = nums.length ? Math.max(...nums) : null
  const sampleFirstRow = rows.find(r => r.card_number_display && r.card_number === String(Math.min(...nums)))
  const sampleLastRow  = rows.find(r => r.card_number_display && r.card_number === String(maxNum))

  const mapping = MAPPING[setName] ?? null
  const referenceDenom = mapping?.base ?? null
  const referenceSource = mapping?.source ?? null
  const bulbapediaName = mapping?.bulbapedia ?? null
  const statusHint = mapping?.status_hint ?? null

  let status, notes = mapping?.notes ?? ''
  const proposedFirst = referenceDenom != null && sampleFirstRow?.card_number ? `${sampleFirstRow.card_number}/${referenceDenom}` : null
  const proposedLast  = referenceDenom != null && sampleLastRow?.card_number  ? `${sampleLastRow.card_number}/${referenceDenom}`  : null
  const affectedRows = referenceDenom != null && storedDenom != null && storedDenom !== referenceDenom
    ? rows.filter(r => r.card_number != null).length
    : 0

  if (rows.length === 0) {
    status = mapping == null ? 'REFERENCE_NOT_AVAILABLE' : (statusHint ?? 'REFERENCE_NOT_AVAILABLE')
    if (!notes) notes = 'No imported cards.'
  } else if (statusHint === 'NOT_APPLICABLE') {
    status = 'NOT_APPLICABLE'
    if (!notes) notes = 'Set does not use N/M printed numbering (promo aggregate, Carddass, Vending, Meiji, Topsun, CD Promo, McDonald\'s promos, ex Starter Decks or Old Maid).'
  } else if (statusHint === 'AMBIGUOUS_MAPPING') {
    status = 'AMBIGUOUS_MAPPING'
    if (!notes) notes = 'Source-name mapping uncertain.'
  } else if (mapping == null || referenceDenom == null) {
    status = 'REFERENCE_NOT_AVAILABLE'
    notes = notes || 'No authoritative printed base yet.'
  } else if (denoms.length > 1) {
    status = 'AMBIGUOUS_MAPPING'
    notes = `Multiple stored denominators (${denoms.join(',')}). Cannot classify a single set-wide value.`
  } else if (storedDenom == null) {
    status = 'AMBIGUOUS_MAPPING'
    notes = 'set_printed_total could not be parsed.'
  } else if (storedDenom === referenceDenom) {
    status = 'CONFIRMED_MATCH'
  } else {
    status = 'CONFIRMED_MISMATCH'
    notes = `Stored /${storedDenom} but authoritative printed base is /${referenceDenom}. Would rewrite ${affectedRows} card rows.`
  }

  results.push({
    set_name: setName,
    visible_name: setName.replace(/^Japanese\s+/, ''),
    release_year: m.release_year,
    set_metadata_total_cards: m.total_cards ?? null,
    stored_printed_denominator: storedDenom,
    reference_printed_denominator: referenceDenom,
    bulbapedia_name: bulbapediaName ?? mapping?.bulbapedia ?? null,
    total_imported_card_rows: rows.length,
    affected_card_rows: affectedRows,
    unique_numerators: uniqueCount,
    max_numerator: maxNum,
    sample_current_display: sampleFirstRow?.card_number_display ?? null,
    sample_proposed_display: proposedFirst,
    sample_current_display_max: sampleLastRow?.card_number_display ?? null,
    sample_proposed_display_max: proposedLast,
    reference_source: referenceSource,
    status,
    notes,
  })
}

// Block 5A-W-51D — refine classifications. Any set previously called
// CONFIRMED_MISMATCH is upgraded to a review-driven bucket:
//   APPLY_SAFE                — verified per-set via
//                               verify-tier-a-candidates.mjs; DB and
//                               Bulbapedia agree on identity, numerators
//                               are consistent with the base, no
//                               aggregate evidence.
//   HOLD_AGGREGATE_OR_SPLIT   — the DB set looks like it merges more
//                               than one original source (paired
//                               releases, vintage catalogue aggregates,
//                               secrets that exceed >60% of base).
//   HOLD_SOURCE_MAPPING       — name mapping uncertain; retained here
//                               instead of AMBIGUOUS_MAPPING when the
//                               issue is source identity rather than
//                               DB data ambiguity.
const APPLY_SAFE_SETS = new Set([
  // The 35 verified APPLY_SAFE sets from verify-tier-a-candidates.mjs.
  'Japanese Abyss Eye','Japanese Glory of Team Rocket','Japanese Nihil Zero','Japanese Inferno X',
  'Japanese Mysterious Mountains','Japanese Wild Force','Japanese Crimson Haze','Japanese Mega Brave',
  'Japanese Mega Dream ex','Japanese Mega Symphonia','Japanese Night Wanderer','Japanese Stellar Miracle',
  'Japanese Super Electric Breaker','Japanese Paradise Dragona','Japanese VSTAR Universe','Japanese Battle Region',
  'Japanese Paradigm Trigger','Japanese Remix Bout','Japanese Super-Burst Impact','Japanese Awakening Psychic King',
  'Japanese GX Battle Boost','Japanese Bandit Ring','Japanese Wild Blaze','Japanese EX Battle Boost',
  'Japanese Rising Fist','Japanese Megalo Cannon','Japanese Plasma Gale','Japanese Cold Flare',
  'Japanese Rocket Gang Strikes Back','Japanese Ninja Spinner','Japanese Wind from the Sea',"Japanese 2002 McDonald's",
  'Japanese Reviving Legends','Japanese Split Earth','Japanese Red Flash',
])
const HOLD_AGGREGATE_SETS = new Set([
  // Paired-release aggregates: DB rows appear to combine both halves.
  'Japanese White Flare','Japanese Black Bolt',
  // Vintage aggregates from the earlier ratio-based flag (still held).
  'Japanese Holon Phantom','Japanese Challenge from the Darkness','Japanese Crossing the Ruins',
  'Japanese Darkness, and to Light','Japanese Secret of the Lakes','Japanese Awakening Legends',
  "Japanese Leaders' Stadium",'Japanese Gold, Silver, New World','Japanese Mystery of the Fossils',
  'Japanese Rocket Gang','Japanese Expansion Pack',
])
for (const r of results) {
  if (r.status === 'CONFIRMED_MISMATCH') {
    if (APPLY_SAFE_SETS.has(r.set_name)) r.status = 'APPLY_SAFE'
    else if (HOLD_AGGREGATE_SETS.has(r.set_name)) r.status = 'HOLD_AGGREGATE_OR_SPLIT'
    else r.status = 'HOLD_SOURCE_MAPPING'
  }
}
// Also compute non-sealed row counts + sealed row counts to include in report.
// This requires a second pass — deferred to the report's per-row data via
// affected_card_rows (already non-sealed via the migration's WHERE clause).
const CLASS_ORDER = { HOLD_AGGREGATE_OR_SPLIT: 0, HOLD_SOURCE_MAPPING: 1, APPLY_SAFE: 2, NOT_APPLICABLE: 3, AMBIGUOUS_MAPPING: 4, REFERENCE_NOT_AVAILABLE: 5, CONFIRMED_MATCH: 6 }
results.sort((a, b) => {
  const c = CLASS_ORDER[a.status] - CLASS_ORDER[b.status]
  if (c !== 0) return c
  return (b.release_year ?? 0) - (a.release_year ?? 0)
})

const totals = { CONFIRMED_MATCH: 0, APPLY_SAFE: 0, HOLD_AGGREGATE_OR_SPLIT: 0, HOLD_SOURCE_MAPPING: 0, NOT_APPLICABLE: 0, AMBIGUOUS_MAPPING: 0, REFERENCE_NOT_AVAILABLE: 0 }
for (const r of results) totals[r.status] += 1
const totalAffectedRows = results.reduce((s, r) => s + r.affected_card_rows, 0)

await mkdir('reports', { recursive: true })
await writeFile('reports/jp-printed-denominator-audit.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  reference_source: 'Bulbapedia — List of Japanese Pokémon Trading Card Game expansions',
  reference_source_url: 'https://bulbapedia.bulbagarden.net/wiki/List_of_Japanese_Pok%C3%A9mon_Trading_Card_Game_expansions',
  mapping_entry_count: Object.keys(MAPPING).length,
  set_metadata_row_count: meta.length,
  jp_card_row_total: seen,
  totals,
  total_affected_card_rows_across_mismatches: totalAffectedRows,
  results,
}, null, 2), 'utf8')

const CSV_COLS = [
  'set_name','visible_name','release_year','set_metadata_total_cards',
  'stored_printed_denominator','reference_printed_denominator','bulbapedia_name',
  'total_imported_card_rows','affected_card_rows','unique_numerators','max_numerator',
  'sample_current_display','sample_proposed_display',
  'sample_current_display_max','sample_proposed_display_max',
  'reference_source','status','notes',
]
const csvCell = (v) => v == null ? '' : (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
const csvLines = [CSV_COLS.join(',')]
for (const r of results) csvLines.push(CSV_COLS.map(c => csvCell(r[c])).join(','))
await writeFile('reports/jp-printed-denominator-audit.csv', csvLines.join('\n') + '\n', 'utf8')

const md = [
  '# Japanese printed-denominator audit — complete 127-set coverage',
  '',
  `_Generated: ${new Date().toISOString()}_`,
  '',
  `**Reference**: [Bulbapedia — List of Japanese Pokémon TCG expansions](https://bulbapedia.bulbagarden.net/wiki/List_of_Japanese_Pok%C3%A9mon_Trading_Card_Game_expansions), extracted verbatim into \`scripts/scanner/data/bulbapedia-jp-expansions.json\` and mapped per-set into the audit script.`,
  '',
  '## Totals',
  '',
  '| Classification | Sets | Card rows to update |',
  '|----------------|-----:|--------------------:|',
  `| CONFIRMED_MATCH | ${totals.CONFIRMED_MATCH} | 0 |`,
  `| CONFIRMED_MISMATCH | ${totals.CONFIRMED_MISMATCH} | ${totalAffectedRows} |`,
  `| NOT_APPLICABLE | ${totals.NOT_APPLICABLE} | 0 |`,
  `| AMBIGUOUS_MAPPING | ${totals.AMBIGUOUS_MAPPING} | 0 |`,
  `| REFERENCE_NOT_AVAILABLE | ${totals.REFERENCE_NOT_AVAILABLE} | 0 |`,
  '',
  '## Confirmed mismatches (proposed second-migration targets)',
  '',
  '| set_name | Bulbapedia name | stored | reference | rows | sample current → proposed |',
  '|----------|-----------------|-------:|----------:|-----:|---------------------------|',
  ...results.filter(r => r.status === 'CONFIRMED_MISMATCH').map(r =>
    `| ${r.set_name} | ${r.bulbapedia_name ?? r.visible_name} | /${r.stored_printed_denominator} | /${r.reference_printed_denominator} | ${r.affected_card_rows} | ${r.sample_current_display_max ?? r.sample_current_display} → ${r.sample_proposed_display_max ?? r.sample_proposed_display} |`
  ),
  '',
  '## Confirmed matches',
  '',
  '<details><summary>All CONFIRMED_MATCH sets</summary>',
  '',
  '| set_name | stored + reference |',
  '|----------|-------------------:|',
  ...results.filter(r => r.status === 'CONFIRMED_MATCH').map(r => `| ${r.set_name} | /${r.stored_printed_denominator} |`),
  '',
  '</details>',
  '',
  '## Not applicable',
  '',
  '_These sets do not use N/M printed numbering (aggregated promos, Carddass, Vending machine cards, Meiji, Topsun, CD Promo, McDonald\'s promos, ex Starter Decks, Old Maid). No printed denominator can be assigned._',
  '',
  '| set_name | rows | notes |',
  '|----------|-----:|-------|',
  ...results.filter(r => r.status === 'NOT_APPLICABLE').map(r => `| ${r.set_name} | ${r.total_imported_card_rows} | ${r.notes} |`),
  '',
  '## Ambiguous mappings',
  '',
  results.filter(r => r.status === 'AMBIGUOUS_MAPPING').length === 0
    ? '_None._'
    : ['| set_name | notes |','|----------|-------|', ...results.filter(r => r.status === 'AMBIGUOUS_MAPPING').map(r => `| ${r.set_name} | ${r.notes} |`)].join('\n'),
  '',
  '## Reference not available',
  '',
  results.filter(r => r.status === 'REFERENCE_NOT_AVAILABLE').length === 0
    ? '_None — all 127 sets are now classified._'
    : ['| set_name | notes |','|----------|-------|', ...results.filter(r => r.status === 'REFERENCE_NOT_AVAILABLE').map(r => `| ${r.set_name} | ${r.notes} |`)].join('\n'),
].join('\n')
await writeFile('reports/jp-printed-denominator-audit.md', md, 'utf8')

console.log('Wrote reports/jp-printed-denominator-audit.{json,csv,md}')
console.log('Totals:', totals)
console.log(`Card rows that would be rewritten by the second migration: ${totalAffectedRows}`)
