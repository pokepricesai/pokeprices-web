// Tests for the Block 3D cron auth helper. Both CRON_SECRET and the
// legacy ONBOARDING_CRON_SECRET are checked in constant time; the
// helper fails-closed when both env vars are missing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { isCronAuthOk } from '../cronAuth'

const KEYS = ['CRON_SECRET', 'ONBOARDING_CRON_SECRET'] as const
let snap: Record<string, string | undefined>

beforeEach(() => {
  snap = {}
  for (const k of KEYS) snap[k] = process.env[k]
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
})

function req(auth?: string): Request {
  return new Request('http://localhost/x', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('isCronAuthOk', () => {
  it('fails closed when both env vars are missing', () => {
    const r = isCronAuthOk(req('Bearer anything'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('missing_secret')
    expect(r.matched).toBe('none')
  })

  it('rejects when no bearer header is present', () => {
    process.env.CRON_SECRET = 'right'
    const r = isCronAuthOk(req())
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_bearer')
  })

  it('accepts the primary CRON_SECRET', () => {
    process.env.CRON_SECRET = 'right-primary'
    const r = isCronAuthOk(req('Bearer right-primary'))
    expect(r.ok).toBe(true)
    expect(r.matched).toBe('primary')
  })

  it('accepts the legacy ONBOARDING_CRON_SECRET', () => {
    process.env.ONBOARDING_CRON_SECRET = 'right-legacy'
    const r = isCronAuthOk(req('Bearer right-legacy'))
    expect(r.ok).toBe(true)
    expect(r.matched).toBe('legacy')
  })

  it('still accepts the legacy secret when both env vars are set', () => {
    process.env.CRON_SECRET             = 'right-primary'
    process.env.ONBOARDING_CRON_SECRET  = 'right-legacy'
    const r = isCronAuthOk(req('Bearer right-legacy'))
    expect(r.ok).toBe(true)
    expect(r.matched).toBe('legacy')
  })

  it('rejects a wrong secret with reason=mismatch', () => {
    process.env.CRON_SECRET = 'right'
    const r = isCronAuthOk(req('Bearer wrong'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('mismatch')
  })

  it('rejects when the bearer length matches but bytes differ', () => {
    process.env.CRON_SECRET = 'aaaa'
    const r = isCronAuthOk(req('Bearer aaab'))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('mismatch')
  })

  it('returns a CronAuthCheck — never includes the secret value', () => {
    process.env.CRON_SECRET = 'super-secret'
    const r = isCronAuthOk(req('Bearer super-secret'))
    expect(JSON.stringify(r)).not.toMatch(/super-secret/)
  })
})
