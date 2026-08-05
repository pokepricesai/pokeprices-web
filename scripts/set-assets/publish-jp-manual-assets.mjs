#!/usr/bin/env node
// scripts/set-assets/publish-jp-manual-assets.mjs
//
// Publish every logo/symbol pair from manual-assets/jp/inbox/<key>/
// into the flat public/set-assets/{logos,symbols}/ directories, using
// the exact DB set_name as the filename. Prints the LOGO_MAP and
// SYMBOL_MAP entries to paste into src/lib/setAssets.ts.
//
// Fallback rules:
//   * Both files present    → publish both.
//   * Only symbol present   → publish symbol; also copy symbol to
//                             logos/ with the same set_name so the
//                             set page has a visible mark.
//   * Only logo present     → publish logo; no symbol entry (existing
//                             fallback stays).
//   * Nothing               → no output for the set.
//
// No source files are deleted. No conversions performed.

import { readFileSync, readdirSync, existsSync, statSync, copyFileSync } from 'node:fs'
import { extname, join, basename } from 'node:path'

const ROOT = 'C:/Users/lukep/OneDrive/Desktop/pokeprices-web'
const INBOX = join(ROOT, 'manual-assets/jp/inbox')
const LOGOS_DIR = join(ROOT, 'public/set-assets/logos')
const SYMBOLS_DIR = join(ROOT, 'public/set-assets/symbols')
const INDEX_PATH = join(ROOT, 'manual-assets/jp/asset-index.json')

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'))
const byKey = new Map(index.entries.map(e => [e.asset_key, e]))

const folders = readdirSync(INBOX, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()

const logoEntries = []   // { set_name, filename }
const symbolEntries = [] // { set_name, filename }
const symbolAsLogo = []  // sets using symbol as logo fallback
const emptyFolders = []  // no assets supplied
const missingIndex = []  // folder exists but no asset-index entry

for (const key of folders) {
  const entry = byKey.get(key)
  if (!entry) { missingIndex.push(key); continue }
  const setName = entry.set_name
  const folderPath = join(INBOX, key)
  const files = readdirSync(folderPath).filter(f => statSync(join(folderPath, f)).isFile())

  const findFile = (base) => {
    for (const f of files) {
      const nm = basename(f, extname(f)).toLowerCase()
      if (nm === base) return f
    }
    return null
  }
  const logoFile = findFile('logo')
  const symbolFile = findFile('symbol')

  if (!logoFile && !symbolFile) { emptyFolders.push({ key, setName }); continue }

  if (logoFile) {
    const ext = extname(logoFile) // .png / .webp
    const dest = `${setName}${ext}`
    copyFileSync(join(folderPath, logoFile), join(LOGOS_DIR, dest))
    logoEntries.push({ set_name: setName, filename: dest })
  } else if (symbolFile) {
    // Fallback: symbol only — use it as logo too
    const ext = extname(symbolFile)
    const dest = `${setName}${ext}`
    copyFileSync(join(folderPath, symbolFile), join(LOGOS_DIR, dest))
    logoEntries.push({ set_name: setName, filename: dest })
    symbolAsLogo.push({ key, setName })
  }

  if (symbolFile) {
    const ext = extname(symbolFile)
    const dest = `${setName}${ext}`
    copyFileSync(join(folderPath, symbolFile), join(SYMBOLS_DIR, dest))
    symbolEntries.push({ set_name: setName, filename: dest })
  }
}

// Emit LOGO_MAP and SYMBOL_MAP fragments for src/lib/setAssets.ts
console.log('=== LOGO_MAP entries ===')
for (const e of logoEntries) console.log(`  '${e.set_name.replace(/'/g, "\\'")}': '${e.filename.replace(/'/g, "\\'")}',`)
console.log('\n=== SYMBOL_MAP entries ===')
for (const e of symbolEntries) console.log(`  '${e.set_name.replace(/'/g, "\\'")}': '${e.filename.replace(/'/g, "\\'")}',`)

console.log('\n=== Summary ===')
console.log(`  Folders processed:               ${folders.length}`)
console.log(`  Logos published:                 ${logoEntries.length}`)
console.log(`  Symbols published:               ${symbolEntries.length}`)
console.log(`  Symbol used as logo fallback:    ${symbolAsLogo.length}`)
console.log(`  Empty folders (no fallback):     ${emptyFolders.length}`)
console.log(`  Folders missing index entry:     ${missingIndex.length}`)
if (symbolAsLogo.length > 0) {
  console.log('\nSymbol-as-logo sets:')
  for (const s of symbolAsLogo) console.log(`  - ${s.setName}`)
}
if (missingIndex.length > 0) {
  console.log('\nFolders without index entry (skipped):')
  for (const k of missingIndex) console.log(`  - ${k}`)
}
