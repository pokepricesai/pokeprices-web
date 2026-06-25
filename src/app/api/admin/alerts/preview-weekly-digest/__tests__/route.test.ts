// Block 5A-W-15 — POST /api/admin/alerts/preview-weekly-digest.
// Covers: dual-flag gate, admin gate, mode handling (auto / real /
// sample), default-self target, response shape, no PII, no DB writes,
// no email send.

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

const KEYS = ['ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED', 'ALERT_EMAIL_PREVIEW_ENABLED'] as const
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
  return new Request('http://localhost/api/admin/alerts/preview-weekly-digest', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    body ? JSON.stringify(body) : '',
  })
}

function seedDigestableAdmin() {
  fakeDB.seed('user_alert_preferences', [
    { user_id: 'admin-uid', ...preferencesToRow(ALERT_PREFERENCE_DEFAULTS) },
  ])
  fakeDB.seed('cards', [
    { card_url_slug: 'charizard-base-4', card_slug: '1450205', card_name: 'Charizard', set_name: 'Base Set' },
  ])
  fakeDB.seed('watchlist', [
    { user_id: 'admin-uid', card_slug: 'charizard-base-4', card_name: null, set_name: null },
  ])
  fakeDB.seed('daily_prices', [
    { card_slug: 'pc-1450205', date: '2026-06-18', raw_usd: 10, psa9_usd: null, psa10_usd: null },
    { card_slug: 'pc-1450205', date: '2026-06-25', raw_usd: 14, psa9_usd: null, psa10_usd: null },
  ])
  fakeDB.seed('recent_sales', [
    { internal_card_slug: '1450205', sale_date: '2026-06-24T10:00:00Z', parse_status: 'ok', review_status: 'active' },
  ])
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/preview-weekly-digest — gates', () => {
  it('503 when neither flag is set', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect((await r.json()).error).toMatch(/disabled/i)
  })

  it('200 when ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED=true and the other is unset', async () => {
    process.env.ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
  })

  it('200 when ALERT_EMAIL_PREVIEW_ENABLED=true and the other is unset', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
  })

  it('rejects flag values other than the literal "true"', async () => {
    for (const v of ['1', 'yes', 'TRUE', 'enabled']) {
      process.env.ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED = v
      const r = await POST(req())
      expect(r.status).toBe(503)
    }
  })

  it('401 when admin auth fails', async () => {
    process.env.ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await POST(req())
    expect(r.status).toBe(401)
  })

  it('403 when admin returns 403', async () => {
    process.env.ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 403, error: 'not authorised' })
    const r = await POST(req())
    expect(r.status).toBe(403)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Mode handling
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/preview-weekly-digest — modes', () => {
  beforeEach(() => { process.env.ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED = 'true' })

  it('defaults to auto-mode and uses sample when the admin has no real data', async () => {
    const r = await POST(req())
    const j = await r.json()
    expect(r.status).toBe(200)
    expect(j.mode).toBe('sample')
    expect(j.sample).toBe(true)
    expect(j.subject).toMatch(/\[SAMPLE\] Your weekly PokePrices update/)
    expect(j.html).toMatch(/Sample data/)
  })

  it('auto-mode resolves to real when the admin has actual data', async () => {
    seedDigestableAdmin()
    const r = await POST(req())
    const j = await r.json()
    expect(j.mode).toBe('real')
    expect(j.sample).toBe(false)
    expect(j.subject).toBe('Your weekly PokePrices update')   // no SAMPLE prefix
    expect(j.html).not.toMatch(/Sample data/)
    expect(j.status).toBe('ok')
  })

  it('mode=sample always renders sample data even when real data exists', async () => {
    seedDigestableAdmin()
    const r = await POST(req({ mode: 'sample' }))
    const j = await r.json()
    expect(j.mode).toBe('sample')
    expect(j.sample).toBe(true)
    expect(j.html).toMatch(/Sample data/)
  })

  it('mode=real never falls back to sample, even on an empty system', async () => {
    const r = await POST(req({ mode: 'real' }))
    const j = await r.json()
    expect(j.mode).toBe('real')
    expect(j.sample).toBe(false)
    expect(j.html).not.toMatch(/Sample data/)
    // With no prefs row, defaults apply (enabled + weeklyDigestEnabled,
    // both scopes on). Both sections render their empty-state copy
    // rather than being omitted — auto-mode would have swapped in
    // sample data; mode=real explicitly opts out of that.
    expect(j.html).toMatch(/No portfolio items yet/)
    expect(j.html).toMatch(/Your watchlist is empty/)
  })

  it('responds with subject / previewText / html / text / status / diagnostics', async () => {
    const r = await POST(req({ mode: 'sample' }))
    const j = await r.json()
    expect(typeof j.subject).toBe('string')
    expect(typeof j.previewText).toBe('string')
    expect(typeof j.html).toBe('string')
    expect(typeof j.text).toBe('string')
    expect(typeof j.status).toBe('string')
    expect(j.diagnostics).toBeDefined()
    expect(typeof j.diagnostics.generatedAt).toBe('string')
  })

  it('accepts an explicit userId and previews that user instead of the admin', async () => {
    // Seed another user with prefs but disable their weekly digest →
    // result should reflect THAT user's setting, not the admin's.
    fakeDB.seed('user_alert_preferences', [
      { user_id: 'other-uid', ...preferencesToRow({ ...ALERT_PREFERENCE_DEFAULTS, weeklyDigestEnabled: false }) },
    ])
    const r = await POST(req({ mode: 'real', userId: 'other-uid' }))
    const j = await r.json()
    expect(j.status).toBe('disabled_weekly')
    expect(j.html).toMatch(/Weekly overview is turned off/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Safety
// ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/alerts/preview-weekly-digest — safety', () => {
  beforeEach(() => { process.env.ALERT_WEEKLY_DIGEST_PREVIEW_ENABLED = 'true' })

  it('does NOT mutate any database table during the preview', async () => {
    seedDigestableAdmin()
    fakeDB.seed('alert_events', [{
      id: 'e1', user_id: 'admin-uid', card_slug: '1450205',
      card_name: 'Charizard', set_name: 'Base Set',
      rule: 'raw_change', severity: 'normal', payload_json: {},
      detected_at: '2026-06-24T10:00:00Z', delivered_at: null,
    }])
    const snapshot = {
      prefs:     JSON.stringify(fakeDB.rows('user_alert_preferences')),
      cards:     JSON.stringify(fakeDB.rows('cards')),
      watch:     JSON.stringify(fakeDB.rows('watchlist')),
      prices:    JSON.stringify(fakeDB.rows('daily_prices')),
      sales:     JSON.stringify(fakeDB.rows('recent_sales')),
      alerts:    JSON.stringify(fakeDB.rows('alert_events')),
    }
    await POST(req({ mode: 'real' }))
    expect(JSON.stringify(fakeDB.rows('user_alert_preferences'))).toBe(snapshot.prefs)
    expect(JSON.stringify(fakeDB.rows('cards'))).toBe(snapshot.cards)
    expect(JSON.stringify(fakeDB.rows('watchlist'))).toBe(snapshot.watch)
    expect(JSON.stringify(fakeDB.rows('daily_prices'))).toBe(snapshot.prices)
    expect(JSON.stringify(fakeDB.rows('recent_sales'))).toBe(snapshot.sales)
    expect(JSON.stringify(fakeDB.rows('alert_events'))).toBe(snapshot.alerts)
    // email_delivery_log must stay empty — proof we never went near sendEmail.
    expect(fakeDB.rows('email_delivery_log')).toEqual([])
  })

  it('response carries no email address or auth-token-shaped string', async () => {
    seedDigestableAdmin()
    const r = await POST(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"token"/i)
  })
})
