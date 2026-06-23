// Block 4B-W-10A — browser-side affiliate-event helper.
// Verifies: sendBeacon path for clicks, fetch keepalive fallback,
// silent failure, compact body shape (no undefined keys, no PII).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { postAffiliateEvent } from '../affiliateEventClient'

type BeaconCall = { url: string; body: string }
let beaconCalls: BeaconCall[]
let beaconReturn: boolean
let beaconImpl: ((url: string, data?: BodyInit | null) => boolean) | undefined
let fetchCalls: Array<{ url: string; init: RequestInit }>
let fetchReject: boolean

class FakeBlob {
  public _text: string
  public type: string
  constructor(parts: string[], opts?: { type?: string }) {
    this._text = parts.join('')
    this.type  = opts?.type ?? ''
  }
}

beforeEach(() => {
  beaconCalls  = []
  beaconReturn = true
  beaconImpl = (url, data) => {
    const maybeText = (data as unknown as { _text?: unknown } | null | undefined)?._text
    const body = typeof maybeText === 'string' ? maybeText : String(data ?? '')
    beaconCalls.push({ url, body })
    return beaconReturn
  }
  fetchCalls   = []
  fetchReject  = false

  vi.stubGlobal('window', {
    navigator: { get sendBeacon() { return beaconImpl } },
  })
  vi.stubGlobal('navigator', { get sendBeacon() { return beaconImpl } })
  vi.stubGlobal('Blob', FakeBlob)
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    fetchCalls.push({ url, init })
    if (fetchReject) return Promise.reject(new Error('network'))
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ─────────────────────────────────────────────────────────────────────
// Transport selection
// ─────────────────────────────────────────────────────────────────────

describe('postAffiliateEvent — transport selection', () => {
  it('uses sendBeacon for clicks', () => {
    postAffiliateEvent({ event_type: 'click', placement: 'recent_sales_psa10' })
    expect(beaconCalls).toHaveLength(1)
    expect(beaconCalls[0].url).toBe('/api/affiliate/event')
    expect(fetchCalls).toHaveLength(0)
  })

  it('uses fetch keepalive for views', () => {
    postAffiliateEvent({ event_type: 'view', placement: 'recent_sales_psa10' })
    expect(beaconCalls).toHaveLength(0)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe('/api/affiliate/event')
    expect((fetchCalls[0].init as RequestInit & { keepalive?: boolean }).keepalive).toBe(true)
    expect(fetchCalls[0].init.method).toBe('POST')
    expect((fetchCalls[0].init.headers as Record<string, string>)['content-type']).toBe('application/json')
  })

  it('falls back to fetch keepalive for clicks when sendBeacon returns false', () => {
    beaconReturn = false
    postAffiliateEvent({ event_type: 'click', placement: 'recent_sales_raw' })
    expect(beaconCalls).toHaveLength(1)
    expect(fetchCalls).toHaveLength(1)
  })

  it('falls back to fetch keepalive for clicks when sendBeacon is absent', () => {
    beaconImpl = undefined
    postAffiliateEvent({ event_type: 'click', placement: 'recent_sales_raw' })
    expect(beaconCalls).toHaveLength(0)
    expect(fetchCalls).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// No-op cases
// ─────────────────────────────────────────────────────────────────────

describe('postAffiliateEvent — no-ops', () => {
  it('does nothing when window is undefined (SSR)', () => {
    vi.stubGlobal('window', undefined)
    postAffiliateEvent({ event_type: 'view', placement: 'recent_sales_raw' })
    expect(beaconCalls).toHaveLength(0)
    expect(fetchCalls).toHaveLength(0)
  })

  it('does not throw when fetch rejects', () => {
    fetchReject = true
    expect(() =>
      postAffiliateEvent({ event_type: 'view', placement: 'recent_sales_raw' }),
    ).not.toThrow()
  })

  it('does not throw when sendBeacon throws synchronously', () => {
    beaconImpl = () => { throw new Error('boom') }
    expect(() =>
      postAffiliateEvent({ event_type: 'click', placement: 'recent_sales_raw' }),
    ).not.toThrow()
    // Falls through to fetch.
    expect(fetchCalls).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Payload shape
// ─────────────────────────────────────────────────────────────────────

describe('postAffiliateEvent — payload shape', () => {
  function parsed(body: string): Record<string, unknown> {
    return JSON.parse(body) as Record<string, unknown>
  }

  it('strips undefined / empty optional fields before sending', () => {
    postAffiliateEvent({
      event_type: 'view',
      placement:  'recent_sales_raw',
      page_type:  undefined,
      card_slug:  '',
    })
    const body = parsed(fetchCalls[0].init.body as string)
    expect(body).toEqual({ event_type: 'view', placement: 'recent_sales_raw' })
    expect(Object.keys(body)).not.toContain('page_type')
    expect(Object.keys(body)).not.toContain('card_slug')
  })

  it('forwards every supplied optional field exactly once', () => {
    postAffiliateEvent({
      event_type:       'click',
      placement:        'recent_sales_psa9',
      page_type:        'card',
      source_component: 'recent_sales_section',
      card_slug:        '1450205',
      set_slug:         'Gym Challenge',
      intent:           'psa9',
      marketplace:      'UK',
      session_id:       'sess-xyz',
    })
    const body = parsed(beaconCalls[0].body)
    expect(body).toEqual({
      event_type:       'click',
      placement:        'recent_sales_psa9',
      page_type:        'card',
      source_component: 'recent_sales_section',
      card_slug:        '1450205',
      set_slug:         'Gym Challenge',
      intent:           'psa9',
      marketplace:      'UK',
      session_id:       'sess-xyz',
    })
  })

  it('never includes ip / user_agent / referer / email / user_id in the body', () => {
    postAffiliateEvent({ event_type: 'click', placement: 'recent_sales_raw' })
    const body = beaconCalls[0].body.toLowerCase()
    for (const banned of ['ip','user_agent','useragent','referer','referrer','email','user_id']) {
      expect(body).not.toContain(banned)
    }
  })
})
