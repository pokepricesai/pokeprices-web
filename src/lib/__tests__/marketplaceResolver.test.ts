import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  resolveMarketplace,
  coerceLegacyMarketplace,
  selectorOptions,
} from '../marketplaceResolver'
import {
  ALL_MARKETPLACES,
  PUBLIC_EBAY_CAMPAIGN_IDS,
  type MarketplaceCode,
} from '../marketplaces'

const MAP = PUBLIC_EBAY_CAMPAIGN_IDS as Record<MarketplaceCode, string | undefined>

let snapshot: Record<MarketplaceCode, string | undefined>

beforeEach(() => {
  snapshot = { ...MAP } as Record<MarketplaceCode, string | undefined>
  for (const code of ALL_MARKETPLACES) MAP[code] = undefined
})

afterEach(() => {
  for (const code of ALL_MARKETPLACES) MAP[code] = snapshot[code]
})

describe('coerceLegacyMarketplace', () => {
  it('passes through known codes case-insensitively', () => {
    expect(coerceLegacyMarketplace('UK')).toBe('UK')
    expect(coerceLegacyMarketplace('us')).toBe('US')
    expect(coerceLegacyMarketplace(' de ')).toBe('DE')
  })

  it('returns null for null / empty / unknown / legacy other', () => {
    expect(coerceLegacyMarketplace(null)).toBeNull()
    expect(coerceLegacyMarketplace(undefined)).toBeNull()
    expect(coerceLegacyMarketplace('')).toBeNull()
    expect(coerceLegacyMarketplace('zz')).toBeNull()
    expect(coerceLegacyMarketplace('other')).toBeNull()
  })

  it('maps EU to the first SELECTABLE European marketplace, or null when none are selectable', () => {
    // No European marketplace is implemented today, so coercing EU
    // returns null regardless of which European campid is populated.
    expect(coerceLegacyMarketplace('EU')).toBeNull()
    MAP.FR = 'fr'
    expect(coerceLegacyMarketplace('EU')).toBeNull()
    MAP.DE = 'de'
    expect(coerceLegacyMarketplace('EU')).toBeNull()
  })
})

describe('resolveMarketplace precedence (cookie > profile > geo > fallback)', () => {
  beforeEach(() => {
    MAP.UK = 'uk'
    MAP.US = 'us'
  })

  it('manual cookie wins over profile, geo and fallback', () => {
    const r = resolveMarketplace({
      manualCookie:      'UK',
      profilePreference: 'US',
      geoCountry:        'US',
    })
    expect(r).toEqual({ marketplace: 'UK', source: 'cookie' })
  })

  it('a fresh cookie click overrides a previously-saved profile preference', () => {
    // Simulates the user changing the selector after their profile was
    // saved to a different marketplace.
    const r = resolveMarketplace({
      manualCookie:      'US', // just-clicked
      profilePreference: 'UK', // earlier server-stored choice
    })
    expect(r).toEqual({ marketplace: 'US', source: 'cookie' })
  })

  it('profile wins when no cookie is present', () => {
    const r = resolveMarketplace({
      profilePreference: 'UK',
      geoCountry:        'US',
    })
    expect(r).toEqual({ marketplace: 'UK', source: 'profile' })
  })

  it('geo wins when neither cookie nor profile is present', () => {
    const r = resolveMarketplace({ geoCountry: 'GB' })
    expect(r).toEqual({ marketplace: 'UK', source: 'geo' })
  })

  it('a legacy profile value does NOT override a manual cookie', () => {
    // Legacy 'EU' is coerced to null (no European marketplace is
    // selectable) but the cookie must still take effect.
    const r = resolveMarketplace({
      manualCookie:      'US',
      profilePreference: 'EU',
    })
    expect(r).toEqual({ marketplace: 'US', source: 'cookie' })
  })

  it('skips an unconfigured cookie value and falls through to profile', () => {
    MAP.UK = undefined // UK no longer configured at all
    const r = resolveMarketplace({
      manualCookie:      'UK', // not selectable → skip
      profilePreference: 'US',
    })
    expect(r).toEqual({ marketplace: 'US', source: 'profile' })
  })

  it('skips an unconfigured profile preference and falls through', () => {
    MAP.UK = undefined
    const r = resolveMarketplace({
      profilePreference: 'UK', // not selectable → skip
      geoCountry:        'US',
    })
    expect(r).toEqual({ marketplace: 'US', source: 'geo' })
  })

  it('walks the country mapping fallback when geo target is not selectable', () => {
    // DE is in the registry but is not selectable; its declared
    // fallback is UK, which IS selectable.
    const r = resolveMarketplace({ geoCountry: 'DE' })
    expect(r).toEqual({ marketplace: 'UK', source: 'geo' })
  })

  it('returns the ultimate fallback when nothing else resolves', () => {
    const r = resolveMarketplace({})
    expect(r).toEqual({ marketplace: 'UK', source: 'fallback' })
  })

  it('only ever returns a SELECTABLE marketplace — never one that is configured-but-not-implemented', () => {
    MAP.DE = 'de' // configured but not implemented
    const r = resolveMarketplace({
      manualCookie:      'DE',
      profilePreference: 'DE',
      geoCountry:        'DE',
    })
    // Cookie/profile DE are skipped (not selectable). Geo's DE is not
    // selectable either, but DE's declared fallback is UK which IS
    // selectable — so the geo step returns UK, attributed to 'geo'.
    expect(r).toEqual({ marketplace: 'UK', source: 'geo' })
  })

  it('falls through to ultimate fallback when no input resolves and no geo is provided', () => {
    MAP.DE = 'de' // configured but not implemented
    const r = resolveMarketplace({
      manualCookie:      'DE',
      profilePreference: 'DE',
      // no geoCountry → skip step 3 entirely
    })
    expect(r).toEqual({ marketplace: 'UK', source: 'fallback' })
  })

  it('returns null marketplace + source "none" when zero marketplaces are selectable', () => {
    MAP.UK = undefined
    MAP.US = undefined
    const r = resolveMarketplace({
      manualCookie:      'UK',
      profilePreference: 'US',
      geoCountry:        'GB',
    })
    expect(r).toEqual({ marketplace: null, source: 'none' })
  })
})

describe('selectorOptions', () => {
  it('returns only SELECTABLE marketplaces in canonical order', () => {
    MAP.UK = 'uk'
    MAP.US = 'us'
    MAP.FR = 'fr' // configured but not implemented → excluded
    const codes = selectorOptions().map(d => d.code)
    expect(codes).toEqual(['UK', 'US'])
  })

  it('returns an empty list when nothing is selectable', () => {
    MAP.FR = 'fr' // configured but not implemented
    expect(selectorOptions()).toEqual([])
  })
})
