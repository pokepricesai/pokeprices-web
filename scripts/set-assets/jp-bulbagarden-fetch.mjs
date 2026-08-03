#!/usr/bin/env node
// scripts/set-assets/jp-bulbagarden-fetch.mjs
//
// Block 5A-W-50G-B — Bulbapedia + Bulbagarden Archives asset
// discovery for Japanese Pokemon TCG expansions.
//
// Strategy (v3):
//   1. Enumerate ALL pages in Category:Pokémon Trading Card Game
//      expansions on Bulbapedia (the master expansion category —
//      contains hundreds of pages, mix of English + Japanese).
//   2. For each page, use prop=pageimages to get the lead image
//      (typically an infobox logo / pack shot).
//   3. Also probe Category:Japanese TCG set symbols on Archives
//      directly (v1 route) to catch symbol assets not attached to a
//      page image.
//   4. Fetch imageinfo + categories for every unique File: found.
//   5. Classify + apply English-market rejection filters.
//
// Read-only. Records URLs and metadata only. No image bytes
// downloaded. 400 ms courtesy delay between requests. Descriptive
// User-Agent per MediaWiki policy.
//
// Usage:
//   node scripts/set-assets/jp-bulbagarden-fetch.mjs
//   node scripts/set-assets/jp-bulbagarden-fetch.mjs --limit 40  (smoke)
//   node scripts/set-assets/jp-bulbagarden-fetch.mjs --out reports/x.json

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const PEDIA    = 'https://bulbapedia.bulbagarden.net/w/api.php'
const ARCHIVES = 'https://archives.bulbagarden.net/w/api.php'
const UA = 'PokePrices/1.0 (https://www.pokeprices.io; contact: hello@pokeprices.io) MediaWiki-crawler for set-asset audit'
const DELAY_MS = 400

const argv = process.argv.slice(2)
const arg = (name, def = null) => { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : def }
const OUT_PATH = arg('--out', 'reports/jp-bulbagarden-fetch.json')
const LIMIT    = arg('--limit', null) ? Number(arg('--limit')) : Infinity

const MASTER_CATEGORY = 'Category:Pokémon Trading Card Game expansions'
const ARCHIVES_ASSET_CATEGORIES = [
  'Category:Japanese TCG set symbols',
  'Category:Japanese TCG set logos',
]

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function api(base, params) {
  const url = new URL(base)
  for (const [k, v] of Object.entries({ format: 'json', formatversion: 2, ...params })) {
    url.searchParams.set(k, String(v))
  }
  const r = await fetch(url.toString(), { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
  if (!r.ok) throw new Error(`GET ${url} -> HTTP ${r.status}`)
  await sleep(DELAY_MS)
  return r.json()
}

async function fetchCategoryMembers(base, cat, cmtype) {
  const out = []
  let cont = null, iter = 0
  do {
    const params = { action: 'query', list: 'categorymembers', cmtitle: cat, cmtype, cmlimit: 500 }
    if (cont) params.cmcontinue = cont
    let res
    try { res = await api(base, params) }
    catch (e) { return { members: out, error: e.message } }
    for (const m of res?.query?.categorymembers ?? []) out.push(m.title)
    cont = res?.continue?.cmcontinue ?? null
    if (++iter > 20) break
  } while (cont)
  return { members: out }
}

async function fetchPageImages(base, pageTitles) {
  // pageimages returns the lead / infobox image per page.
  const CHUNK = 30
  const map = new Map()
  for (let i = 0; i < pageTitles.length; i += CHUNK) {
    const chunk = pageTitles.slice(i, i + CHUNK)
    let res
    try {
      res = await api(base, {
        action: 'query',
        titles: chunk.join('|'),
        prop:   'pageimages|categories',
        piprop: 'name|original',
        cllimit: 500,
      })
    } catch (e) { console.warn(`  [pageimages chunk ${i}] ${e.message}`); continue }
    for (const p of res?.query?.pages ?? []) {
      if (p.missing) continue
      map.set(p.title, {
        pageimage:      p.pageimage ?? null,
        pageimageOrig:  p.original?.source ?? null,
        pageCategories: (p.categories ?? []).map(c => c.title),
      })
    }
  }
  return map
}

async function fetchImageInfo(fileTitles) {
  const CHUNK = 50
  const out = []
  for (let i = 0; i < fileTitles.length; i += CHUNK) {
    const chunk = fileTitles.slice(i, i + CHUNK)
    let res
    try {
      res = await api(ARCHIVES, {
        action: 'query',
        titles: chunk.join('|'),
        prop:   'imageinfo|categories',
        iiprop: 'url|mime|size|thumbmime|thumburl',
        iiurlwidth: 320,
        cllimit: 500,
      })
    } catch (e) { console.warn(`  [imageinfo chunk ${i}] ${e.message}`); continue }
    for (const p of res?.query?.pages ?? []) {
      if (p.missing) continue
      const info = p.imageinfo?.[0]
      if (!info) continue
      out.push({
        archive_title:        p.title,
        source_url:           info.url,
        thumb_url:            info.thumburl ?? null,
        mime:                 info.mime ?? null,
        width:                info.width ?? null,
        height:               info.height ?? null,
        description_page_url: info.descriptionurl ?? null,
        categories:           (p.categories ?? []).map(c => c.title),
      })
    }
  }
  return out
}

// ── Classification + rejection ──

function classifyAsset(f, hostPageTitle) {
  const t = f.archive_title.toLowerCase()
  const cats = f.categories.map(c => c.toLowerCase())
  // Rejection filters first (block Part 3 / Part 6).
  if (/(boosterpack|booster pack|booster box)/.test(t)) return 'pack'
  if (/\bpack\.(png|jpg|jpeg|webp|svg)$/.test(t))       return 'pack'
  if (/\bbox\.(png|jpg|jpeg|webp|svg)$/.test(t))         return 'pack'
  if (/\bcard\b/.test(t) && /\.(jpg|jpeg|png)$/i.test(t)) return 'card'
  if (t.includes('banner') || t.includes('poster'))       return 'banner'
  // Positive signals.
  const inSymbolCat = cats.some(c => c.includes('symbol'))
  const inLogoCat   = cats.some(c => c.includes('logo'))
  if (inSymbolCat && !inLogoCat) return 'symbol'
  if (inLogoCat) return 'logo'
  if (t.includes('setsymbol')) return 'symbol'
  if (t.includes('setlogo'))   return 'logo'
  if (t.includes('symbol')) return 'symbol'
  if (t.includes('logo'))   return 'logo'
  return 'unknown'
}

function isEnglishMarketLikely(f) {
  const cats = f.categories.map(c => c.toLowerCase())
  const t = f.archive_title.toLowerCase()
  // Explicit "_EN" or "-EN" suffix on file name (e.g. Neo_Genesis_Logo_EN.png).
  if (/[_\- ]en\.(png|jpg|jpeg|webp|svg)$/i.test(t)) return true
  const jp = cats.some(c => c.includes('japanese'))
             || t.includes('japanese')
             || /[一-龠ぁ-んァ-ヶ]/.test(t)
             || /[_\- ]jp\.(png|jpg|jpeg|webp|svg)$/i.test(t)
  const en = cats.some(c => /(english|international)/.test(c))
  return en && !jp
}

// ── Main ─────────────────────────────────────────────────

console.log('[jp-bulbagarden-fetch] Phase 1: enumerate master expansion category on Bulbapedia')
const { members: expansionPages, error: catErr } = await fetchCategoryMembers(PEDIA, MASTER_CATEGORY, 'page')
console.log(`  ${MASTER_CATEGORY.padEnd(60)} ${expansionPages.length} pages${catErr ? ' (ERROR: ' + catErr + ')' : ''}`)

const scoped = expansionPages.slice(0, LIMIT)
console.log(`\n[jp-bulbagarden-fetch] Phase 2: pageimages for ${scoped.length} expansion pages`)
const pageImageMap = await fetchPageImages(PEDIA, scoped)

const fileTitleToPages = new Map()
for (const [page, info] of pageImageMap.entries()) {
  if (info.pageimage) {
    const t = `File:${info.pageimage}`
    if (!fileTitleToPages.has(t)) fileTitleToPages.set(t, [])
    fileTitleToPages.get(t).push(page)
  }
}
console.log(`  found lead images for ${fileTitleToPages.size} of ${scoped.length} pages`)

// Phase 3: Archives asset categories (v1 route — small but genuine JP)
console.log(`\n[jp-bulbagarden-fetch] Phase 3: Archives JP asset categories (files only)`)
const catStats = []
for (const cat of ARCHIVES_ASSET_CATEGORIES) {
  const { members, error } = await fetchCategoryMembers(ARCHIVES, cat, 'file')
  catStats.push({ category: cat, count: members.length, error: error ?? null })
  console.log(`  ${cat.padEnd(46)} ${members.length} files${error ? ' (ERROR: ' + error + ')' : ''}`)
  for (const f of members) {
    if (!fileTitleToPages.has(f)) fileTitleToPages.set(f, [])
  }
}

const fileTitles = [...fileTitleToPages.keys()]
console.log(`\n[jp-bulbagarden-fetch] Phase 4: imageinfo for ${fileTitles.length} unique files`)
const files = await fetchImageInfo(fileTitles)

const now = new Date().toISOString()
const enriched = files.map(f => {
  const linked = fileTitleToPages.get(f.archive_title) ?? []
  return {
    ...f,
    linked_pages:             linked,
    asset_type:               classifyAsset(f, linked[0] ?? null),
    is_english_market_likely: isEnglishMarketLikely(f),
    retrieved_at:             now,
  }
})

await mkdir(dirname(OUT_PATH), { recursive: true })
await writeFile(OUT_PATH, JSON.stringify({
  fetched_at:         now,
  master_category:    MASTER_CATEGORY,
  categories_probed:  catStats,
  expansion_pages:    scoped.length,
  file_count:         enriched.length,
  files:              enriched,
}, null, 2), 'utf8')

const summary = enriched.reduce((acc, f) => {
  acc[f.asset_type] = (acc[f.asset_type] ?? 0) + 1
  if (f.is_english_market_likely) acc._english_flagged = (acc._english_flagged ?? 0) + 1
  return acc
}, {})
console.log(`\n[jp-bulbagarden-fetch] wrote ${enriched.length} files -> ${OUT_PATH}`)
console.log(`[jp-bulbagarden-fetch] by asset_type: ${JSON.stringify(summary)}`)
console.log(`[jp-bulbagarden-fetch] expansion pages processed: ${scoped.length}`)
