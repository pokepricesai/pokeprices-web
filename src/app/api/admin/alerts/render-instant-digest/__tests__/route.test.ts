// Block 5A-W-22 — POST /api/admin/alerts/render-instant-digest tests.
// Covers: flag gate, admin gate, no-send semantics, dedupe applied
// before render, counters in response, no DB mutation.

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

const KEYS = ['ALERT_EMAIL_PREVIEW_ENABLED', 'ALERTS_EVALUATOR_ENABLED'] as const
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

function req(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/alerts/render-instant-digest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : '',
  })
}

function seedTwoDuplicateEventsForAdmin() {
  fakeDB.seed('alert_events', [
    {
      id: 'rs1', user_id: 'admin-uid', card_slug: '1450205',
      card_name: 'Charizard', set_name: 'Base Set',
      rule: 'recent_sales', severity: 'normal',
      payload_json: { recent_active_count: 5, window_days: 7 },
      detected_at: '2026-06-24T10:00:00Z', delivered_at: null,
    },
    {
      id: 'rs2', user_id: 'admin-uid', card_slug: '1450205',
      card_name: 'Charizard', set_name: 'Base Set',
      rule: 'recent_sales', severity: 'normal',
      payload_json: { recent_active_count: 9, window_days: 7 },
      detected_at: '2026-06-25T10:00:00Z', delivered_at: null,
    },
  ])
}

describe('render-instant-digest — gates', () => {
  it('503 when both gates are unset', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
  })

  it('proceeds when ALERT_EMAIL_PREVIEW_ENABLED=true', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
  })

  it('rejects non-admins', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'unauthorised' })
    const r = await POST(req())
    expect(r.status).toBe(401)
  })
})

describe('render-instant-digest — behaviour', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('applies the dedupe pipeline and reports counters', async () => {
    seedTwoDuplicateEventsForAdmin()
    const r = await POST(req())
    const body = await r.json()
    expect(body.eventCountLoaded).toBe(2)
    expect(body.eventCountRendered).toBe(1)
    expect(body.supersededEventCount).toBe(1)
    expect(body.cardCount).toBe(1)
    expect(typeof body.subject).toBe('string')
    expect(typeof body.html).toBe('string')
    expect(typeof body.text).toBe('string')
  })

  it('does NOT mutate alert_events — delivered_at stays null', async () => {
    seedTwoDuplicateEventsForAdmin()
    await POST(req())
    const rows = fakeDB.rows('alert_events') as Array<{ delivered_at: string | null }>
    for (const r of rows) expect(r.delivered_at).toBeNull()
  })

  it('never accepts a recipient field; rendered output never leaks user_id / token', async () => {
    seedTwoDuplicateEventsForAdmin()
    const r = await POST(req({ toEmail: 'attacker@evil.com' }))
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/admin-uid/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"token"/i)
    expect(blob).not.toMatch(/attacker@evil\.com/)
  })

  it('returns empty digest gracefully when the user has no undelivered events', async () => {
    const r = await POST(req())
    const body = await r.json()
    expect(body.eventCountLoaded).toBe(0)
    expect(body.eventCountRendered).toBe(0)
    expect(body.supersededEventCount).toBe(0)
  })
})
