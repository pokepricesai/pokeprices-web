// src/lib/editorial/__tests__/context.test.ts
//
// EIC Block 3 — end-to-end shape test for buildEditorialContext().
// Mocks the service Supabase client so we can drive a controlled
// four-table world and assert the returned context has the expected
// structure and derived summary numbers.

import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))

// ── Table doubles ────────────────────────────────────────────────

type Row = Record<string, any>
const tables: Record<string, Row[]> = {
  insights: [],
  editorial_projects: [],
  release_calendar: [],
  cards: [],
}

function makeQuery(rows: Row[]) {
  // A minimal Supabase-js query-builder double: supports select, eq,
  // neq, gte, lte, order, limit, range, and the terminal thenable
  // that returns { data, error }. `.range()` support was added in
  // Block 5B so paged fetches work under test.
  const state = { rows: rows.slice(), thened: false, rangeFrom: null as number | null, rangeTo: null as number | null }
  const chain: any = {
    select() { return chain },
    eq(col: string, val: any) { state.rows = state.rows.filter(r => r[col] === val); return chain },
    neq(col: string, val: any) { state.rows = state.rows.filter(r => r[col] !== val); return chain },
    gte(col: string, val: any) { state.rows = state.rows.filter(r => r[col] != null && r[col] >= val); return chain },
    lte(col: string, val: any) { state.rows = state.rows.filter(r => r[col] != null && r[col] <= val); return chain },
    order() { return chain },
    limit() { return chain },
    range(from: number, to: number) { state.rangeFrom = from; state.rangeTo = to; return chain },
    then(resolve: (v: any) => any) {
      state.thened = true
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

// Import after the mock is registered.
import { buildEditorialContext } from '../context'

// ── Fixtures ─────────────────────────────────────────────────────

const TODAY = new Date('2026-09-06T12:00:00Z')

function reset() {
  tables.insights = [
    {
      id: 'i-1', slug: 'psa-9-vs-10', headline: 'PSA 9 vs PSA 10 Pokémon Cards',
      intro: 'When the one-grade jump matters.', published_at: '2026-09-01T10:00:00Z',
      theme: 'grading', theme_label: 'Grading & PSA',
      seo_title: 'PSA 9 vs 10 | PokePrices', seo_description: 'Compare PSA 9 vs PSA 10.',
      set_refs: null, card_refs: null, status: 'published',
      body_json: { blocks: [{ type: 'paragraph', text: 'PSA 10 commands a premium over PSA 9.' }] },
    },
    {
      id: 'i-2', slug: 'chaos-rising-report', headline: 'Chaos Rising set report',
      intro: 'Everything about the Mega Evolution set.', published_at: '2026-08-20T10:00:00Z',
      theme: 'market', theme_label: 'Market Analysis',
      seo_title: null, seo_description: null,
      set_refs: null, card_refs: null, status: 'published',
      body_json: { blocks: [{ type: 'paragraph', text: 'Chaos Rising launched with strong demand.' }] },
    },
  ]
  tables.editorial_projects = [
    {
      id: 1, title: 'Storm Emerald first-look', angle: 'What we know about the upcoming Mega Rayquaza set',
      article_type: 'upcoming_set', status: 'planned', priority: 2,
      target_publish_at: '2026-09-04', notes: 'Storm Emerald angle',
      insights_id: null, created_at: '2026-08-30T10:00:00Z', updated_at: '2026-08-30T10:00:00Z',
    },
    {
      id: 2, title: 'Idea about grading trends', angle: null,
      article_type: 'evergreen', status: 'idea', priority: 3,
      target_publish_at: null, notes: null,
      insights_id: null, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z',
    },
  ]
  tables.release_calendar = [
    {
      id: 12, set_name: 'Celebration Collection', set_code: null, release_date: '2026-11-01',
      region: 'global', jp_release_date: null, confirmed: false, notes: 'Rumoured.',
    },
    {
      id: 7,  set_name: 'Storm Emerald', set_code: 'STE', release_date: '2026-09-01',
      region: 'global', jp_release_date: '2026-07-31', confirmed: false, notes: 'JP already out.',
    },
  ]
  tables.cards = [
    { set_name: 'Pitch Black', set_release_date: '2026-07-17' },
    { set_name: 'Pitch Black', set_release_date: '2026-07-17' },
  ]
}

beforeEach(reset)

// ── Tests ────────────────────────────────────────────────────────

describe('buildEditorialContext', () => {
  it('returns the intended top-level shape', async () => {
    const ctx = await buildEditorialContext(TODAY)
    expect(ctx).toHaveProperty('meta')
    expect(ctx).toHaveProperty('articles')
    expect(ctx).toHaveProperty('projects')
    expect(ctx).toHaveProperty('release')
    expect(ctx).toHaveProperty('summary')
    expect(ctx.meta.today).toBe('2026-09-06')
  })

  it('serialises to JSON without cycles or NaN', async () => {
    const ctx = await buildEditorialContext(TODAY)
    const s = JSON.stringify(ctx)
    expect(typeof s).toBe('string')
    expect(s.length).toBeGreaterThan(100)
    // Round-trip and re-inspect a couple of fields to be sure.
    const round = JSON.parse(s)
    expect(round.meta.today).toBe('2026-09-06')
    expect(Array.isArray(round.articles)).toBe(true)
  })

  it('captures both published articles with body excerpts', async () => {
    const ctx = await buildEditorialContext(TODAY)
    expect(ctx.articles.length).toBe(2)
    for (const a of ctx.articles) {
      expect(a).toHaveProperty('slug')
      expect(a).toHaveProperty('headline')
      expect(a).toHaveProperty('bodyExcerpt')
      expect(a).toHaveProperty('publicUrl')
      expect(a.publicUrl).toContain('/insights/')
      expect(a.wordCount).toBeGreaterThan(0)
    }
  })

  it('recognises the Storm Emerald project as covering the upcoming Storm Emerald release', async () => {
    const ctx = await buildEditorialContext(TODAY)
    const storm = ctx.release.upcoming.find(r => r.setName === 'Storm Emerald')
      || ctx.release.recent.find(r => r.setName === 'Storm Emerald')
    expect(storm).toBeTruthy()
    expect(storm!.coverage.status).toBe('planned')
    expect(storm!.coverage.plannedProjects.length).toBeGreaterThan(0)
  })

  it('recognises the Chaos Rising article via body-text mention', async () => {
    // Chaos Rising launched more than 45 days ago, so it does not appear
    // in the release window today. This test proves coverage detection
    // works when the set is present: temporarily add a Chaos Rising
    // release_calendar row inside the window.
    tables.release_calendar.push({
      id: 999, set_name: 'Chaos Rising', set_code: 'CRS', release_date: '2026-09-05',
      region: 'global', jp_release_date: null, confirmed: true, notes: null,
    })
    const ctx = await buildEditorialContext(TODAY)
    const cr = [...ctx.release.recent, ...ctx.release.upcoming].find(r => r.setName === 'Chaos Rising')
    expect(cr).toBeTruthy()
    expect(cr!.coverage.status).toBe('covered')
    expect(cr!.coverage.publishedInsights.some(i => i.slug === 'chaos-rising-report')).toBe(true)
  })

  it('marks a release with no coverage as "none"', async () => {
    const ctx = await buildEditorialContext(TODAY)
    const cel = ctx.release.upcoming.find(r => r.setName === 'Celebration Collection')
    expect(cel).toBeTruthy()
    expect(cel!.coverage.status).toBe('none')
  })

  it('summary numbers are derived from the returned data', async () => {
    const ctx = await buildEditorialContext(TODAY)
    expect(ctx.summary.totalArticles).toBe(2)
    expect(ctx.summary.ideasInBacklog).toBe(1)
    expect(ctx.summary.activeProjects).toBe(2) // planned + idea; neither is closed
    expect(ctx.summary.upcomingReleases).toBe(ctx.release.upcoming.length)
    expect(ctx.summary.recentReleases).toBe(ctx.release.recent.length)
    expect(ctx.summary.releasesWithoutCoverage).toBeGreaterThanOrEqual(0)
  })

  it('bounds body excerpts to the configured character cap', async () => {
    const ctx = await buildEditorialContext(TODAY)
    for (const a of ctx.articles) {
      expect(a.bodyExcerpt.length).toBeLessThanOrEqual(ctx.meta.articleBodyExcerptChars + 1) // + ellipsis
    }
  })
})
