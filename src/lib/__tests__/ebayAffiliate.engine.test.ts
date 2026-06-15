import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildAffiliateLink,
  buildSearchQuery,
  affiliateWrapEbayUrl,
  hasMarketplaceCampaign,
} from '../ebayAffiliate'
import { PUBLIC_EBAY_CAMPAIGN_IDS, type MarketplaceCode } from '../marketplaces'

// The engine's new buildAffiliateLink path reads campaign IDs from
// PUBLIC_EBAY_CAMPAIGN_IDS (captured at module load). vi.stubEnv only
// affects process.env at runtime — which would be silently ignored by
// the new path. Tests must mutate the map directly to set up state.
const MAP = PUBLIC_EBAY_CAMPAIGN_IDS as Record<MarketplaceCode, string | undefined>
let mapSnapshot: Record<MarketplaceCode, string | undefined>

beforeEach(() => {
  mapSnapshot = { ...MAP } as Record<MarketplaceCode, string | undefined>
  MAP.UK = 'TEST-UK'
  MAP.US = 'TEST-US'
  // Keep the legacy exports' process.env reads in sync with the map
  // for the legacy URL builders that still consult process.env.
  vi.stubEnv('NEXT_PUBLIC_EBAY_CAMPID_UK', 'TEST-UK')
  vi.stubEnv('NEXT_PUBLIC_EBAY_CAMPID_US', 'TEST-US')
})

afterEach(() => {
  for (const code of Object.keys(MAP) as MarketplaceCode[]) MAP[code] = mapSnapshot[code]
})

describe('buildSearchQuery', () => {
  it('raw query: name + #number + set + pokemon card', () => {
    expect(buildSearchQuery({
      marketplace: 'uk',
      intent:      'raw',
      cardName:    'Pikachu',
      cardNumber:  '58',
      setName:     'Base Set',
    })).toBe('Pikachu #58 Base Set pokemon card')
  })

  it('PSA 9 query has PSA 9 suffix, no duplicate "pokemon card"', () => {
    const q = buildSearchQuery({
      marketplace: 'uk',
      intent:      'psa9',
      cardName:    'Pikachu',
      cardNumber:  '58',
      setName:     'Base Set',
    })
    expect(q).toBe('Pikachu #58 Base Set PSA 9')
    expect(q).not.toMatch(/pokemon card/i)
  })

  it('PSA 10 query', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'psa10', cardName: 'Pikachu', cardNumber: '58', setName: 'Base Set' }))
      .toBe('Pikachu #58 Base Set PSA 10')
  })

  it('PSA 8 query', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'psa8', cardName: 'Pikachu', cardNumber: '58', setName: 'Base Set' }))
      .toBe('Pikachu #58 Base Set PSA 8')
  })

  it('graded with CGC 9.5', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'graded', cardName: 'Pikachu', setName: 'Base Set', gradingCompany: 'cgc', grade: '9.5' }))
      .toBe('Pikachu Base Set CGC 9.5')
  })

  it('graded sold search carries grade in the query', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'sold_search', cardName: 'Pikachu', setName: 'Base Set', gradingCompany: 'PSA', grade: '10' }))
      .toBe('Pikachu Base Set PSA 10')
  })

  it('japanese drops the set name and adds Japanese Pokemon card', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'japanese', cardName: 'Pikachu', cardNumber: '058' }))
      .toBe('Pikachu #058 Japanese Pokemon card')
  })

  it('set_search uses set name + pokemon set', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'set_search', setName: 'Base Set' }))
      .toBe('Base Set pokemon set')
  })

  it('pokemon_search uses pokemon name + pokemon card', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'pokemon_search', cardName: 'Charizard' }))
      .toBe('Charizard pokemon card')
  })

  it('sealed uses productName + pokemon, no PSA grade text', () => {
    const q = buildSearchQuery({
      marketplace: 'uk',
      intent:      'sealed',
      productName: 'Sword & Shield Booster Box',
    })
    expect(q).toBe('Sword & Shield Booster Box pokemon')
    expect(q).not.toMatch(/PSA/)
  })

  it('does not double-append #number when already in name', () => {
    expect(buildSearchQuery({ marketplace: 'uk', intent: 'raw', cardName: 'Pikachu #58', cardNumber: '58', setName: 'Base Set' }))
      .toBe('Pikachu #58 Base Set pokemon card')
  })

  it('strips control characters from the query', () => {
    const q = buildSearchQuery({ marketplace: 'uk', intent: 'raw', cardName: 'Pikachu\x00Bad', setName: 'Base Set' })
    expect(q).not.toMatch(/\x00/)
    // Control chars are replaced with a single space and runs of
    // whitespace are collapsed; the original token splits into two
    // search words.
    expect(q).toBe('Pikachu Bad Base Set pokemon card')
  })
})

describe('buildAffiliateLink — URL composition', () => {
  it('UK raw URL points at ebay.co.uk + singles category + campid + customid', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'raw',
      cardName:    'Pikachu',
      cardNumber:  '58',
      setName:     'Base Set',
      placement:   'card_page',
      pageType:    'card',
      cardSlug:    '959616',
    })
    expect(r.url).not.toBeNull()
    const u = new URL(r.url!)
    expect(u.hostname).toBe('www.ebay.co.uk')
    expect(u.searchParams.get('campid')).toBe('TEST-UK')
    expect(u.searchParams.get('mkrid')).toBe('710-53481-19255-0')
    expect(u.searchParams.get('siteid')).toBe('3')
    expect(u.searchParams.get('_sacat')).toBe('183454')
    expect(u.searchParams.get('LH_PrefLoc')).toBe('1')
    expect(u.searchParams.get('mkevt')).toBe('1')
    expect(u.searchParams.get('customid')).toMatch(/^pp:card_page:raw:uk:card:959616$/)
    expect(u.searchParams.get('_nkw')).toBe('Pikachu #58 Base Set pokemon card')
  })

  it('US URL omits LH_PrefLoc, uses correct siteid', () => {
    const r = buildAffiliateLink({ marketplace: 'us', intent: 'raw', cardName: 'Pikachu', setName: 'Base Set' })
    const u = new URL(r.url!)
    expect(u.hostname).toBe('www.ebay.com')
    expect(u.searchParams.get('siteid')).toBe('0')
    expect(u.searchParams.has('LH_PrefLoc')).toBe(false)
    expect(u.searchParams.get('campid')).toBe('TEST-US')
  })

  it('sold_search sets LH_Sold + LH_Complete', () => {
    const r = buildAffiliateLink({ marketplace: 'uk', intent: 'sold_search', cardName: 'Pikachu', setName: 'Base Set' })
    const u = new URL(r.url!)
    expect(u.searchParams.get('LH_Sold')).toBe('1')
    expect(u.searchParams.get('LH_Complete')).toBe('1')
  })

  it('sealed uses the sealed parent category, not singles', () => {
    const r = buildAffiliateLink({ marketplace: 'uk', intent: 'sealed', productName: 'Sword & Shield Booster Box' })
    const u = new URL(r.url!)
    expect(u.searchParams.get('_sacat')).toBe('2536')
  })

  it('returns url: null when the campaign id is empty', () => {
    MAP.UK = ''
    const r = buildAffiliateLink({ marketplace: 'uk', intent: 'raw', cardName: 'Pikachu', setName: 'Base Set' })
    expect(r.url).toBeNull()
    expect(r.campaignId).toBeNull()
    expect(r.customTrackingId.length).toBeGreaterThan(0)
  })

  it('returns url: null when the campaign id is whitespace', () => {
    MAP.US = '   '
    const r = buildAffiliateLink({ marketplace: 'us', intent: 'raw', cardName: 'Pikachu' })
    expect(r.url).toBeNull()
  })

  it('preserves an exact legacyCustomId verbatim', () => {
    const r = buildAffiliateLink({
      marketplace:    'uk',
      intent:         'raw',
      cardName:       'Pikachu',
      setName:        'Base Set',
      legacyCustomId: '959616',
    })
    expect(new URL(r.url!).searchParams.get('customid')).toBe('959616')
  })

  it('v2 custom id is restricted to safe chars and bounded length', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'raw',
      placement:   'card page chips!',
      pageType:    'CARD',
      cardSlug:    'pikachu/95',
    })
    const id = r.customTrackingId
    expect(id.length).toBeLessThanOrEqual(200)
    expect(id).toMatch(/^[A-Za-z0-9._:-]+$/)
    expect(id).toContain('pp:')
  })

  it('URL-encodes spaces and #', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'raw',
      cardName:    'Charizard',
      cardNumber:  '4',
      setName:     'Base Set',
    })
    expect(r.url!).toContain('Charizard+%234+Base+Set+pokemon+card')
  })

  it('analytics metadata reflects intent and marketplace as UK/US', () => {
    const r = buildAffiliateLink({ marketplace: 'us', intent: 'psa10', cardName: 'Pikachu' })
    expect(r.analytics.marketplace).toBe('US')
    expect(r.analytics.intent).toBe('psa10')
    expect(r.analytics.custom_tracking_id).toBeTruthy()
  })
})

describe('affiliateWrapEbayUrl', () => {
  it('rewrites an /itm/<id> URL to a precise affiliate search', () => {
    const r = affiliateWrapEbayUrl('https://www.ebay.com/itm/365842915432', { placement: 'ai_response' })
    expect(r).not.toBeNull()
    expect(r!.marketplace).toBe('us')
    expect(r!.intent).toBe('exact_listing')
    const u = new URL(r!.url!)
    expect(u.hostname).toBe('www.ebay.com')
    expect(u.searchParams.get('_nkw')).toBe('365842915432')
    expect(u.searchParams.get('campid')).toBe('TEST-US')
  })

  it('preserves an existing _nkw query', () => {
    const r = affiliateWrapEbayUrl('https://www.ebay.co.uk/sch/i.html?_nkw=charizard+psa+10&LH_Sold=1')
    expect(r).not.toBeNull()
    expect(r!.intent).toBe('sold_search')
    expect(new URL(r!.url!).searchParams.get('_nkw')).toBe('charizard psa 10')
    expect(new URL(r!.url!).searchParams.get('LH_Sold')).toBe('1')
  })

  it('returns null for a non-eBay URL', () => {
    expect(affiliateWrapEbayUrl('https://example.com/itm/1')).toBeNull()
  })

  it('returns url: null when the marketplace campaign id is missing', () => {
    MAP.UK = ''
    const r = affiliateWrapEbayUrl('https://www.ebay.co.uk/itm/12345678')
    expect(r).not.toBeNull()
    expect(r!.url).toBeNull()
  })

  it('returns null on garbage input', () => {
    expect(affiliateWrapEbayUrl('not a url')).toBeNull()
    expect(affiliateWrapEbayUrl('')).toBeNull()
    // @ts-expect-error intentionally bad input
    expect(affiliateWrapEbayUrl(42)).toBeNull()
  })
})

describe('hasMarketplaceCampaign', () => {
  it('true when env set', () => {
    expect(hasMarketplaceCampaign('uk')).toBe(true)
    expect(hasMarketplaceCampaign('us')).toBe(true)
  })

  it('false when env is missing', () => {
    MAP.UK = ''
    expect(hasMarketplaceCampaign('uk')).toBe(false)
  })
})
