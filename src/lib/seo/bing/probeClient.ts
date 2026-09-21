// src/lib/seo/bing/probeClient.ts
// ============================================================================
// Stage 5A discovery — Bing Webmaster REST/JSON probe client.
//
// Read-only. Never mutates. Never logs the API key. All endpoints hit the
// current post-SOAP-retirement JSON base:
//
//   https://ssl.bing.com/webmaster/api.svc/json/<METHOD>?apikey=<KEY>&…
//
// Auth is a single-shot query-string parameter `apikey` (per Microsoft
// Learn's api-protocols.md). Callers pass their site URL; this file
// never persists or writes anything.
// ============================================================================

import 'server-only'

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json'

/** Parse the WCF/ASP.NET-AJAX date format Bing returns:
 *  "/Date(1316156400000-0700)/" → { iso: string, tzOffsetMinutes: number }.
 *  Returns null for anything that does not match. */
export function parseWcfDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.match(/^\/Date\((-?\d+)(?:([+-])(\d{2})(\d{2}))?\)\/$/)
  if (!m) return null
  const ms = Number(m[1])
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/** Replace the apikey= value inside any surfaced URL with a placeholder
 *  so no probe result can accidentally leak the secret. */
export function sanitiseUrl(u: string): string {
  return u.replace(/([?&])apikey=[^&]*/i, '$1apikey=[REDACTED]')
}

export type BingProbe = {
  name: string
  method: string
  input: Record<string, unknown>
  status: number
  http_ok: boolean
  duration_ms: number
  url_sanitised: string
  /** True when Bing returned a JSON body whose `d` field is an array
   *  or object; false when the response was an error. */
  parsed_ok: boolean
  d_length?: number
  first_row_keys?: string[]
  sample_row?: Record<string, unknown>
  notes: string[]
  error?: string
}

/** Build the request URL. Only used inside this file, never returned. */
function buildUrl(method: string, params: Record<string, unknown>, apiKey: string): string {
  const qs = new URLSearchParams()
  qs.set('apikey', apiKey)
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue
    qs.set(k, String(v))
  }
  return `${BASE}/${method}?${qs.toString()}`
}

/** Perform one probe with a hard timeout. Never throws — always returns
 *  a BingProbe with status/parsed_ok/notes/error populated as appropriate. */
export async function probeOne(
  name: string,
  method: string,
  input: Record<string, unknown>,
  apiKey: string,
  opts: { timeoutMs?: number; sampleRowsForKeys?: boolean } = {},
): Promise<BingProbe> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const url = buildUrl(method, input, apiKey)
  const urlSan = sanitiseUrl(url)
  const started = performance.now()
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  const notes: string[] = []
  try {
    const res = await fetch(url, {
      method: 'GET',
      // Bing accepts GET or POST for JSON; use GET for read-only probing.
      headers: { 'accept': 'application/json' },
      signal: controller.signal,
    })
    clearTimeout(t)
    const duration_ms = Math.round(performance.now() - started)
    const status = res.status
    const http_ok = res.ok
    let bodyText = ''
    try { bodyText = await res.text() } catch { bodyText = '' }
    let parsed_ok = false
    let d_length: number | undefined
    let first_row_keys: string[] | undefined
    let sample_row: Record<string, unknown> | undefined
    let error: string | undefined
    if (!http_ok) {
      error = bodyText.slice(0, 300)
    } else {
      try {
        const json = JSON.parse(bodyText) as { d?: unknown }
        if (Array.isArray(json.d)) {
          parsed_ok = true
          d_length = json.d.length
          if (json.d.length > 0 && typeof json.d[0] === 'object' && json.d[0] !== null) {
            first_row_keys = Object.keys(json.d[0] as Record<string, unknown>)
            sample_row = { ...(json.d[0] as Record<string, unknown>) }
            // Convert Bing's WCF date on the sample row for readability.
            for (const [k, v] of Object.entries(sample_row)) {
              const iso = parseWcfDate(v)
              if (iso) sample_row[k] = `${iso}  (raw ${v as string})`
            }
          }
        } else if (json && typeof json.d === 'object' && json.d !== null) {
          parsed_ok = true
          const obj = json.d as Record<string, unknown>
          first_row_keys = Object.keys(obj)
          sample_row = { ...obj }
          for (const [k, v] of Object.entries(sample_row)) {
            const iso = parseWcfDate(v)
            if (iso) sample_row[k] = `${iso}  (raw ${v as string})`
          }
        } else {
          error = 'response has no `d` field or unexpected shape'
        }
      } catch (e) {
        error = `json parse failed: ${e instanceof Error ? e.message : 'unknown'}: body=${bodyText.slice(0, 200)}`
      }
    }
    return {
      name, method, input,
      status, http_ok, duration_ms,
      url_sanitised: urlSan,
      parsed_ok,
      d_length, first_row_keys, sample_row,
      notes,
      error,
    }
  } catch (e) {
    clearTimeout(t)
    const duration_ms = Math.round(performance.now() - started)
    const msg = e instanceof Error ? e.message : 'unknown'
    return {
      name, method, input,
      status: 0, http_ok: false, duration_ms,
      url_sanitised: urlSan,
      parsed_ok: false,
      notes,
      error: `fetch failed: ${msg}`,
    }
  }
}

/** Extract per-day date coverage from a stats response — returns
 *  {min, max, count} of ISO dates found in the response body. */
export async function summariseDailyStats(url: string): Promise<{ min: string | null; max: string | null; count: number; distinct_days: number } | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const json = await res.json() as { d?: Array<{ Date?: unknown }> }
    if (!Array.isArray(json.d)) return null
    const days = new Set<string>()
    let min: string | null = null, max: string | null = null
    for (const row of json.d) {
      const iso = parseWcfDate(row.Date)
      if (!iso) continue
      const d = iso.slice(0, 10)
      days.add(d)
      if (min == null || d < min) min = d
      if (max == null || d > max) max = d
    }
    return { min, max, count: json.d.length, distinct_days: days.size }
  } catch { return null }
}
