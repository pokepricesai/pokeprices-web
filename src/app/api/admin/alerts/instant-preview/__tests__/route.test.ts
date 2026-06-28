// Block 5A-W-22 — POST /api/admin/alerts/instant-preview tests.
// Covers: flag gate, admin gate, hard-coded dryRun=true, warnings
// aggregation, allowlist passthrough, masked response shape.

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

type DelivOpts = Record<string, unknown>
const deliverCalls: DelivOpts[] = []
let deliverMock: (opts: DelivOpts) => Promise<Record<string, unknown>> = async () => ({
  dryRun: true, asOf: 'now',
  usersConsidered: 0, usersEmailed: 0, eventsDelivered: 0,
  cardsDelivered: 0, eventsLeftUndelivered: 0,
  usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0,
  cooldownHours: 24, perUser: [],
  allowlist: { active: false, size: 0, filteredOut: 0 },
})
vi.mock('@/lib/alerts/delivery', () => ({
  deliverAlerts: (_supa: unknown, opts: DelivOpts) => {
    deliverCalls.push(opts)
    return deliverMock(opts)
  },
  makeAuthEmailLookup: () => async (_uid: string) => null,
}))

import { POST } from '../route'

const KEYS = ['ALERT_EMAIL_PREVIEW_ENABLED', 'ALERT_DELIVERY_ENABLED'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
  fakeDB.reset()
  deliverCalls.length = 0
  mockAdmin = async () => ({ ok: true, userId: 'admin-uid', email: 'admin@example.com', status: 200, error: '' })
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(body?: Record<string, unknown>): Request {
  return new Request('http://localhost/api/admin/alerts/instant-preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : '',
  })
}

describe('instant-preview — gates', () => {
  it('503 when both preview + delivery flags are unset', async () => {
    const r = await POST(req())
    expect(r.status).toBe(503)
    expect(deliverCalls).toHaveLength(0)
  })
  it('proceeds when ALERT_EMAIL_PREVIEW_ENABLED=true', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
    expect(deliverCalls).toHaveLength(1)
  })
  it('proceeds when ALERT_DELIVERY_ENABLED=true', async () => {
    process.env.ALERT_DELIVERY_ENABLED = 'true'
    const r = await POST(req())
    expect(r.status).toBe(200)
  })
  it('rejects non-admins', async () => {
    process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true'
    mockAdmin = async () => ({ ok: false, userId: '', email: '', status: 401, error: 'unauthorised' })
    const r = await POST(req())
    expect(r.status).toBe(401)
    expect(deliverCalls).toHaveLength(0)
  })
})

describe('instant-preview — dryRun is hard-coded true (cannot be overridden)', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('forces dryRun=true even when body asks for false', async () => {
    await POST(req({ dryRun: false }))
    expect(deliverCalls[0].dryRun).toBe(true)
  })

  it('hard-codes maxCardsPerEmail=10 and uses makeAuthEmailLookup', async () => {
    await POST(req())
    expect(deliverCalls[0].maxCardsPerEmail).toBe(10)
    expect(typeof deliverCalls[0].getUserEmail).toBe('function')
  })
})

describe('instant-preview — warnings aggregation', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('flags users above each threshold and reports the thresholds back', async () => {
    deliverMock = async () => ({
      dryRun: true, asOf: 'now',
      usersConsidered: 4, usersEmailed: 4,
      eventsDelivered: 0, cardsDelivered: 0, eventsLeftUndelivered: 0,
      usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0,
      cooldownHours: 24,
      allowlist: { active: false, size: 0, filteredOut: 0 },
      perUser: [
        { recipientMasked: 'a***@x.io', outcome: 'would_send', eventCount: 11, cardCount: 1,
          eventCountRendered: 11, supersededEventCount: 0, salesOnlyCardCount: 0 },
        { recipientMasked: 'b***@x.io', outcome: 'would_send', eventCount: 1,  cardCount: 6,
          eventCountRendered: 1,  supersededEventCount: 0, salesOnlyCardCount: 0 },
        { recipientMasked: 'c***@x.io', outcome: 'would_send', eventCount: 4,  cardCount: 4,
          eventCountRendered: 4,  supersededEventCount: 0, salesOnlyCardCount: 4 },
        { recipientMasked: 'd***@x.io', outcome: 'would_send', eventCount: 2,  cardCount: 1,
          eventCountRendered: 2,  supersededEventCount: 3, salesOnlyCardCount: 0 },
      ],
    })
    const r = await POST(req())
    const body = await r.json()
    expect(body.warnings).toEqual({
      usersWithHighEventCount:      1,
      usersWithHighCardCount:       1,
      usersWithManySalesOnlyCards:  1,
      usersWithPreDedupeDuplicates: 1,
      flagged:                      true,
    })
    expect(body.warningThresholds).toEqual({ events: 10, cards: 5, salesOnlyCards: 3 })
  })

  it('flagged=false when nothing crosses any threshold', async () => {
    deliverMock = async () => ({
      dryRun: true, asOf: 'now',
      usersConsidered: 1, usersEmailed: 1, eventsDelivered: 0,
      cardsDelivered: 0, eventsLeftUndelivered: 0,
      usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0,
      cooldownHours: 24,
      allowlist: { active: false, size: 0, filteredOut: 0 },
      perUser: [
        { recipientMasked: 'a***@x.io', outcome: 'would_send', eventCount: 3, cardCount: 2,
          eventCountRendered: 3, supersededEventCount: 0, salesOnlyCardCount: 1 },
      ],
    })
    const r = await POST(req())
    const body = await r.json()
    expect(body.warnings.flagged).toBe(false)
  })
})

describe('instant-preview — response shape', () => {
  beforeEach(() => { process.env.ALERT_EMAIL_PREVIEW_ENABLED = 'true' })

  it('passes the allowlist block through verbatim', async () => {
    deliverMock = async () => ({
      dryRun: true, asOf: 'now',
      usersConsidered: 1, usersEmailed: 0, eventsDelivered: 0,
      cardsDelivered: 0, eventsLeftUndelivered: 0,
      usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0,
      cooldownHours: 24,
      allowlist: { active: true, size: 2, filteredOut: 17 },
      perUser: [],
    })
    const r = await POST(req())
    const body = await r.json()
    expect(body.allowlist).toEqual({ active: true, size: 2, filteredOut: 17 })
  })

  it('never echoes user_id / token / raw email even when engine returned them in perUser', async () => {
    deliverMock = async () => ({
      dryRun: true, asOf: 'now',
      usersConsidered: 1, usersEmailed: 1, eventsDelivered: 0,
      cardsDelivered: 0, eventsLeftUndelivered: 0,
      usersInCooldown: 0, suppressedOrSkipped: 0, failed: 0,
      cooldownHours: 24,
      allowlist: { active: false, size: 0, filteredOut: 0 },
      perUser: [{ recipientMasked: 'lu***@gmail.com', outcome: 'would_send', eventCount: 1, cardCount: 1 }],
    })
    const r = await POST(req())
    const blob = JSON.stringify(await r.json())
    expect(blob).not.toMatch(/admin-uid/)
    expect(blob).not.toMatch(/"user_id"/i)
    expect(blob).not.toMatch(/"token"/i)
    expect(blob).not.toMatch(/lukejosephpierce@gmail\.com/)
  })
})
