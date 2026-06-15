import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as marketplacesModule from '../marketplaces'
import {
  ALL_MARKETPLACES,
  IMPLEMENTED_MARKETPLACES,
  MARKETPLACE_DEFINITIONS,
  PUBLIC_EBAY_CAMPAIGN_IDS,
  configuredMarketplaces,
  countryToMarketplace,
  isMarketplaceConfigured,
  isMarketplaceImplemented,
  isMarketplaceSelectable,
  nearestConfiguredMarketplace,
  pickConfigured,
  readCampaignId,
  selectableMarketplaces,
  ultimateFallback,
  type MarketplaceCode,
} from '../marketplaces'

// PUBLIC_EBAY_CAMPAIGN_IDS is captured at module load via literal
// `process.env.NEXT_PUBLIC_EBAY_CAMPID_<CODE>` reads — the TypeScript
// Readonly assertion is compile-time only, so we can mutate the
// runtime object for tests. This is the production code path: the map
// is the single source of truth for readCampaignId.
const MAP = PUBLIC_EBAY_CAMPAIGN_IDS as Record<MarketplaceCode, string | undefined>

let snapshot: Record<MarketplaceCode, string | undefined>

beforeEach(() => {
  snapshot = { ...MAP } as Record<MarketplaceCode, string | undefined>
  for (const code of ALL_MARKETPLACES) MAP[code] = undefined
})

afterEach(() => {
  for (const code of ALL_MARKETPLACES) MAP[code] = snapshot[code]
})

describe('MARKETPLACE_DEFINITIONS', () => {
  it('contains every declared MarketplaceCode', () => {
    const expected: MarketplaceCode[] = ['UK', 'US', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES']
    for (const code of expected) {
      expect(MARKETPLACE_DEFINITIONS[code]).toBeTruthy()
      expect(MARKETPLACE_DEFINITIONS[code].code).toBe(code)
    }
  })

  it('each definition declares a non-empty hostname, mkrid, envVar, label, flag', () => {
    for (const code of ALL_MARKETPLACES) {
      const def = MARKETPLACE_DEFINITIONS[code]
      expect(def.hostname.length).toBeGreaterThan(0)
      expect(def.mkrid.length).toBeGreaterThan(0)
      expect(def.campaignEnvVar.startsWith('NEXT_PUBLIC_EBAY_CAMPID_')).toBe(true)
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.flag.length).toBeGreaterThan(0)
    }
  })

  it('every fallback target is itself a declared MarketplaceCode', () => {
    for (const code of ALL_MARKETPLACES) {
      const fb = MARKETPLACE_DEFINITIONS[code].fallback
      expect(MARKETPLACE_DEFINITIONS[fb]).toBeTruthy()
    }
  })
})

describe('static PUBLIC_EBAY_CAMPAIGN_IDS map (anti-dynamic-env)', () => {
  it('the registry source file uses only literal process.env.NAME accesses, never dynamic process.env[name]', async () => {
    const fs   = await import('node:fs')
    const path = await import('node:path')
    const file = path.resolve(process.cwd(), 'src', 'lib', 'marketplaces.ts')
    const src  = fs.readFileSync(file, 'utf8')
    // The single allowed dynamic access exists only in a comment that
    // documents the anti-pattern. Strip line comments before scanning.
    const stripped = src
      .split('\n')
      .map(l => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(/process\.env\s*\[/.test(stripped)).toBe(false)
  })

  it('readCampaignId reads exclusively from PUBLIC_EBAY_CAMPAIGN_IDS, not process.env at call time', () => {
    // Both env var sources are clear (beforeEach). Mutating process.env
    // directly must NOT change the answer — the function reads the map.
    process.env.NEXT_PUBLIC_EBAY_CAMPID_UK = 'sneaky-runtime-value'
    expect(readCampaignId('UK')).toBeNull()
    delete process.env.NEXT_PUBLIC_EBAY_CAMPID_UK
  })

  it('readCampaignId returns the trimmed map value when the map slot is populated', () => {
    MAP.UK = '  abc123  '
    expect(readCampaignId('UK')).toBe('abc123')
  })

  it('readCampaignId treats undefined and whitespace as null', () => {
    expect(readCampaignId('UK')).toBeNull()
    MAP.UK = ''
    expect(readCampaignId('UK')).toBeNull()
    MAP.UK = '   '
    expect(readCampaignId('UK')).toBeNull()
  })
})

describe('countryToMarketplace', () => {
  it('maps the UK / GB / IE bucket to UK', () => {
    expect(countryToMarketplace('GB')).toBe('UK')
    expect(countryToMarketplace('UK')).toBe('UK')
    expect(countryToMarketplace('IE')).toBe('UK')
  })

  it('maps DE / AT / CH to DE', () => {
    expect(countryToMarketplace('DE')).toBe('DE')
    expect(countryToMarketplace('AT')).toBe('DE')
    expect(countryToMarketplace('CH')).toBe('DE')
  })

  it('maps FR / BE / LU / MC to FR', () => {
    expect(countryToMarketplace('FR')).toBe('FR')
    expect(countryToMarketplace('BE')).toBe('FR')
    expect(countryToMarketplace('LU')).toBe('FR')
    expect(countryToMarketplace('MC')).toBe('FR')
  })

  it('falls back to US for unknown / empty / non-string input', () => {
    expect(countryToMarketplace('ZZ')).toBe('US')
    expect(countryToMarketplace('')).toBe('US')
    expect(countryToMarketplace(null)).toBe('US')
    expect(countryToMarketplace(undefined)).toBe('US')
    // @ts-expect-error explicit non-string input is tolerated
    expect(countryToMarketplace(42)).toBe('US')
  })

  it('accepts lowercase input', () => {
    expect(countryToMarketplace('gb')).toBe('UK')
    expect(countryToMarketplace(' us ')).toBe('US')
  })
})

describe('readiness model: implemented / configured / selectable', () => {
  it('IMPLEMENTED_MARKETPLACES today is exactly UK + US', () => {
    expect([...IMPLEMENTED_MARKETPLACES].sort()).toEqual(['UK', 'US'])
  })

  it('isMarketplaceImplemented matches IMPLEMENTED_MARKETPLACES', () => {
    for (const code of ALL_MARKETPLACES) {
      expect(isMarketplaceImplemented(code)).toBe(IMPLEMENTED_MARKETPLACES.includes(code))
    }
  })

  it('isMarketplaceSelectable requires BOTH implemented and configured', () => {
    // Implemented but not configured — not selectable.
    expect(isMarketplaceImplemented('UK')).toBe(true)
    expect(isMarketplaceConfigured('UK')).toBe(false)
    expect(isMarketplaceSelectable('UK')).toBe(false)

    // Implemented + configured — selectable.
    MAP.UK = 'uk-id'
    expect(isMarketplaceSelectable('UK')).toBe(true)

    // Configured but not implemented — not selectable.
    MAP.DE = 'de-id'
    expect(isMarketplaceImplemented('DE')).toBe(false)
    expect(isMarketplaceConfigured('DE')).toBe(true)
    expect(isMarketplaceSelectable('DE')).toBe(false)
  })

  it('selectableMarketplaces returns only entries where both states are true', () => {
    MAP.UK = 'uk'
    MAP.US = 'us'
    MAP.DE = 'de' // configured but not implemented → excluded
    MAP.FR = 'fr' // configured but not implemented → excluded
    expect(selectableMarketplaces()).toEqual(['UK', 'US'])
  })
})

describe('configuration helpers', () => {
  it('isMarketplaceConfigured reflects map values', () => {
    expect(isMarketplaceConfigured('US')).toBe(false)
    MAP.US = 'usval'
    expect(isMarketplaceConfigured('US')).toBe(true)
  })

  it('configuredMarketplaces returns configured entries in canonical order regardless of implementation', () => {
    MAP.US = 'us'
    MAP.DE = 'de'
    expect(configuredMarketplaces()).toEqual(['US', 'DE'])
  })

  it('pickConfigured walks the chain and returns the first hit', () => {
    MAP.DE = 'de'
    expect(pickConfigured(['UK', 'US', 'DE'])).toBe('DE')
    expect(pickConfigured(['UK', 'US'])).toBeNull()
  })

  it('nearestConfiguredMarketplace prefers the requested code, then its fallback, then any configured', () => {
    MAP.US = 'us'
    // UK is unconfigured, but its declared fallback is US.
    expect(nearestConfiguredMarketplace('UK')).toBe('US')
    // Nothing configured at all → null.
    MAP.US = undefined
    expect(nearestConfiguredMarketplace('UK')).toBeNull()
  })

  it('ultimateFallback prefers UK then any configured marketplace', () => {
    expect(ultimateFallback()).toBeNull()
    MAP.US = 'us'
    expect(ultimateFallback()).toBe('US')
    MAP.UK = 'uk'
    expect(ultimateFallback()).toBe('UK')
  })
})

describe('namespace exports', () => {
  it('exposes the readiness API publicly', () => {
    expect(typeof marketplacesModule.isMarketplaceImplemented).toBe('function')
    expect(typeof marketplacesModule.isMarketplaceSelectable).toBe('function')
    expect(typeof marketplacesModule.selectableMarketplaces).toBe('function')
    expect(typeof marketplacesModule.PUBLIC_EBAY_CAMPAIGN_IDS).toBe('object')
  })
})
