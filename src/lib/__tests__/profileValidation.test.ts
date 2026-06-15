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
  it('accepts known values', () => {
    expect(cleanMarketplacePreference('UK')).toBe('UK')
    expect(cleanMarketplacePreference('US')).toBe('US')
  })

  it('rejects unknown values', () => {
    expect(cleanMarketplacePreference('XX')).toBeNull()
    expect(cleanMarketplacePreference('uk')).toBeNull()
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

  it('accepts a known marketplace', () => {
    expect(cleanProfilePatch({ marketplace_preference: 'EU' }).marketplace_preference).toBe('EU')
  })

  it('returns an empty patch for a non-object input', () => {
    expect(cleanProfilePatch(null)).toEqual({})
    expect(cleanProfilePatch(42)).toEqual({})
    expect(cleanProfilePatch('hi')).toEqual({})
  })
})
