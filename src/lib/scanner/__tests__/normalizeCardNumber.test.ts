// Block 5A-W-51B.1 — regression tests for the corrected card-number
// normalisation. These lock down every case the block spec calls out
// plus the distinctness assertions that PROVE 102 no longer collides
// with 12 after the regex fix.
//
// The JS helper in src/lib/scanner/normalizeCardNumber.ts is a mirror
// of the Postgres _normalize_card_number function shipped by
// migrations/2026-08-05-fix-card-number-normalisation.sql. If the two
// diverge, the migration's postflight DO block will fail — but these
// tests catch the drift earlier during PR review.

import { describe, it, expect } from 'vitest'
import { normalizeCardNumber } from '@/lib/scanner/normalizeCardNumber'

describe('normalizeCardNumber — leading zeros stripped', () => {
  it('001 → 1', () => expect(normalizeCardNumber('001')).toBe('1'))
  it('012 → 12', () => expect(normalizeCardNumber('012')).toBe('12'))
  it('030/086 → 30/86', () => expect(normalizeCardNumber('030/086')).toBe('30/86'))
  it('SWSH-001 → swsh-1 (letter prefix ok)', () => expect(normalizeCardNumber('SWSH-001')).toBe('swsh-1'))
  it('0001/0100 → 1/100 (multi-zero leading)', () => expect(normalizeCardNumber('0001/0100')).toBe('1/100'))
})

describe('normalizeCardNumber — internal zeros preserved (the 51B.1 fix)', () => {
  it('102 → 102 (was buggy "12")', () => expect(normalizeCardNumber('102')).toBe('102'))
  it('100 → 100 (was buggy "10")', () => expect(normalizeCardNumber('100')).toBe('100'))
  it('102/100 → 102/100 (was buggy "12/10")', () => expect(normalizeCardNumber('102/100')).toBe('102/100'))
  it('12/100 → 12/100 (was buggy "12/10")', () => expect(normalizeCardNumber('12/100')).toBe('12/100'))
  it('200/100 → 200/100 (was buggy "20/10")', () => expect(normalizeCardNumber('200/100')).toBe('200/100'))
  it('20/10 → 20/10 (unchanged — no internal zero to preserve)', () => expect(normalizeCardNumber('20/10')).toBe('20/10'))
  it('TG12/TG30 → tg12/tg30 (unchanged)', () => expect(normalizeCardNumber('TG12/TG30')).toBe('tg12/tg30'))
  it('106 → 106 (was buggy "16")', () => expect(normalizeCardNumber('106')).toBe('106'))
  it('107/88 → 107/88 (was buggy "17/88")', () => expect(normalizeCardNumber('107/88')).toBe('107/88'))
  it('204/88 → 204/88 (was buggy "24/88")', () => expect(normalizeCardNumber('204/88')).toBe('204/88'))
  it('30/202 → 30/202 (was buggy "30/22")', () => expect(normalizeCardNumber('30/202')).toBe('30/202'))
})

describe('normalizeCardNumber — distinctness (must NOT collide)', () => {
  it('102 must not equal 12', () => {
    expect(normalizeCardNumber('102')).not.toBe(normalizeCardNumber('12'))
  })

  it('102/100 must not equal 12/100', () => {
    expect(normalizeCardNumber('102/100')).not.toBe(normalizeCardNumber('12/100'))
  })

  it('200/100 must not equal 20/10', () => {
    expect(normalizeCardNumber('200/100')).not.toBe(normalizeCardNumber('20/10'))
  })

  it('106 must not equal 16 (any card whose numerator is 106)', () => {
    expect(normalizeCardNumber('106')).not.toBe(normalizeCardNumber('16'))
  })
})

describe('normalizeCardNumber — trainer-gallery and promo formats', () => {
  it('TG05/TG30 → tg5/tg30 (TG-prefixed leading zeros stripped)', () => {
    expect(normalizeCardNumber('TG05/TG30')).toBe('tg5/tg30')
  })
  it('SWSH123 → swsh123 (promo prefix, no zeros)', () => {
    expect(normalizeCardNumber('SWSH123')).toBe('swsh123')
  })
  it('SM-01 → sm-1 (letter prefix + separator + leading zero)', () => {
    expect(normalizeCardNumber('SM-01')).toBe('sm-1')
  })
  it('SVP-102 → svp-102 (letter prefix + internal zero preserved)', () => {
    expect(normalizeCardNumber('SVP-102')).toBe('svp-102')
  })
  it('BW-001/BW-201 → bw-1/bw-201 (leading strip on left, internal preserved on right)', () => {
    expect(normalizeCardNumber('BW-001/BW-201')).toBe('bw-1/bw-201')
  })
})

describe('normalizeCardNumber — English and Japanese realistic samples', () => {
  it('English: 4/102 (Base Set Charizard) unchanged', () => {
    expect(normalizeCardNumber('4/102')).toBe('4/102')
  })
  it('English: 016/165 (SV 151) → 16/165', () => {
    expect(normalizeCardNumber('016/165')).toBe('16/165')
  })
  it('Japanese: 102/130 (BP Articuno as currently stored) unchanged', () => {
    expect(normalizeCardNumber('102/130')).toBe('102/130')
  })
  it('Japanese: 102/100 (BP Articuno printed value) unchanged', () => {
    expect(normalizeCardNumber('102/100')).toBe('102/100')
  })
  it('Japanese: 140/108 (Ruler of the Black Flame secret) unchanged', () => {
    expect(normalizeCardNumber('140/108')).toBe('140/108')
  })
  it('Japanese: 79/66 (Ancient Roar secret) unchanged', () => {
    expect(normalizeCardNumber('79/66')).toBe('79/66')
  })
})

describe('normalizeCardNumber — null and empty handling', () => {
  it('null → null', () => expect(normalizeCardNumber(null)).toBeNull())
  it('undefined → null', () => expect(normalizeCardNumber(undefined)).toBeNull())
  it('empty string → null', () => expect(normalizeCardNumber('')).toBeNull())
  it('whitespace only → null', () => expect(normalizeCardNumber('   ')).toBeNull())
})

describe('normalizeCardNumber — whitespace + case normalisation', () => {
  it('strips embedded whitespace', () => {
    expect(normalizeCardNumber('102 / 100')).toBe('102/100')
  })
  it('lowercases uppercase letters', () => {
    expect(normalizeCardNumber('TG12')).toBe('tg12')
  })
})
