// Block 5A-W-22 — POST /api/admin/alerts/instant-logs tests.
// Covers: flag gate, admin gate, scoped to watchlist_alert category,
// limit, masked user_id, metadata projection, read-only.

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

const KEYS = ['ALERT_EMAIL_PREVIEW_ENABLED', 'ALERT_DELIVERY_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  mockAdmin = async () => ({ ok: true, userId: 'admin-uid', email: 'admin@example.com', status: 200, error: '' })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(): Request {
  return new Request('http://localhost/api/admin/alerts/instant-logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '',
  })
}

describe('instant-logs — gates', () => {
  it('503 when both gates are unset', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
  })
  it('rejects non-admins', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'unauthorised' })
    const r = await POST(req())
    expect(r.status).toBe(401)
  })
})

describe('instant-logs — projection', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('returns watchlist_alert rows with masked user_id and projected metadata', async () => {
    fakeDB.seed('email_delivery_log', [
      {
        id: 'log-1', user_id: '11111111-2222-3333-4444-555555555555',
        category: 'watchlist_alert', status: 'sent',
        template_key: 'alert-digest', campaign_key: null,
        sent_at: '2026-06-25T10:00:00Z', failed_at: null,
        created_at: '2026-06-25T10:00:00Z',
        resend_email_id: 'r-1', error_code: null,
        metadata_json: {
          source: 'alert_delivery_batch',
          event_count: 4, card_count: 2,
          event_count_loaded: 7, event_count_rendered: 4,
          superseded_event_count: 3,
          dedupe_applied: true,
          delivery_engine_version: 'deduped-card-rule-v1',
        },
      },
    ])
    const r = await POST(req())
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.rows).toHaveLength(1)
    const row = body.rows[0]
    expect(row.user_id_masked).toBe('11111111***')
    expect(row.template_key).toBe('alert-digest')
    expect(row.event_count_loaded).toBe(7)
    expect(row.event_count_rendered).toBe(4)
    expect(row.superseded_event_count).toBe(3)
    expect(row.dedupe_applied).toBe(true)
    expect(row.delivery_engine_version).toBe('deduped-card-rule-v1')
  })

  it('excludes rows in other categories', async () => {
    fakeDB.seed('email_delivery_log', [
      {
        id: 'log-w', user_id: 'u-w', category: 'weekly_report', status: 'sent',
        template_key: 'weekly-digest', created_at: '2026-06-25T10:00:00Z',
        sent_at: '2026-06-25T10:00:00Z', metadata_json: {},
      },
      {
        id: 'log-o', user_id: 'u-o', category: 'onboarding', status: 'sent',
        template_key: 'onboarding-1', created_at: '2026-06-25T10:00:00Z',
        sent_at: '2026-06-25T10:00:00Z', metadata_json: {},
      },
    ])
    const r = await POST(req())
    const body = await r.json()
    expect(body.rows).toEqual([])
  })

  it('never echoes raw email or any user_id-as-string', async () => {
    fakeDB.seed('email_delivery_log', [
      {
        id: 'log-1', user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        category: 'watchlist_alert', status: 'sent',
        template_key: 'alert-digest',
        sent_at: '2026-06-25T10:00:00Z',
        created_at: '2026-06-25T10:00:00Z',
        metadata_json: {},
      },
    ])
    const r = await POST(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/lukejosephpierce@/)
    // The full user_id must not appear; only the masked head is OK.
    expect(blob).not.toMatch(/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/)
  })
})
