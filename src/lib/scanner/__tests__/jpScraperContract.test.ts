// Block 5A-W-51C — contract tests on the sister-repo scraper's
// Japanese bulk-seed driver. Reads C:\Users\lukep\OneDrive\Desktop\
// pokeprices\bulk_seed_japanese.py and asserts that:
//
//   * The driver prefers manifest['printed_denominator'] over
//     manifest['total_cards'] when composing --printed-total.
//   * The safety flag --allow-total-cards-as-denominator is defined
//     with a helpful description.
//   * Missing printed_denominator without the safety flag emits an
//     ERROR and is treated as a failure (not silently seeded).
//   * The 51C reference values landed in the manifest for the 10
//     sourced sets already in the manifest.
//
// These assertions run against the working-tree file. If someone
// mutates the driver in a way that reintroduces the "catalogue count
// as printed denominator" bug, this test flags it before the code
// merges.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const SCRAPER_PATH = 'C:\\Users\\lukep\\OneDrive\\Desktop\\pokeprices\\bulk_seed_japanese.py'
const MANIFEST_PATH = 'C:\\Users\\lukep\\OneDrive\\Desktop\\pokeprices\\manifests\\japanese_sets.json'

const scraper = existsSync(SCRAPER_PATH) ? readFileSync(SCRAPER_PATH, 'utf8') : null
const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null

// If neither file exists (fresh clone, sister repo not present) these
// tests skip. In Luke's dev environment they run.
describe.skipIf(scraper == null)('bulk_seed_japanese.py — 51C printed_denominator preference', () => {
  it('reads printed_denominator from each manifest entry BEFORE falling back to total_cards', () => {
    expect(scraper).toMatch(/if e\.get\("printed_denominator"\):[\s\S]{0,100}cmd \+= \["--printed-total", str\(e\["printed_denominator"\]\)\]/)
  })

  it('emits an ERROR when printed_denominator is missing and the safety flag is not set', () => {
    expect(scraper).toMatch(/manifest is missing `printed_denominator`/)
    expect(scraper).toMatch(/if not args\.allow_total_cards_as_denominator/)
  })

  it('marks the entry as a failure rather than seeding with the wrong denominator', () => {
    expect(scraper).toMatch(/failures\.append\(\{"set_name": e\["set_name"\], "reason": "printed_denominator missing"\}\)/)
  })

  it('registers --allow-total-cards-as-denominator as an argparse flag with a warning description', () => {
    expect(scraper).toMatch(/add_argument\("--allow-total-cards-as-denominator",\s+action="store_true"/)
    expect(scraper).toMatch(/unsafe for modern sets with secret cards/)
  })

  it('preserves the WARN fallback path when the safety flag IS set (old behaviour still available)', () => {
    expect(scraper).toMatch(/WARN:[\s\S]{0,120}no printed_denominator supplied/)
  })
})

describe.skipIf(manifest == null)('manifests/japanese_sets.json — 51C printed_denominator entries', () => {
  it('carries a printed_denominator on every set with a 51C reference', () => {
    const expected = new Set([
      'Japanese Terastal Festival',
      'Japanese Ruler of the Black Flame',
      'Japanese Scarlet & Violet 151',
      'Japanese Shiny Treasure ex',
      'Japanese VMAX Climax',
      'Japanese Shiny Star V',
      'Japanese Tag All Stars',
      'Japanese GX Ultra Shiny',
      'Japanese Best of XY',
    ])
    for (const entry of manifest) {
      if (!expected.has(entry.set_name)) continue
      expect(entry, `${entry.set_name} missing printed_denominator`).toHaveProperty('printed_denominator')
      expect(typeof entry.printed_denominator).toBe('number')
    }
  })

  it('printed_denominator for Ruler of the Black Flame = 108 (matches reference file)', () => {
    const e = manifest.find((x: { set_name: string }) => x.set_name === 'Japanese Ruler of the Black Flame')
    expect(e?.printed_denominator).toBe(108)
  })

  it('printed_denominator for Scarlet & Violet 151 = 165', () => {
    const e = manifest.find((x: { set_name: string }) => x.set_name === 'Japanese Scarlet & Violet 151')
    expect(e?.printed_denominator).toBe(165)
  })

  it('printed_denominator for Tag All Stars = 173 (NOT 100 — the block-spec anti-pattern)', () => {
    const e = manifest.find((x: { set_name: string }) => x.set_name === 'Japanese Tag All Stars')
    expect(e?.printed_denominator).toBe(173)
  })
})
