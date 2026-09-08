// src/lib/editorial/__tests__/opportunityRadarCache.test.ts
//
// Verifies the daily Radar cache: read-through, force-refresh,
// and graceful degradation when the cache table is unreachable.

import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))

// In-memory fake Supabase — supports the subset used by
// loadOrComputeRadar: from(TABLE).select().eq().maybeSingle()
// and .upsert().
type Row = { calendar_date: string; computed_at: string; radar_json: any }
const fakeRows: Row[] = []
let readShouldFail = false
let writeShouldFail = false

vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({
    from(_table: string) {
      let filterDate: string | null = null
      const chain: any = {
        select() { return chain },
        eq(col: string, val: any) { if (col === 'calendar_date') filterDate = String(val); return chain },
        async maybeSingle() {
          if (readShouldFail) throw new Error('boom')
          const row = fakeRows.find(r => r.calendar_date === filterDate) ?? null
          return { data: row, error: null }
        },
        async upsert(payload: Row | Row[]) {
          if (writeShouldFail) throw new Error('boom-write')
          const rows = Array.isArray(payload) ? payload : [payload]
          for (const r of rows) {
            const existing = fakeRows.findIndex(x => x.calendar_date === r.calendar_date)
            if (existing >= 0) fakeRows[existing] = r
            else fakeRows.push(r)
          }
          return { data: rows, error: null }
        },
      }
      return chain
    },
  }),
}))

// Fake buildOpportunityRadar — deterministic and cheap; increments a
// counter every time it runs so we can assert cache hit vs miss.
let buildCount = 0
vi.mock('../opportunityRadar', () => ({
  buildOpportunityRadar: vi.fn(async (_ctx: any) => {
    buildCount++
    return {
      opportunities: [
        { id: `op-${buildCount}`, kind: 'movers_30d', headlineSuggestion: `Snapshot ${buildCount}`, angle: '', whyNow: '', score: 50, scoreReasons: [], dataStrength: 'medium', citationPotential: 'medium', suggestedArticleType: 'data_study', suggestedTiming: null, relatedSets: [], relatedCards: [], metrics: [], evidenceSummary: [], overlap: { verdict: 'low', topMatchSlug: null, topMatchHeadline: null }, visuals: [] },
      ],
      meta: { generatedAt: new Date().toISOString(), detectorsSuppressed: [] },
    }
  }),
}))

import { loadOrComputeRadar } from '../opportunityRadarCache'

const fakeContext: any = { meta: { today: '2026-09-08', generatedAt: '2026-09-08T00:00:00Z', articleBodyExcerptChars: 1500 }, articles: [], projects: [], release: { today: '2026-09-08', windowDaysBack: 45, windowDaysForward: 120, recent: [], upcoming: [], upcomingCoverageIsThin: false, gapNote: null }, summary: {} }

beforeEach(() => {
  fakeRows.length = 0
  buildCount = 0
  readShouldFail = false
  writeShouldFail = false
})

// ─────────────────────────────────────────────────────────────────
// Same-day stability
// ─────────────────────────────────────────────────────────────────

describe('loadOrComputeRadar: same-day stability', () => {
  it('first call computes + persists; second same-day call returns the cache without recomputing', async () => {
    const first = await loadOrComputeRadar(fakeContext)
    expect(first.fromCache).toBe(false)
    expect(buildCount).toBe(1)
    expect(fakeRows).toHaveLength(1)

    const second = await loadOrComputeRadar(fakeContext)
    expect(second.fromCache).toBe(true)
    // buildOpportunityRadar was NOT called a second time.
    expect(buildCount).toBe(1)
    // Both calls return the same radar payload.
    expect(second.radar).toEqual(first.radar)
    expect(second.computedAt).toBe(first.computedAt)
  })

  it('third same-day call still hits cache', async () => {
    await loadOrComputeRadar(fakeContext)
    await loadOrComputeRadar(fakeContext)
    const third = await loadOrComputeRadar(fakeContext)
    expect(third.fromCache).toBe(true)
    expect(buildCount).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// Force refresh
// ─────────────────────────────────────────────────────────────────

describe('loadOrComputeRadar: force refresh', () => {
  it('force=true recomputes even when a cached row exists', async () => {
    await loadOrComputeRadar(fakeContext)
    expect(buildCount).toBe(1)

    const forced = await loadOrComputeRadar(fakeContext, { force: true })
    expect(forced.fromCache).toBe(false)
    expect(buildCount).toBe(2)
    // The forced result was upserted so subsequent normal reads
    // return the NEW radar, not the old one.
    const followUp = await loadOrComputeRadar(fakeContext)
    expect(followUp.fromCache).toBe(true)
    expect(followUp.radar).toEqual(forced.radar)
    expect(followUp.computedAt).toBe(forced.computedAt)
    // Still no extra compute triggered by the follow-up read.
    expect(buildCount).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────
// Degradation
// ─────────────────────────────────────────────────────────────────

describe('loadOrComputeRadar: graceful degradation', () => {
  it('when the cache read errors (e.g. missing table), computes on the fly', async () => {
    readShouldFail = true
    const r = await loadOrComputeRadar(fakeContext)
    expect(r.fromCache).toBe(false)
    expect(buildCount).toBe(1)
    // r.radar was still returned successfully.
    expect(r.radar.opportunities.length).toBeGreaterThan(0)
  })

  it('when the cache write errors, still returns a fresh radar', async () => {
    writeShouldFail = true
    const r = await loadOrComputeRadar(fakeContext)
    expect(r.fromCache).toBe(false)
    expect(buildCount).toBe(1)
    expect(r.radar.opportunities.length).toBeGreaterThan(0)
  })
})
