// Block 3D — admin status route + reader.

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

const KEYS = ['EMAIL_ONBOARDING_ENABLED', 'ONBOARDING_CLAIM_STALE_SECONDS'] as const
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
  return new Request('http://localhost/api/admin/onboarding-status', { method: 'GET' })
}

describe('GET /api/admin/onboarding-status', () => {
  it('rejects non-admins', async () => {
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'no' })
    const r = await GET(req())
    expect(r.status).toBe(401)
  })

  it('returns enabled=false when EMAIL_ONBOARDING_ENABLED is unset', async () => {
    const r = await GET(req())
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.enabled).toBe(false)
    expect(j.lastRun).toBeNull()
    expect(j.lastSuccessfulRun).toBeNull()
    expect(j.state.active).toBe(0)
  })

  it('surfaces the most recent run AND the most recent SUCCESS run, distinctly', async () => {
    process.env.EMAIL_ONBOARDING_ENABLED = 'true'
    fakeDB.seed('email_onboarding_runs', [
      { id: 'r-old', source: 'cron', started_at: '2026-06-10T10:00:00Z', completed_at: '2026-06-10T10:00:01Z',
        status: 'success', processed_count: 1, sent_count: 1, skipped_count: 0, retried_count: 0, cancelled_count: 0, failed_count: 0, duration_ms: 100 },
      { id: 'r-new', source: 'manual', started_at: '2026-06-17T10:00:00Z', completed_at: '2026-06-17T10:00:01Z',
        status: 'partial', processed_count: 3, sent_count: 2, skipped_count: 0, retried_count: 1, cancelled_count: 0, failed_count: 0, duration_ms: 220 },
    ])
    const r = await GET(req())
    const j = await r.json()
    expect(j.lastRun.status).toBe('partial')
    expect(j.lastRun.source).toBe('manual')
    expect(j.lastSuccessfulRun.startedAt).toBe('2026-06-10T10:00:00Z')
    expect(j.lastSummary).toEqual({ processed: 3, sent: 2, skipped: 0, retried: 1, cancelled: 0, failed: 0 })
  })

  it('counts active / paused / cancelled / completed correctly', async () => {
    fakeDB.seed('email_onboarding_state', [
      { user_id: 'u1', status: 'active'   },
      { user_id: 'u2', status: 'active'   },
      { user_id: 'u3', status: 'paused'   },
      { user_id: 'u4', status: 'cancelled'},
      { user_id: 'u5', status: 'completed'},
      { user_id: 'u6', status: 'completed'},
    ])
    const r = await GET(req())
    const j = await r.json()
    expect(j.state.active).toBe(2)
    expect(j.state.paused).toBe(1)
    expect(j.state.cancelled).toBe(1)
    expect(j.state.completed).toBe(2)
  })

  it('counts due-now rows across welcome / activation / discovery', async () => {
    const past   = '2026-06-15T00:00:00Z'
    const future = '2099-01-01T00:00:00Z'
    fakeDB.seed('email_onboarding_state', [
      // welcome due
      { user_id: 'u1', status: 'active',
        welcome_due_at: past, activation_due_at: future, discovery_due_at: future,
        welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null },
      // activation due (welcome already sent)
      { user_id: 'u2', status: 'active',
        welcome_due_at: past, activation_due_at: past, discovery_due_at: future,
        welcome_sent_at: '2026-06-10T00:00:00Z', activation_sent_at: null, discovery_sent_at: null },
      // discovery due (welcome + activation sent)
      { user_id: 'u3', status: 'active',
        welcome_due_at: past, activation_due_at: past, discovery_due_at: past,
        welcome_sent_at: '2026-06-10T00:00:00Z', activation_sent_at: '2026-06-12T00:00:00Z', discovery_sent_at: null },
      // none due — discovery already sent
      { user_id: 'u4', status: 'active',
        welcome_due_at: past, activation_due_at: past, discovery_due_at: past,
        welcome_sent_at: '2026-06-10T00:00:00Z', activation_sent_at: '2026-06-12T00:00:00Z', discovery_sent_at: '2026-06-14T00:00:00Z' },
    ])
    const r = await GET(req())
    const j = await r.json()
    expect(j.state.dueNow).toBe(3)
  })

  it('reports stale-claim count using the configured stale threshold', async () => {
    process.env.ONBOARDING_CLAIM_STALE_SECONDS = '60' // 60 seconds
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString() // 10 minutes ago
    const fresh = new Date(Date.now() - 5  * 1000).toISOString()       // 5 seconds ago
    fakeDB.seed('email_onboarding_state', [
      { user_id: 'u1', status: 'active',
        welcome_due_at: '2099-01-01T00:00:00Z', activation_due_at: '2099-01-01T00:00:00Z', discovery_due_at: '2099-01-01T00:00:00Z',
        welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
        processing_step: 'welcome', processing_token: 'tok-stale', processing_started_at: stale },
      { user_id: 'u2', status: 'active',
        welcome_due_at: '2099-01-01T00:00:00Z', activation_due_at: '2099-01-01T00:00:00Z', discovery_due_at: '2099-01-01T00:00:00Z',
        welcome_sent_at: null, activation_sent_at: null, discovery_sent_at: null,
        processing_step: 'welcome', processing_token: 'tok-fresh', processing_started_at: fresh },
    ])
    const r = await GET(req())
    const j = await r.json()
    expect(j.state.staleClaims).toBe(1)
  })

  it('response contains no email addresses or user IDs', async () => {
    fakeDB.seed('email_onboarding_state', [
      { user_id: 'u-sensitive', status: 'active' },
    ])
    fakeDB.seed('email_onboarding_runs', [
      { id: 'r1', source: 'cron', started_at: '2026-06-17T00:00:00Z', status: 'success' },
    ])
    const r = await GET(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/u-sensitive/)
    expect(blob).not.toMatch(/@/)
  })
})
