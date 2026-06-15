// Block 2D correction pass — UK/US URL byte-compat tests for every
// affiliate placement introduced by Block 2D.
//
// Each test asserts the full URL shape:
//   - hostname
//   - mkrid
//   - siteid
//   - campid
//   - customid (v2 form for new placements, legacy form for legacy)
//   - search query (_nkw)
//   - sold filters only on sold_search intents
//
// If any of these regress, the placement test catches it before the
// engine test does — the engine test asserts the engine, the
// placement test asserts how each surface invokes the engine.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildAffiliateLink, getEbayUkUrl, getEbayUsUrl, getEbayUkSoldUrl, getEbayUsSoldUrl } from '../ebayAffiliate'
import { PUBLIC_EBAY_CAMPAIGN_IDS, type MarketplaceCode } from '../marketplaces'

const MAP = PUBLIC_EBAY_CAMPAIGN_IDS as Record<MarketplaceCode, string | undefined>
let snapshot: Record<MarketplaceCode, string | undefined>

beforeEach(() => {
  snapshot = { ...MAP } as Record<MarketplaceCode, string | undefined>
  MAP.UK = 'TEST-UK'
  MAP.US = 'TEST-US'
  process.env.NEXT_PUBLIC_EBAY_CAMPID_UK = 'TEST-UK'
  process.env.NEXT_PUBLIC_EBAY_CAMPID_US = 'TEST-US'
})

afterEach(() => {
  for (const code of Object.keys(MAP) as MarketplaceCode[]) MAP[code] = snapshot[code]
  delete process.env.NEXT_PUBLIC_EBAY_CAMPID_UK
  delete process.env.NEXT_PUBLIC_EBAY_CAMPID_US
})

const UK_HOST  = 'www.ebay.co.uk'
const US_HOST  = 'www.ebay.com'
const UK_MKRID = '710-53481-19255-0'
const US_MKRID = '711-53200-19255-0'
const UK_SITE  = '3'
const US_SITE  = '0'
const CAT_SING = '183454'

function parts(url: string) {
  const u = new URL(url)
  return {
    host:    u.hostname,
    nkw:     u.searchParams.get('_nkw'),
    mkrid:   u.searchParams.get('mkrid'),
    siteid:  u.searchParams.get('siteid'),
    campid:  u.searchParams.get('campid'),
    customid:u.searchParams.get('customid'),
    cat:     u.searchParams.get('_sacat'),
    sold:    u.searchParams.get('LH_Sold'),
    complete:u.searchParams.get('LH_Complete'),
    pref:    u.searchParams.get('LH_PrefLoc'),
    mkevt:   u.searchParams.get('mkevt'),
    toolid:  u.searchParams.get('toolid'),
  }
}

describe('legacy UK/US URL builders — byte-compat (cardSlug customId)', () => {
  it('UK raw URL: ebay.co.uk + correct mkrid/siteid/campid/customid/category, no sold filters', () => {
    const p = parts(getEbayUkUrl('Pikachu Base Set pokemon card', 'pc-1234'))
    expect(p.host).toBe(UK_HOST)
    expect(p.mkrid).toBe(UK_MKRID)
    expect(p.siteid).toBe(UK_SITE)
    expect(p.campid).toBe('TEST-UK')
    expect(p.customid).toBe('pc-1234')
    expect(p.cat).toBe(CAT_SING)
    expect(p.nkw).toBe('Pikachu Base Set pokemon card')
    expect(p.sold).toBeNull()
    expect(p.complete).toBeNull()
    expect(p.pref).toBe('1') // UK always sets LH_PrefLoc
    expect(p.mkevt).toBe('1')
    expect(p.toolid).toBe('10001')
  })

  it('US raw URL: ebay.com + correct mkrid/siteid/campid/customid/category, no LH_PrefLoc', () => {
    const p = parts(getEbayUsUrl('Pikachu Base Set pokemon card', 'pc-1234'))
    expect(p.host).toBe(US_HOST)
    expect(p.mkrid).toBe(US_MKRID)
    expect(p.siteid).toBe(US_SITE)
    expect(p.campid).toBe('TEST-US')
    expect(p.customid).toBe('pc-1234')
    expect(p.cat).toBe(CAT_SING)
    expect(p.pref).toBeNull()
    expect(p.sold).toBeNull()
  })

  it('UK sold URL: LH_Sold + LH_Complete set, customid receives the "-sold" suffix', () => {
    const p = parts(getEbayUkSoldUrl('Pikachu', 'pc-1234'))
    expect(p.host).toBe(UK_HOST)
    expect(p.sold).toBe('1')
    expect(p.complete).toBe('1')
    expect(p.customid).toBe('pc-1234-sold')
  })

  it('US sold URL: LH_Sold + LH_Complete set, customid receives the "-sold" suffix', () => {
    const p = parts(getEbayUsSoldUrl('Pikachu', 'pc-1234'))
    expect(p.host).toBe(US_HOST)
    expect(p.sold).toBe('1')
    expect(p.complete).toBe('1')
    expect(p.customid).toBe('pc-1234-sold')
  })
})

describe('Block 2D placements — buildAffiliateLink produces the documented URL shape', () => {
  it('card-page Raw chip (placement=price_raw, intent=raw)', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'raw',
      cardName:    'Pikachu',
      cardNumber:  '58',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'price_raw',
      pageType:    'card',
      sourceComponent: 'card_price_actions',
    })
    const p = parts(r.url!)
    expect(p.host).toBe(UK_HOST)
    expect(p.mkrid).toBe(UK_MKRID)
    expect(p.siteid).toBe(UK_SITE)
    expect(p.campid).toBe('TEST-UK')
    expect(p.cat).toBe(CAT_SING)
    expect(p.nkw).toBe('Pikachu #58 Base Set pokemon card')
    expect(p.customid).toBe('pp:price_raw:raw:uk:card:959616')
    expect(p.sold).toBeNull()
    expect(p.complete).toBeNull()
  })

  it('card-page PSA 9 chip (placement=price_psa9, intent=psa9)', () => {
    const r = buildAffiliateLink({
      marketplace: 'us',
      intent:      'psa9',
      cardName:    'Pikachu',
      cardNumber:  '58',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'price_psa9',
      pageType:    'card',
      sourceComponent: 'card_price_actions',
    })
    const p = parts(r.url!)
    expect(p.host).toBe(US_HOST)
    expect(p.siteid).toBe(US_SITE)
    expect(p.mkrid).toBe(US_MKRID)
    expect(p.campid).toBe('TEST-US')
    expect(p.nkw).toBe('Pikachu #58 Base Set PSA 9')
    expect(p.customid).toBe('pp:price_psa9:psa9:us:card:959616')
    expect(p.cat).toBe(CAT_SING)
    expect(p.sold).toBeNull()
  })

  it('card-page PSA 10 chip (placement=price_psa10, intent=psa10)', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'psa10',
      cardName:    'Pikachu',
      cardNumber:  '58',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'price_psa10',
      pageType:    'card',
      sourceComponent: 'card_price_actions',
    })
    const p = parts(r.url!)
    expect(p.nkw).toBe('Pikachu #58 Base Set PSA 10')
    expect(p.customid).toBe('pp:price_psa10:psa10:uk:card:959616')
  })

  it('portfolio row, raw holding (placement=portfolio_row, intent=raw)', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'raw',
      cardName:    'Pikachu',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'portfolio_row',
      pageType:    'dashboard',
      sourceComponent: 'portfolio_row',
    })
    const p = parts(r.url!)
    expect(p.host).toBe(UK_HOST)
    expect(p.customid).toBe('pp:portfolio_row:raw:uk:dashboard:959616')
    expect(p.sold).toBeNull()
  })

  it('portfolio row, PSA 10 holding (placement=portfolio_row, intent=psa10)', () => {
    const r = buildAffiliateLink({
      marketplace: 'us',
      intent:      'psa10',
      cardName:    'Pikachu',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'portfolio_row',
      pageType:    'dashboard',
      sourceComponent: 'portfolio_row',
    })
    const p = parts(r.url!)
    expect(p.host).toBe(US_HOST)
    expect(p.customid).toBe('pp:portfolio_row:psa10:us:dashboard:959616')
    expect(p.nkw).toContain('PSA 10')
  })

  it('watchlist row defaults to raw intent', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'raw',
      cardName:    'Pikachu',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'watchlist_row',
      pageType:    'dashboard',
      sourceComponent: 'watchlist_row',
    })
    const p = parts(r.url!)
    expect(p.customid).toBe('pp:watchlist_row:raw:uk:dashboard:959616')
  })

  it('grading-calculator raw scenario chip (placement=grading_report, intent=raw)', () => {
    const r = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'raw',
      cardName:    'Pikachu',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'grading_report',
      pageType:    'grading',
      sourceComponent: 'grading_scenario_action',
    })
    const p = parts(r.url!)
    expect(p.customid).toBe('pp:grading_report:raw:uk:grading:959616')
  })

  it('grading-calculator PSA 10 scenario chip', () => {
    const r = buildAffiliateLink({
      marketplace: 'us',
      intent:      'psa10',
      cardName:    'Pikachu',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'grading_report',
      pageType:    'grading',
      sourceComponent: 'grading_scenario_action',
    })
    const p = parts(r.url!)
    expect(p.customid).toBe('pp:grading_report:psa10:us:grading:959616')
    expect(p.nkw).toContain('PSA 10')
    expect(p.sold).toBeNull()
  })

  it('every Block 2D placement URL has the correct toolid and mkevt', () => {
    const placements = ['price_raw', 'price_psa9', 'price_psa10', 'portfolio_row', 'watchlist_row', 'grading_report']
    for (const placement of placements) {
      const r = buildAffiliateLink({
        marketplace: 'uk',
        intent:      'raw',
        cardName:    'Pikachu',
        setName:     'Base Set',
        cardSlug:    '959616',
        placement,
        pageType:    'card',
        sourceComponent: placement,
      })
      const p = parts(r.url!)
      expect(p.toolid).toBe('10001')
      expect(p.mkevt).toBe('1')
    }
  })

  it('sold filters appear ONLY on sold_search intent, never on raw/psa9/psa10', () => {
    for (const intent of ['raw', 'psa9', 'psa10'] as const) {
      const r = buildAffiliateLink({
        marketplace: 'uk',
        intent,
        cardName:    'Pikachu',
        setName:     'Base Set',
        cardSlug:    '959616',
        placement:   'price_' + intent,
        pageType:    'card',
      })
      const p = parts(r.url!)
      expect(p.sold).toBeNull()
      expect(p.complete).toBeNull()
    }
    const sold = buildAffiliateLink({
      marketplace: 'uk',
      intent:      'sold_search',
      cardName:    'Pikachu',
      setName:     'Base Set',
      cardSlug:    '959616',
      placement:   'price_sold',
      pageType:    'card',
    })
    const p = parts(sold.url!)
    expect(p.sold).toBe('1')
    expect(p.complete).toBe('1')
  })
})
