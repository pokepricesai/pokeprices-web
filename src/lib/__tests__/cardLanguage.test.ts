// Block 5A-W-48B — pure unit tests for the client-side language
// derivation helper. The helper is the single source of truth for
// "what language is this card/set" in the web app until Luke extends
// search_global and get_set_list_v2 to return the language field
// natively — at which point the helper still applies precedence in
// the correct order (explicit > derived > 'en').

import { describe, it, expect } from 'vitest'
import {
  JAPANESE_SET_NAME_PREFIX,
  isJapaneseSetName,
  resolveLanguage,
} from '../cardLanguage'

// ── Constant sanity ─────────────────────────────

describe('cardLanguage — constants', () => {
  it('JAPANESE_SET_NAME_PREFIX matches the seeder convention exactly', () => {
    // The scraper repo's seed_set_cards.py + --require-console gate
    // pin the same convention. Any change here must mirror there.
    expect(JAPANESE_SET_NAME_PREFIX).toBe('Japanese ')
  })
})

// ── isJapaneseSetName — must handle every hostile input ─────────

describe('isJapaneseSetName', () => {
  it('matches every canonical Japanese set name shape', () => {
    expect(isJapaneseSetName('Japanese Battle Partners')).toBe(true)
    expect(isJapaneseSetName('Japanese Terastal Fest ex')).toBe(true)
    expect(isJapaneseSetName('Japanese Base Set')).toBe(true)
    // Multi-word titles preserved.
    expect(isJapaneseSetName('Japanese Fire Red & Leaf Green')).toBe(true)
  })
  it('does not match on the substring "Japanese" appearing mid-string', () => {
    // Guard against a hypothetical English set with "Japanese" in the
    // middle of the name — the pilot convention is a prefix.
    expect(isJapaneseSetName('The Japanese Pokemon League')).toBe(false)
    expect(isJapaneseSetName('Team Rocket Japanese Edition')).toBe(false)
  })
  it('is case-sensitive (the prefix must be the exact "Japanese ")', () => {
    // Lower-cased prefix is not the convention.
    expect(isJapaneseSetName('japanese Battle Partners')).toBe(false)
    expect(isJapaneseSetName('JAPANESE BATTLE PARTNERS')).toBe(false)
  })
  it('does not match on the word "Japan" alone', () => {
    expect(isJapaneseSetName('Japan Trophy Card')).toBe(false)
  })
  it('handles null / undefined / empty string safely', () => {
    expect(isJapaneseSetName(null)).toBe(false)
    expect(isJapaneseSetName(undefined)).toBe(false)
    expect(isJapaneseSetName('')).toBe(false)
  })
  it('rejects non-string inputs (belt and braces)', () => {
    // The type sig forbids this at compile time; guard against any
    // caller that reaches us via `any`.
    expect(isJapaneseSetName(123 as any)).toBe(false)
    expect(isJapaneseSetName({} as any)).toBe(false)
    expect(isJapaneseSetName([] as any)).toBe(false)
  })
  it('does not match just "Japanese" (no trailing space)', () => {
    // Prefix has a trailing space to prevent lone-word false positives.
    expect(isJapaneseSetName('Japanese')).toBe(false)
  })
  it('handles a set called literally "Japanese Set"', () => {
    // Whatever the title, if it starts with "Japanese " it's JP.
    expect(isJapaneseSetName('Japanese Set')).toBe(true)
  })
})

// ── resolveLanguage — precedence order ─────────

describe('resolveLanguage', () => {
  it('prefers an explicit "jp" over anything else', () => {
    // If the RPC has been extended to return language and says jp,
    // that's authoritative — even for a set name that does not begin
    // with "Japanese " (unlikely but possible in transitional data).
    expect(resolveLanguage('jp', 'Base Set')).toBe('jp')
    expect(resolveLanguage('jp', null)).toBe('jp')
    expect(resolveLanguage('jp', undefined)).toBe('jp')
    expect(resolveLanguage('jp', '')).toBe('jp')
  })
  it('respects an explicit "en" even for a "Japanese "-prefixed set (data anomaly guard)', () => {
    // If the DB says en, respect the DB — never override the RPC
    // with the derived value. This is a paranoia branch that fires
    // only under bad data.
    expect(resolveLanguage('en', 'Japanese Battle Partners')).toBe('en')
  })
  it('derives jp from "Japanese <title>" when no explicit value is given', () => {
    expect(resolveLanguage(null, 'Japanese Battle Partners')).toBe('jp')
    expect(resolveLanguage(undefined, 'Japanese Terastal Fest ex')).toBe('jp')
    expect(resolveLanguage('', 'Japanese Base Set')).toBe('jp')
  })
  it('falls back to en when nothing suggests jp', () => {
    expect(resolveLanguage(null, 'Base Set')).toBe('en')
    expect(resolveLanguage(undefined, 'Team Magma & Team Aqua')).toBe('en')
    expect(resolveLanguage(undefined, null)).toBe('en')
    expect(resolveLanguage(null, undefined)).toBe('en')
    expect(resolveLanguage('', '')).toBe('en')
  })
  it('is deterministic across all null / undefined / empty combinations', () => {
    const cases: Array<[unknown, unknown, 'en' | 'jp']> = [
      [null,       null,                       'en'],
      [null,       undefined,                  'en'],
      [null,       '',                         'en'],
      [null,       'Base Set',                 'en'],
      [null,       'Japanese Battle Partners', 'jp'],
      [undefined,  null,                       'en'],
      [undefined,  undefined,                  'en'],
      [undefined,  '',                         'en'],
      [undefined,  'Japanese X',               'jp'],
      ['',         null,                       'en'],
      ['',         'Japanese X',               'jp'],
      ['jp',       null,                       'jp'],
      ['jp',       undefined,                  'jp'],
      ['jp',       '',                         'jp'],
      ['jp',       'Base Set',                 'jp'],
      ['en',       null,                       'en'],
      ['en',       'Japanese X',               'en'],
    ]
    for (const [explicit, setName, expected] of cases) {
      expect(resolveLanguage(explicit as any, setName as any), `explicit=${JSON.stringify(explicit)} setName=${JSON.stringify(setName)}`).toBe(expected)
    }
  })
  it('coerces unexpected explicit values to the derived fallback', () => {
    // An RPC returning a garbage value ("de", "unknown", 123) does
    // not trip a jp classification — the helper defaults to derived.
    expect(resolveLanguage('de' as any, 'Base Set')).toBe('en')
    expect(resolveLanguage('unknown' as any, 'Base Set')).toBe('en')
    expect(resolveLanguage('de' as any, 'Japanese Battle Partners')).toBe('jp')
  })
})
