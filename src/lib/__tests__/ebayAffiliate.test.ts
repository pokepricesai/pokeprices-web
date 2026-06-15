import { describe, it, expect, beforeEach, vi } from 'vitest'

// Stub env vars BEFORE importing the helper, because campid is read at
// call-time but documented for visibility.
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_EBAY_CAMPID_UK', 'TEST-UK-CAMPID')
  vi.stubEnv('NEXT_PUBLIC_EBAY_CAMPID_US', 'TEST-US-CAMPID')
})

import { getEbayUkUrl, getEbayUsUrl, getEbayUkSoldUrl, getEbayUsSoldUrl, buildCardEbayQuery } from '../ebayAffiliate'

describe('ebayAffiliate.buildCardEbayQuery', () => {
  it('appends the card number when it is not already embedded in the name', () => {
    expect(buildCardEbayQuery('Pikachu', 'Base Set', '58')).toBe('Pikachu #58 Base Set pokemon card')
  })

  it('does not double-append the number when already in the name', () => {
    expect(buildCardEbayQuery('Pikachu #58', 'Base Set', '58')).toBe('Pikachu #58 Base Set pokemon card')
  })

  it('omits the number suffix when no card number is provided', () => {
    expect(buildCardEbayQuery('Pikachu', 'Base Set', null)).toBe('Pikachu Base Set pokemon card')
  })
})

describe('ebayAffiliate URL builders', () => {
  it('UK URL points at ebay.co.uk, sets the campaign id and trading-card category', () => {
    const url = new URL(getEbayUkUrl('Pikachu Base Set pokemon card', 'pc-1234'))
    expect(url.hostname).toBe('www.ebay.co.uk')
    expect(url.searchParams.get('campid')).toBe('TEST-UK-CAMPID')
    expect(url.searchParams.get('mkcid')).toBe('1')
    expect(url.searchParams.get('siteid')).toBe('3')
    expect(url.searchParams.get('_sacat')).toBe('183454')
    expect(url.searchParams.get('LH_PrefLoc')).toBe('1')
    expect(url.searchParams.get('customid')).toBe('pc-1234')
    expect(url.searchParams.get('_nkw')).toBe('Pikachu Base Set pokemon card')
  })

  it('US URL points at ebay.com and omits the UK pref-loc flag', () => {
    const url = new URL(getEbayUsUrl('Pikachu Base Set pokemon card', 'pc-1234'))
    expect(url.hostname).toBe('www.ebay.com')
    expect(url.searchParams.get('siteid')).toBe('0')
    expect(url.searchParams.has('LH_PrefLoc')).toBe(false)
    expect(url.searchParams.get('campid')).toBe('TEST-US-CAMPID')
  })

  it('Sold variants flip the LH_Sold and LH_Complete flags', () => {
    const uk = new URL(getEbayUkSoldUrl('Pikachu', 'pc-1234'))
    expect(uk.searchParams.get('LH_Sold')).toBe('1')
    expect(uk.searchParams.get('LH_Complete')).toBe('1')
    expect(uk.searchParams.get('customid')).toBe('pc-1234-sold')

    const us = new URL(getEbayUsSoldUrl('Pikachu', 'pc-1234'))
    expect(us.searchParams.get('LH_Sold')).toBe('1')
    expect(us.searchParams.get('LH_Complete')).toBe('1')
    expect(us.searchParams.get('customid')).toBe('pc-1234-sold')
  })

  it('omits customid when not provided', () => {
    const url = new URL(getEbayUkUrl('Pikachu'))
    expect(url.searchParams.has('customid')).toBe(false)
  })

  it('URL-encodes spaces and punctuation in the query', () => {
    const raw = getEbayUkUrl('Charizard #4 Base Set pokemon card')
    expect(raw).toContain('Charizard+%234+Base+Set+pokemon+card')
  })
})
