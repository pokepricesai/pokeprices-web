// Block 5A-W-50H — file-content assertions on the manual-intake
// scaffold + audit script. All checks are static text inspection so
// the suite stays deterministic without hitting the DB, the network,
// or the file system beyond src/, scripts/, package.json,
// .gitignore, and (when they exist) the generated index files.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SCAFFOLD = readFileSync(
  join(process.cwd(), 'scripts', 'set-assets', 'jp-manual-scaffold.mjs'),
  'utf8',
)
const AUDIT = readFileSync(
  join(process.cwd(), 'scripts', 'set-assets', 'jp-manual-audit.mjs'),
  'utf8',
)
const README_PATH = join(process.cwd(), 'manual-assets', 'jp', 'README.md')
const INDEX_JSON_PATH = join(process.cwd(), 'manual-assets', 'jp', 'asset-index.json')
const PKG = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const GITIGNORE = readFileSync(join(process.cwd(), '.gitignore'), 'utf8')

// ── Scaffold script contract ──────────────────────────

describe('jp-manual-scaffold.mjs — scaffold contract', () => {
  it('sources the authoritative catalogue from set_metadata WHERE language=jp', () => {
    expect(SCAFFOLD).toMatch(/\.from\('set_metadata'\)[\s\S]{0,120}\.eq\('language',\s*'jp'\)/)
  })

  it('fails loudly when the count is not exactly 127', () => {
    expect(SCAFFOLD).toMatch(/jpSets\.length !== 127[\s\S]{0,300}process\.exit\(1\)/)
  })

  it('fails loudly when Japanese Old Maid is missing', () => {
    expect(SCAFFOLD).toMatch(/'Japanese Old Maid'[\s\S]{0,300}process\.exit\(1\)/)
  })

  it('fails loudly on asset-key collisions rather than picking arbitrarily', () => {
    expect(SCAFFOLD).toMatch(/detectKeyCollisions[\s\S]{0,600}process\.exit\(1\)/)
  })

  it('sorts entries deterministically by asset_key', () => {
    expect(SCAFFOLD).toMatch(/withKeys\.sort\(\(a, b\) => a\.asset_key\.localeCompare\(b\.asset_key\)\)/)
  })

  it('merges human-entered fields by asset_key + set_name (does not clobber existing entries)', () => {
    expect(SCAFFOLD).toContain('HUMAN_FIELDS')
    expect(SCAFFOLD).toMatch(/existingByKey\.get\(s\.asset_key\)\s*\?\?\s*existingBySetName\.get\(s\.set_name\)/)
  })

  it('every generated entry defaults approved:false and content hashes null', () => {
    expect(SCAFFOLD).toMatch(/approved:\s*prior\.approved === true \? true : false/)
    expect(SCAFFOLD).toMatch(/logo_content_hash:\s+prior\.logo_content_hash\s+\?\?\s+null/)
    expect(SCAFFOLD).toMatch(/symbol_content_hash:\s+prior\.symbol_content_hash\s+\?\?\s+null/)
  })

  it('preserves internal Japanese identity — set_name column is verbatim', () => {
    // The manifest keys off pi.set_name unchanged; visible_name is a
    // separate, derived field for display, computed from the same set_name.
    expect(SCAFFOLD).toMatch(/set_name:\s+s\.set_name/)
    expect(SCAFFOLD).toMatch(/visible_name:\s+stripJapanesePrefix\(set_name\)/)
  })

  it('emits both asset-index.csv and asset-index.json', () => {
    expect(SCAFFOLD).toContain('INDEX_JSON')
    expect(SCAFFOLD).toContain('INDEX_CSV')
    expect(SCAFFOLD).toContain('writeFile(INDEX_JSON')
    expect(SCAFFOLD).toContain('writeFile(INDEX_CSV')
  })

  it('creates one inbox folder per set (idempotent mkdir)', () => {
    expect(SCAFFOLD).toMatch(/for \(const e of entries\)[\s\S]{0,200}mkdir\(dir, \{ recursive: true \}\)/)
  })
})

// ── Audit script contract ─────────────────────────────

describe('jp-manual-audit.mjs — audit contract', () => {
  it('is read-only against Supabase (no createClient / no writes)', () => {
    expect(AUDIT).not.toMatch(/createClient\(/)
    expect(AUDIT).not.toMatch(/\.from\([^)]+\)\.(insert|update|upsert|delete)\(/)
    expect(AUDIT).not.toMatch(/\.storage\.from\(/)
  })

  it('has an explicit allowlist of extensions', () => {
    expect(AUDIT).toMatch(/ALLOWED_EXT\s*=\s*\[\s*'\.png',\s*'\.webp',\s*'\.svg',\s*'\.jpg',\s*'\.jpeg'\s*\]/)
  })

  it('recognises exactly the two case-sensitive basenames "logo" and "symbol"', () => {
    expect(AUDIT).toMatch(/BASE_LOGO\s*=\s*'logo'/)
    expect(AUDIT).toMatch(/BASE_SYMBOL\s*=\s*'symbol'/)
    expect(AUDIT).toMatch(/basename must be exactly "logo" or "symbol" \(case sensitive\)/)
  })

  it('rejects multiple candidates for either type', () => {
    expect(AUDIT).toMatch(/multiple logo candidates/)
    expect(AUDIT).toMatch(/multiple symbol candidates/)
  })

  it('rejects extension/MIME mismatch', () => {
    expect(AUDIT).toMatch(/extension \$\{ext\} does not match detected MIME/)
  })

  it('rejects empty files', () => {
    expect(AUDIT).toMatch(/is empty/)
  })

  it('warns on JPEG (no transparency)', () => {
    expect(AUDIT).toMatch(/JPEG has no transparency/)
  })

  it('parses SVG safely — flags scripts, event handlers, external hrefs, entities', () => {
    expect(AUDIT).toMatch(/svg-contains-script-element/)
    expect(AUDIT).toMatch(/svg-contains-inline-event-handler/)
    expect(AUDIT).toMatch(/svg-external-reference/)
    expect(AUDIT).toMatch(/svg-contains-doctype-entity/)
  })

  it('computes SHA-256 per file', () => {
    expect(AUDIT).toMatch(/createHash\('sha256'\)/)
  })

  it('cross-set duplicate hash detection only fires when sets differ', () => {
    expect(AUDIT).toMatch(/if \(sets\.size < 2\) continue/)
  })

  it('paired-expansion duplicate is flagged with a specific marker', () => {
    expect(AUDIT).toMatch(/paired_expansion_only/)
  })

  it('leaves approved:false — never mutates the index', () => {
    // Audit only READS the index. It must not write it back.
    expect(AUDIT).not.toMatch(/writeFile\([^,]*asset-index/)
    expect(AUDIT).toMatch(/every discovered asset remains approved:false/)
  })
})

// ── Package.json + .gitignore + no live UI change ────

describe('package.json + .gitignore invariants', () => {
  it('adds scaffold:jp-manual-assets and audit:jp-manual-assets scripts', () => {
    expect(PKG.scripts['scaffold:jp-manual-assets']).toContain('jp-manual-scaffold.mjs')
    expect(PKG.scripts['audit:jp-manual-assets']).toContain('jp-manual-audit.mjs')
  })

  it('git-ignores the manual asset inbox', () => {
    expect(GITIGNORE).toMatch(/^manual-assets\/jp\/inbox\/?$/m)
  })
})

describe('50H does NOT touch route / browse / set-header rendering', () => {
  const src = join(process.cwd(), 'src')

  it('the manual-intake scripts are not imported by any src/ file', () => {
    const bad: string[] = []
    function walk(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx|mjs|js)$/.test(e.name)) continue
        const t = readFileSync(full, 'utf8')
        if (/scripts\/set-assets\/jp-manual/.test(t)) bad.push(full)
        if (/manual-assets\/jp\//.test(t)) bad.push(full)
      }
    }
    walk(src)
    expect(bad).toEqual([])
  })

  it('setAssets.ts (browse + set-header + card-breadcrumb source) is unchanged by this block', () => {
    // Sanity: setAssets.ts still uses the static bundled LOGO_MAP —
    // no reference to manual-assets or set_metadata columns yet.
    const setAssetsSrc = readFileSync(join(src, 'lib', 'setAssets.ts'), 'utf8')
    expect(setAssetsSrc).not.toMatch(/manual-assets/)
    expect(setAssetsSrc).not.toMatch(/set_metadata\.(logo|symbol)/)
  })
})

// ── If the scaffold has been run, assert on its output ───
//
// These invariants only make sense once `npm run scaffold:jp-manual-assets`
// has produced asset-index.json. We evaluate the file lazily inside each
// test so the callback that registers them never throws when the file is
// absent (Vitest still executes the describe body even when skipIf is
// truthy — it just skips the individual its).

const scaffoldRan = existsSync(INDEX_JSON_PATH)
const readIndex = () => JSON.parse(readFileSync(INDEX_JSON_PATH, 'utf8')).entries as Array<Record<string, unknown>>

describe.skipIf(!scaffoldRan)('generated asset-index.json invariants (skipped if scaffold not yet run)', () => {
  it('contains exactly 127 unique Japanese sets', () => {
    const entries = readIndex()
    expect(entries.length).toBe(127)
    expect(new Set(entries.map(e => e.set_name)).size).toBe(127)
  })

  it('includes Japanese Old Maid', () => {
    expect(readIndex().some(e => e.set_name === 'Japanese Old Maid')).toBe(true)
  })

  it('every entry retains the Japanese identity in set_name', () => {
    for (const e of readIndex()) expect(String(e.set_name).startsWith('Japanese ')).toBe(true)
  })

  it('every asset_key is unique', () => {
    const keys = readIndex().map(e => e.asset_key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every entry defaults approved:false and hashes null (before user drops files)', () => {
    for (const e of readIndex()) {
      expect(e.approved).toBe(false)
      expect(e.logo_content_hash).toBeNull()
      expect(e.symbol_content_hash).toBeNull()
    }
  })

  it('sorted deterministically by asset_key ASC', () => {
    const keys = readIndex().map(e => e.asset_key as string)
    const sorted = [...keys].sort((a, b) => a.localeCompare(b))
    expect(keys).toEqual(sorted)
  })

  it('every relative_folder is inbox/<asset_key>', () => {
    for (const e of readIndex()) {
      expect(e.relative_folder).toBe(`inbox/${e.asset_key}`)
    }
  })

  it('has one on-disk folder per set under inbox/', () => {
    const inbox = join(process.cwd(), 'manual-assets', 'jp', 'inbox')
    if (!existsSync(inbox) || !statSync(inbox).isDirectory()) {
      throw new Error('inbox/ folder missing — did the scaffold complete?')
    }
    const folders = new Set(readdirSync(inbox, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name))
    for (const e of readIndex()) expect(folders.has(e.asset_key as string), `${e.asset_key} folder missing`).toBe(true)
  })
})

// ── README contract ──────────────────────────────────

describe.skipIf(!existsSync(README_PATH))('manual-assets/jp/README.md — reviewer guidance', () => {
  const md = readFileSync(README_PATH, 'utf8')

  it('documents the two package commands', () => {
    expect(md).toContain('scaffold:jp-manual-assets')
    expect(md).toContain('audit:jp-manual-assets')
  })

  it('warns against renaming file types (webp / svg pretending to be png)', () => {
    expect(md).toMatch(/never rename/i)
  })

  it('warns against booster packs, card scans, and English-market logos', () => {
    expect(md).toMatch(/booster/i)
    expect(md).toMatch(/card scans/i)
    expect(md).toMatch(/English-market/i)
  })

  it('states that missing logo or symbol is acceptable', () => {
    expect(md).toMatch(/leave the folder empty/i)
  })

  it('clarifies source URL is provenance, not proof of permission', () => {
    expect(md).toMatch(/not itself proof[\s\S]{0,20}of permission/i)
  })

  // ── Asset-key authority rules ─────────────────────────
  // Documents the four-part contract downstream import code must obey.
  // These are documentation, not algorithm changes — but the rules must
  // stay visible in the README so future importers cannot claim they
  // did not know.
  it('names asset-index.json as the authoritative mapping', () => {
    expect(md).toMatch(/authoritative mapping/i)
    expect(md).toContain('asset-index.json')
  })

  it('instructs future import code to use the stored asset_key from the index', () => {
    expect(md).toMatch(/use\s+the\s+stored\s+`?asset_key`?\s+from\s+the\s+index/i)
  })

  it('forbids future import code from independently regenerating the folder key from a display name', () => {
    expect(md).toMatch(/must\s+not\s+independently\s+regenerate\s+the\s+folder\s+key\s+from\s+a\s+display\s+name/i)
  })

  it('states the scaffold merges existing mappings + provenance rather than silently discarding them', () => {
    expect(md).toMatch(/must\s+not\s+be\s+silently\s+discarded/i)
  })
})
