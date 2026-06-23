// src/lib/affiliateEventClient.ts
// Block 4B-W-10A — browser-side helper that fires affiliate events at
// our own ingest endpoint in addition to the existing GA4 / gtag path.
//
// Three rules:
//   1. Never block. Clicks must navigate immediately.
//   2. Never throw. Any failure is silent.
//   3. No PII. The helper does not read cookies, document.referrer,
//      navigator.userAgent, or any header beyond content-type. It
//      forwards only the typed analytics payload supplied by the
//      caller.
//
// Click transport: navigator.sendBeacon — does not delay the
// outbound navigation and survives the page unload.
// View transport: fetch with keepalive — same survival guarantee,
// returns the response (which we ignore).

const ENDPOINT = '/api/affiliate/event'

export type AffiliateEventType = 'view' | 'click'

export type AffiliateEventPayload = {
  event_type:        AffiliateEventType
  placement:         string
  page_type?:        string
  source_component?: string
  card_slug?:        string
  set_slug?:         string
  intent?:           string
  marketplace?:      string
  session_id?:       string
}

function compact(p: AffiliateEventPayload): Record<string, string> {
  // Drop undefined / empty values before sending. The endpoint accepts
  // partial bodies; sending fewer keys keeps payloads tiny.
  const out: Record<string, string> = {
    event_type: p.event_type,
    placement:  p.placement,
  }
  const optional: Array<keyof AffiliateEventPayload> = [
    'page_type','source_component','card_slug','set_slug',
    'intent','marketplace','session_id',
  ]
  for (const k of optional) {
    const v = p[k]
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  return out
}

export function postAffiliateEvent(payload: AffiliateEventPayload): void {
  if (typeof window === 'undefined') return
  const body = JSON.stringify(compact(payload))

  // Clicks: use sendBeacon so navigation isn't blocked and the request
  // survives unload. Fall through to fetch keepalive when sendBeacon
  // is missing (older Safari with certain permissions, etc.).
  if (payload.event_type === 'click') {
    try {
      const nav = window.navigator as Navigator & {
        sendBeacon?: (url: string, data?: BodyInit | null) => boolean
      }
      if (typeof nav.sendBeacon === 'function') {
        const blob = new Blob([body], { type: 'application/json' })
        if (nav.sendBeacon(ENDPOINT, blob)) return
      }
    } catch { /* fall through to fetch */ }
  }

  // Views (and click fallback): fetch keepalive. Failure is silent.
  try {
    void fetch(ENDPOINT, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
      cache:       'no-store',
    }).catch(() => { /* silent */ })
  } catch { /* silent */ }
}
