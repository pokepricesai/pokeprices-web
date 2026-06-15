// src/lib/attribution.ts
// Lightweight first-touch and current-session attribution capture.
//
// What we store:
//   * utm_source, utm_medium, utm_campaign, utm_content, utm_term — from
//     the current URL's query string when present.
//   * referrer_domain — the hostname of document.referrer ONLY. We never
//     persist the full referring URL because it may contain personal
//     details in its own query string.
//
// Where we store it:
//   * pp_first_touch_v1 (localStorage) — first non-empty capture, kept
//     for FIRST_TOUCH_TTL_MS.
//   * pp_last_touch_v1  (localStorage) — most recent capture; replaced
//     on every visit that brings any attribution.
//
// The helper is safe to call on every navigation. It is a no-op when
// nothing of value is present — empty captures do not overwrite the
// stored entries.

export const FIRST_TOUCH_KEY = 'pp_first_touch_v1'
export const LAST_TOUCH_KEY  = 'pp_last_touch_v1'
export const FIRST_TOUCH_TTL_MS = 90 * 24 * 60 * 60 * 1000  // 90 days

const MAX_VALUE_LEN = 100

const UTM_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
] as const

export type UtmKey = typeof UTM_KEYS[number]

export type AttributionPayload = {
  utm_source?:      string
  utm_medium?:      string
  utm_campaign?:    string
  utm_content?:     string
  utm_term?:        string
  referrer_domain?: string
  captured_at:      number
}

function truncate(s: string): string {
  return s.length > MAX_VALUE_LEN ? s.slice(0, MAX_VALUE_LEN) : s
}

/** Extracts UTMs from a URL's search params. */
export function extractUtmFromUrl(search: string): Partial<AttributionPayload> {
  const out: Partial<AttributionPayload> = {}
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  for (const key of UTM_KEYS) {
    const raw = params.get(key)
    if (!raw) continue
    const v = raw.trim()
    if (!v) continue
    out[key] = truncate(v)
  }
  return out
}

/** Hostname of a referrer URL; null if missing or unparseable. */
export function extractReferrerDomain(referrer: string | null | undefined): string | undefined {
  if (typeof referrer !== 'string' || !referrer) return undefined
  try {
    const u = new URL(referrer)
    if (!u.hostname) return undefined
    return truncate(u.hostname.toLowerCase())
  } catch {
    return undefined
  }
}

/** True when the payload carries at least one non-empty UTM or referrer_domain. */
export function hasMeaningfulAttribution(p: Partial<AttributionPayload>): boolean {
  if (p.referrer_domain) return true
  for (const k of UTM_KEYS) {
    if (p[k]) return true
  }
  return false
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch { return null }
}

function readStored(key: string): AttributionPayload | null {
  const ls = safeLocalStorage()
  if (!ls) return null
  try {
    const raw = ls.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.captured_at !== 'number') return null
    return parsed as AttributionPayload
  } catch { return null }
}

function writeStored(key: string, payload: AttributionPayload): void {
  const ls = safeLocalStorage()
  if (!ls) return
  try { ls.setItem(key, JSON.stringify(payload)) } catch { /* quota / privacy mode */ }
}

/**
 * Capture attribution from the current URL + document.referrer.
 *
 * Updates last-touch whenever a capture brings any UTM or referrer.
 * Updates first-touch only when none is currently stored or the stored
 * one has expired. Empty captures (no UTMs, same-origin referrer) are
 * ignored entirely.
 */
export function captureAttribution(now: number = Date.now()): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const fromUrl = extractUtmFromUrl(window.location.search || '')
  let referrer = extractReferrerDomain(document.referrer || null)

  // Same-origin referrers are not useful attribution; treat as none.
  if (referrer && referrer === window.location.hostname.toLowerCase()) {
    referrer = undefined
  }

  const payload: AttributionPayload = {
    ...fromUrl,
    referrer_domain: referrer,
    captured_at:     now,
  }

  if (!hasMeaningfulAttribution(payload)) return

  writeStored(LAST_TOUCH_KEY, payload)

  const existing = readStored(FIRST_TOUCH_KEY)
  if (existing && now - existing.captured_at < FIRST_TOUCH_TTL_MS) return
  writeStored(FIRST_TOUCH_KEY, payload)
}

/** Returns the stored first-touch and last-touch entries. */
export function getAttribution(): {
  first_touch?: AttributionPayload
  last_touch?:  AttributionPayload
} {
  const first = readStored(FIRST_TOUCH_KEY)
  const last  = readStored(LAST_TOUCH_KEY)
  return {
    first_touch: first ?? undefined,
    last_touch:  last  ?? undefined,
  }
}

/**
 * Builds a flat dimensions object suitable for attaching to a commercial
 * event. Prefixes first-touch keys with `ft_` and last-touch with `lt_`
 * so the two attribution windows can be compared in GA4.
 */
export function attributionDimensions(): Record<string, string> {
  const out: Record<string, string> = {}
  const { first_touch, last_touch } = getAttribution()
  if (first_touch) {
    for (const k of UTM_KEYS) {
      const v = first_touch[k]
      if (v) out[`ft_${k}`] = v
    }
    if (first_touch.referrer_domain) out['ft_referrer_domain'] = first_touch.referrer_domain
  }
  if (last_touch) {
    for (const k of UTM_KEYS) {
      const v = last_touch[k]
      if (v) out[`lt_${k}`] = v
    }
    if (last_touch.referrer_domain) out['lt_referrer_domain'] = last_touch.referrer_domain
  }
  return out
}

export function clearAttribution(): void {
  const ls = safeLocalStorage()
  if (!ls) return
  try { ls.removeItem(FIRST_TOUCH_KEY); ls.removeItem(LAST_TOUCH_KEY) } catch { /* fine */ }
}
