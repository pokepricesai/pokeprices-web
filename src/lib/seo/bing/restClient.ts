// src/lib/seo/bing/restClient.ts
// ============================================================================
// Bing Webmaster REST/JSON client — production ingest.
//
// Renamed from probeClient.ts after Stage 5A discovery. Read-only.
//
// Base:
//   https://ssl.bing.com/webmaster/api.svc/json/<METHOD>?apikey=<KEY>&…
//
// SOAP + POX surfaces (retired 2026-08-31) are intentionally NOT supported.
//
// Safety
//   - The API key is only ever composed inside buildUrl(). Errors surface
//     `sanitiseError()` output which redacts `apikey=` values.
//   - Never logs, echoes, or persists BING_WEBMASTER_API_KEY.
//   - Bounded timeout per attempt.
//   - Conservative exponential backoff on 429 / 500 / 502 / 503 / 504 and
//     network errors. 4xx (other than 429) is never retried — the caller
//     needs to see auth/parameter failures immediately.
// ============================================================================

import 'server-only'

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json'

/** Parse the WCF/ASP.NET-AJAX date format Bing returns:
 *  "/Date(1316156400000-0700)/" → ISO string, or null. */
export function parseWcfDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/^\/Date\((-?\d+)(?:([+-])(\d{2})(\d{2}))?\)\/$/)
  if (!m) return null
  const ms = Number(m[1])
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/** Redact any surfaced apikey= parameter value from an error string. */
export function sanitiseError(s: string): string {
  return s.replace(/apikey=[^&\s"]+/gi, 'apikey=[REDACTED]')
}

export type BingFetchOptions = {
  timeoutMs?: number
  maxRetries?: number
}

export type BingFetchResult<T> = {
  ok: boolean
  data?: T
  error?: string
  attempts: number
  latency_ms: number
  http_status?: number
  retriable?: boolean
}

function buildUrl(method: string, params: Record<string, unknown>, apiKey: string): string {
  const qs = new URLSearchParams()
  qs.set('apikey', apiKey)
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    qs.set(k, String(v))
  }
  return `${BASE}/${method}?${qs.toString()}`
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** GET a Bing REST/JSON Get* method with retry/backoff. Returns the parsed
 *  `d` field of the response body, or a sanitised error string. Never
 *  throws — always returns a discriminated union. */
export async function bingFetch<T = unknown>(
  method: string,
  params: Record<string, unknown>,
  apiKey: string,
  opts: BingFetchOptions = {},
): Promise<BingFetchResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 20_000
  const maxRetries = opts.maxRetries ?? 3
  const url = buildUrl(method, params, apiKey)

  const started = performance.now()
  let attempts = 0
  let lastError = 'unknown'
  let lastStatus: number | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts++
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'accept': 'application/json' },
        signal: controller.signal,
      })
      clearTimeout(t)
      lastStatus = res.status
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = sanitiseError(`HTTP ${res.status}: ${body.slice(0, 200)}`)
        if (isRetriableStatus(res.status) && attempt < maxRetries) {
          lastError = err
          await sleep(backoffMs(attempt))
          continue
        }
        return {
          ok: false,
          error: err,
          attempts,
          latency_ms: Math.round(performance.now() - started),
          http_status: res.status,
          retriable: isRetriableStatus(res.status),
        }
      }
      const bodyText = await res.text()
      let parsed: { d?: T }
      try {
        parsed = JSON.parse(bodyText) as { d?: T }
      } catch (e) {
        const msg = sanitiseError(`json parse failed: ${e instanceof Error ? e.message : 'unknown'}: body=${bodyText.slice(0, 200)}`)
        return {
          ok: false, error: msg, attempts,
          latency_ms: Math.round(performance.now() - started),
          http_status: res.status,
        }
      }
      if (parsed.d === undefined) {
        return {
          ok: false,
          error: 'response body has no `d` field',
          attempts,
          latency_ms: Math.round(performance.now() - started),
          http_status: res.status,
        }
      }
      return {
        ok: true,
        data: parsed.d as T,
        attempts,
        latency_ms: Math.round(performance.now() - started),
        http_status: res.status,
      }
    } catch (e) {
      clearTimeout(t)
      const isAbort = e instanceof Error && e.name === 'AbortError'
      lastError = sanitiseError(`fetch failed${isAbort ? ' (timeout)' : ''}: ${e instanceof Error ? e.message : 'unknown'}`)
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt))
        continue
      }
      return {
        ok: false,
        error: lastError,
        attempts,
        latency_ms: Math.round(performance.now() - started),
        http_status: lastStatus,
        retriable: true,
      }
    }
  }
  return {
    ok: false,
    error: lastError,
    attempts,
    latency_ms: Math.round(performance.now() - started),
    http_status: lastStatus,
  }
}

function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, attempt)
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(8000, base) + jitter
}

/** Small helper for callers that want a hard failure. */
export function requireBingApiKey(): string {
  const key = process.env.BING_WEBMASTER_API_KEY
  if (!key) throw new Error('BING_WEBMASTER_API_KEY env var is not set')
  return key
}

export const BING_SITE_URL = 'https://pokeprices.io/'
