// src/lib/editorial/publishing/__tests__/slug.test.ts
//
// EIC Block 10 — slug generator tests.

import { describe, it, expect } from 'vitest'
import { generateSlug, isValidSlug, suggestAlternativeSlug } from '../slug'

describe('generateSlug', () => {
  it('produces ASCII kebab from a real headline', () => {
    expect(generateSlug('Pokémon Card Market Report: August 2026')).toBe('pokemon-card-market-report-august-2026')
  })
  it('strips diacritics and typographic punctuation', () => {
    expect(generateSlug('Ampharos’ population "is" 2')).toBe('ampharos-population-is-2')
  })
  it('collapses duplicate hyphens', () => {
    expect(generateSlug('a  b   c')).toBe('a-b-c')
  })
  it('replaces "&" with "and"', () => {
    expect(generateSlug('Fire Red & Leaf Green')).toBe('fire-red-and-leaf-green')
  })
  it('caps length at 80 chars and trims trailing hyphens', () => {
    const long = 'x'.repeat(200)
    const s = generateSlug(long)
    expect(s.length).toBeLessThanOrEqual(80)
    expect(s.endsWith('-')).toBe(false)
  })
  it('falls back to "untitled-article" for empty seed', () => {
    expect(generateSlug('')).toBe('untitled-article')
    expect(generateSlug('   ')).toBe('untitled-article')
  })
  it('never produces the malformed /pok-mon/ legacy shape', () => {
    // The old bug left "pok-mon" because it dropped the é without
    // decomposing. Verify the new generator keeps the "o".
    expect(generateSlug('Pokémon')).toBe('pokemon')
  })
})

describe('isValidSlug', () => {
  it('accepts standard kebab', () => { expect(isValidSlug('pokemon-market')).toBe(true) })
  it('rejects uppercase', () => { expect(isValidSlug('Pokemon-Market')).toBe(false) })
  it('rejects leading hyphen', () => { expect(isValidSlug('-pokemon')).toBe(false) })
  it('rejects shorter than 3 chars', () => { expect(isValidSlug('a')).toBe(false) })
  it('rejects slashes and spaces', () => { expect(isValidSlug('a/b')).toBe(false); expect(isValidSlug('a b')).toBe(false) })
})

describe('suggestAlternativeSlug', () => {
  it('appends -2 when the base is taken', () => {
    expect(suggestAlternativeSlug('report', ['report'])).toBe('report-2')
  })
  it('walks upward past existing numeric siblings', () => {
    expect(suggestAlternativeSlug('report', ['report', 'report-2', 'report-3'])).toBe('report-4')
  })
})
