// Block 5A-W-2 — POST /api/admin/alerts/evaluate
// Covers: env-flag gate (503), admin gate (401/403), default dryRun=true,
// explicit dryRun=false write path, body validation, no-PII in response.

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

import { POST } from '../route'
import { preferencesToRow, ALERT_PREFERENCE_DEFAULTS } from '@/lib/alerts/preferences'

const KEYS = ['ALERTS_EVALUATOR_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  mockAdmin = async () => ({ ok: true, userId: 'admin', email: 'a@x', status: 200, error: '' })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/alerts/evaluate', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body ? JSON.stringify(body) : '',
  })
}

function seedReadyToFire() {
  fakeDB.seed('user_alert_preferences', [{ user_id: 'u1', ...preferencesToRow(ALERT_PREFERENCE_DEFAULTS) }])
  fakeDB.seed('watchlist',     [{ user_id: 'u1', card_slug: '1450205', card_name: 'Charizard', set_name: 'Base' }])
  fakeDB.seed('daily_prices',  [
    { card_slug: 'pc-1450205', date: '2026-06-15', raw_usd: 1000, psa10_usd: null },
    { card_slug: 'pc-1450205', date: '2026-06-22', raw_usd: 1200, psa10_usd: null },
  ])
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/evaluate — gates', () => {
  it('503 when ALERTS_EVALUATOR_ENABLED is unset', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect((await r.json()).error).toMatch(/disabled/i)
  })

  it('503 when ALERTS_EVALUATOR_ENABLED is anything other than the literal "true"', async () => {
    for (const v of ['1','yes','TRUE','True','enabled']) {
      process.env.ALERTS_EVALUATOR_ENABLED = v
      const r = await POST(req())
      expect(r.status).toBe(503)
    }
  })

  it('401 when admin auth fails', async () => {
    process.env.ALERTS_EVALUATOR_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await POST(req())
    expect(r.status).toBe(401)
  })

  it('403 when admin returns 403', async () => {
    process.env.ALERTS_EVALUATOR_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'not authorised' })
    const r = await POST(req())
    expect(r.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Dry-run default
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/evaluate — dryRun default', () => {
  beforeEach(() => { process.env.ALERTS_EVALUATOR_ENABLED = 'true' })

  it('defaults dryRun=true with an empty body (no rows inserted)', async () => {
    seedReadyToFire()
    const r = await POST(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.dryRun).toBe(true)
    expect(j.triggersInserted).toBe(0)
    expect(j.proposedEvents.length).toBeGreaterThan(0)
    expect(fakeDB.rows('alert_events')).toEqual([])
  })

  it('defaults dryRun=true when body explicitly passes { dryRun: true }', async () => {
    seedReadyToFire()
    const r = await POST(req({ dryRun: true }))
    const j = await r.json()
    expect(j.dryRun).toBe(true)
    expect(fakeDB.rows('alert_events')).toEqual([])
  })

  it('defaults dryRun=true when body passes a string "false" (only literal boolean writes)', async () => {
    seedReadyToFire()
    const r = await POST(req({ dryRun: 'false' as unknown as boolean }))
    const j = await r.json()
    expect(j.dryRun).toBe(true)
    expect(fakeDB.rows('alert_events')).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// Write mode
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/evaluate — write mode', () => {
  beforeEach(() => { process.env.ALERTS_EVALUATOR_ENABLED = 'true' })

  it('inserts alert_events when dryRun is the literal boolean false', async () => {
    seedReadyToFire()
    const r = await POST(req({ dryRun: false }))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.dryRun).toBe(false)
    expect(j.triggersInserted).toBeGreaterThan(0)
    const inserted = fakeDB.rows('alert_events')
    expect(inserted.length).toBe(j.triggersInserted)
    expect(inserted[0]).toMatchObject({
      user_id:  'u1',
      card_slug: '1450205',
      rule:     'raw_change',
    })
  })

  it('does NOT send emails (no Resend / sendEmail call surface invoked)', async () => {
    seedReadyToFire()
    await POST(req({ dryRun: false }))
    // The fake supabase has no email_delivery_log writes; the route
    // never imports email modules. Nothing to assert beyond schema:
    expect(fakeDB.rows('email_delivery_log')).toEqual([])
  })

  it('honours an optional limitUsers cap', async () => {
    // Seed five users; cap to two.
    for (let i = 0; i < 5; i++) {
      fakeDB.seed('user_alert_preferences', [
        ...fakeDB.rows('user_alert_preferences'),
        { user_id: `u${i}`, ...preferencesToRow(ALERT_PREFERENCE_DEFAULTS) },
      ])
      fakeDB.seed('watchlist', [
        ...fakeDB.rows('watchlist'),
        { user_id: `u${i}`, card_slug: '1450205', card_name: 'Charizard', set_name: 'Base' },
      ])
    }
    fakeDB.seed('daily_prices', [
      { card_slug: 'pc-1450205', date: '2026-06-15', raw_usd: 1000, psa10_usd: null },
      { card_slug: 'pc-1450205', date: '2026-06-22', raw_usd: 1200, psa10_usd: null },
    ])
    const r = await POST(req({ dryRun: true, limitUsers: 2 }))
    const j = await r.json()
    expect(j.usersConsidered).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Privacy
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/evaluate — privacy', () => {
  beforeEach(() => { process.env.ALERTS_EVALUATOR_ENABLED = 'true' })

  it('response contains no email addresses', async () => {
    seedReadyToFire()
    const r = await POST(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
  })
})
