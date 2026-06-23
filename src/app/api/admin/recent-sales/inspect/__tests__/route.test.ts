// Block 4B-W-3A — /api/admin/recent-sales/inspect route.
// Verifies: env-flag gate (503), admin gate (401), GET-only path,
// no-PII response, success path returns the snapshot.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

let mockAdmin: () => Promise<{ ok: boolean; userId: string; email: string; status: number; error: string }>
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: (_req: Request) => mockAdmin(),
}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import { GET } from '../route'

const KEYS = ['RECENT_SALES_ADMIN_VIEW_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  mockAdmin = async () => ({ ok: true, userId: 'u', email: 'a@x', status: 200, error: '' })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(): Request {
  return new Request('http://localhost/api/admin/recent-sales/inspect', { method: 'GET' })
}

describe('GET /api/admin/recent-sales/inspect — fail-closed gating', () => {
  it('503 when RECENT_SALES_ADMIN_VIEW_ENABLED is unset', async () => {
    const r = await GET(req())
    expect(r.status).toBe(503)
    const j = await r.json()
    expect(j.error).toMatch(/disabled/i)
  })

  it('503 even when the literal is not exactly "true"', async () => {
    for (const v of ['1','yes','TRUE','True','enabled']) {
      process.env.RECENT_SALES_ADMIN_VIEW_ENABLED = v
      const r = await GET(req())
      expect(r.status).toBe(503)
    }
  })

  it('flag does not bypass admin gate (401 when admin rejects)', async () => {
    process.env.RECENT_SALES_ADMIN_VIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await GET(req())
    expect(r.status).toBe(401)
  })

  it('returns 403 when admin returns 403', async () => {
    process.env.RECENT_SALES_ADMIN_VIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'not authorised' })
    const r = await GET(req())
    expect(r.status).toBe(403)
  })
})

describe('GET /api/admin/recent-sales/inspect — success path', () => {
  beforeEach(() => { process.env.RECENT_SALES_ADMIN_VIEW_ENABLED = 'true' })

  it('returns a snapshot shape with all top-level keys', async () => {
    fakeDB.seed('market_import_runs', [
      { id: 'r1', provider: 'pricecharting', source: 'pilot', status: 'success',
        started_at: '2026-06-22T00:00:00Z', completed_at: '2026-06-22T00:01:00Z',
        duration_ms: 60000, pages_processed: 58, rows_ok: 410, rows_quarantined: 4,
        rows_rejected: 0, rows_duplicate: 0, parser_version: 'recent_sales_parser@v1',
        layout_signature: 'sig-a', notes: null },
    ])
    fakeDB.seed('recent_sales', [
      { provider_sale_key: 'k1', provider: 'pricecharting', provider_card_id: '12054014',
        internal_card_slug: '12054014', card_slug: '12054014',
        marketplace_source: 'ebay', marketplace_country: 'US',
        sale_date: '2026-06-20', sale_price_cents: 1500,
        observed_section: 'Ungraded', grading_company: null, grade: null,
        raw_or_graded: 'raw', condition_bucket: 'near_mint', best_offer_status: 'none',
        parse_status: 'ok', review_status: 'active', parse_confidence: 95,
        first_seen_at: '2026-06-22T00:00:30Z', rejection_reason: null },
      { provider_sale_key: 'k2', provider: 'pricecharting', provider_card_id: '12054014',
        internal_card_slug: '12054014', card_slug: '12054014',
        marketplace_source: 'ebay', marketplace_country: 'US',
        sale_date: '2026-06-21', sale_price_cents: 1600,
        observed_section: 'PSA 10', grading_company: 'PSA', grade: '10',
        raw_or_graded: 'graded', condition_bucket: 'mint', best_offer_status: 'accepted',
        parse_status: 'ok', review_status: 'active', parse_confidence: 92,
        first_seen_at: '2026-06-22T00:00:31Z', rejection_reason: null },
      { provider_sale_key: 'k3', provider: 'pricecharting', provider_card_id: '6377915',
        internal_card_slug: '6377915', card_slug: '6377915',
        marketplace_source: 'heritage', marketplace_country: null,
        sale_date: '2026-06-19', sale_price_cents: 250000,
        observed_section: 'Sealed', grading_company: null, grade: null,
        raw_or_graded: null, condition_bucket: null, best_offer_status: null,
        parse_status: 'quarantined', review_status: 'active', parse_confidence: 60,
        first_seen_at: '2026-06-22T00:00:32Z', rejection_reason: 'unusual price' },
    ])
    const r = await GET(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j).toHaveProperty('generatedAt')
    expect(j).toHaveProperty('importRuns')
    expect(j).toHaveProperty('recentSales')
    expect(j).toHaveProperty('recentSalesHealth')
    expect(j).toHaveProperty('perCard')
    expect(j).toHaveProperty('quarantine')
    expect(j).toHaveProperty('duplicateCheck')
    expect(j).toHaveProperty('latestSamples')
    expect(j).toHaveProperty('affiliateMonitoring')

    // recentSalesHealth shape — values derived from the seeded rows.
    expect(j.recentSalesHealth.totalRows).toBe(3)
    expect(j.recentSalesHealth.okActiveRows).toBe(2)
    expect(j.recentSalesHealth.okSupersededRows).toBe(0)
    expect(j.recentSalesHealth.distinctActiveCards).toBe(1)
    expect(j.recentSalesHealth.gradeCapViolations.cap).toBe(5)
    expect(j.recentSalesHealth.gradeCapViolations.violationCount).toBe(0)
    expect(j.recentSalesHealth.freshness.anchorDate).toBe('2026-06-21')
    expect(j.recentSalesHealth.topActiveCards.length).toBeGreaterThanOrEqual(1)

    // affiliateMonitoring panel is informational and disclosed as
    // GA4-only (no server-side storage exists today).
    expect(j.affiliateMonitoring.available).toBe(false)
    expect(j.affiliateMonitoring.placements).toEqual(
      expect.arrayContaining(['recent_sales_raw', 'recent_sales_psa10']),
    )

    // notesParsed defaults to null when the seeded notes is null.
    expect(j.importRuns[0].notesParsed).toBeNull()

    expect(j.recentSales.totalRows).toBe(3)
    expect(j.recentSales.okRows).toBe(2)
    expect(j.recentSales.activeRows).toBe(2)
    expect(j.recentSales.distinctProviderCards).toBe(2)
    expect(j.recentSales.distinctMarketplaces).toBe(2)
    expect(j.recentSales.parseStatusBreakdown.ok).toBe(2)
    expect(j.recentSales.parseStatusBreakdown.quarantined).toBe(1)
    expect(j.recentSales.bestOfferStatusBreakdown.accepted).toBe(1)
    expect(j.recentSales.bestOfferStatusBreakdown.none).toBe(1)
    expect(j.recentSales.rawOrGradedBreakdown.raw).toBe(1)
    expect(j.recentSales.rawOrGradedBreakdown.graded).toBe(1)

    // perCard only counts parse_status='ok' AND review_status='active' rows.
    // The third seeded row is quarantined, so only the first card appears.
    expect(j.perCard).toHaveLength(1)
    const card1 = j.perCard.find((c: { providerCardId: string }) => c.providerCardId === '12054014')
    expect(card1.rowCount).toBe(2)
    expect(card1.rawCount).toBe(1)
    expect(card1.gradedCount).toBe(1)
    expect(card1.marketplaceBreakdown.ebay).toBe(2)
    expect(card1.latestSaleDate).toBe('2026-06-21')

    expect(j.quarantine.quarantinedRowsInTable).toBe(1)
    expect(j.quarantine.rejectedRowsInTable).toBe(0)
    expect(j.quarantine.runQuarantinedTotal).toBe(4)  // sum across runs

    expect(j.duplicateCheck.duplicateCount).toBe(0)
    expect(j.latestSamples.length).toBe(3)
  })

  it('parses JSON notes into notesParsed when present', async () => {
    fakeDB.seed('market_import_runs', [
      { id: 'r-notes', provider: 'pricecharting', source: 'pilot', status: 'success',
        started_at: '2026-06-22T00:00:00Z', completed_at: '2026-06-22T00:01:00Z',
        duration_ms: 60000, pages_processed: 1, rows_ok: 5, rows_quarantined: 0,
        rows_rejected: 0, rows_duplicate: 0, parser_version: 'v1', layout_signature: null,
        notes: '{"offset": 50, "batch_size": 100, "max_sales_per_grade": 5, "errors_count": 0}' },
    ])
    const r = await GET(req())
    const j = await r.json()
    const run = j.importRuns.find((x: { id: string }) => x.id === 'r-notes')
    expect(run.notesParsed).toEqual({
      offset: 50, batch_size: 100, max_sales_per_grade: 5, errors_count: 0,
    })
  })

  it('returns notesParsed=null for non-JSON / malformed notes (no crash)', async () => {
    fakeDB.seed('market_import_runs', [
      { id: 'r-bad', provider: 'pricecharting', source: 'pilot', status: 'success',
        started_at: '2026-06-21T00:00:00Z', completed_at: '2026-06-21T00:01:00Z',
        duration_ms: 60000, pages_processed: 1, rows_ok: 5, rows_quarantined: 0,
        rows_rejected: 0, rows_duplicate: 0, parser_version: 'v1', layout_signature: null,
        notes: 'plain text from an older run' },
    ])
    const r = await GET(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    const run = j.importRuns.find((x: { id: string }) => x.id === 'r-bad')
    expect(run.notes).toBe('plain text from an older run')
    expect(run.notesParsed).toBeNull()
  })

  it('detects duplicate provider_sale_key when (somehow) present', async () => {
    fakeDB.seed('recent_sales', [
      { provider_sale_key: 'dup', provider: 'pricecharting', provider_card_id: '1',
        internal_card_slug: '1', sale_date: '2026-06-20', sale_price_cents: 100,
        marketplace_source: 'ebay', observed_section: 'Ungraded',
        parse_status: 'ok', review_status: 'active', parse_confidence: 90,
        first_seen_at: '2026-06-22T00:00:30Z' },
      { provider_sale_key: 'dup', provider: 'pricecharting', provider_card_id: '1',
        internal_card_slug: '1', sale_date: '2026-06-20', sale_price_cents: 100,
        marketplace_source: 'ebay', observed_section: 'Ungraded',
        parse_status: 'ok', review_status: 'active', parse_confidence: 90,
        first_seen_at: '2026-06-22T00:00:31Z' },
    ])
    const r = await GET(req())
    const j = await r.json()
    expect(j.duplicateCheck.duplicateCount).toBe(1)
    expect(j.duplicateCheck.duplicateSamples[0].providerSaleKey).toBe('dup')
  })

  it('response contains no email addresses or user IDs', async () => {
    fakeDB.seed('recent_sales', [
      { provider_sale_key: 'k1', provider: 'pricecharting', provider_card_id: '1',
        internal_card_slug: '1', sale_date: '2026-06-20', sale_price_cents: 100,
        marketplace_source: 'ebay', observed_section: 'Ungraded',
        parse_status: 'ok', review_status: 'active', parse_confidence: 90,
        first_seen_at: '2026-06-22T00:00:30Z' },
    ])
    const r = await GET(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"email"/i)
  })
})
