// Block 5A-W-4 — POST /api/admin/alerts/preview-email.
// Covers: dual-flag gate, admin gate, real vs sample vs auto, response
// shape, no PII, no DB writes.

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

const KEYS = ['ALERTS_EVALUATOR_ENABLED', 'ALERT_EMAIL_PREVIEW_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  mockAdmin = async () => ({ ok: true, userId: 'admin-uid', email: 'a@x', status: 200, error: '' })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/alerts/preview-email', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body ? JSON.stringify(body) : '',
  })
}

function seedRealEvents(userId: string) {
  fakeDB.seed('alert_events', [
    { user_id: userId, card_slug: '1450205', card_name: "Lt. Surge's Raichu", set_name: 'Gym Challenge',
      rule: 'raw_change', severity: 'high', payload_json: { old: 12500, new: 16875, pct: 35 },
      detected_at: '2026-06-24T10:00:00Z', delivered_at: null },
    { user_id: userId, card_slug: '9536051', card_name: 'Haunter', set_name: 'Fossil',
      rule: 'recent_sales', severity: 'normal', payload_json: { recent_active_count: 3, window_days: 7 },
      detected_at: '2026-06-24T09:00:00Z', delivered_at: null },
    // Already delivered — must NOT appear.
    { user_id: userId, card_slug: '11870547', card_name: "Larry's Starly", set_name: 'Ascended Heroes',
      rule: 'psa10_change', severity: 'normal', payload_json: { old: 1000, new: 1100, pct: 10 },
      detected_at: '2026-06-22T09:00:00Z', delivered_at: '2026-06-23T08:00:00Z' },
    // Different user — must NOT appear.
    { user_id: 'other-user', card_slug: '12054014', card_name: 'Raikou', set_name: 'Promo',
      rule: 'raw_change', severity: 'high', payload_json: { old: 1500, new: 3000, pct: 100 },
      detected_at: '2026-06-24T10:30:00Z', delivered_at: null },
  ])
  fakeDB.seed('cards', [
    { card_slug: '1450205', set_name: 'Gym Challenge', card_url_slug: 'lt-surges-raichu-1st-edition-11' },
    { card_slug: '9536051', set_name: 'Fossil',         card_url_slug: 'haunter-incomplete-holo-error-6'   },
  ])
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/preview-email — gates', () => {
  it('503 when neither flag is set', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect((await r.json()).error).toMatch(/disabled/i)
  })

  it('200 when ALERTS_EVALUATOR_ENABLED=true and ALERT_EMAIL_PREVIEW_ENABLED unset', async () => {
    process.env.ALERTS_EVALUATOR_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
  })

  it('200 when ALERT_EMAIL_PREVIEW_ENABLED=true and the other flag is unset', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
  })

  it('503 when either flag is a non-literal-true value', async () => {
    for (const v of ['1','yes','TRUE','True']) {
      process.env.ALERTS_EVALUATOR_ENABLED   = v
      process.env.ALERT_EMAIL_PREVIEW_ENABLED = v
      const r = await POST(req())
      expect(r.status).toBe(503)
    }
  })

  it('401 when admin auth fails', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await POST(req())
    expect(r.status).toBe(401)
  })

  it('403 when admin returns 403', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'not authorised' })
    const r = await POST(req())
    expect(r.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Sample mode
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/preview-email — sample mode', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('returns sample mode with [SAMPLE] subject when no alert_events exist and mode=auto', async () => {
    const r = await POST(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.mode).toBe('sample')
    expect(j.sample).toBe(true)
    expect(j.subject).toMatch(/^\[SAMPLE\]/)
    expect(j.eventCount).toBeGreaterThan(0)
    expect(j.html).toMatch(/<html/i)
    expect(j.text.length).toBeGreaterThan(0)
  })

  it('returns sample mode when mode=sample even if real events exist', async () => {
    seedRealEvents('admin-uid')
    const r = await POST(req({ mode: 'sample' }))
    const j = await r.json()
    expect(j.mode).toBe('sample')
    expect(j.sample).toBe(true)
    // The sample event set is the hand-crafted one, not the seed.
    // The renderer HTML-escapes apostrophes to &#39; — match the escaped form.
    expect(j.html).toMatch(/Lt\.\s?Surge&#39;s Raichu \[1st Edition\]/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Real mode
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/preview-email — real mode', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('returns real mode when the admin has undelivered events (mode=auto)', async () => {
    seedRealEvents('admin-uid')
    const r = await POST(req())
    const j = await r.json()
    expect(j.mode).toBe('real')
    expect(j.sample).toBe(false)
    expect(j.eventCount).toBe(2)   // delivered + other-user excluded
    expect(j.subject).not.toMatch(/^\[SAMPLE\]/)
    // The renderer HTML-escapes apostrophes — match the escaped form
    // (or use a plain substring that does not include the apostrophe).
    expect(j.html).toMatch(/Lt\.\s?Surge&#39;s Raichu/)
    expect(j.html).toMatch(/Haunter/)
  })

  it('returns real mode with zero events when mode=real and admin has none', async () => {
    const r = await POST(req({ mode: 'real' }))
    const j = await r.json()
    expect(j.mode).toBe('real')
    expect(j.eventCount).toBe(0)
    expect(j.html).toMatch(/No new alerts since your last digest/)
  })

  it('renders card-page links for slugs that resolve in the cards table', async () => {
    seedRealEvents('admin-uid')
    const r = await POST(req())
    const j = await r.json()
    expect(j.html).toMatch(/href="https:\/\/www\.pokeprices\.io\/set\/Gym%20Challenge\/card\/lt-surges-raichu-1st-edition-11"/)
  })

  it('renders the event without a View card button when the slug is missing from cards', async () => {
    // Seed only the alert_events; do NOT seed cards. The event row
    // should render with no "View card" button — but the branded
    // footer's Manage-alerts link does still appear, so we cannot
    // blanket-assert there is no href anywhere in the document.
    fakeDB.seed('alert_events', [
      { user_id: 'admin-uid', card_slug: '9999999', card_name: 'Unresolvable', set_name: 'X',
        rule: 'raw_change', severity: 'normal', payload_json: { old: 100, new: 110, pct: 10 },
        detected_at: '2026-06-24T09:00:00Z', delivered_at: null },
    ])
    const r = await POST(req())
    const j = await r.json()
    expect(j.html).toMatch(/Unresolvable/)
    expect(j.html).not.toMatch(/View card →/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Safety: no writes, no PII
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/preview-email — safety', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('does not insert, update or delete alert_events', async () => {
    seedRealEvents('admin-uid')
    const before = fakeDB.rows('alert_events').map(r => ({ ...r }))
    await POST(req())
    await POST(req({ mode: 'sample' }))
    await POST(req({ mode: 'real' }))
    const after = fakeDB.rows('alert_events').map(r => ({ ...r }))
    expect(after).toEqual(before)
  })

  it('never writes to email_delivery_log (no send path executed)', async () => {
    seedRealEvents('admin-uid')
    await POST(req())
    expect(fakeDB.rows('email_delivery_log')).toEqual([])
  })

  it('response contains no email addresses, no user_id keys', async () => {
    seedRealEvents('admin-uid')
    const r = await POST(req())
    const j = await r.json()
    const blob = JSON.stringify(j)
    expect(blob).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"email"/i)
    // The seeded admin user_id must not leak into the body content.
    expect(blob).not.toMatch(/admin-uid/)
    // Nor any other user's id.
    expect(blob).not.toMatch(/other-user/)
  })
})
