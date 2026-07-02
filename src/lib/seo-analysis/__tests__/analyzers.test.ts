// Block 5A-W-33 — analyzer unit tests.
// Uses tiny anonymised fixtures only; never reads real export data.

import { describe, it, expect } from 'vitest'
import { parseCsv, parseCsvRows } from '../csvParse'
import { isBrandedQuery, splitBrandedNonBranded } from '../brandedQueries'
import { classifyPage, toPath, type PageType } from '../pageClassifier'
import {
  findOpportunities,
  MIN_IMPRESSIONS,
  OPPORTUNITY_BAND,
  CTR_THRESHOLD,
} from '../ctrOpportunity'
import { summarise } from '../timeSeries'
import { summariseCoverage } from '../coverageAnalysis'
import { summariseEbay } from '../ebayAnalysis'
import {
  computeCtr,
  parseCtrString,
  POSITION_COLUMN_CANDIDATES,
} from '../rowParsing'

// ── csvParse ────────────────────────────────────────────────────────

describe('parseCsv', () => {
  it('parses a simple two-row file with a header', () => {
    const out = parseCsv('a,b\n1,2\n3,4')
    expect(out).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }])
  })

  it('handles quoted fields and commas inside quotes', () => {
    const out = parseCsv('a,b\n"1,000","hello, world"')
    expect(out).toEqual([{ a: '1,000', b: 'hello, world' }])
  })

  it('handles escaped double-quotes inside a quoted field', () => {
    const out = parseCsv('a\n"she said ""hi"""')
    expect(out).toEqual([{ a: 'she said "hi"' }])
  })

  it('tolerates CRLF line endings', () => {
    const out = parseCsv('a,b\r\n1,2\r\n')
    expect(out).toEqual([{ a: '1', b: '2' }])
  })

  it('strips a leading UTF-8 BOM', () => {
    const text = '﻿a\n1'
    const out = parseCsv(text)
    expect(out).toEqual([{ a: '1' }])
  })

  it('returns an empty array on empty input', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('parseCsvRows handles missing trailing newline', () => {
    expect(parseCsvRows('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

// ── brandedQueries ──────────────────────────────────────────────────

describe('isBrandedQuery', () => {
  it('matches the canonical brand', () => {
    expect(isBrandedQuery('pokeprices')).toBe(true)
    expect(isBrandedQuery('Pokeprices')).toBe(true)
    expect(isBrandedQuery('POKEPRICES')).toBe(true)
  })

  it('matches spaced variant via normalization', () => {
    expect(isBrandedQuery('poke prices')).toBe(true)
    expect(isBrandedQuery('poke  prices')).toBe(true)
  })

  it('matches singular variant', () => {
    expect(isBrandedQuery('pokeprice')).toBe(true)
    expect(isBrandedQuery('poke price')).toBe(true)
  })

  it('matches when brand is part of a longer query', () => {
    expect(isBrandedQuery('pokeprices uk')).toBe(true)
    expect(isBrandedQuery('pokeprices.io reviews')).toBe(true)
    expect(isBrandedQuery('what is pokeprices')).toBe(true)
  })

  it('rejects unrelated queries', () => {
    expect(isBrandedQuery('charizard price')).toBe(false)
    expect(isBrandedQuery('pokemon')).toBe(false)
    expect(isBrandedQuery('pokemon prices')).toBe(false)
    expect(isBrandedQuery('')).toBe(false)
  })

  it('rejects suspiciously similar but distinct terms', () => {
    expect(isBrandedQuery('pricecharting')).toBe(false)
  })
})

describe('splitBrandedNonBranded', () => {
  it('partitions rows correctly and ignores null/missing query', () => {
    const rows = [
      { query: 'pokeprices', impressions: 100 },
      { query: 'charizard', impressions: 200 },
      { query: null, impressions: 0 },
    ]
    const { branded, nonBranded } = splitBrandedNonBranded(rows)
    expect(branded.map(r => r.query)).toEqual(['pokeprices'])
    expect(nonBranded.map(r => r.query)).toEqual(['charizard', null])
  })
})

// ── pageClassifier ──────────────────────────────────────────────────

describe('classifyPage', () => {
  const cases: Array<{ input: string; expected: PageType }> = [
    { input: 'https://www.pokeprices.io/',                                                         expected: 'home' },
    { input: '/',                                                                                  expected: 'home' },
    { input: 'https://www.pokeprices.io',                                                          expected: 'home' },
    { input: 'https://www.pokeprices.io/set/Stellar%20Crown/card/12345',                           expected: 'card' },
    { input: '/set/black-bolt/card/abc',                                                           expected: 'card' },
    { input: 'https://www.pokeprices.io/set/Surging%20Sparks',                                     expected: 'set' },
    { input: 'https://www.pokeprices.io/pokemon',                                                  expected: 'pokemon' },
    { input: 'https://www.pokeprices.io/pokemon/charizard',                                        expected: 'pokemon' },
    { input: 'https://www.pokeprices.io/insights/grading-guide',                                   expected: 'insights' },
    { input: 'https://www.pokeprices.io/tools',                                                    expected: 'tools' },
    { input: 'https://www.pokeprices.io/vendors',                                                  expected: 'vendors' },
    { input: 'https://www.pokeprices.io/vendors/my-shop',                                          expected: 'vendors' },
    { input: 'https://www.pokeprices.io/vendors/submit',                                           expected: 'submit' },
    { input: 'https://www.pokeprices.io/creators',                                                 expected: 'creators' },
    { input: 'https://www.pokeprices.io/creators/some-creator',                                    expected: 'creators' },
    { input: 'https://www.pokeprices.io/creators/submit',                                          expected: 'submit' },
    { input: 'https://www.pokeprices.io/card-shows',                                               expected: 'card-shows' },
    { input: 'https://www.pokeprices.io/card-shows/uk',                                            expected: 'card-shows' },
    { input: 'https://www.pokeprices.io/card-shows/uk/london',                                     expected: 'card-shows' },
    { input: 'https://www.pokeprices.io/games',                                                    expected: 'games' },
    { input: 'https://www.pokeprices.io/games/higher-lower',                                       expected: 'games' },
    { input: 'https://www.pokeprices.io/dashboard',                                                expected: 'private' },
    { input: 'https://www.pokeprices.io/dashboard/portfolio',                                      expected: 'private' },
    { input: 'https://www.pokeprices.io/admin/recent-sales',                                       expected: 'private' },
    { input: 'https://www.pokeprices.io/intel/login',                                              expected: 'private' },
    { input: 'https://www.pokeprices.io/auth/reset-password',                                      expected: 'private' },
    { input: 'https://www.pokeprices.io/api/account/plan',                                         expected: 'private' },
    { input: 'https://www.pokeprices.io/scan-test',                                                expected: 'private' },
    { input: 'https://www.pokeprices.io/dealer',                                                   expected: 'dealer' },
    { input: 'https://www.pokeprices.io/studio',                                                   expected: 'studio' },
    { input: 'https://www.pokeprices.io/ai-assistant',                                             expected: 'ai-assistant' },
    { input: 'https://www.pokeprices.io/roadmap',                                                  expected: 'roadmap' },
    { input: 'https://www.pokeprices.io/visualisations',                                           expected: 'visualisations' },
    { input: 'https://www.pokeprices.io/visualisations/heatmap',                                   expected: 'visualisations' },
    { input: 'https://www.pokeprices.io/browse',                                                   expected: 'browse' },
    { input: 'https://www.pokeprices.io/privacy',                                                  expected: 'legal' },
    { input: 'https://www.pokeprices.io/terms',                                                    expected: 'legal' },
    { input: 'https://www.pokeprices.io/contact',                                                  expected: 'legal' },
    { input: 'https://www.pokeprices.io/something-weird',                                          expected: 'other' },
  ]
  for (const c of cases) {
    it(`classifies ${c.input} → ${c.expected}`, () => {
      expect(classifyPage(c.input)).toBe(c.expected)
    })
  }

  it('places submit forms outside their parent template bucket', () => {
    // Critical for opportunity tables — a /vendors/submit row should not
    // count toward "vendor page CTR".
    expect(classifyPage('https://www.pokeprices.io/vendors/submit')).toBe('submit')
    expect(classifyPage('https://www.pokeprices.io/creators/submit')).toBe('submit')
  })

  it('tolerates trailing slashes, query strings, and fragments', () => {
    expect(classifyPage('https://www.pokeprices.io/set/foo/card/bar/')).toBe('card')
    expect(classifyPage('https://www.pokeprices.io/set/foo?utm_source=x')).toBe('set')
    expect(classifyPage('https://www.pokeprices.io/insights/x#section')).toBe('insights')
  })

  it('toPath strips host', () => {
    expect(toPath('https://www.pokeprices.io/foo/bar')).toBe('/foo/bar')
    expect(toPath('https://pokeprices.io/foo')).toBe('/foo')
    expect(toPath('/already/relative')).toBe('/already/relative')
    expect(toPath('')).toBe('/')
  })
})

// ── ctrOpportunity ──────────────────────────────────────────────────

describe('findOpportunities', () => {
  it('returns rows that meet all three thresholds', () => {
    const rows = [
      { page: '/a', impressions: 500, clicks: 2, ctr: 0.004, avgPosition: 10 },  // hit
      { page: '/b', impressions: 50,  clicks: 0, ctr: 0,     avgPosition: 10 },  // too few impressions
      { page: '/c', impressions: 500, clicks: 0, ctr: 0,     avgPosition: 2  },  // position too good (not opportunity)
      { page: '/d', impressions: 500, clicks: 0, ctr: 0,     avgPosition: 50 },  // position too low
      { page: '/e', impressions: 500, clicks: 50, ctr: 0.1,  avgPosition: 10 },  // already high CTR
    ]
    const out = findOpportunities(rows)
    expect(out.map(r => r.page)).toEqual(['/a'])
  })

  it('sorts opportunities by impressions descending', () => {
    const rows = [
      { page: '/low',  impressions: 200, clicks: 1, ctr: 0.005, avgPosition: 10 },
      { page: '/high', impressions: 999, clicks: 1, ctr: 0.001, avgPosition: 10 },
      { page: '/mid',  impressions: 500, clicks: 1, ctr: 0.002, avgPosition: 10 },
    ]
    const out = findOpportunities(rows)
    expect(out.map(r => r.page)).toEqual(['/high', '/mid', '/low'])
  })

  it('annotates each opportunity with a reason and recommended action', () => {
    const rows = [
      { page: '/x', pageType: 'card' as PageType, impressions: 300, clicks: 1, ctr: 0.003, avgPosition: 12 },
    ]
    const out = findOpportunities(rows)
    expect(out).toHaveLength(1)
    expect(out[0]!.opportunityReason).toContain('pos 12')
    expect(out[0]!.opportunityReason).toContain('type=card')
    expect(out[0]!.recommendedAction).toContain('W34')
  })

  it('handles NaN / Infinity / negative numbers safely', () => {
    const rows = [
      { page: '/a', impressions: NaN,      clicks: 0, ctr: 0,        avgPosition: 10 },
      { page: '/b', impressions: 500,      clicks: 0, ctr: NaN,      avgPosition: 10 },
      { page: '/c', impressions: 500,      clicks: 0, ctr: 0.005,    avgPosition: NaN },
      { page: '/d', impressions: Infinity, clicks: 0, ctr: 0.001,    avgPosition: 10 },
    ]
    const out = findOpportunities(rows)
    // /d has Infinity impressions — Number.isFinite catches it.
    expect(out.map(r => r.page)).toEqual([])
  })

  it('threshold constants stay at the values the report pins', () => {
    expect(MIN_IMPRESSIONS).toBe(100)
    expect(OPPORTUNITY_BAND.min).toBe(5)
    expect(OPPORTUNITY_BAND.max).toBe(20)
    expect(CTR_THRESHOLD).toBe(0.01)
  })
})

// ── timeSeries ──────────────────────────────────────────────────────

describe('summarise (time series)', () => {
  it('handles an empty series gracefully', () => {
    const s = summarise([])
    expect(s.totalDays).toBe(0)
    expect(s.total).toBe(0)
    expect(s.mean).toBe(0)
    expect(s.weekOverWeekDelta).toBeNull()
    expect(s.weekOverWeekPct).toBeNull()
    expect(s.rolling7).toEqual([])
  })

  it('sums and means a small series', () => {
    const s = summarise([
      { date: '2026-06-01', value: 10 },
      { date: '2026-06-02', value: 20 },
      { date: '2026-06-03', value: 30 },
    ])
    expect(s.total).toBe(60)
    expect(s.mean).toBe(20)
    expect(s.firstDate).toBe('2026-06-01')
    expect(s.lastDate).toBe('2026-06-03')
  })

  it('computes week-over-week growth on a 14-day series', () => {
    const points = []
    for (let i = 1; i <= 14; i++) {
      // first week mean = 10; last week mean = 20 → +100%
      points.push({ date: `2026-06-${String(i).padStart(2, '0')}`, value: i <= 7 ? 10 : 20 })
    }
    const s = summarise(points)
    expect(s.weekOverWeekDelta).toBe(10)
    expect(s.weekOverWeekPct).toBe(100)
  })

  it('returns null wowPct when first-week mean is 0', () => {
    const points = []
    for (let i = 1; i <= 14; i++) {
      points.push({ date: `2026-06-${String(i).padStart(2, '0')}`, value: i <= 7 ? 0 : 5 })
    }
    const s = summarise(points)
    expect(s.weekOverWeekDelta).toBe(5)
    expect(s.weekOverWeekPct).toBeNull()
  })

  it('rolling7 produces one entry per input point', () => {
    const points = [1, 2, 3, 4, 5, 6, 7, 8].map((v, i) => ({ date: `2026-06-0${i + 1}`, value: v }))
    const s = summarise(points)
    expect(s.rolling7).toHaveLength(8)
    // Day 8: average of days 2..8 = (2+3+4+5+6+7+8)/7 = 5
    expect(s.rolling7[7]!.value).toBe(5)
  })
})

// ── coverageAnalysis ────────────────────────────────────────────────

describe('summariseCoverage', () => {
  it('handles empty input', () => {
    const s = summariseCoverage([])
    expect(s.firstDate).toBeNull()
    expect(s.trend).toBe('flat')
    expect(s.trendReason).toBe('no data')
  })

  it('detects an improving trend when indexed share rises', () => {
    const s = summariseCoverage([
      { date: '2026-04-01', indexed: 10000, notIndexed: 30000, impressions: 100 },
      { date: '2026-04-15', indexed: 38000, notIndexed: 7000,  impressions: 2000 },
    ])
    expect(s.trend).toBe('improving')
    expect(s.lastIndexedShare).toBeGreaterThan(s.firstIndexedShare!)
  })

  it('detects a worsening trend when indexed share falls', () => {
    const s = summariseCoverage([
      { date: '2026-04-01', indexed: 30000, notIndexed: 10000, impressions: 1000 },
      { date: '2026-04-15', indexed: 8000,  notIndexed: 32000, impressions: 200  },
    ])
    expect(s.trend).toBe('worsening')
  })

  it('flags large jumps in notIndexed as spikes / drops', () => {
    const s = summariseCoverage([
      { date: '2026-04-10', indexed: 7000,  notIndexed: 31000, impressions: 500 },
      { date: '2026-04-11', indexed: 39000, notIndexed: 7000,  impressions: 1200 },  // drop
      { date: '2026-04-12', indexed: 36000, notIndexed: 10500, impressions: 1900 },  // spike (+3500 → not flagged at threshold 5000)
      { date: '2026-04-13', indexed: 10000, notIndexed: 22000, impressions: 1500 },  // spike (+11500 — flagged)
    ])
    expect(s.largeNotIndexedDrops).toHaveLength(1)
    expect(s.largeNotIndexedDrops[0]!.date).toBe('2026-04-11')
    expect(s.largeNotIndexedSpikes).toHaveLength(1)
    expect(s.largeNotIndexedSpikes[0]!.date).toBe('2026-04-13')
  })
})

// ── ebayAnalysis ────────────────────────────────────────────────────

describe('summariseEbay', () => {
  it('totals quantity / sales / earnings without claiming a currency', () => {
    const s = summariseEbay([
      { itemName: 'Card A', quantity: 1, sales: 2.29, earnings: 0.11, campaignName: 'pokeprices-uk', checkoutSite: 'UK', buyerCountry: 'gb', trafficType: 'Desktop', landingPageUrl: 'https://www.ebay.co.uk/sch/i.html' },
      { itemName: 'Card A', quantity: 2, sales: 5.00, earnings: 0.30, campaignName: 'pokeprices-uk', checkoutSite: 'UK', buyerCountry: 'gb', trafficType: 'Desktop', landingPageUrl: 'https://www.ebay.co.uk/sch/i.html' },
      { itemName: 'Card B', quantity: 1, sales: 1.45, earnings: 0.07, campaignName: 'pokeprices-uk', checkoutSite: 'UK', buyerCountry: 'gb', trafficType: 'Mobile',  landingPageUrl: 'https://www.ebay.co.uk/sch/i.html' },
    ])
    expect(s.rowCount).toBe(3)
    expect(s.totalQuantity).toBe(4)
    expect(s.totalSalesNumeric).toBe(8.74)
    expect(s.totalEarningsNumeric).toBe(0.48)
    expect(s.currencyNote).toContain('not in the export')
  })

  it('groups top items by total earnings', () => {
    const s = summariseEbay([
      { itemName: 'Card A', quantity: 1, sales: 2.0, earnings: 0.10 },
      { itemName: 'Card A', quantity: 1, sales: 3.0, earnings: 0.20 },
      { itemName: 'Card B', quantity: 1, sales: 5.0, earnings: 0.05 },
    ])
    expect(s.topItemsByEarnings[0]!.itemName).toBe('Card A')
    expect(s.topItemsByEarnings[0]!.earnings).toBe(0.30)
    expect(s.topItemsByEarnings[1]!.itemName).toBe('Card B')
  })

  it('lists distinct landing pages so W39 can spot generic-search bias', () => {
    const s = summariseEbay([
      { landingPageUrl: 'https://www.ebay.co.uk/sch/i.html' },
      { landingPageUrl: 'https://www.ebay.co.uk/sch/i.html' },
      { landingPageUrl: 'https://www.ebay.co.uk/itm/12345' },
    ])
    expect(s.landingPages).toHaveLength(2)
    expect(s.landingPages[0]!.url).toBe('https://www.ebay.co.uk/sch/i.html')
    expect(s.landingPages[0]!.rows).toBe(2)
  })

  it('handles missing optional fields without crashing', () => {
    const s = summariseEbay([
      {},
      { itemName: 'Card X', sales: 1.0 },
    ])
    expect(s.rowCount).toBe(2)
    expect(s.totalEarningsNumeric).toBe(0)
  })

  it('coerces string numerics (XLSX-converted CSVs)', () => {
    const s = summariseEbay([
      { quantity: '1' as unknown as number, sales: '2.50' as unknown as number, earnings: '0.10' as unknown as number },
    ])
    expect(s.totalSalesNumeric).toBe(2.50)
    expect(s.totalEarningsNumeric).toBe(0.10)
  })
})

// ── rowParsing — Block 5A-W-33B ────────────────────────────────────

describe('parseCtrString', () => {
  it('parses standard percentage notation', () => {
    expect(parseCtrString('0.72%')).toBeCloseTo(0.0072, 6)
    expect(parseCtrString('5.40%')).toBeCloseTo(0.054, 6)
    expect(parseCtrString('41.44%')).toBeCloseTo(0.4144, 6)
  })

  it('parses raw decimal CTR (no percent sign)', () => {
    expect(parseCtrString('0.0072')).toBeCloseTo(0.0072, 6)
    expect(parseCtrString('0.054')).toBeCloseTo(0.054, 6)
  })

  it('treats unmarked values > 1 as already-percentages and re-scales them', () => {
    // Defensive: real GSC exports sometimes ship "72" meaning 72%.
    expect(parseCtrString('72')).toBeCloseTo(0.72, 6)
    expect(parseCtrString('5.4')).toBeCloseTo(0.054, 6)
  })

  it('accepts locale comma decimals', () => {
    expect(parseCtrString('0,72%')).toBeCloseTo(0.0072, 6)
    expect(parseCtrString('0,0072')).toBeCloseTo(0.0072, 6)
  })

  it('strips whitespace around values', () => {
    expect(parseCtrString('  0.72 %  ')).toBeCloseTo(0.0072, 6)
  })

  it('returns null on blank / undefined / unparseable input', () => {
    expect(parseCtrString('')).toBeNull()
    expect(parseCtrString(null)).toBeNull()
    expect(parseCtrString(undefined)).toBeNull()
    expect(parseCtrString('  ')).toBeNull()
    expect(parseCtrString('not a number')).toBeNull()
  })

  it('rejects negative values', () => {
    expect(parseCtrString('-0.5%')).toBeNull()
  })
})

describe('computeCtr', () => {
  it('prefers clicks / impressions over the CSV column when both are sensible', () => {
    // The bug that prompted this helper: CSV said "25.00%", real value
    // is 4/1580 = 0.00253. computeCtr must trust the computation.
    expect(computeCtr(4, 1580, '25.00%')).toBeCloseTo(0.00253, 5)
    expect(computeCtr(18, 2493, '72%')).toBeCloseTo(0.00722, 5)
  })

  it('falls back to the parsed CTR column when clicks are missing', () => {
    expect(computeCtr(null, 1000, '5.4%')).toBeCloseTo(0.054, 6)
    expect(computeCtr(undefined, 1000, '0.054')).toBeCloseTo(0.054, 6)
  })

  it('falls back to the parsed CTR column when impressions are missing', () => {
    expect(computeCtr(20, null, '5.4%')).toBeCloseTo(0.054, 6)
  })

  it('returns 0 when impressions is 0 — never NaN or Infinity', () => {
    const out = computeCtr(0, 0, '')
    expect(Number.isFinite(out)).toBe(true)
    expect(out).toBe(0)
  })

  it('returns 0 when impressions is 0 even if the CSV column is set', () => {
    // No real CTR can exist with 0 impressions. Don't let the column lie.
    const out = computeCtr(5, 0, '50%')
    expect(out).toBe(0)
  })

  it('returns 0 when impressions is negative or NaN', () => {
    expect(computeCtr(5, -10, '')).toBe(0)
    expect(computeCtr(5, NaN, '')).toBe(0)
  })

  it('handles a blank CTR column with valid clicks + impressions', () => {
    expect(computeCtr(18, 2493, '')).toBeCloseTo(0.00722, 5)
  })

  it('never returns NaN or Infinity for any combination', () => {
    const cases: Array<[unknown, unknown, unknown]> = [
      [NaN, 1000, '5%'],
      [10, Infinity, '5%'],
      [Infinity, 100, '5%'],
      ['abc', 100, '5%'],
      [null, null, null],
    ]
    for (const [c, i, f] of cases) {
      const v = computeCtr(c as number, i as number, f)
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('POSITION_COLUMN_CANDIDATES', () => {
  it('includes every variant the real exports use', () => {
    // The bug that prompted this: Bing exports use "Avg. Position"
    // (with a period). The original regex only matched "Position" or
    // "Average position" exactly. Confirm the full list.
    const required = [
      'Position',
      'Average position',
      'Average Position',
      'Avg. Position',
      'Avg. position',
      'Avg Position',
      'Avg position',
      'Avg. pos',
      'Avg pos',
    ]
    for (const c of required) {
      expect(POSITION_COLUMN_CANDIDATES).toContain(c)
    }
  })

  it('exposes a usable shape (read-only string array)', () => {
    expect(Array.isArray(POSITION_COLUMN_CANDIDATES)).toBe(true)
    for (const c of POSITION_COLUMN_CANDIDATES) {
      expect(typeof c).toBe('string')
      expect(c.length).toBeGreaterThan(0)
    }
  })
})
