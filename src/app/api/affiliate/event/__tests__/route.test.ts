// Block 4B-W-10A — POST /api/affiliate/event ingest tests.
// Covers: validation (400), insert success (200), PII non-capture,
// missing-table fallback (503), and trim/length capping.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

vi.mock('server-only', () => ({}))

const fakeDB = new FakeDB()
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => fakeDB,
}))

import { POST } from '../route'

beforeEach(() => { fakeDB.reset() })

function jsonReq(body: unknown, extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/affiliate/event', {
    method:  'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body:    JSON.stringify(body),
  })
}

describe('POST /api/affiliate/event — validation', () => {
  it('400 on non-JSON body', async () => {
    const r = await POST(new Request('http://localhost/api/affiliate/event', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    'not json',
    }))
    expect(r.status).toBe(400)
    const j = await r.json()
    expect(j.error).toMatch(/json/i)
  })

  it('400 when event_type is missing', async () => {
    const r = await POST(jsonReq({ placement: 'recent_sales_raw' }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/event_type/i)
  })

  it('400 when event_type is not "view" or "click"', async () => {
    const r = await POST(jsonReq({ event_type: 'hover', placement: 'recent_sales_raw' }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/event_type/i)
  })

  it('400 when placement is missing', async () => {
    const r = await POST(jsonReq({ event_type: 'view' }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/placement/i)
  })

  it('400 when placement contains disallowed characters', async () => {
    const r = await POST(jsonReq({ event_type: 'view', placement: 'recent sales/raw' }))
    expect(r.status).toBe(400)
  })

  it('400 when placement exceeds 80 chars', async () => {
    const r = await POST(jsonReq({ event_type: 'view', placement: 'a'.repeat(81) }))
    expect(r.status).toBe(400)
  })
})

describe('POST /api/affiliate/event — insert', () => {
  it('200 + inserts a row for a minimal valid view', async () => {
    const r = await POST(jsonReq({ event_type: 'view', placement: 'recent_sales_raw' }))
    expect(r.status).toBe(200)
    expect((await r.json()).ok).toBe(true)
    const rows = fakeDB.rows('affiliate_events')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event_type: 'view',
      placement:  'recent_sales_raw',
    })
  })

  it('200 + inserts a click with all optional fields', async () => {
    await POST(jsonReq({
      event_type:       'click',
      placement:        'recent_sales_psa10',
      page_type:        'card',
      source_component: 'recent_sales_section',
      card_slug:        '1450205',
      set_slug:         'Gym Challenge',
      intent:           'psa10',
      marketplace:      'UK',
      session_id:       'abc123',
    }))
    const rows = fakeDB.rows('affiliate_events')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      event_type:       'click',
      placement:        'recent_sales_psa10',
      page_type:        'card',
      source_component: 'recent_sales_section',
      card_slug:        '1450205',
      set_slug:         'Gym Challenge',
      intent:           'psa10',
      marketplace:      'UK',
      session_id:       'abc123',
    })
  })

  it('caps over-long optional fields rather than rejecting', async () => {
    await POST(jsonReq({
      event_type: 'view',
      placement:  'recent_sales_raw',
      card_slug:  'a'.repeat(200),    // cap = 80
      set_slug:   'b'.repeat(500),    // cap = 200
    }))
    const row = fakeDB.rows('affiliate_events')[0]
    expect(row.card_slug.length).toBe(80)
    expect(row.set_slug.length).toBe(200)
  })

  it('writes null for empty / whitespace-only optional fields', async () => {
    await POST(jsonReq({
      event_type: 'view',
      placement:  'recent_sales_raw',
      card_slug:  '   ',
      intent:     '',
    }))
    const row = fakeDB.rows('affiliate_events')[0]
    expect(row.card_slug).toBeNull()
    expect(row.intent).toBeNull()
  })
})

describe('POST /api/affiliate/event — privacy', () => {
  it('does not store the User-Agent header', async () => {
    await POST(jsonReq({ event_type: 'view', placement: 'recent_sales_raw' },
      { 'user-agent': 'Mozilla/5.0 (X11; pry-bot)' }))
    const row = fakeDB.rows('affiliate_events')[0]
    expect(JSON.stringify(row)).not.toMatch(/pry-bot/)
  })

  it('does not store the Referer header', async () => {
    await POST(jsonReq({ event_type: 'click', placement: 'recent_sales_raw' },
      { referer: 'https://www.pokeprices.io/set/x/card/y?secret=1' }))
    const row = fakeDB.rows('affiliate_events')[0]
    expect(JSON.stringify(row)).not.toMatch(/secret=1/)
    expect(JSON.stringify(row)).not.toMatch(/pokeprices\.io/)
  })

  it('does not store any IP-bearing header', async () => {
    await POST(jsonReq({ event_type: 'view', placement: 'recent_sales_raw' }, {
      'x-forwarded-for':  '203.0.113.42',
      'cf-connecting-ip': '203.0.113.42',
      'x-real-ip':        '203.0.113.42',
    }))
    const row = fakeDB.rows('affiliate_events')[0]
    expect(JSON.stringify(row)).not.toMatch(/203\.0\.113\.42/)
  })
})

describe('POST /api/affiliate/event — missing-table fallback', () => {
  it('503 when the affiliate_events table is missing (PGRST205)', async () => {
    fakeDB.forceInsertError('affiliate_events', {
      code: 'PGRST205',
      message: "Could not find the table 'public.affiliate_events' in the schema cache",
    })
    const r = await POST(jsonReq({ event_type: 'view', placement: 'recent_sales_raw' }))
    expect(r.status).toBe(503)
    const j = await r.json()
    expect(j.error).toMatch(/migration/i)
  })

  it('500 on any other insert failure', async () => {
    fakeDB.forceInsertError('affiliate_events', { code: 'XX000', message: 'kaboom' })
    const r = await POST(jsonReq({ event_type: 'view', placement: 'recent_sales_raw' }))
    expect(r.status).toBe(500)
  })
})
