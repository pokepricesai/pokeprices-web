// Block 5A-W-50G-B — file-content assertions on the generated JP
// review manifest. Skipped when the artifact is missing (i.e. the
// script has not been run in this environment) so CI stays green
// without the network fetches.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MANIFEST_PATH = join(process.cwd(), 'reports', 'jp-set-assets-manifest.json')
const REPORT_PATH   = join(process.cwd(), 'reports', 'jp-set-assets-review.html')

const manifestExists = existsSync(MANIFEST_PATH)
const reportExists   = existsSync(REPORT_PATH)

describe.skipIf(!manifestExists)('jp-set-assets-manifest.json — Block 5A-W-50G-B invariants', () => {
  const parsed = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  const entries = parsed.entries as Array<Record<string, unknown>>

  it('contains all 127 unique Japanese sets', () => {
    expect(entries.length).toBe(127)
    const uniq = new Set(entries.map(e => e.internalSetName))
    expect(uniq.size).toBe(127)
  })

  it('includes the previously-missing "Japanese Old Maid"', () => {
    expect(entries.some(e => e.internalSetName === 'Japanese Old Maid')).toBe(true)
  })

  it('every entry preserves the internal `Japanese ` prefix on internalSetName', () => {
    for (const e of entries) {
      expect(String(e.internalSetName).startsWith('Japanese ')).toBe(true)
    }
  })

  it('every entry defaults to approved:false', () => {
    for (const e of entries) expect(e.approved).toBe(false)
  })

  it('no English set is included', () => {
    // language filter in the generator is language=jp; assert the
    // manifest never contains a bare English set name.
    for (const e of entries) {
      expect(String(e.internalSetName)).toMatch(/^Japanese /)
    }
  })

  it('every entry carries the required shape', () => {
    const keys = ['internalSetName','visibleSetName','logoCandidateUrl','symbolCandidateUrl','logoSourcePage','symbolSourcePage','sourceType','confidence','approved','warnings','contentHash']
    for (const e of entries) {
      for (const k of keys) expect(k in e, `${k} missing on ${e.internalSetName}`).toBe(true)
    }
  })

  it('sourceType is bulbagarden / tcgdex / none', () => {
    for (const e of entries) expect(['bulbagarden','tcgdex','none']).toContain(e.sourceType)
  })

  it('confidence is one of the allowed enum values', () => {
    for (const e of entries) expect(['confirmed','probable','ambiguous','none']).toContain(e.confidence)
  })
})

describe.skipIf(!reportExists)('jp-set-assets-review.html — Block 5A-W-50G-B invariants', () => {
  const html = readFileSync(REPORT_PATH, 'utf8')

  it('renders all 127 sets', () => {
    // Every set row emits one <tr> containing a class="name" td. Count
    // those cells — 127 expected.
    const rowCount = (html.match(/<td class="name">/g) || []).length
    expect(rowCount).toBe(127)
  })

  it('has counter tiles for confirmed logos / symbols / probable / ambiguous / no_match / english_rejected / duplicates', () => {
    for (const label of ['confirmed logos','confirmed symbols','probable','ambiguous','no match','English-market files rejected','duplicate URLs across sets']) {
      expect(html.toLowerCase()).toContain(label.toLowerCase())
    }
  })

  it('does not silently render "sv08a"-style TCGdex probes as approved matches', () => {
    // Sanity: the composite classification never fabricates a
    // "confirmed" without a valid source. If a row is confirmed, its
    // manifest counterpart has a non-empty logoCandidateUrl.
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    for (const e of manifest.entries) {
      if (e.confidence === 'confirmed') {
        expect(e.logoCandidateUrl || e.symbolCandidateUrl).toBeTruthy()
      }
    }
  })
})

describe('Block 5A-W-50G-B — script placement invariants', () => {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = require('node:path') as typeof import('node:path')

  it('all block scripts live under scripts/set-assets/', () => {
    const dir = path.join(process.cwd(), 'scripts', 'set-assets')
    const files = fs.readdirSync(dir).sort()
    for (const expected of [
      'jp-tcgdex-fetch.mjs',
      'jp-bulbagarden-fetch.mjs',
      'jp-review-report.mjs',
      'jp-import.mjs',
      'jp-manifest-scaffold.mjs',
    ]) {
      expect(files, `${expected} missing from scripts/set-assets/`).toContain(expected)
    }
  })

  it('no production upload code lives in the scripts (import.mjs is dry-run by default)', () => {
    const importSrc = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'set-assets', 'jp-import.mjs'), 'utf8',
    )
    // The script must not silently write; --write is required.
    expect(importSrc).toMatch(/const WRITE\s*=\s*has\('--write'\)/)
    expect(importSrc).toMatch(/if \(!WRITE\)[\s\S]{0,200}DRY-RUN complete/)
  })

  it('no application source imports from scripts/set-assets/ or from reports/', () => {
    // These artifacts must never leak into the deployed bundle.
    const src = path.join(process.cwd(), 'src')
    const bad: string[] = []
    function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name === 'node_modules') continue; walk(full); continue }
        if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue
        const t = fs.readFileSync(full, 'utf8')
        if (/from ['"]\.\.?\/.*scripts\/set-assets/.test(t) || /from ['"]\.\.?\/.*reports\//.test(t)) bad.push(full)
      }
    }
    walk(src)
    expect(bad).toEqual([])
  })
})
