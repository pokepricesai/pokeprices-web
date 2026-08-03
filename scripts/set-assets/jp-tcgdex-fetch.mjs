#!/usr/bin/env node
// scripts/set-assets/jp-tcgdex-fetch.mjs
//
// Block 5A-W-50G — fetches every Japanese-market set from TCGdex and
// writes the result to reports/jp-tcgdex-fetch.json. Zero side
// effects on the DB, on Supabase Storage, or on the app. Safe to run
// repeatedly.
//
// TCGdex uses the `ja` locale (NOT `jp`) — see block memo.
//
// Usage:
//   node scripts/set-assets/jp-tcgdex-fetch.mjs
//   node scripts/set-assets/jp-tcgdex-fetch.mjs --out reports/custom.json
//   node scripts/set-assets/jp-tcgdex-fetch.mjs --limit 5    (smoke test)
//
// Output shape:
//   {
//     fetched_at: "<ISO>",
//     count: <n>,
//     sets: [
//       {
//         id, name_ja, name_en, releaseDate,
//         cardCountTotal, cardCountOfficial,
//         logoUrl, symbolUrl, serie,
//       },
//       ...
//     ]
//   }

import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const argv = process.argv.slice(2)
const outFlag   = argv.indexOf('--out')
const outPath   = outFlag !== -1 ? argv[outFlag + 1] : 'reports/jp-tcgdex-fetch.json'
const limitFlag = argv.indexOf('--limit')
const limit     = limitFlag !== -1 ? Number(argv[limitFlag + 1]) : Infinity

const BASE = 'https://api.tcgdex.net/v2'

function pickLogoUrl(setDetail) {
  // TCGdex returns a `logo` string (path without extension) — append
  // .webp per their API doc. Some legacy sets have no logo at all.
  const p = setDetail?.logo
  if (!p) return null
  return p.endsWith('.webp') ? p : `${p}.webp`
}

function pickSymbolUrl(setDetail) {
  const p = setDetail?.symbol
  if (!p) return null
  return p.endsWith('.webp') ? p : `${p}.webp`
}

async function fetchJson(url) {
  const r = await fetch(url, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'pokeprices-web/set-assets-audit' },
  })
  if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}`)
  return r.json()
}

async function main() {
  console.log(`[jp-tcgdex-fetch] GET ${BASE}/ja/sets`)
  const summary = await fetchJson(`${BASE}/ja/sets`)
  const targets = Array.isArray(summary) ? summary.slice(0, limit) : []
  console.log(`[jp-tcgdex-fetch] discovered ${summary?.length ?? 0} JP-locale sets (fetching ${targets.length})`)

  const out = []
  let done = 0
  for (const s of targets) {
    // Detail fetches for both locales so the matching engine can
    // compare against either localised name.
    let detailJa = null
    let detailEn = null
    try { detailJa = await fetchJson(`${BASE}/ja/sets/${encodeURIComponent(s.id)}`) } catch (e) { console.warn(`  [ja/${s.id}] ${e.message}`) }
    try { detailEn = await fetchJson(`${BASE}/en/sets/${encodeURIComponent(s.id)}`) } catch { /* not every JP set has an EN entry */ }

    out.push({
      id:                s.id,
      name_ja:           detailJa?.name ?? s.name ?? null,
      name_en:           detailEn?.name ?? null,
      releaseDate:       detailJa?.releaseDate ?? detailEn?.releaseDate ?? null,
      cardCountTotal:    detailJa?.cardCount?.total    ?? detailEn?.cardCount?.total    ?? null,
      cardCountOfficial: detailJa?.cardCount?.official ?? detailEn?.cardCount?.official ?? null,
      logoUrl:           pickLogoUrl(detailJa) ?? pickLogoUrl(detailEn),
      symbolUrl:         pickSymbolUrl(detailJa) ?? pickSymbolUrl(detailEn),
      serie:             detailJa?.serie?.name ?? detailEn?.serie?.name ?? null,
    })

    done += 1
    if (done % 25 === 0) console.log(`[jp-tcgdex-fetch] ${done}/${targets.length}`)
  }

  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify({
    fetched_at: new Date().toISOString(),
    count:      out.length,
    sets:       out,
  }, null, 2), 'utf8')

  console.log(`[jp-tcgdex-fetch] wrote ${out.length} sets → ${outPath}`)
  console.log(`[jp-tcgdex-fetch] with-logo: ${out.filter(s => s.logoUrl).length}`)
  console.log(`[jp-tcgdex-fetch] with-symbol: ${out.filter(s => s.symbolUrl).length}`)
}

main().catch(err => { console.error(err); process.exit(1) })
