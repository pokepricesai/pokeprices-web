// Block 5A-W-43B — invariants for the daily_deals CTA deep-link
// builder.
//
// The central marketplace registry (src/lib/marketplaces.ts) reads
// campaign IDs from NEXT_PUBLIC_EBAY_CAMPID_<code> at module load
// time and caches them in a `const`. `vi.stubEnv` after that read
// has no effect, so the test mocks the whole module and exposes a
// mutable campaign-ID map its own tests can flip.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock BEFORE the SUT import — `vi.mock` is hoisted.
const campaignIds: { UK: string | null; US: string | null } = { UK: '5339105001', US: '5339105002' }
vi.mock('@/lib/marketplaces', () => {
  const MARKETPLACE_DEFINITIONS = {
    UK: { code: 'UK', hostname: 'www.ebay.co.uk', siteId: '3',  mkrid: '710-53481-19255-0' },
    US: { code: 'US', hostname: 'www.ebay.com',   siteId: '0',  mkrid: '711-53200-19255-0' },
  } as const
  return {
    MARKETPLACE_DEFINITIONS,
    readCampaignId: (code: 'UK' | 'US') => campaignIds[code] || null,
  }
})

import { buildDealDeepLink, parseEbayItemUrl } from '../affiliateDealLink'

beforeEach(() => {
  campaignIds.UK = '5339105001'
  campaignIds.US = '5339105002'
})

describe('parseEbayItemUrl', () => {
  it('returns UK marketplace + item id for an ebay.co.uk /itm/ URL', () => {
    expect(parseEbayItemUrl('https://www.ebay.co.uk/itm/123456789012')).toEqual({
      marketplace: 'UK', itemId: '123456789012',
    })
  })

  it('returns US marketplace + item id for an ebay.com /itm/ URL', () => {
    expect(parseEbayItemUrl('https://www.ebay.com/itm/999888777')).toEqual({
      marketplace: 'US', itemId: '999888777',
    })
  })

  it('handles the title-slug variant "/itm/some-title-slug/12345"', () => {
    expect(parseEbayItemUrl('https://www.ebay.co.uk/itm/charizard-holo/135790246810')).toEqual({
      marketplace: 'UK', itemId: '135790246810',
    })
  })

  it('returns null for null / non-string / empty input', () => {
    expect(parseEbayItemUrl(null)).toBeNull()
    expect(parseEbayItemUrl(undefined)).toBeNull()
    expect(parseEbayItemUrl('')).toBeNull()
    expect(parseEbayItemUrl(123 as any)).toBeNull()
  })

  it('returns null for URLs that fail parsing', () => {
    expect(parseEbayItemUrl('not a url')).toBeNull()
    expect(parseEbayItemUrl('javascript:alert(1)')).toBeNull()
  })

  it('returns null for non-eBay hosts', () => {
    expect(parseEbayItemUrl('https://www.example.com/itm/1234567')).toBeNull()
    expect(parseEbayItemUrl('https://www.ebay-lookalike.com/itm/1234567')).toBeNull()
  })

  it('returns null for eBay URLs that are not /itm/', () => {
    expect(parseEbayItemUrl('https://www.ebay.co.uk/sch/i.html?_nkw=charizard')).toBeNull()
    expect(parseEbayItemUrl('https://www.ebay.com/str/pokestop')).toBeNull()
    expect(parseEbayItemUrl('https://www.ebay.co.uk/')).toBeNull()
  })

  it('returns null when the item id is shorter than 6 digits', () => {
    expect(parseEbayItemUrl('https://www.ebay.co.uk/itm/12345')).toBeNull()
  })
})

describe('buildDealDeepLink', () => {
  it('emits a UK deep link with all EPN params for a valid ebay.co.uk /itm/ URL', () => {
    const url = buildDealDeepLink({ itemWebUrl: 'https://www.ebay.co.uk/itm/123456789012' })
    expect(url).not.toBeNull()
    const u = new URL(url!)
    expect(u.origin).toBe('https://www.ebay.co.uk')
    expect(u.pathname).toBe('/itm/123456789012')
    expect(u.searchParams.get('mkcid')).toBe('1')
    expect(u.searchParams.get('mkrid')).toBe('710-53481-19255-0')
    expect(u.searchParams.get('siteid')).toBe('3')
    expect(u.searchParams.get('campid')).toBe('5339105001')
    expect(u.searchParams.get('toolid')).toBe('10001')
    expect(u.searchParams.get('mkevt')).toBe('1')
  })

  it('emits a US deep link with the US mkrid + siteid', () => {
    const url = buildDealDeepLink({ itemWebUrl: 'https://www.ebay.com/itm/999888777' })
    expect(url).not.toBeNull()
    const u = new URL(url!)
    expect(u.origin).toBe('https://www.ebay.com')
    expect(u.searchParams.get('mkrid')).toBe('711-53200-19255-0')
    expect(u.searchParams.get('siteid')).toBe('0')
    expect(u.searchParams.get('campid')).toBe('5339105002')
  })

  it('appends a sanitised customid when supplied', () => {
    const url = buildDealDeepLink({
      itemWebUrl: 'https://www.ebay.co.uk/itm/123456789012',
      customId:   'pp:dashboard-deals:uk',
    })
    expect(new URL(url!).searchParams.get('customid')).toBe('pp:dashboard-deals:uk')
  })

  it('sanitises unsafe customid characters', () => {
    const url = buildDealDeepLink({
      itemWebUrl: 'https://www.ebay.co.uk/itm/123456789012',
      customId:   'pp/deals uk?attack=<script>',
    })
    const custom = new URL(url!).searchParams.get('customid') || ''
    expect(custom).not.toMatch(/[<>?\/= ]/)
  })

  it('returns null when the URL does not parse as an /itm/ URL', () => {
    expect(buildDealDeepLink({ itemWebUrl: null })).toBeNull()
    expect(buildDealDeepLink({ itemWebUrl: 'https://google.com' })).toBeNull()
    expect(buildDealDeepLink({ itemWebUrl: 'https://www.ebay.co.uk/sch/i.html?_nkw=x' })).toBeNull()
  })

  it('returns null when the supplied ebay_item_id disagrees with the URL id (defensive)', () => {
    expect(buildDealDeepLink({
      itemWebUrl:  'https://www.ebay.co.uk/itm/123456789012',
      ebayItemId:  '999999999999',
    })).toBeNull()
  })

  it('accepts a matching ebay_item_id', () => {
    expect(buildDealDeepLink({
      itemWebUrl:  'https://www.ebay.co.uk/itm/123456789012',
      ebayItemId:  '123456789012',
    })).not.toBeNull()
  })

  it('accepts a numeric ebay_item_id that matches the URL', () => {
    expect(buildDealDeepLink({
      itemWebUrl:  'https://www.ebay.co.uk/itm/123456789012',
      ebayItemId:  123456789012,
    })).not.toBeNull()
  })

  it('returns null when the marketplace campaign ID is missing', () => {
    campaignIds.UK = null
    expect(buildDealDeepLink({
      itemWebUrl: 'https://www.ebay.co.uk/itm/123456789012',
    })).toBeNull()
  })
})
