// Block 5A-W-17 — /api/cron/weekly-digests tests.
// Covers: CRON_SECRET gate, flag gate, source=cron, dryRun=false call
// shape, max-users env, no body, GET + POST parity.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

type DelivOpts = Record<string, unknown>
const deliveryCalls: DelivOpts[] = []
let deliveryMock: (opts: DelivOpts) => Promise<Record<string, unknown>> = async () => ({
  dryRun: false, source: 'cron', asOf: 'now',
  asOfDayOfWeek: 1, usersConsidered: 0, usersEmailed: 0,
  usersInCooldown: 0, usersWrongDay: 0, usersSkipped: 0,
  usersFailed: 0, cooldownDays: 7, perUser: [],
})
vi.mock('@/lib/alerts/weeklyDigestDelivery', () => ({
  deliverWeeklyDigests: (_supa: unknown, opts: DelivOpts) => {
    deliveryCalls.push(opts)
    return deliveryMock(opts)
  },
}))

vi.mock('@/lib/alerts/delivery', () => ({
  makeAuthEmailLookup: () => async (_uid: string) => null,
}))

import { GET, POST } from '../route'

const KEYS = [
  'CRON_SECRET',
  'ONBOARDING_CRON_SECRET',
  'ALERT_WEEKLY_DIGEST_CRON_ENABLED',
  'ALERT_WEEKLY_DIGEST_CRON_MAX_USERS',
] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  deliveryCalls.length = 0
  deliveryMock = async () => ({
    dryRun: false, source: 'cron', asOf: 'now',
    asOfDayOfWeek: 1, usersConsidered: 0, usersEmailed: 0,
    usersInCooldown: 0, usersWrongDay: 0, usersSkipped: 0,
    usersFailed: 0, cooldownDays: 7, perUser: [],
  })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(opts: { method: 'GET'|'POST'; bearer?: string } = { method: 'GET' }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  return new Request('http://localhost/api/cron/weekly-digests', {
    method:  opts.method,
    headers,
    body:    opts.method === 'POST' ? '' : undefined,
  })
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('cron/weekly-digests — auth gate', () => {
  it('503 when CRON_SECRET is missing (config gap)', async () => {
    process.env.ALERT_WEEKLY_DIGEST_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET', bearer: 'whatever' }))
    expect(r.status).toBe(503)
    expect(deliveryCalls).toHaveLength(0)
  })

  it('401 when secret is set but bearer is missing', async () => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_WEEKLY_DIGEST_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET' }))   // no bearer
    expect(r.status).toBe(401)
    expect(deliveryCalls).toHaveLength(0)
  })

  it('401 when bearer does not match the secret', async () => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_WEEKLY_DIGEST_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET', bearer: 'wrong' }))
    expect(r.status).toBe(401)
    expect(deliveryCalls).toHaveLength(0)
  })

  it('accepts the legacy ONBOARDING_CRON_SECRET as a secondary bearer', async () => {
    process.env.ONBOARDING_CRON_SECRET = 'legacy'
    process.env.ALERT_WEEKLY_DIGEST_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET', bearer: 'legacy' }))
    expect(r.status).toBe(200)
    expect(deliveryCalls).toHaveLength(1)
  })
})

describe('cron/weekly-digests — flag gate', () => {
  it('503 when bearer is valid but ALERT_WEEKLY_DIGEST_CRON_ENABLED is unset', async () => {
    process.env.CRON_SECRET = 's3cr3t'
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(r.status).toBe(503)
    expect(deliveryCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Call shape
// ─────────────────────────────────────────────────────────────────────

describe('cron/weekly-digests — engine call shape', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_WEEKLY_DIGEST_CRON_ENABLED = 'true'
  })

  it('source=cron, dryRun=false, maxUsers from env default (25)', async () => {
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(r.status).toBe(200)
    expect(deliveryCalls).toHaveLength(1)
    const opts = deliveryCalls[0]
    expect(opts.source).toBe('cron')
    expect(opts.dryRun).toBe(false)
    expect(opts.maxUsers).toBe(25)
  })

  it('maxUsers respects ALERT_WEEKLY_DIGEST_CRON_MAX_USERS env override', async () => {
    process.env.ALERT_WEEKLY_DIGEST_CRON_MAX_USERS = '42'
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(deliveryCalls[0].maxUsers).toBe(42)
  })

  it('GET and POST both invoke the engine with the same options', async () => {
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    await POST(req({ method: 'POST', bearer: 's3cr3t' }))
    expect(deliveryCalls).toHaveLength(2)
    expect(deliveryCalls[0].source).toBe('cron')
    expect(deliveryCalls[1].source).toBe('cron')
    expect(deliveryCalls[0].dryRun).toBe(false)
    expect(deliveryCalls[1].dryRun).toBe(false)
  })
})
