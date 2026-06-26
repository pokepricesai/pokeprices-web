// Block 5A-W-18 — /api/cron/instant-alerts tests.
// Covers: CRON_SECRET gate (missing / wrong / valid / legacy), flag
// gate, evaluator+delivery wired in order with dryRun=false, env-cap
// reads, GET + POST parity, redaction of proposedEvents, evaluator
// failure short-circuits delivery, no user_id leakage in the response.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

// Mock the evaluator and delivery boundaries so the test asserts the
// route's gate behaviour + wiring shape; the engines themselves are
// covered by their own test files.
type EvalOpts = Record<string, unknown>
type DelivOpts = Record<string, unknown>

const evalCalls: EvalOpts[] = []
let evalMock: (opts: EvalOpts) => Promise<Record<string, unknown>> = async () => ({
  dryRun: false, asOf: 'now',
  usersConsidered: 0, cardsConsidered: 0,
  triggersFound: 0, triggersSuppressedByCooldown: 0, triggersInserted: 0,
  proposedEvents: [],
  diagnostics: {},
})
vi.mock('@/lib/alerts/evaluator', () => ({
  evaluateAlerts: (_supa: unknown, opts: EvalOpts) => {
    evalCalls.push(opts)
    return evalMock(opts)
  },
}))

const deliverCalls: DelivOpts[] = []
let deliverMock: (opts: DelivOpts) => Promise<Record<string, unknown>> = async () => ({
  dryRun: false, asOf: 'now',
  usersConsidered: 0, usersEmailed: 0, eventsDelivered: 0,
  cardsDelivered: 0, eventsLeftUndelivered: 0,
  usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0,
  cooldownHours: 24, perUser: [],
})
vi.mock('@/lib/alerts/delivery', () => ({
  deliverAlerts: (_supa: unknown, opts: DelivOpts) => {
    deliverCalls.push(opts)
    return deliverMock(opts)
  },
  makeAuthEmailLookup: () => async (_uid: string) => null,
}))

import { GET, POST } from '../route'

const KEYS = [
  'CRON_SECRET',
  'ONBOARDING_CRON_SECRET',
  'ALERT_INSTANT_ALERTS_CRON_ENABLED',
  'ALERT_INSTANT_EVALUATOR_CRON_MAX_USERS',
  'ALERT_INSTANT_DELIVERY_CRON_MAX_USERS',
] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  evalCalls.length = 0
  deliverCalls.length = 0
  evalMock = async () => ({
    dryRun: false, asOf: 'now',
    usersConsidered: 1, cardsConsidered: 2,
    triggersFound: 1, triggersSuppressedByCooldown: 0, triggersInserted: 1,
    proposedEvents: [{ user_id: 'u1', card_slug: 'c1', rule: 'raw_change', severity: 'normal', payload: {} }],
    diagnostics: { usersWithDisabledPrefs: 0, usersWithNoCards: 0, cardsWithNoSlugResolution: 0,
                   cardsWithMissingDisplayFields: 0, cardsWithInsufficientPriceHistory: 0,
                   cardsWithNoRecentSales: 0, triggersByRule: { raw_change: 1 } },
  })
  deliverMock = async () => ({
    dryRun: false, asOf: 'now',
    usersConsidered: 1, usersEmailed: 1, eventsDelivered: 1,
    cardsDelivered: 1, eventsLeftUndelivered: 0,
    usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0,
    cooldownHours: 24,
    perUser: [{ recipientMasked: 'lu***@gmail.com', eventCount: 1, cardCount: 1, eventsLeftUndelivered: 0, outcome: 'sent' }],
  })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(opts: { method: 'GET' | 'POST'; bearer?: string } = { method: 'GET' }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`
  return new Request('http://localhost/api/cron/instant-alerts', {
    method:  opts.method,
    headers,
    body:    opts.method === 'POST' ? '' : undefined,
  })
}

// ─────────────────────────────────────────────────────────────────────
// Gates
// ─────────────────────────────────────────────────────────────────────

describe('cron/instant-alerts — auth gate', () => {
  it('503 when CRON_SECRET is missing (config gap)', async () => {
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET', bearer: 'anything' }))
    expect(r.status).toBe(503)
    expect(evalCalls).toHaveLength(0)
    expect(deliverCalls).toHaveLength(0)
  })

  it('401 when secret is set but bearer is missing', async () => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET' }))
    expect(r.status).toBe(401)
    expect(evalCalls).toHaveLength(0)
    expect(deliverCalls).toHaveLength(0)
  })

  it('401 when bearer does not match the secret', async () => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET', bearer: 'wrong' }))
    expect(r.status).toBe(401)
    expect(evalCalls).toHaveLength(0)
  })

  it('accepts the legacy ONBOARDING_CRON_SECRET as a secondary bearer', async () => {
    process.env.ONBOARDING_CRON_SECRET = 'legacy'
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = 'true'
    const r = await GET(req({ method: 'GET', bearer: 'legacy' }))
    expect(r.status).toBe(200)
    expect(evalCalls).toHaveLength(1)
    expect(deliverCalls).toHaveLength(1)
  })
})

describe('cron/instant-alerts — flag gate', () => {
  it('503 when bearer is valid but ALERT_INSTANT_ALERTS_CRON_ENABLED is unset', async () => {
    process.env.CRON_SECRET = 's3cr3t'
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(r.status).toBe(503)
    expect(evalCalls).toHaveLength(0)
  })

  it('503 when flag is set to a non-"true" value (e.g. "1")', async () => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = '1'
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(r.status).toBe(503)
    expect(evalCalls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────

describe('cron/instant-alerts — engine wiring', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = 'true'
  })

  it('runs the evaluator with dryRun=false and the env evaluator cap (default 100)', async () => {
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(evalCalls).toHaveLength(1)
    expect(evalCalls[0].dryRun).toBe(false)
    expect(evalCalls[0].limitUsers).toBe(100)
  })

  it('runs the delivery batch with dryRun=false, env delivery cap (default 25), and maxCardsPerEmail=10', async () => {
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(deliverCalls).toHaveLength(1)
    expect(deliverCalls[0].dryRun).toBe(false)
    expect(deliverCalls[0].maxUsers).toBe(25)
    expect(deliverCalls[0].maxCardsPerEmail).toBe(10)
    expect(typeof deliverCalls[0].getUserEmail).toBe('function')
  })

  it('env overrides raise the caps up to the engine hard limits', async () => {
    process.env.ALERT_INSTANT_EVALUATOR_CRON_MAX_USERS = '300'
    process.env.ALERT_INSTANT_DELIVERY_CRON_MAX_USERS = '75'
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(evalCalls[0].limitUsers).toBe(300)
    expect(deliverCalls[0].maxUsers).toBe(75)
  })

  it('env overrides ABOVE the hard limit are clamped (evaluator 500, delivery 100)', async () => {
    process.env.ALERT_INSTANT_EVALUATOR_CRON_MAX_USERS = '9999'
    process.env.ALERT_INSTANT_DELIVERY_CRON_MAX_USERS = '9999'
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(evalCalls[0].limitUsers).toBe(500)
    expect(deliverCalls[0].maxUsers).toBe(100)
  })

  it('evaluator runs BEFORE delivery (newly inserted events feed the same-tick delivery)', async () => {
    const order: string[] = []
    evalMock     = async () => { order.push('eval');     return await Promise.resolve({ dryRun: false, asOf: 'x', usersConsidered: 0, cardsConsidered: 0, triggersFound: 0, triggersSuppressedByCooldown: 0, triggersInserted: 0, proposedEvents: [], diagnostics: {} }) }
    deliverMock  = async () => { order.push('deliver'); return await Promise.resolve({ dryRun: false, asOf: 'x', usersConsidered: 0, usersEmailed: 0, eventsDelivered: 0, cardsDelivered: 0, eventsLeftUndelivered: 0, usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0, cooldownHours: 24, perUser: [] }) }
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(order).toEqual(['eval', 'deliver'])
  })

  it('GET and POST both invoke the pipeline once', async () => {
    await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    await POST(req({ method: 'POST', bearer: 's3cr3t' }))
    expect(evalCalls).toHaveLength(2)
    expect(deliverCalls).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Failure handling
// ─────────────────────────────────────────────────────────────────────

describe('cron/instant-alerts — failure handling', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = 'true'
  })

  it('evaluator throw short-circuits delivery (stage=evaluator_failed, 500)', async () => {
    evalMock = async () => { throw new Error('rule engine boom') }
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(r.status).toBe(500)
    const body = await r.json()
    expect(body.stage).toBe('evaluator_failed')
    expect(body.detail).toMatch(/rule engine boom/)
    expect(deliverCalls).toHaveLength(0)
  })

  it('delivery throw returns stage=delivery_failed and includes the evaluator counters', async () => {
    deliverMock = async () => { throw new Error('resend down') }
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    expect(r.status).toBe(500)
    const body = await r.json()
    expect(body.stage).toBe('delivery_failed')
    expect(body.evaluation.triggersInserted).toBe(1)
    expect(body.evaluation.proposedEventCount).toBe(1)
    // The raw proposedEvents payload (with user_id) must not be echoed.
    expect(body.evaluation.proposedEvents).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Response shape — no PII leakage
// ─────────────────────────────────────────────────────────────────────

describe('cron/instant-alerts — response shape', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 's3cr3t'
    process.env.ALERT_INSTANT_ALERTS_CRON_ENABLED = 'true'
  })

  it('redacts proposedEvents (no user_id / card payload echoed); keeps the count', async () => {
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    const body = await r.json()
    expect(body.evaluation.proposedEvents).toBeUndefined()
    expect(body.evaluation.proposedEventCount).toBe(1)
    const blob = JSON.stringify(body)
    expect(blob).not.toMatch(/"user_id"/i)
  })

  it('delivery perUser only carries masked recipients', async () => {
    const r = await GET(req({ method: 'GET', bearer: 's3cr3t' }))
    const body = await r.json()
    expect(body.delivery.perUser[0].recipientMasked).toBe('lu***@gmail.com')
    const blob = JSON.stringify(body)
    expect(blob).not.toMatch(/lukejosephpierce@gmail\.com/)
  })
})
