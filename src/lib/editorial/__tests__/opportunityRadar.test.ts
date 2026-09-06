// src/lib/editorial/__tests__/opportunityRadar.test.ts
//
// EIC Block 4 — shape + behaviour tests for the Opportunity Radar.
// Mocks the Supabase service client with a controlled dataset so
// we can assert both the "opportunity found" and "opportunity
// suppressed" branches deterministically.

import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))

type Row = Record<string, any>
const tables: Record<string, Row[]> = {
  card_trends: [],
  card_volume: [],
  psa_population: [],
}

function makeQuery(rows: Row[]) {
  const state = { rows: rows.slice(), rangeFrom: 0 as number | null, rangeTo: null as number | null }
  const chain: any = {
    select() { return chain },
    eq(col: string, val: any) { state.rows = state.rows.filter(r => r[col] === val); return chain },
    in(col: string, vals: any[]) { state.rows = state.rows.filter(r => vals.includes(r[col])); return chain },
    not(col: string, _op: string, val: any) { state.rows = state.rows.filter(r => r[col] !== val); return chain },
    gte(col: string, val: any) { state.rows = state.rows.filter(r => r[col] != null && r[col] >= val); return chain },
    lte(col: string, val: any) { state.rows = state.rows.filter(r => r[col] != null && r[col] <= val); return chain },
    neq(col: string, val: any) { state.rows = state.rows.filter(r => r[col] !== val); return chain },
    order() { return chain },
    limit() { return chain },
    range(from: number, to: number) { state.rangeFrom = from; state.rangeTo = to; return chain },
    then(resolve: (v: any) => any) {
      let out = state.rows
      if (state.rangeFrom != null && state.rangeTo != null) out = out.slice(state.rangeFrom, state.rangeTo + 1)
      return Promise.resolve({ data: out, error: null }).then(resolve)
    },
  }
  return chain
}

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({
    from(name: string) { return makeQuery(tables[name] ?? []) },
  }),
}))

import { buildOpportunityRadar } from '../opportunityRadar'
import type { EditorialContext } from '../context'

// ── Fixtures ─────────────────────────────────────────────────────

const TODAY = new Date('2026-09-06T12:00:00Z')

function baseContext(overrides: Partial<EditorialContext> = {}): EditorialContext {
  return {
    meta: { today: '2026-09-06', generatedAt: TODAY.toISOString(), articleBodyExcerptChars: 1500 },
    articles: [],
    projects: [],
    release: {
      today: '2026-09-06',
      windowDaysBack: 45,
      windowDaysForward: 120,
      recent: [],
      upcoming: [],
      upcomingCoverageIsThin: true,
      gapNote: null,
    },
    summary: {
      totalArticles: 0, articlesPublishedThisMonth: 0, activeProjects: 0, ideasInBacklog: 0,
      upcomingReleases: 0, recentReleases: 0, releasesWithoutCoverage: 0,
    },
    ...overrides,
  }
}

function reset() {
  tables.card_trends = []
  tables.card_volume = []
  tables.psa_population = []
}
beforeEach(reset)

// ── Tests ────────────────────────────────────────────────────────

describe('buildOpportunityRadar', () => {
  it('returns an empty result set with reasons when there is no signal', async () => {
    const radar = await buildOpportunityRadar(baseContext(), { now: TODAY, includeMonthly: false })
    expect(radar.opportunities.length).toBe(0)
    expect(radar.meta.detectorsSuppressed.length).toBeGreaterThan(0)
    // A quiet market should have movers_30d and set_momentum suppressed.
    expect(radar.meta.detectorsSuppressed.some(d => d.kind === 'movers_30d')).toBe(true)
  })

  it('serialises to JSON without cycles', async () => {
    const radar = await buildOpportunityRadar(baseContext(), { now: TODAY, includeMonthly: false })
    const s = JSON.stringify(radar)
    expect(typeof s).toBe('string')
    const round = JSON.parse(s)
    expect(round.meta.today).toBe('2026-09-06')
  })

  it('surfaces a monthly-report opportunity when the previous month has no coverage', async () => {
    const radar = await buildOpportunityRadar(baseContext(), { now: TODAY })
    const monthly = radar.opportunities.find(o => o.kind === 'monthly_report')
    expect(monthly).toBeTruthy()
    expect(monthly!.headlineSuggestion).toContain('August 2026')
    expect(monthly!.citationPotential).toBe('high')
    expect(monthly!.score).toBeGreaterThanOrEqual(80)
  })

  it('suppresses the monthly-report opportunity when the previous month is already covered', async () => {
    const ctx = baseContext({
      articles: [{
        id: 'x', slug: 'aug-report', headline: 'Pokémon Card Market Report — August 2026',
        intro: null, publishedAt: null, theme: null, themeLabel: null,
        seoTitle: null, seoDescription: null, setRefs: null, cardRefs: null,
        wordCount: 500, bodyExcerpt: '…', publicUrl: '',
      }],
      summary: { totalArticles: 1, articlesPublishedThisMonth: 0, activeProjects: 0, ideasInBacklog: 0,
        upcomingReleases: 0, recentReleases: 0, releasesWithoutCoverage: 0 },
    })
    const radar = await buildOpportunityRadar(ctx, { now: TODAY })
    expect(radar.opportunities.find(o => o.kind === 'monthly_report')).toBeUndefined()
  })

  it('surfaces a launch-week opportunity for an upcoming release with no coverage', async () => {
    const ctx = baseContext({
      release: {
        today: '2026-09-06', windowDaysBack: 45, windowDaysForward: 120,
        recent: [], upcoming: [{
          kind: 'upcoming', setName: 'Storm Emerald', altSetNames: [], setCode: 'STE',
          releaseDate: '2026-09-10', jpReleaseDate: '2026-07-31', region: 'global',
          confirmed: false, cardCount: null, daysDelta: 4, releaseCalendarId: 7,
          pokePricesSetUrl: null, sources: ['release_calendar'],
          coverage: { publishedInsights: [], plannedProjects: [], status: 'none' },
          timingOpportunities: [
            { key: 'launch', label: 'Full-set guide + launch pricing', applicable: true, reason: '…' },
            { key: 'reveal', label: 'Chase-card reveals', applicable: false, reason: '…' },
          ],
          notes: null,
        }],
        upcomingCoverageIsThin: true, gapNote: null,
      },
      summary: { totalArticles: 0, articlesPublishedThisMonth: 0, activeProjects: 0, ideasInBacklog: 0,
        upcomingReleases: 1, recentReleases: 0, releasesWithoutCoverage: 1 },
    })
    const radar = await buildOpportunityRadar(ctx, { now: TODAY, includeMonthly: false })
    const rel = radar.opportunities.find(o => o.kind === 'release_driven')
    expect(rel).toBeTruthy()
    expect(rel!.headlineSuggestion).toContain('Storm Emerald')
    expect(rel!.relatedSets).toContain('Storm Emerald')
    expect(rel!.suggestedArticleType).toBe('new_set')
  })

  it('detects a market-mover opportunity when enough trusted movers exist', async () => {
    // Seed 5 trusted risers, all >= $3.00 and > 8% 30d, ungraded high confidence.
    for (let i = 0; i < 5; i++) {
      tables.card_trends.push({
        card_slug: String(1000 + i), card_name: `Card ${i}`, set_name: 'Base Set',
        current_raw: 1000, current_psa9: 0, current_psa10: 0,
        raw_pct_7d: 5, raw_pct_30d: 25 - i, raw_pct_90d: 10,
        psa10_pct_30d: null, psa10_pct_90d: null, trend_quality: 'ok', as_of: '2026-09-06',
      })
      tables.card_volume.push({ card_slug: String(1000 + i), grade: 'Ungraded', confidence: 'high', sales_30d: 20, sales_90d: 60 })
    }
    const radar = await buildOpportunityRadar(baseContext(), { now: TODAY, includeMonthly: false })
    const mv = radar.opportunities.find(o => o.kind === 'movers_30d')
    expect(mv).toBeTruthy()
    expect(mv!.score).toBeGreaterThan(50)
    expect(mv!.visuals).toContain('ranking_table')
  })

  it('detects set momentum when a set has enough concentrated moves', async () => {
    // 5 cards in the same set, 4 moving up ≥ 8%.
    for (let i = 0; i < 5; i++) {
      tables.card_trends.push({
        card_slug: String(2000 + i), card_name: `SetCard ${i}`, set_name: 'Vivid Voltage',
        current_raw: 1500, current_psa9: 0, current_psa10: 0,
        raw_pct_7d: 3, raw_pct_30d: i === 4 ? -2 : 12, raw_pct_90d: 5,
        psa10_pct_30d: null, psa10_pct_90d: null, trend_quality: 'ok', as_of: '2026-09-06',
      })
      tables.card_volume.push({ card_slug: String(2000 + i), grade: 'Ungraded', confidence: 'high', sales_30d: 20, sales_90d: 60 })
    }
    const radar = await buildOpportunityRadar(baseContext(), { now: TODAY, includeMonthly: false })
    const sm = radar.opportunities.find(o => o.kind === 'set_momentum')
    expect(sm).toBeTruthy()
    expect(sm!.headlineSuggestion).toContain('Vivid Voltage')
  })

  it('detects a grading-spread study when >= 20 cards have raw+PSA10 prices', async () => {
    for (let i = 0; i < 25; i++) {
      tables.card_trends.push({
        card_slug: String(3000 + i), card_name: `Cool ${i}`, set_name: 'Team Rocket',
        current_raw: 500, current_psa9: 2500, current_psa10: 8000, // 16× multiple
        raw_pct_7d: null, raw_pct_30d: null, raw_pct_90d: null,
        psa10_pct_30d: null, psa10_pct_90d: null, trend_quality: 'ok', as_of: '2026-09-06',
      })
      tables.card_volume.push({ card_slug: String(3000 + i), grade: 'Ungraded', confidence: 'high', sales_30d: 5, sales_90d: 15 })
    }
    const radar = await buildOpportunityRadar(baseContext(), { now: TODAY, includeMonthly: false })
    const g = radar.opportunities.find(o => o.kind === 'grading_spread')
    expect(g).toBeTruthy()
    expect(g!.citationPotential).toBe('medium') // 25 cards -> medium
    expect(g!.metrics.some(m => m.label.includes('Median'))).toBe(true)
  })
})
