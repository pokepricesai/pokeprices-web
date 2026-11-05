// src/app/api/cron/indexnow-harvest/__tests__/route.test.ts
//
// CN-06.02 (2026-11-04) — pins the route-level safeguards added when
// raising maxDuration from 60 → 300. Specifically:
//   * EVENTS_PER_RUN_CEILING (= 1000) caps a settings misconfiguration.
//   * Operator can still tune LOWER via settings.harvester_events_per_run.
//   * Harvester is invoked exactly once with the effective cap.
//   * Structured log line emitted per invocation for observability.
//   * harvester_enabled=false short-circuits without invoking the lib.
//   * Auth gates (missing secret / wrong bearer) behave as before.

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// ── runIndexnowHarvester mock — captures opts + lets tests set result ─
const harvesterCalls: Array<Record<string, unknown>> = []
let harvesterResult: Record<string, unknown> = {
  status: 'ok', reason: 'drained',
  events_read: 3, events_marked_processed: 3,
  card_enqueue_attempted: 0, card_enqueue_inserted: 0,
  card_enqueue_updated: 0, card_enqueue_unchanged: 0,
  set_enqueue_attempted: 0, pokemon_enqueue_attempted: 0,
  editorial_enqueue_attempted: 0, directory_enqueue_attempted: 0,
  deletion_enqueue_attempted: 0,
  errors: [],
}
vi.mock('@/lib/indexnow/harvester', () => ({
  runIndexnowHarvester: (opts: Record<string, unknown>) => {
    harvesterCalls.push(opts)
    return Promise.resolve(harvesterResult)
  },
}))

// ── loadSettings mock — lets each test set what settings returns ─────
let settingsMock: Record<string, unknown> = { harvester_enabled: true }
vi.mock('@/lib/indexnow/queue', () => ({
  loadSettings: () => Promise.resolve(settingsMock),
}))

// ── isCronAuthOk mock — authentication via Bearer cronAuth ───────────
let cronAuthResult: { ok: true } | { ok: false; reason: string } = { ok: true }
vi.mock('@/lib/email/cronAuth', () => ({
  isCronAuthOk: () => cronAuthResult,
}))

// Import AFTER mocks register.
import { GET, POST, EVENTS_PER_RUN_CEILING } from '../route'

function req(method: 'GET' | 'POST' = 'GET') {
  return new Request('https://pokeprices.io/api/cron/indexnow-harvest', { method })
}

beforeEach(() => {
  harvesterCalls.length = 0
  harvesterResult = {
    status: 'ok', reason: 'drained',
    events_read: 3, events_marked_processed: 3,
    card_enqueue_attempted: 0, card_enqueue_inserted: 0,
    card_enqueue_updated: 0, card_enqueue_unchanged: 0,
    set_enqueue_attempted: 0, pokemon_enqueue_attempted: 0,
    editorial_enqueue_attempted: 0, directory_enqueue_attempted: 0,
    deletion_enqueue_attempted: 0,
    errors: [],
  }
  settingsMock = { harvester_enabled: true }
  cronAuthResult = { ok: true }
})

describe('indexnow-harvest route — auth', () => {
  it('returns 401 on invalid bearer', async () => {
    cronAuthResult = { ok: false, reason: 'bad_secret' }
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(harvesterCalls).toHaveLength(0)
  })

  it('returns 503 when CRON_SECRET not set on server', async () => {
    cronAuthResult = { ok: false, reason: 'missing_secret' }
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(harvesterCalls).toHaveLength(0)
  })

  it('returns skipped when harvester_enabled is false — no lib call', async () => {
    settingsMock = { harvester_enabled: false }
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('skipped')
    expect(body.reason).toBe('harvester_disabled')
    expect(harvesterCalls).toHaveLength(0)
  })
})

describe('indexnow-harvest route — CN-06.02 events-per-run ceiling', () => {
  // Ceiling lowered 1000 → 500 on 2026-11-04 after production
  // telemetry showed 1000 events landing at 294s (first post-deploy
  // fire) and the subsequent fire timing out at 300s. Target: fit
  // comfortably in 300s with ~50% headroom.

  it('EVENTS_PER_RUN_CEILING is 500 (lowered from 1000)', () => {
    expect(EVENTS_PER_RUN_CEILING).toBe(500)
  })

  it('invokes harvester with 2000 → capped to EVENTS_PER_RUN_CEILING=500', async () => {
    settingsMock = { harvester_enabled: true, harvester_events_per_run: 2000 }
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(harvesterCalls).toHaveLength(1)
    expect(harvesterCalls[0].eventsPerRun).toBe(EVENTS_PER_RUN_CEILING)
    expect(harvesterCalls[0].eventsPerRun).toBe(500)
  })

  it('invokes harvester with settings override 5000 → still capped at 500', async () => {
    settingsMock = { harvester_enabled: true, harvester_events_per_run: 5000 }
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(harvesterCalls[0].eventsPerRun).toBe(500)
  })

  it('invokes harvester with settings override 1000 → still capped at 500 (operator cannot raise above ceiling)', async () => {
    settingsMock = { harvester_enabled: true, harvester_events_per_run: 1000 }
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(harvesterCalls[0].eventsPerRun).toBe(500)
  })

  it('invokes harvester with settings override 250 → passed through (operator can tune LOWER)', async () => {
    settingsMock = { harvester_enabled: true, harvester_events_per_run: 250 }
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(harvesterCalls[0].eventsPerRun).toBe(250)
  })

  it('invokes harvester with settings override 500 → passed through (matches ceiling exactly)', async () => {
    settingsMock = { harvester_enabled: true, harvester_events_per_run: 500 }
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(harvesterCalls[0].eventsPerRun).toBe(500)
  })

  it('invokes harvester with settings override 0 → coerced to 1 (minimum)', async () => {
    settingsMock = { harvester_enabled: true, harvester_events_per_run: 0 }
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(harvesterCalls[0].eventsPerRun).toBe(1)
  })

  it('invokes harvester with default (no settings override) → default 2000 capped to 500', async () => {
    settingsMock = { harvester_enabled: true }
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(harvesterCalls[0].eventsPerRun).toBe(500)
  })
})

describe('indexnow-harvest route — trigger + enqueueAggregates', () => {
  it('GET → trigger=cron', async () => {
    await GET(req('GET'))
    expect(harvesterCalls[0].trigger).toBe('cron')
  })

  it('POST → trigger=admin_manual', async () => {
    await POST(req('POST'))
    expect(harvesterCalls[0].trigger).toBe('admin_manual')
  })

  it('passes enqueueAggregates=true by default', async () => {
    settingsMock = { harvester_enabled: true }
    await GET(req())
    expect(harvesterCalls[0].enqueueAggregates).toBe(true)
  })

  it('passes enqueueAggregates=false when settings say so', async () => {
    settingsMock = { harvester_enabled: true, harvester_enqueue_aggregates: false }
    await GET(req())
    expect(harvesterCalls[0].enqueueAggregates).toBe(false)
  })
})

describe('indexnow-harvest route — structured log + status pass-through', () => {
  it('emits one structured log line per invocation including cap flag', async () => {
    const logs: string[][] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String))
    })
    settingsMock = { harvester_enabled: true, harvester_events_per_run: 5000 }
    await GET(req())
    spy.mockRestore()
    expect(logs.some(line => line.join(' ').includes('[indexnow-harvest]'))).toBe(true)
    const line = logs.find(l => l.join(' ').includes('[indexnow-harvest]'))!.join(' ')
    expect(line).toContain('"effective_events_per_run":500')
    expect(line).toContain('"requested_events_per_run":5000')
    expect(line).toContain('"capped_by_ceiling":true')
    expect(line).toContain('"status":"ok"')
  })

  it('surfaces harvester status=error as HTTP 500', async () => {
    harvesterResult = { ...harvesterResult, status: 'error', reason: 'read_events_failed', errors: ['boom'] }
    const res = await GET(req())
    expect(res.status).toBe(500)
  })

  it('surfaces harvester status=partial as HTTP 200 (non-fatal, retries next tick)', async () => {
    harvesterResult = { ...harvesterResult, status: 'partial', reason: 'partial_or_failure' }
    const res = await GET(req())
    expect(res.status).toBe(200)
  })

  it('surfaces harvester status=ok as HTTP 200', async () => {
    harvesterResult = { ...harvesterResult, status: 'ok' }
    const res = await GET(req())
    expect(res.status).toBe(200)
  })
})
