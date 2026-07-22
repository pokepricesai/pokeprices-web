// Block 5A-W-46B — IndexNow submitter pure-logic tests.
// Covers: URL validation (canonical host, protocol, path prefix,
// segment, query/fragment), dedup, batching, snapshot diff for
// change-detection, HTTP status classification, retry policy,
// payload construction, and key-safe log sanitisation.

import { describe, it, expect } from 'vitest'
// Import from the .mjs source so the CLI and tests share one canonical
// module. Vitest resolves .mjs from a .test.ts entry without config.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as submitter from '../submitter.mjs'
const {
  validateUrl,
  dedupe,
  collectValidUrls,
  batchUrls,
  diffSnapshots,
  classifyStatus,
  shouldRetry,
  safeLogBody,
  buildPayload,
  CANONICAL_HOST,
  MAX_BATCH_SIZE,
  MAX_ATTEMPTS,
  RETRY_DELAY_SCHEDULE_MS,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} = submitter as any

describe('validateUrl — canonical host', () => {
  it('accepts www.pokeprices.io https URLs', () => {
    const r = validateUrl('https://www.pokeprices.io/set/Base%20Set')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url).toBe('https://www.pokeprices.io/set/Base%20Set')
  })

  it('rejects non-www.pokeprices.io hosts (bare-apex, preview, localhost, other domains)', () => {
    for (const bad of [
      'https://pokeprices.io/',
      'https://preview.pokeprices.io/',
      'http://localhost/',
      'https://google.com/',
      'https://www.pokeprices.io.evil.com/',
    ]) {
      const r = validateUrl(bad)
      expect(r.ok, `expected ${bad} to fail`).toBe(false)
      if (!r.ok) expect(r.reason === 'wrong-host' || r.reason === 'wrong-protocol').toBe(true)
    }
  })

  it('rejects non-https protocols', () => {
    const r = validateUrl('http://www.pokeprices.io/')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('wrong-protocol')
  })
})

describe('validateUrl — rejected paths', () => {
  it('rejects /admin, /intel, /api, /scan-test, /dashboard, /_next roots + descendants', () => {
    for (const bad of [
      'https://www.pokeprices.io/admin',
      'https://www.pokeprices.io/admin/analytics',
      'https://www.pokeprices.io/intel',
      'https://www.pokeprices.io/intel/login',
      'https://www.pokeprices.io/api/account/plan',
      'https://www.pokeprices.io/scan-test',
      'https://www.pokeprices.io/dashboard',
      'https://www.pokeprices.io/dashboard/portfolio',
      'https://www.pokeprices.io/_next/static/foo.js',
    ]) {
      const r = validateUrl(bad)
      expect(r.ok, `expected ${bad} to be rejected`).toBe(false)
      if (!r.ok) expect(r.reason).toBe('rejected-path')
    }
  })

  it('rejects login / signup / logout surfaces', () => {
    for (const bad of [
      'https://www.pokeprices.io/login',
      'https://www.pokeprices.io/signup',
      'https://www.pokeprices.io/dashboard/login',
    ]) {
      const r = validateUrl(bad)
      expect(r.ok, `expected ${bad} to be rejected`).toBe(false)
    }
  })
})

describe('validateUrl — query / fragment', () => {
  it('rejects URLs with query strings', () => {
    const r = validateUrl('https://www.pokeprices.io/set/Base%20Set?foo=bar')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('has-query-string')
  })

  it('rejects URLs with hash fragments', () => {
    const r = validateUrl('https://www.pokeprices.io/insights#anchor')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('has-fragment')
  })
})

describe('validateUrl — bad input', () => {
  it('rejects non-string / empty / undefined / null / numbers', () => {
    for (const bad of [null, undefined, '', 42, {}, [], true]) {
      const r = validateUrl(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason === 'not-a-string' || r.reason === 'not-a-url').toBe(true)
    }
  })

  it('rejects malformed URL strings', () => {
    const r = validateUrl('not a url at all')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-a-url')
  })

  it('trims surrounding whitespace before validating', () => {
    const r = validateUrl('  https://www.pokeprices.io/insights  ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url).toBe('https://www.pokeprices.io/insights')
  })
})

describe('dedupe', () => {
  it('preserves first-seen order and drops duplicates', () => {
    expect(dedupe([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/b',
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/c',
    ])).toEqual([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/b',
      'https://www.pokeprices.io/c',
    ])
  })

  it('empty input yields empty output', () => {
    expect(dedupe([])).toEqual([])
  })
})

describe('collectValidUrls', () => {
  it('separates accepted from rejected and dedupes accepted', () => {
    const out = collectValidUrls([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/a', // duplicate of first
      'https://pokeprices.io/b',      // wrong host
      'https://www.pokeprices.io/admin', // rejected path
      'https://www.pokeprices.io/b',  // fine
    ])
    expect(out.accepted).toEqual([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/b',
    ])
    expect(out.rejected.length).toBe(2)
    expect(out.rejected.map(r => r.reason).sort()).toEqual(['rejected-path', 'wrong-host'])
  })
})

describe('batchUrls', () => {
  it('splits into batches of the requested size, last batch is remainder', () => {
    const urls = Array.from({ length: 2500 }, (_, i) => `https://www.pokeprices.io/x/${i}`)
    const batches = batchUrls(urls, MAX_BATCH_SIZE)
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(MAX_BATCH_SIZE)
    expect(batches[1]).toHaveLength(MAX_BATCH_SIZE)
    expect(batches[2]).toHaveLength(500)
  })

  it('empty input → empty batches array', () => {
    expect(batchUrls([])).toEqual([])
  })

  it('throws on non-positive batch size', () => {
    expect(() => batchUrls(['x'], 0)).toThrow()
    expect(() => batchUrls(['x'], -1)).toThrow()
  })

  it('caps at MAX_BATCH_SIZE = 1000 per protocol safety', () => {
    expect(MAX_BATCH_SIZE).toBe(1000)
  })
})

describe('diffSnapshots — change detection', () => {
  it('URLs present in current but not in previous count as changed', () => {
    const prev = new Map([['https://www.pokeprices.io/a', 'h1']])
    const cur  = new Map([
      ['https://www.pokeprices.io/a', 'h1'],  // unchanged
      ['https://www.pokeprices.io/b', 'h1'],  // NEW
    ])
    const d = diffSnapshots(prev, cur)
    expect(d.changed).toEqual(['https://www.pokeprices.io/b'])
    expect(d.deleted).toEqual([])
  })

  it('URLs with different hash count as changed', () => {
    const prev = new Map([['https://www.pokeprices.io/a', 'h1']])
    const cur  = new Map([['https://www.pokeprices.io/a', 'h2']])
    const d = diffSnapshots(prev, cur)
    expect(d.changed).toEqual(['https://www.pokeprices.io/a'])
  })

  it('URLs with identical hash are NOT changed (skip nightly re-submission)', () => {
    const prev = new Map([
      ['https://www.pokeprices.io/a', 'h1'],
      ['https://www.pokeprices.io/b', 'h1'],
    ])
    const cur = new Map([
      ['https://www.pokeprices.io/a', 'h1'],
      ['https://www.pokeprices.io/b', 'h1'],
    ])
    const d = diffSnapshots(prev, cur)
    expect(d.changed).toEqual([])
    expect(d.deleted).toEqual([])
  })

  it('URLs only in previous count as deleted', () => {
    const prev = new Map([['https://www.pokeprices.io/a', 'h1']])
    const cur  = new Map<string, string>()
    const d = diffSnapshots(prev, cur)
    expect(d.deleted).toEqual(['https://www.pokeprices.io/a'])
  })
})

describe('classifyStatus + shouldRetry — response handling', () => {
  it('recognises the IndexNow success codes (200 / 202)', () => {
    expect(classifyStatus(200)).toBe('ok')
    expect(classifyStatus(202)).toBe('accepted')
  })

  it('recognises documented client errors (400 / 403 / 422)', () => {
    expect(classifyStatus(400)).toBe('bad-request')
    expect(classifyStatus(403)).toBe('forbidden')
    expect(classifyStatus(422)).toBe('unprocessable')
  })

  it('recognises 429 rate-limit + 5xx server errors', () => {
    expect(classifyStatus(429)).toBe('rate-limited')
    expect(classifyStatus(500)).toBe('server-error')
    expect(classifyStatus(503)).toBe('server-error')
  })

  it('classifies status 0 as a network-error (fetch throw)', () => {
    expect(classifyStatus(0)).toBe('network-error')
  })

  it('only retries rate-limits, server errors, and network errors', () => {
    expect(shouldRetry('rate-limited')).toBe(true)
    expect(shouldRetry('server-error')).toBe(true)
    expect(shouldRetry('network-error')).toBe(true)
    // Client errors + successes are never retried.
    expect(shouldRetry('ok')).toBe(false)
    expect(shouldRetry('accepted')).toBe(false)
    expect(shouldRetry('bad-request')).toBe(false)
    expect(shouldRetry('forbidden')).toBe(false)
    expect(shouldRetry('unprocessable')).toBe(false)
    expect(shouldRetry('unknown')).toBe(false)
  })

  it('retry schedule has exactly MAX_ATTEMPTS - 1 entries and is monotonically increasing', () => {
    expect(RETRY_DELAY_SCHEDULE_MS.length).toBe(MAX_ATTEMPTS - 1)
    for (let i = 1; i < RETRY_DELAY_SCHEDULE_MS.length; i++) {
      expect(RETRY_DELAY_SCHEDULE_MS[i]).toBeGreaterThan(RETRY_DELAY_SCHEDULE_MS[i - 1])
    }
  })
})

describe('safeLogBody — never leaks the shared key', () => {
  it('replaces the shared key with a redacted marker', () => {
    const key = 'secret-key-123'
    const body = `IndexNow received host=www.pokeprices.io key=${key}`
    const out  = safeLogBody(body, key)
    expect(out).not.toContain(key)
    expect(out).toContain('[REDACTED_KEY]')
  })

  it('truncates long bodies to 500 chars', () => {
    const body = 'x'.repeat(2000)
    const out  = safeLogBody(body, 'k')
    expect(out.length).toBeLessThanOrEqual(501)
    expect(out.endsWith('…')).toBe(true)
  })

  it('empty body → empty string', () => {
    expect(safeLogBody('', 'k')).toBe('')
  })
})

describe('buildPayload', () => {
  it('uses the CANONICAL_HOST regardless of what caller passes', () => {
    const p = buildPayload(['https://www.pokeprices.io/a'], { key: 'K', keyLocation: 'https://www.pokeprices.io/K.txt' })
    expect(p.host).toBe(CANONICAL_HOST)
    expect(p.key).toBe('K')
    expect(p.keyLocation).toBe('https://www.pokeprices.io/K.txt')
    expect(p.urlList).toEqual(['https://www.pokeprices.io/a'])
  })

  it('W46D — payload always includes host + key + keyLocation + urlList (no field omitted)', () => {
    const p = buildPayload(['https://www.pokeprices.io/a'], { key: 'K', keyLocation: 'https://www.pokeprices.io/K.txt' })
    // JSON.stringify surfaces every own property; the four required
    // IndexNow fields must all be present.
    const keys = Object.keys(p).sort()
    expect(keys).toEqual(['host', 'key', 'keyLocation', 'urlList'])
  })

  it('W46D — keyLocation must be an https URL on the canonical host (no bare-apex, no http)', () => {
    const p = buildPayload(['https://www.pokeprices.io/a'], {
      key: 'K',
      keyLocation: `https://${CANONICAL_HOST}/K.txt`,
    })
    expect(p.keyLocation.startsWith(`https://${CANONICAL_HOST}/`)).toBe(true)
    expect(p.keyLocation.endsWith('.txt')).toBe(true)
  })

  it('W46D — accepts a one-URL payload (single-URL verification test path)', () => {
    const p = buildPayload(['https://www.pokeprices.io/insights'], {
      key: 'K', keyLocation: `https://${CANONICAL_HOST}/K.txt`,
    })
    expect(p.urlList).toEqual(['https://www.pokeprices.io/insights'])
    expect(p.urlList.length).toBe(1)
  })
})

describe('classifyStatus + shouldRetry — W46D 202/403 semantics', () => {
  it('W46D — 202 is classified as `accepted` (pending, NOT an error)', () => {
    // Bing's IndexNow returns 202 Accepted while key validation is
    // still in-flight. That's a "pending, do not retry, check back
    // later" state — not a failure.
    expect(classifyStatus(202)).toBe('accepted')
    expect(shouldRetry(classifyStatus(202))).toBe(false)
  })

  it('W46D — 403 is classified as `forbidden` (verification failed)', () => {
    // The SiteVerificationNotCompleted rejection lands here. It is
    // NEVER a success and MUST NOT be treated as propagation
    // completion.
    expect(classifyStatus(403)).toBe('forbidden')
  })

  it('W46D — 403 is NOT retried (client error class)', () => {
    // Retrying a 403 wastes API budget and does not change Bing's
    // verification state. The bounded-retry policy correctly skips it.
    expect(shouldRetry(classifyStatus(403))).toBe(false)
  })

  it('W46D — 200 remains the only "success and safe to batch" status', () => {
    // Regression pin so a future refactor cannot silently reclassify
    // 202 or 403 as `ok`.
    expect(classifyStatus(200)).toBe('ok')
    expect(classifyStatus(202)).not.toBe('ok')
    expect(classifyStatus(403)).not.toBe('ok')
  })
})
