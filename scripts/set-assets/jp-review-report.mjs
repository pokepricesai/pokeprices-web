#!/usr/bin/env node
// scripts/set-assets/jp-review-report.mjs
//
// Block 5A-W-50G / 50G-B — merges TCGdex + Bulbagarden Archives fetch
// output with the production set_metadata list (all 127 JP sets) and
// writes:
//   * reports/jp-set-assets-review.html   (visual review report)
//   * reports/jp-set-assets-manifest.json (dry-run import manifest,
//                                          every entry approved:false)
//
// No DB writes. No Supabase Storage writes. No image bytes downloaded.
//
// Environment:
//   NEXT_PUBLIC_SUPABASE_URL     (or SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY    (or SUPABASE_SERVICE_KEY)
//   loaded automatically from .env.local
//
// Usage:
//   npx tsx scripts/set-assets/jp-review-report.mjs
//   npx tsx scripts/set-assets/jp-review-report.mjs --out reports/x.html --manifest reports/y.json

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(m[1] in process.env)) process.env[m[1]] = v
  }
}

import {
  classifyMatch,
  isKnownPairedExpansion,
  isLikelyFallbackSourceOnly,
} from '../../src/lib/set-assets/jpMatch.ts'
import { matchBulbagardenFor } from '../../src/lib/set-assets/jpBulbagardenMatch.ts'

const argv = process.argv.slice(2)
const arg = (name, def = null) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : def }
const TCGDEX_PATH    = arg('--tcgdex',   'reports/jp-tcgdex-fetch.json')
const BULBA_PATH     = arg('--bulba',    'reports/jp-bulbagarden-fetch.json')
const HTML_OUT       = arg('--out',      'reports/jp-set-assets-review.html')
const MANIFEST_OUT   = arg('--manifest', 'reports/jp-set-assets-manifest.json')

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (checked .env.local and process.env)')
  process.exit(1)
}

// ── Load candidate universes ──
async function safeReadJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch { return null }
}
const tcgdex = await safeReadJson(TCGDEX_PATH)
const bulba  = await safeReadJson(BULBA_PATH)
const tcgdexCandidates = tcgdex?.sets ?? []
const bulbaFiles       = bulba?.files ?? []
console.log(`[jp-review] TCGdex candidates: ${tcgdexCandidates.length}`)
console.log(`[jp-review] Bulbagarden files: ${bulbaFiles.length}`)

// ── Load production JP set list (all 127, direct from set_metadata) ──
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const { data: meta, error: metaErr } = await supabase
  .from('set_metadata')
  .select('set_name, language')
  .eq('language', 'jp')
if (metaErr) throw metaErr

const { data: rpc, error: rpcErr } = await supabase.rpc('get_set_list_v2')
if (rpcErr) throw rpcErr
const rpcByName = new Map((rpc ?? []).map(r => [r.set_name, r]))

const jpSets = (meta ?? [])
  .map(m => {
    const r = rpcByName.get(m.set_name) ?? {}
    return {
      set_name:         m.set_name,
      set_release_date: r.set_release_date ?? null,
      card_count:       r.card_count ?? 0,
      language:         'jp',
      set_image_url:    r.set_image_url ?? null,
    }
  })
  .sort((a, b) => (b.set_release_date || '').localeCompare(a.set_release_date || ''))

console.log(`[jp-review] production JP sets: ${jpSets.length}`)

// ── Per-set matching ──
const rows = jpSets.map(pp => {
  const flags = []
  if (isKnownPairedExpansion(pp.set_name)) flags.push('paired-expansion')
  if (isLikelyFallbackSourceOnly(pp.set_name)) flags.push('fallback-source-only')

  const tcgdexMatch = classifyMatch(pp, tcgdexCandidates)
  if (flags.includes('paired-expansion') && tcgdexMatch.classification === 'CONFIRMED_AUTOMATIC') {
    tcgdexMatch.classification = 'PROBABLE_REVIEW'
    tcgdexMatch.warnings = ['known paired expansion — human review required', ...tcgdexMatch.warnings]
  }

  const bulbaMatch = matchBulbagardenFor(pp, bulbaFiles)

  // Composite classification: prefer Bulbagarden logo; fall back to
  // TCGdex; fall back to Bulbagarden symbol; else NO_MATCH /
  // NO_OFFICIAL_LOGO / WRONG_ASSET_TYPE / FALLBACK_ONLY.
  let composite = 'NO_MATCH'
  if (flags.includes('fallback-source-only')) composite = 'FALLBACK_ONLY'
  else if (bulbaMatch.logoClassification === 'CONFIRMED_AUTOMATIC') composite = 'CONFIRMED_AUTOMATIC'
  else if (tcgdexMatch.classification === 'CONFIRMED_AUTOMATIC')     composite = 'CONFIRMED_AUTOMATIC'
  else if (bulbaMatch.logoClassification === 'PROBABLE_REVIEW' || bulbaMatch.logoClassification === 'AMBIGUOUS') composite = bulbaMatch.logoClassification
  else if (tcgdexMatch.classification === 'PROBABLE_REVIEW' || tcgdexMatch.classification === 'AMBIGUOUS') composite = tcgdexMatch.classification
  else if (bulbaMatch.logoClassification === 'WRONG_ASSET_TYPE')     composite = 'WRONG_ASSET_TYPE'
  else if (bulbaMatch.symbolClassification === 'CONFIRMED_AUTOMATIC' || bulbaMatch.symbolClassification === 'PROBABLE_REVIEW') composite = 'SYMBOL_ONLY'

  return { pp, flags, tcgdexMatch, bulbaMatch, composite }
})

// ── Bucketing + counters ──
const BUCKETS = ['CONFIRMED_AUTOMATIC','PROBABLE_REVIEW','AMBIGUOUS','SYMBOL_ONLY','WRONG_ASSET_TYPE','FALLBACK_ONLY','NO_MATCH']
const buckets = Object.fromEntries(BUCKETS.map(k => [k, []]))
for (const r of rows) buckets[r.composite]?.push(r) || buckets.NO_MATCH.push(r)

const total = rows.length
const counters = {
  total,
  confirmed_logos:    rows.filter(r => r.bulbaMatch.logoClassification === 'CONFIRMED_AUTOMATIC' || r.tcgdexMatch.classification === 'CONFIRMED_AUTOMATIC').length,
  confirmed_symbols:  rows.filter(r => r.bulbaMatch.symbolClassification === 'CONFIRMED_AUTOMATIC').length,
  probable:           rows.filter(r => r.composite === 'PROBABLE_REVIEW').length,
  ambiguous:          rows.filter(r => r.composite === 'AMBIGUOUS').length,
  wrong_asset_type:   rows.filter(r => r.composite === 'WRONG_ASSET_TYPE').length,
  fallback_only:      rows.filter(r => r.composite === 'FALLBACK_ONLY').length,
  no_match:           rows.filter(r => r.composite === 'NO_MATCH').length,
  english_rejected:   bulbaFiles.filter(f => f.is_english_market_likely).length,
  duplicate_assets:   detectDuplicates(rows),
}
console.log('[jp-review] counters:', JSON.stringify(counters))

function detectDuplicates(rows) {
  const urlToSets = new Map()
  for (const r of rows) {
    for (const url of [r.bulbaMatch.logoBest?.file?.source_url, r.bulbaMatch.symbolBest?.file?.source_url, r.tcgdexMatch.best?.candidate?.logoUrl].filter(Boolean)) {
      const arr = urlToSets.get(url) || []
      arr.push(r.pp.set_name)
      urlToSets.set(url, arr)
    }
  }
  let dups = 0
  for (const [, sets] of urlToSets) if (sets.length > 1) dups++
  return dups
}

// ── HTML report ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))

function renderRow({ pp, flags, tcgdexMatch, bulbaMatch, composite }) {
  const tcg = tcgdexMatch.best?.candidate
  const bLogo = bulbaMatch.logoBest?.file
  const bSym  = bulbaMatch.symbolBest?.file
  const cur = pp.set_image_url ? `<img src="${esc(pp.set_image_url)}" loading="lazy">` : '<span class=muted>—</span>'
  const tcgImg = tcg?.logoUrl ? `<img src="${esc(tcg.logoUrl)}" loading="lazy" title="TCGdex">` : '<span class=muted>—</span>'
  const bLogoImg = bLogo?.thumb_url || bLogo?.source_url ? `<img src="${esc(bLogo.thumb_url || bLogo.source_url)}" loading="lazy" title="Bulbagarden logo">` : '<span class=muted>—</span>'
  const bSymImg  = bSym?.thumb_url  || bSym?.source_url  ? `<img class=sym src="${esc(bSym.thumb_url  || bSym.source_url)}" loading="lazy" title="Bulbagarden symbol">` : '<span class=muted>—</span>'
  const flagChips = flags.map(f => `<span class="flag">${esc(f)}</span>`).join('')
  const warnings = [
    ...(tcgdexMatch.warnings ?? []),
    ...(tcgdexMatch.best?.warnings ?? []),
    ...(bulbaMatch.logoBest?.warnings ?? []),
    ...(bulbaMatch.symbolBest?.warnings ?? []),
  ].filter(Boolean).map(esc).join('<br>')

  const reasons = [
    ...(tcgdexMatch.best?.reasons ?? []).map(r => `[tcgdex] ${r}`),
    ...(bulbaMatch.logoBest?.reasons ?? []).map(r => `[bulba/logo] ${r}`),
    ...(bulbaMatch.symbolBest?.reasons ?? []).map(r => `[bulba/sym] ${r}`),
  ].map(esc).join('<br>')

  const srcLinks = []
  if (tcg) srcLinks.push(`<a href="https://tcgdex.dev/en/set/${esc(tcg.id)}" target="_blank">tcgdex/${esc(tcg.id)}</a>`)
  if (bLogo?.description_page_url) srcLinks.push(`<a href="${esc(bLogo.description_page_url)}" target="_blank">bulba/${esc(bLogo.archive_title.replace(/^File:/, ''))}</a>`)
  if (bSym?.description_page_url)  srcLinks.push(`<a href="${esc(bSym.description_page_url)}"  target="_blank">bulba-sym</a>`)

  return `<tr>
    <td class="name">
      <div class="internal">${esc(pp.set_name)}</div>
      <div class="visible">${esc(pp.set_name.replace(/^Japanese\\s+/, ''))}</div>
      <div class="meta">${esc(pp.set_release_date || '—')} · ${pp.card_count ?? '—'} cards</div>
      ${flagChips}
    </td>
    <td>${cur}</td>
    <td>${tcgImg}</td>
    <td>${bLogoImg}</td>
    <td>${bSymImg}</td>
    <td class="source">${srcLinks.join('<br>') || '<span class=muted>—</span>'}</td>
    <td class="score">
      <div>bulba/logo: <b>${bulbaMatch.logoClassification}</b> ${bulbaMatch.logoBest?.score ?? ''}</div>
      <div>bulba/sym : <b>${bulbaMatch.symbolClassification}</b> ${bulbaMatch.symbolBest?.score ?? ''}</div>
      <div>tcgdex    : <b>${tcgdexMatch.classification}</b> ${tcgdexMatch.best?.score ?? ''}</div>
    </td>
    <td class="reasons">${reasons}</td>
    <td class="warnings">${warnings || '<span class=muted>—</span>'}</td>
  </tr>`
}

function renderBucket(label, rows) {
  if (rows.length === 0) return ''
  return `<section>
    <h2>${esc(label)} <span class="count">${rows.length}</span></h2>
    <table><thead><tr>
      <th>Set</th><th>Current</th><th>TCGdex</th><th>Bulba logo</th><th>Bulba symbol</th>
      <th>Source</th><th>Classification</th><th>Reasons</th><th>Warnings</th>
    </tr></thead><tbody>${rows.map(renderRow).join('')}</tbody></table>
  </section>`
}

const html = `<!doctype html><html><head><meta charset=utf-8><title>JP set-assets review</title>
<style>
  body { font: 13px/1.4 -apple-system, sans-serif; margin: 24px; color: #111 }
  h1 { margin: 0 0 4px }
  .lead { color: #555 }
  .counters { display: flex; gap: 14px; flex-wrap: wrap; margin: 16px 0 24px; padding: 12px; background: #f8f9fb; border-radius: 8px }
  .counter { padding: 6px 12px; background: #fff; border-radius: 6px; border: 1px solid #e2e5eb }
  .counter b { font-size: 18px; display: block }
  section { margin: 24px 0 }
  h2 { border-bottom: 2px solid #ddd; padding-bottom: 4px }
  .count { background: #eee; border-radius: 10px; padding: 2px 8px; font-size: 12px; margin-left: 8px }
  table { border-collapse: collapse; width: 100% }
  th, td { border-bottom: 1px solid #eee; padding: 8px; vertical-align: top; text-align: left }
  th { background: #fafafa; position: sticky; top: 0; z-index: 1 }
  td.name .internal { font-weight: 600 }
  td.name .visible { color: #555; font-size: 12px }
  td.name .meta { color: #888; font-size: 11px; margin-top: 4px }
  img { max-width: 120px; max-height: 70px; object-fit: contain; background: repeating-conic-gradient(#f8f8f8 0 25%, #fff 0 50%) 0/12px 12px; border-radius: 3px }
  img.sym { max-width: 44px; max-height: 44px }
  .flag { display: inline-block; margin: 4px 4px 0 0; padding: 1px 6px; border-radius: 8px; background: #fef3c7; color: #92400e; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px }
  .muted { color: #999 }
  .reasons, .warnings, .score { font-size: 11px; max-width: 280px }
  .score b { color: #3730a3 }
</style></head><body>
<h1>Japanese set-assets review</h1>
<p class="lead">Generated ${esc(new Date().toISOString())} · sources: TCGdex + Bulbagarden Archives</p>
<div class="counters">
  <div class="counter"><b>${counters.total}</b>JP sets</div>
  <div class="counter"><b>${counters.confirmed_logos}</b>confirmed logos</div>
  <div class="counter"><b>${counters.confirmed_symbols}</b>confirmed symbols</div>
  <div class="counter"><b>${counters.probable}</b>probable</div>
  <div class="counter"><b>${counters.ambiguous}</b>ambiguous</div>
  <div class="counter"><b>${counters.wrong_asset_type}</b>wrong asset type</div>
  <div class="counter"><b>${counters.fallback_only}</b>fallback-only</div>
  <div class="counter"><b>${counters.no_match}</b>no match</div>
  <div class="counter"><b>${counters.english_rejected}</b>English-market files rejected</div>
  <div class="counter"><b>${counters.duplicate_assets}</b>duplicate URLs across sets</div>
</div>
${renderBucket('Confirmed automatic',      buckets.CONFIRMED_AUTOMATIC)}
${renderBucket('Probable — needs review',  buckets.PROBABLE_REVIEW)}
${renderBucket('Ambiguous',                buckets.AMBIGUOUS)}
${renderBucket('Symbol only (no logo)',    buckets.SYMBOL_ONLY)}
${renderBucket('Wrong asset type (packs / cards / banners)', buckets.WRONG_ASSET_TYPE)}
${renderBucket("Fallback-source only (McDonald's / Carddass / vending / decks)", buckets.FALLBACK_ONLY)}
${renderBucket('No match',                 buckets.NO_MATCH)}
</body></html>`

await mkdir(dirname(HTML_OUT), { recursive: true })
await writeFile(HTML_OUT, html, 'utf8')
console.log(`[jp-review] wrote report -> ${HTML_OUT}`)

// ── Dry-run manifest ──
const manifest = rows.map(r => {
  const bLogo = r.bulbaMatch.logoBest?.file
  const bSym  = r.bulbaMatch.symbolBest?.file
  const tcg   = r.tcgdexMatch.best?.candidate
  return {
    internalSetName:    r.pp.set_name,
    visibleSetName:     r.pp.set_name.replace(/^Japanese\s+/, ''),
    logoCandidateUrl:   bLogo?.source_url ?? tcg?.logoUrl ?? null,
    symbolCandidateUrl: bSym?.source_url ?? tcg?.symbolUrl ?? null,
    logoSourcePage:     bLogo?.description_page_url ?? null,
    symbolSourcePage:   bSym?.description_page_url ?? null,
    sourceType:         bLogo ? 'bulbagarden' : (tcg ? 'tcgdex' : 'none'),
    confidence:         r.composite === 'CONFIRMED_AUTOMATIC' ? 'confirmed'
                        : r.composite === 'PROBABLE_REVIEW'   ? 'probable'
                        : r.composite === 'AMBIGUOUS'          ? 'ambiguous'
                        : 'none',
    approved:           false,
    warnings:           [
      ...(r.tcgdexMatch.warnings ?? []),
      ...(r.bulbaMatch.logoBest?.warnings ?? []),
      ...(r.bulbaMatch.symbolBest?.warnings ?? []),
    ],
    contentHash:        null,
    flags:              r.flags,
    composite_classification: r.composite,
  }
})

await mkdir(dirname(MANIFEST_OUT), { recursive: true })
await writeFile(MANIFEST_OUT, JSON.stringify({ generated_at: new Date().toISOString(), count: manifest.length, entries: manifest }, null, 2), 'utf8')
console.log(`[jp-review] wrote manifest -> ${MANIFEST_OUT}`)
console.log(`[jp-review] every manifest entry defaults to approved:false`)
