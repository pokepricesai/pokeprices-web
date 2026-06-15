import { describe, it, expect } from 'vitest'
import {
  cleanCountryCode,
  cleanDisplayName,
  cleanMarketplacePreference,
  cleanProfilePatch,
} from '../profileValidation'

describe('cleanCountryCode', () => {
  it('accepts two upper-case letters', () => {
    expect(cleanCountryCode('GB')).toBe('GB')
    expect(cleanCountryCode('US')).toBe('US')
  })

  it('uppercases lowercase input', () => {
    expect(cleanCountryCode('gb')).toBe('GB')
  })

  it('rejects three-letter codes', () => {
    expect(cleanCountryCode('USA')).toBeNull()
  })

  it('rejects single letter', () => {
    expect(cleanCountryCode('G')).toBeNull()
  })

  it('rejects digits and punctuation', () => {
    expect(cleanCountryCode('G1')).toBeNull()
    expect(cleanCountryCode('G-')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(cleanCountryCode('  gb  ')).toBe('GB')
  })

  it('returns null for empty', () => {
    expect(cleanCountryCode('')).toBeNull()
    expect(cleanCountryCode(null)).toBeNull()
    expect(cleanCountryCode(undefined)).toBeNull()
  })
})

describe('cleanDisplayName', () => {
  it('returns trimmed input', () => {
    expect(cleanDisplayName('  Luke  ')).toBe('Luke')
  })

  it('drops control characters', () => {
    expect(cleanDisplayName('Lu\x00ke')).toBe('Luke')
  })

  it('truncates to the maximum length', () => {
    const long = 'a'.repeat(80)
    const out = cleanDisplayName(long)
    expect(out?.length).toBe(60)
  })

  it('returns null for empty', () => {
    expect(cleanDisplayName('')).toBeNull()
    expect(cleanDisplayName('   ')).toBeNull()
  })
})

describe('cleanMarketplacePreference', () => {
  it('accepts every canonical Block 2D marketplace code', () => {
    for (const v of ['UK', 'US', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES']) {
      expect(cleanMarketplacePreference(v)).toBe(v)
    }
  })

  it('uppercases lowercase input', () => {
    expect(cleanMarketplacePreference('uk')).toBe('UK')
    expect(cleanMarketplacePreference(' fr ')).toBe('FR')
  })

  it('rejects values outside the canonical set, including legacy EU/other', () => {
    expect(cleanMarketplacePreference('XX')).toBeNull()
    expect(cleanMarketplacePreference('EU')).toBeNull()
    expect(cleanMarketplacePreference('other')).toBeNull()
    expect(cleanMarketplacePreference('')).toBeNull()
    expect(cleanMarketplacePreference(null)).toBeNull()
  })
})

describe('cleanProfilePatch', () => {
  it('drops unknown keys', () => {
    const patch = cleanProfilePatch({ display_name: 'Luke', is_admin: true })
    expect('is_admin' in patch).toBe(false)
    expect(patch.display_name).toBe('Luke')
  })

  it('preserves valid country code', () => {
    expect(cleanProfilePatch({ country_code: 'gb' }).country_code).toBe('GB')
  })

  it('coerces invalid country to null', () => {
    expect(cleanProfilePatch({ country_code: 'USA' }).country_code).toBeNull()
  })

  it('accepts a canonical marketplace code', () => {
    expect(cleanProfilePatch({ marketplace_preference: 'UK' }).marketplace_preference).toBe('UK')
  })

  it('coerces the legacy EU value to null on write (legacy values stay readable in the DB but new writes use canonical codes only)', () => {
    expect(cleanProfilePatch({ marketplace_preference: 'EU' }).marketplace_preference).toBeNull()
  })

  it('returns an empty patch for a non-object input', () => {
    expect(cleanProfilePatch(null)).toEqual({})
    expect(cleanProfilePatch(42)).toEqual({})
    expect(cleanProfilePatch('hi')).toEqual({})
  })
})
