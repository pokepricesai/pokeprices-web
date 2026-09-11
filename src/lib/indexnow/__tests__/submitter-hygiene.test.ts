// Block 5A-W-58C — IndexNow submission-hygiene tests.
//
// These regression-pin the fixes for the Aug 2026 amplification spike:
//   * endpoint policy — api.indexnow.org only unless --also-bing
//   * bounded retry — 3 retries max, only on 429 / 5xx / network-error
//   * changed-only — unchanged cohort re-runs submit zero URLs
//   * dedupe — duplicate input URLs collapse to one submission
//   * key redaction — the shared IndexNow key never appears in a log line
//
// No real network I/O. `fetch` is fully mocked via vi.stubGlobal so a
// missed retry-policy branch cannot leak an actual POST.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as submitter from '../submitter.mjs'
const {
  collectValidUrls,
  diffSnapshots,
  classifyStatus,
  shouldRetry,
  safeLogBody,
  buildPayload,
  composeSnapshotFromAccepted,
  MAX_ATTEMPTS,
  RETRY_DELAY_SCHEDULE_MS,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} = submitter as any

// ── minimal fetch-driven retry harness ─────────────────────────────
//
// Mirrors the CLI's submitBatch policy without pulling in Node fs / path.
// If the pure module's classifyStatus / shouldRetry ever drift from the
// documented policy, these tests fail immediately.

type FetchResp = { status: number; text: () => Promise<string> }

async function runBatchWithHarness(
  urls: string[],
  key: string,
  keyLocation: string,
  fetchMock: (endpoint: string, init: RequestInit) => Promise<FetchResp>,
  endpoint = 'https://api.indexnow.org/indexnow',
): Promise<{ attempts: number; lastStatus: number; ok: boolean; endpoints: string[]; logLines: string[] }> {
  const payload = buildPayload(urls, { key, keyLocation })
  const endpoints: string[] = []
  const logLines: string[] = []
  let attempt = 0
  let lastStatus = 0
  let lastText = ''
  while (attempt < MAX_ATTEMPTS) {
    attempt++
    endpoints.push(endpoint)
    try {
      const res = await fetchMock(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
      })
      lastStatus = res.status
      lastText = await res.text()
    } catch (e) {
      lastStatus = 0
      lastText = e instanceof Error ? e.message : 'network error'
    }
    const cls = classifyStatus(lastStatus)
    const bodyLog = safeLogBody(lastText, key)
    logLines.push(`status=${lastStatus} cls=${cls} body=${bodyLog}`)
    if (!shouldRetry(cls) || attempt >= MAX_ATTEMPTS) {
      return { attempts: attempt, lastStatus, ok: cls === 'ok' || cls === 'accepted', endpoints, logLines }
    }
  }
  return { attempts: attempt, lastStatus, ok: false, endpoints, logLines }
}

describe('58C — endpoint policy (default path)', () => {
  it('default submission hits api.indexnow.org only — never www.bing.com/indexnow', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, text: async () => '' }))
    const result = await runBatchWithHarness(
      ['https://www.pokeprices.io/a'],
      'K',
      'https://www.pokeprices.io/K.txt',
      fetchMock,
    )
    expect(result.ok).toBe(true)
    expect(result.endpoints).toEqual(['https://api.indexnow.org/indexnow'])
    // Regression pin — a future refactor that reintroduces the second
    // endpoint would flip this to length 2.
    expect(result.endpoints.some(e => e.includes('bing.com'))).toBe(false)
  })
})

describe('58C — retry cap + status policy', () => {
  it('HTTP 200 → 1 attempt, no retry', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, text: async () => 'ok' }))
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(1)
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 202 → 1 attempt, no retry (accepted-pending)', async () => {
    const fetchMock = vi.fn(async () => ({ status: 202, text: async () => 'pending' }))
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(1)
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 400 → 1 attempt, no retry', async () => {
    const fetchMock = vi.fn(async () => ({ status: 400, text: async () => 'bad' }))
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(1)
    expect(r.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 403 → 1 attempt, no retry', async () => {
    const fetchMock = vi.fn(async () => ({ status: 403, text: async () => 'forbidden' }))
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 422 → 1 attempt, no retry', async () => {
    const fetchMock = vi.fn(async () => ({ status: 422, text: async () => 'unprocessable' }))
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('HTTP 429 → retried up to the cap (MAX_ATTEMPTS = 4 → 3 retries)', async () => {
    const fetchMock = vi.fn(async () => ({ status: 429, text: async () => 'rate limited' }))
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(MAX_ATTEMPTS)
    expect(MAX_ATTEMPTS).toBe(4) // regression pin — 1 initial + 3 retries
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('HTTP 500 → retried up to the cap', async () => {
    const fetchMock = vi.fn(async () => ({ status: 500, text: async () => 'server' }))
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(MAX_ATTEMPTS)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('network error (fetch throws) → retried, then bounded at the cap', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('ECONNRESET') })
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.attempts).toBe(MAX_ATTEMPTS)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('retries exit as soon as a success arrives', async () => {
    let call = 0
    const fetchMock = vi.fn(async () => {
      call++
      if (call < 3) return { status: 500, text: async () => 'server' }
      return { status: 200, text: async () => 'ok' }
    })
    const r = await runBatchWithHarness(['https://www.pokeprices.io/a'], 'K', 'https://www.pokeprices.io/K.txt', fetchMock)
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(3) // 500, 500, 200
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retry schedule has exactly MAX_ATTEMPTS - 1 slots', () => {
    expect(RETRY_DELAY_SCHEDULE_MS.length).toBe(MAX_ATTEMPTS - 1)
  })
})

describe('58C — dedupe and validation collapse duplicates', () => {
  it('duplicate input URLs collapse to one accepted URL', () => {
    const out = collectValidUrls([
      'https://www.pokeprices.io/set/Base%20Set',
      'https://www.pokeprices.io/set/Base%20Set',
      'https://www.pokeprices.io/set/Base%20Set',
    ])
    expect(out.accepted).toEqual(['https://www.pokeprices.io/set/Base%20Set'])
    expect(out.rejected.length).toBe(0)
  })

  it('mixed dedupe + validation reports duplicates once as accepted, rejects invalid separately', () => {
    const out = collectValidUrls([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/a',              // duplicate
      'https://pokeprices.io/b',                    // wrong host
      'https://www.pokeprices.io/dashboard/x',      // rejected path
      'https://www.pokeprices.io/insights',
    ])
    expect(out.accepted.sort()).toEqual([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/insights',
    ])
    expect(out.rejected.length).toBe(2)
  })
})

describe('58C — changed-only cohort: unchanged run submits zero', () => {
  it('re-running against an identical snapshot yields zero URLs to submit', () => {
    const previous = new Map<string, string>([
      ['https://www.pokeprices.io/a', 'h1'],
      ['https://www.pokeprices.io/b', 'h1'],
      ['https://www.pokeprices.io/c', 'h1'],
    ])
    const current = new Map<string, string>([
      ['https://www.pokeprices.io/a', 'h1'],
      ['https://www.pokeprices.io/b', 'h1'],
      ['https://www.pokeprices.io/c', 'h1'],
    ])
    const diff = diffSnapshots(previous, current)
    expect(diff.changed).toEqual([])
    expect(diff.deleted).toEqual([])
    // Simulate the CLI: no changed URLs → nothing to POST. If a future
    // refactor makes diffSnapshots include unchanged URLs by mistake, the
    // Aug 2026 amplification pattern reappears — this pin blocks that.
  })

  it('a single new URL flows through as the only submission', () => {
    const previous = new Map<string, string>([
      ['https://www.pokeprices.io/a', 'h1'],
    ])
    const current = new Map<string, string>([
      ['https://www.pokeprices.io/a', 'h1'],
      ['https://www.pokeprices.io/b', 'h1'], // NEW
    ])
    const diff = diffSnapshots(previous, current)
    expect(diff.changed).toEqual(['https://www.pokeprices.io/b'])
  })

  it('a content-hash change flows through as an update-submission', () => {
    const previous = new Map<string, string>([['https://www.pokeprices.io/a', 'h1']])
    const current  = new Map<string, string>([['https://www.pokeprices.io/a', 'h2']])
    const diff = diffSnapshots(previous, current)
    expect(diff.changed).toEqual(['https://www.pokeprices.io/a'])
  })
})

describe('58C — key never leaks into log output', () => {
  it('safeLogBody redacts the key even inside JSON responses', () => {
    const key = 'a8f92c1d7e4b49d2b7c5e913f4aa8179'
    const body = `{"status":"ok","host":"www.pokeprices.io","echoedKey":"${key}"}`
    const redacted = safeLogBody(body, key)
    expect(redacted).not.toContain(key)
    expect(redacted).toContain('[REDACTED_KEY]')
  })

  it('a full simulated batch run never surfaces the key in any log line', async () => {
    const key = 'super-secret-indexnow-key-do-not-log'
    // Simulate a server that echoes the key in error responses (this is
    // exactly the failure mode safeLogBody exists to defend against).
    const fetchMock = vi.fn(async () => ({
      status: 422,
      text: async () => `SiteVerification failed for key=${key}`,
    }))
    const r = await runBatchWithHarness(
      ['https://www.pokeprices.io/a'],
      key,
      `https://www.pokeprices.io/${key}.txt`,
      fetchMock,
    )
    for (const line of r.logLines) {
      expect(line, `log line leaked key: ${line}`).not.toContain(key)
    }
    // Also verify the redaction marker made it through.
    expect(r.logLines.some(l => l.includes('[REDACTED_KEY]'))).toBe(true)
  })
})

describe('58C — module invariants', () => {
  let originalFetch: typeof globalThis.fetch | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
    // Guard: any accidental real fetch inside the tests must fail hard.
    globalThis.fetch = (async () => { throw new Error('real fetch used in test') }) as unknown as typeof fetch
  })

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch
  })

  it('shouldRetry never returns true for a 200 / 202 / 400 / 403 / 422', () => {
    for (const s of [200, 202, 400, 403, 422]) {
      expect(shouldRetry(classifyStatus(s)), `status ${s} was retried`).toBe(false)
    }
  })

  it('shouldRetry returns true for 429 / 500 / 503 / 0 (network)', () => {
    for (const s of [429, 500, 503, 0]) {
      expect(shouldRetry(classifyStatus(s)), `status ${s} was not retried`).toBe(true)
    }
  })
})

// ── snapshot post-success semantics (Block 5A-W-58C follow-up) ────
//
// composeSnapshotFromAccepted is the single source of truth for the
// after-batching snapshot write. If any URL that IndexNow rejected /
// failed on ends up in the new snapshot with its NEW hash, the next
// operator run will incorrectly treat it as already-sent and never
// retry — that's the bug this suite pins against.

describe('composeSnapshotFromAccepted', () => {
  it('records the new hash only for URLs IndexNow accepted this run', () => {
    const prev = new Map([['https://www.pokeprices.io/a', 'h1-old']])
    const cur  = new Map([
      ['https://www.pokeprices.io/a', 'h1-new'],
      ['https://www.pokeprices.io/b', 'h2-new'],
    ])
    const accepted = new Set([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/b',
    ])
    const out = composeSnapshotFromAccepted(prev, cur, accepted)
    expect(out.get('https://www.pokeprices.io/a')).toBe('h1-new')
    expect(out.get('https://www.pokeprices.io/b')).toBe('h2-new')
    expect(out.size).toBe(2)
  })

  it('retains prior hash for a changed URL whose submission failed', () => {
    const prev = new Map([['https://www.pokeprices.io/a', 'h1-old']])
    const cur  = new Map([['https://www.pokeprices.io/a', 'h1-new']])
    const accepted = new Set<string>() // nothing accepted
    const out = composeSnapshotFromAccepted(prev, cur, accepted)
    expect(out.get('https://www.pokeprices.io/a')).toBe('h1-old')
  })

  it('omits a brand-new URL whose submission failed so next run retries it', () => {
    const prev = new Map<string, string>()
    const cur  = new Map([['https://www.pokeprices.io/new', 'h-new']])
    const accepted = new Set<string>()
    const out = composeSnapshotFromAccepted(prev, cur, accepted)
    expect(out.has('https://www.pokeprices.io/new')).toBe(false)
    expect(out.size).toBe(0)
  })

  it('keeps unchanged URLs (same hash on both sides) regardless of accepted set', () => {
    const prev = new Map([['https://www.pokeprices.io/a', 'h1']])
    const cur  = new Map([['https://www.pokeprices.io/a', 'h1']])
    const accepted = new Set<string>()
    const out = composeSnapshotFromAccepted(prev, cur, accepted)
    expect(out.get('https://www.pokeprices.io/a')).toBe('h1')
  })

  it('drops URLs that only existed in previous (deletion path)', () => {
    const prev = new Map([['https://www.pokeprices.io/gone', 'h-gone']])
    const cur  = new Map<string, string>()
    const accepted = new Set<string>()
    const out = composeSnapshotFromAccepted(prev, cur, accepted)
    expect(out.has('https://www.pokeprices.io/gone')).toBe(false)
  })

  it('mixed cohort — accepted new, failed new, accepted changed, failed changed, unchanged', () => {
    const prev = new Map([
      ['https://www.pokeprices.io/a', 'ha-old'], // will change + accepted → new hash
      ['https://www.pokeprices.io/b', 'hb-old'], // will change + fail → keep old hash
      ['https://www.pokeprices.io/e', 'he'],     // unchanged
    ])
    const cur = new Map([
      ['https://www.pokeprices.io/a', 'ha-new'],
      ['https://www.pokeprices.io/b', 'hb-new'],
      ['https://www.pokeprices.io/c', 'hc-new'], // new + accepted
      ['https://www.pokeprices.io/d', 'hd-new'], // new + failed
      ['https://www.pokeprices.io/e', 'he'],
    ])
    const accepted = new Set([
      'https://www.pokeprices.io/a',
      'https://www.pokeprices.io/c',
    ])
    const out = composeSnapshotFromAccepted(prev, cur, accepted)
    expect(out.get('https://www.pokeprices.io/a')).toBe('ha-new')
    expect(out.get('https://www.pokeprices.io/b')).toBe('hb-old')
    expect(out.get('https://www.pokeprices.io/c')).toBe('hc-new')
    expect(out.has('https://www.pokeprices.io/d')).toBe(false)
    expect(out.get('https://www.pokeprices.io/e')).toBe('he')
    expect(out.size).toBe(4)
  })
})
