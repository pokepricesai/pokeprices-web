// src/lib/studio/dataBlocks/__tests__/acceptance.test.ts
//
// EIC Block 8 — acceptance drafts.
//
// Live Studio drafts for the August 2026 market report and the
// Population Scarcity study, built programmatically through the
// factory API. Locks:
//   * Population scarcity carries correct populationAsOf/priceAsOf
//     per row.
//   * Quarantined rows (the six zero-pop-with-price and the 23
//     August extreme movers) never enter a publishable table.
//   * Raw/PSA comparison factory refuses to build from a blocked
//     pack (Block 5C 32.4x regression protection).
//   * Adapter passes data_block variant + payload through cleanly.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import type { EvidencePack, QuarantineEntry } from '@/lib/editorial/research/types'
import {
  createRankingTableFromResearch, createStatCalloutFromFact, createMethodologyBlock,
  createRawPsaComparisonFromResearch, createPriceChartLive, createCardBlock,
} from '../factories'
import { studioDocumentToInsightBody } from '@/lib/studio/adapter'

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

function augustPack(): EvidencePack {
  return {
    version: 1,
    recipe: 'monthly_market_report',
    project: { id: 42, title: 'August 2026 report', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
    generatedAt: '2026-09-06T00:00:00Z',
    dataAsOf: '2026-08-31',
    methodology: {
      summary: 'Compared raw card prices on 2026-08-01 and 2026-08-31. Sample is the intersection.',
      filters: [
        { label: 'Start date', value: '2026-08-01' },
        { label: 'End date',   value: '2026-08-31' },
      ],
      excludedGroups: [{ label: 'start-only cards', reason: '221 cards' }, { label: 'end-only cards', reason: '76 cards' }],
      dedupKey: 'card_slug',
    },
    verifiedFacts: [
      { id: 'fact-window',       type: 'verified_fact', statement: 'Report window: 2026-08-01 to 2026-08-31 (August 2026).', evidenceRefs: [], asOf: '2026-08-31' },
      { id: 'fact-both-raw',     type: 'verified_fact', statement: '62,645 cards have a raw price on both dates.', evidenceRefs: [], asOf: '2026-08-31' },
    ],
    derivedFindings: [
      { id: 'finding-median-raw', type: 'derived_finding', statement: 'Median raw-price change was +0.0%.', formula: 'median(rawPct)', evidenceRefs: ['fact-both-raw'], asOf: '2026-08-31' },
      { id: 'finding-direction',  type: 'derived_finding', statement: '22,795 cards rose >1%; 24,493 fell >1%; 15,357 flat.', formula: 'count', evidenceRefs: ['fact-both-raw'], asOf: '2026-08-31' },
    ],
    dataTables: [
      {
        id: 'mover-risers-2026-08', title: 'Top raw-price risers, August 2026', source: 'daily_prices + cards', asOf: '2026-08-31',
        columns: [
          { key: 'cardName',   label: 'Card' },
          { key: 'cardNumber', label: '#',      align: 'right' },
          { key: 'setName',    label: 'Set' },
          { key: 'startUsd',   label: 'Start $', align: 'right' },
          { key: 'endUsd',     label: 'End $',   align: 'right' },
          { key: 'pct',        label: '% change',align: 'right' },
        ],
        rows: [
          { cardName: 'Card A', cardNumber: '1', setName: 'Set X', startUsd: 39.92, endUsd: 219.98, pct: 451.1 },
          { cardName: 'Card B', cardNumber: '2', setName: 'Set X', startUsd: 17.97, endUsd: 92.51,  pct: 414.8 },
          { cardName: 'Card C', cardNumber: '3', setName: 'Set X', startUsd: 99.45, endUsd: 500.00, pct: 402.8 },
        ],
      },
    ],
    internalSources: [
      { id: 'src-dp-start', kind: 'internal', label: 'daily_prices start', table: 'daily_prices', asOf: '2026-08-01' },
      { id: 'src-dp-end',   kind: 'internal', label: 'daily_prices end',   table: 'daily_prices', asOf: '2026-08-31' },
    ],
    externalSources: [],
    internalLinks: [],
    visualOpportunities: [],
    warnings: [],
    researchGaps: [],
    rejectedClaims: [{ claim: 'The Pokemon market moved X% in August 2026.', reason: 'attribute to tracked catalogue' }],
    notes: [],
    quarantinedRows: [
      // The +27,755% artifact — must NEVER appear in a publishable ranking
      {
        id: 'q-extreme-1', wouldHaveJoined: 'mover-risers-2026-08', reason: 'extreme_monthly_move', severity: 'major',
        message: 'Card D moved +27,755% ($110.70 to $30,835.63).',
        rowSnapshot: { cardName: 'Card D', cardNumber: '999', setName: 'Set X', startUsd: 110.70, endUsd: 30835.63, pct: 27755.13 },
        contaminatesPublishable: false,
      },
    ] as QuarantineEntry[],
    quality: {
      status: 'ok', dataStrength: 'strong', sampleSize: 62_645,
      freshness: { asOf: '2026-08-31', daysOld: 6, isStale: false },
      publishable: true, reasons: ['All gates cleared.'],
    },
  }
}

function populationPack(): EvidencePack {
  const asOfPop = '2026-05-13'   // stale
  return {
    version: 1,
    recipe: 'population_scarcity',
    project: { id: 51, title: 'Population scarcity study', articleType: 'data_study', angle: null, targetPublishAt: null },
    generatedAt: '2026-09-06T00:00:00Z',
    dataAsOf: asOfPop,
    methodology: {
      summary: 'psa_population < 200 PSA 10 + >= 100 total graded, deduped and filtered.',
      filters: [
        { label: 'PSA 10 population', value: '< 200' },
        { label: 'Total graded',      value: '>= 100' },
      ],
      excludedGroups: [{ label: 'reverse-foil variants', reason: 'excluded' }],
      dedupKey: 'psa_spec_id',
    },
    verifiedFacts: [
      { id: 'fact-shortlist', type: 'verified_fact', statement: '3,244 cards clear the price gate after quarantine.', evidenceRefs: ['src-psa-population'], asOf: asOfPop },
    ],
    derivedFindings: [
      { id: 'finding-gem-1', type: 'derived_finding', statement: 'Blissey PSA 10 gem rate is 0.10%.', formula: '1 / 961 * 100', evidenceRefs: ['fact-shortlist'], asOf: asOfPop },
    ],
    dataTables: [
      {
        id: 'population-scarcity-top20', title: 'Top 20 cards by lowest PSA 10 population', source: 'psa_population + cards + card_latest_prices', asOf: asOfPop,
        columns: [
          { key: 'cardName',       label: 'Card' },
          { key: 'setName',        label: 'Set' },
          { key: 'psa10',          label: 'PSA 10 pop', align: 'right' },
          { key: 'totalGraded',    label: 'Total graded', align: 'right' },
          { key: 'gemRate',        label: 'Gem rate %', align: 'right' },
          { key: 'psa10Usd',       label: 'PSA 10 $', align: 'right' },
          { key: 'populationAsOf', label: 'Pop as of' },
          { key: 'priceAsOf',      label: 'Price as of' },
        ],
        rows: [
          { cardName: 'Blissey-Holo',      setName: 'Pokemon Neo Revelation', psa10: 1, totalGraded: 961, gemRate: 0.10, psa10Usd: 11000, populationAsOf: asOfPop, priceAsOf: '2026-09-06' },
          { cardName: 'Blastoise-Holo',    setName: 'Pokemon Base Set',       psa10: 1, totalGraded: 372, gemRate: 0.27, psa10Usd: 8859,  populationAsOf: asOfPop, priceAsOf: '2026-09-06' },
        ],
      },
    ],
    internalSources: [
      { id: 'src-psa-population', kind: 'internal', label: 'psa_population', table: 'psa_population', asOf: asOfPop },
    ],
    externalSources: [], internalLinks: [], visualOpportunities: [],
    warnings: [
      { id: 'stale-1', severity: 'major', message: `PSA snapshot is 116 days old.` },
    ],
    researchGaps: [],
    rejectedClaims: [
      { claim: 'Only <N> PSA 10 copies exist today.', reason: 'Population data is 116 days old.' },
    ],
    notes: [],
    quarantinedRows: [
      // A row that would be in the shortlist if not quarantined —
      // must NEVER re-enter a publishable ranking.
      {
        id: 'q-zero-pop-dusknoir', wouldHaveJoined: 'population-scarcity-top20', reason: 'zero_pop_with_price', severity: 'major',
        message: 'Dusknoir-Holo #2 (Diamond & Pearl) — 0 PSA 10s but $12,711 PSA 10 price. Excluded.',
        rowSnapshot: { cardName: 'Dusknoir-Holo', setName: 'Pokemon Diamond & Pearl', psa10: 0, totalGraded: 137, gemRate: 0.0, psa10Usd: 12711.07, populationAsOf: asOfPop, priceAsOf: '2026-09-06' },
        contaminatesPublishable: false,
      },
    ] as QuarantineEntry[],
    quality: {
      status: 'needs_review', dataStrength: 'strong', sampleSize: 3244,
      freshness: { asOf: asOfPop, daysOld: 116, isStale: true },
      publishable: true,
      reasons: ['PSA snapshot is 116 days old. Article can ship ONLY if population figures are framed as "PSA population as of 2026-05-13".'],
    },
  }
}

// A minimal "blocked" grading pack that mirrors the 32.4x failure mode.
function blockedGradingPack(): EvidencePack {
  const p = populationPack()
  return {
    ...p,
    quality: { ...p.quality, status: 'blocked', publishable: false, reasons: ['raw side of the sample is a listing floor'] },
    warnings: [{ id: 'w1', severity: 'critical', message: '32.4x median is a data-composition artifact' }],
  }
}

// ─────────────────────────────────────────────────────────────────
// Acceptance A — August 2026 market report
// ─────────────────────────────────────────────────────────────────

describe('acceptance A: August 2026 market report Studio draft', () => {
  const pack = augustPack()

  it('methodology block reflects the pack methodology', () => {
    const b = createMethodologyBlock(pack)
    expect(b.variant).toBe('methodology')
    expect(b.payload.summary).toMatch(/2026-08-01/)
    expect(b.payload.asOf).toBe('2026-08-31')
    expect(b.payload.provenance?.packRecipe).toBe('monthly_market_report')
  })

  it('stat callouts preserve the exact evidence value + provenance', () => {
    const a = createStatCalloutFromFact(pack, 'fact-both-raw', { value: '62,645', label: 'cards priced at both August endpoints' })
    const b = createStatCalloutFromFact(pack, 'finding-median-raw', { value: '0.0%', label: 'median monthly move' })
    const c = createStatCalloutFromFact(pack, 'finding-direction', { value: '39.1%', label: 'of the tracked sample fell by more than 1%' })
    for (const stat of [a, b, c]) {
      expect(stat.payload.mode).toBe('snapshot')
      expect(stat.payload.provenance?.asOf).toBe('2026-08-31')
      expect(stat.payload.provenance?.evidenceRefs?.length).toBe(1)
    }
    expect(a.payload.value).toBe('62,645')
  })

  it('corrected top-risers table excludes the +27,755% quarantined row', () => {
    const b = createRankingTableFromResearch(pack, {
      dataTableId: 'mover-risers-2026-08',
      title: 'Top 3 raw-price risers, August 2026',
      limit: 3,
    })
    const rows = b.payload.rows
    expect(rows.some(r => r.cells.cardName === 'Card D')).toBe(false)
    expect(rows.some(r => (r.cells.pct as number) === 27755.13)).toBe(false)
    expect(rows).toHaveLength(3)
  })
})

// ─────────────────────────────────────────────────────────────────
// Acceptance B — Population Scarcity
// ─────────────────────────────────────────────────────────────────

describe('acceptance B: Population Scarcity Studio draft', () => {
  const pack = populationPack()

  it('methodology block carries the stale-population caveat surfaced to the reader', () => {
    const b = createMethodologyBlock(pack)
    const caveatBlob = (b.payload.caveats ?? []).join(' ')
    expect(caveatBlob).toMatch(/PSA population as of 2026-05-13/i)
  })

  it('top-20 ranking table carries populationAsOf and priceAsOf per row', () => {
    const b = createRankingTableFromResearch(pack, { dataTableId: 'population-scarcity-top20', limit: 20 })
    for (const row of b.payload.rows) {
      expect(row.cells.populationAsOf).toBe('2026-05-13')
      expect(row.cells.priceAsOf).toBe('2026-09-06')
    }
  })

  it('ranking table excludes the zero-pop-with-price quarantined row', () => {
    const b = createRankingTableFromResearch(pack, { dataTableId: 'population-scarcity-top20' })
    expect(b.payload.rows.some(r => r.cells.cardName === 'Dusknoir-Holo')).toBe(false)
  })

  it('stat callouts preserve the exact facts', () => {
    const s = createStatCalloutFromFact(pack, 'fact-shortlist', { value: '3,244', label: 'cards clear the ranking gate' })
    expect(s.payload.provenance?.asOf).toBe('2026-05-13')
  })
})

// ─────────────────────────────────────────────────────────────────
// 32.4x regression — comparison from a blocked pack must throw
// ─────────────────────────────────────────────────────────────────

describe('32.4x regression: raw/PSA comparison from a blocked pack', () => {
  const blocked = blockedGradingPack()
  it('refuses to build a comparison', () => {
    expect(() => createRawPsaComparisonFromResearch(blocked, {
      rows: [{ card: { cardSlug: '100', cardName: 'X' }, rawCents: 100, psa10Cents: 32000 }],
      showRatios: true,
    })).toThrow(/blocked|research-required|quality/i)
  })
})

// ─────────────────────────────────────────────────────────────────
// Adapter passthrough
// ─────────────────────────────────────────────────────────────────

describe('adapter passthrough: data_block variant + payload survive to the insight body', () => {
  const pack = augustPack()

  it('adapter carries variant + payload cleanly', () => {
    const methBlock = createMethodologyBlock(pack)
    const stat      = createStatCalloutFromFact(pack, 'fact-both-raw', { value: '62,645', label: 'cards' })
    const tiptapDoc = {
      type: 'doc',
      content: [
        { type: 'dataBlock', attrs: { variant: methBlock.variant, payload: methBlock.payload } },
        { type: 'paragraph', content: [{ type: 'text', text: 'The August 2026 sample was:' }] },
        { type: 'dataBlock', attrs: { variant: stat.variant, payload: stat.payload } },
      ],
    }
    const { body, warnings } = studioDocumentToInsightBody(tiptapDoc)
    expect(warnings).toEqual([])
    expect(body.blocks).toHaveLength(3)
    expect(body.blocks[0]).toMatchObject({ type: 'data_block', variant: 'methodology' })
    expect(body.blocks[2]).toMatchObject({ type: 'data_block', variant: 'stat_callout' })
    // Deep-equality on payload: adapter must not mutate.
    expect((body.blocks[0] as any).payload.summary).toBe(methBlock.payload.summary)
    expect((body.blocks[2] as any).payload.value).toBe('62,645')
  })
})

// ─────────────────────────────────────────────────────────────────
// Live block: card_block factory produces the right shape
// ─────────────────────────────────────────────────────────────────

describe('live card block factory', () => {
  it('creates a live card block with the requested show flags', () => {
    const b = createCardBlock({ card: { cardSlug: '849998', cardName: 'Charmeleon' }, show: { raw: true, psa10: true } })
    expect(b.payload.mode).toBe('live')
    expect(b.payload.snapshot).toBeUndefined()
    expect(b.payload.show.raw).toBe(true)
  })
  it('creates a live price chart with a bounded day window default', () => {
    const b = createPriceChartLive({ card: { cardSlug: '849998', cardName: 'Charmeleon' }, series: ['raw', 'psa10'] })
    expect(b.payload.mode).toBe('live')
    expect(b.payload.days).toBe(180)
  })
})
