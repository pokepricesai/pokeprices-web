// Block 5A-W-51A — unit tests for the pure parse helpers shared with
// the scan-card edge function.
//
// These tests use realistic strings observed from Google Vision
// output (collector numbers, promo tags, Japanese script) and lock
// down the specific behaviours that 51A needs to guarantee for the
// Japanese scanner fix.

import { describe, it, expect } from 'vitest'
import {
  extractCollectorNumber,
  detectCardLanguageFromText,
  extractIsPromo,
} from '@/lib/scanner/parseHelpers'

// ── extractCollectorNumber ─────────────────────────────

describe('extractCollectorNumber — English (must not regress)', () => {
  it('parses classic fraction like "4/102"', () => {
    expect(extractCollectorNumber('4/102')).toEqual({ value: '4/102', pattern: 'fraction-numeric' })
  })

  it('preserves leading zeros in the raw extraction', () => {
    // The RPC's _normalize_card_number handles zero-stripping downstream.
    // Extraction itself should return what the OCR saw — "016/165" not "16/165".
    expect(extractCollectorNumber('016/165').value).toBe('016/165')
  })

  it('parses promo-prefixed like "SWSH123"', () => {
    expect(extractCollectorNumber('SWSH123')).toEqual({ value: 'SWSH123', pattern: 'promo-prefixed' })
  })

  it('parses promo-prefixed with dash like "SWSH-123"', () => {
    expect(extractCollectorNumber('SWSH-123')).toEqual({ value: 'SWSH-123', pattern: 'promo-prefixed' })
  })

  it('parses loose separator "12-100" and reassembles as "12/100"', () => {
    expect(extractCollectorNumber('12-100')).toEqual({ value: '12/100', pattern: 'fraction-loose' })
  })
})

describe('extractCollectorNumber — Japanese formats', () => {
  it('parses Japanese Battle Partners format "102/130"', () => {
    // Real card: Articuno #102 in Japanese Battle Partners (set total 130).
    expect(extractCollectorNumber('102/130')).toEqual({ value: '102/130', pattern: 'fraction-numeric' })
  })

  it('parses Japanese secret rare where numerator > denominator ("140/108")', () => {
    // Real card: Artazon #140 in Japanese Ruler of the Black Flame (set total 108).
    expect(extractCollectorNumber('140/108')).toEqual({ value: '140/108', pattern: 'fraction-numeric' })
  })

  it('parses another Japanese secret rare ("79/66")', () => {
    // Real card: Armarouge ex #79 in Japanese Ancient Roar (set total 66).
    expect(extractCollectorNumber('79/66')).toEqual({ value: '79/66', pattern: 'fraction-numeric' })
  })

  it('parses Japanese card number embedded in surrounding OCR noise', () => {
    // Vision OCR output typically concatenates all bottom-strip text on one line.
    const ocr = 'イラスト: kirisAki 102/130 © 2025 Pokémon'
    expect(extractCollectorNumber(ocr).value).toBe('102/130')
  })
})

// ── detectCardLanguageFromText ─────────────────────────

describe('detectCardLanguageFromText', () => {
  it('returns null for empty / undefined / null input', () => {
    expect(detectCardLanguageFromText('')).toBeNull()
    expect(detectCardLanguageFromText(null)).toBeNull()
    expect(detectCardLanguageFromText(undefined)).toBeNull()
  })

  it('returns "jp" for a Kanji character (e.g. 炎)', () => {
    expect(detectCardLanguageFromText('炎タイプ')).toBe('jp')
  })

  it('returns "jp" for Hiragana (e.g. たね)', () => {
    // "たね" = basic Pokemon stage indicator on JP cards
    expect(detectCardLanguageFromText('たね ポケモン')).toBe('jp')
  })

  it('returns "jp" for Katakana (e.g. リザードン = Charizard)', () => {
    expect(detectCardLanguageFromText('リザードン')).toBe('jp')
  })

  it('returns "jp" when Japanese text is embedded in mixed Latin/JP OCR', () => {
    // Realistic OCR output — number and copyright are Latin but the name is JP.
    const ocr = 'アーティキュノー HP 120 102/130 © 2025 Pokemon'
    expect(detectCardLanguageFromText(ocr)).toBe('jp')
  })

  it('returns "en" for a plain English card OCR string', () => {
    const ocr = 'Charizard HP 170 4/102 Fire Energy'
    expect(detectCardLanguageFromText(ocr)).toBe('en')
  })

  it('returns null for a digits-and-punctuation-only string (no letter signal)', () => {
    expect(detectCardLanguageFromText('102/130 © 2025')).toBeNull()
  })
})

// ── extractIsPromo ─────────────────────────────────────

describe('extractIsPromo', () => {
  it('flags PROMO word regardless of case', () => {
    expect(extractIsPromo('PROMO card', null)).toBe(true)
    expect(extractIsPromo('promotional set', null)).toBe(true)
  })

  it('flags Black Star', () => {
    expect(extractIsPromo('Black Star Promo', null)).toBe(true)
  })

  it('flags any promo-prefixed collector pattern', () => {
    expect(extractIsPromo('random text', 'promo-prefixed')).toBe(true)
  })

  it('does NOT flag a normal card as promo', () => {
    expect(extractIsPromo('Charizard 4/102', 'fraction-numeric')).toBe(false)
  })
})
