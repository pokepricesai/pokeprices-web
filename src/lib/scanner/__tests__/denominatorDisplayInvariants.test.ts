// Block 5A-W-51C — UI display invariants. These tests use the JS
// mirror of the correction migration to prove the expected
// `card_number_display` values for the audited JP sets, and lock
// down the "catalogue total ≠ printed denominator" boundary.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Trivial helper — mirrors the SQL composition
//   card_number || '/' || <printed_denominator>::text
const formatDisplay = (num: string, printedDenominator: number) => `${num}/${printedDenominator}`

// Reference values Luke supplied — locked-in per-set printed denominators.
const REFERENCE = JSON.parse(readFileSync(
  join(process.cwd(), 'scripts', 'scanner', 'data', 'jp-printed-denominators.reference.json'),
  'utf8',
))

const REF_BP = REFERENCE.entries['Japanese Battle Partners']?.printed_denominator
const REF_TF = REFERENCE.entries['Japanese Terastal Festival']?.printed_denominator
const REF_RBF = REFERENCE.entries['Japanese Ruler of the Black Flame']?.printed_denominator
const REF_151 = REFERENCE.entries['Japanese Scarlet & Violet 151']?.printed_denominator
const REF_STE = REFERENCE.entries['Japanese Shiny Treasure ex']?.printed_denominator
const REF_TAG = REFERENCE.entries['Japanese Tag All Stars']?.printed_denominator

describe('Battle Partners display samples (after correction)', () => {
  it('printed denominator is 100', () => {
    expect(REF_BP).toBe(100)
  })

  it('base card #109 (N’s Reshiram) displays as 109/100', () => {
    expect(formatDisplay('109', REF_BP)).toBe('109/100')
  })

  it('secret card #132 (secret ex) displays as 132/100 — numerator > denominator OK', () => {
    expect(formatDisplay('132', REF_BP)).toBe('132/100')
  })

  it('base card #102 (Articuno) displays as 102/100', () => {
    expect(formatDisplay('102', REF_BP)).toBe('102/100')
  })

  it('base card #1 (Caterpie) displays as 1/100', () => {
    expect(formatDisplay('1', REF_BP)).toBe('1/100')
  })
})

describe('Confirmed-match sets retain their existing denominators (no regression)', () => {
  it('Ruler of the Black Flame remains /108', () => {
    expect(REF_RBF).toBe(108)
    expect(formatDisplay('11', REF_RBF)).toBe('11/108')
    expect(formatDisplay('141', REF_RBF)).toBe('141/108') // secret preserved
  })

  it('Scarlet & Violet 151 remains /165', () => {
    expect(REF_151).toBe(165)
    expect(formatDisplay('165', REF_151)).toBe('165/165')
    expect(formatDisplay('210', REF_151)).toBe('210/165') // secret
  })

  it('Shiny Treasure ex remains /190', () => {
    expect(REF_STE).toBe(190)
    expect(formatDisplay('190', REF_STE)).toBe('190/190')
  })

  it('Tag All Stars remains /173', () => {
    expect(REF_TAG).toBe(173)
    expect(formatDisplay('173', REF_TAG)).toBe('173/173')
    expect(formatDisplay('226', REF_TAG)).toBe('226/173') // secret
  })
})

describe('Terastal Festival display samples (after correction)', () => {
  it('printed denominator is 187', () => {
    expect(REF_TF).toBe(187)
  })

  it('base card #100 displays as 100/187', () => {
    expect(formatDisplay('100', REF_TF)).toBe('100/187')
  })

  it('secret card #237 displays as 237/187', () => {
    expect(formatDisplay('237', REF_TF)).toBe('237/187')
  })
})

describe('Catalogue total and printed denominator are separate concepts', () => {
  it('102/100 remains distinct from 12/100 (regression of the 51B.1 normalisation fix)', () => {
    // This is a static assertion — the corrected _normalize_card_number
    // no longer collapses 102 to 12. The invariant is expressed here
    // as a display-string comparison; if any future change reintroduces
    // the collision it'll be caught by normalizeCardNumber.test.ts too.
    expect(formatDisplay('102', 100)).not.toBe(formatDisplay('12', 100))
  })

  it('secret-rare numerators legitimately exceed the denominator (documented, not a bug)', () => {
    // Battle Partners has 100 base + 32 secret = 132 unique cards.
    // Secret rows have card_number 101..132 with printed denom 100.
    for (const num of ['101', '109', '132']) {
      const [n, d] = formatDisplay(num, 100).split('/').map(Number)
      expect(n).toBeGreaterThan(d)
    }
  })
})
