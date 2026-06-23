// src/app/api/affiliate/event/route.ts
// Block 4B-W-10A — public ingest endpoint for affiliate impression/click
// events. Writes one row to public.affiliate_events per request.
//
// PRIVACY
//   This handler never reads:
//     * any IP-bearing header  (x-forwarded-for, cf-connecting-ip, …)
//     * the User-Agent header
//     * the Referer header
//   It records only the placement / page-type / card-slug / intent /
//   marketplace context already attached to the affiliate link itself.
//   Session ID is accepted ONLY when the client supplies one — the
//   server never invents or rotates it.
//
// SHAPE
//   POST application/json
//     {
//       event_type:       'view' | 'click',
//       placement:        string (required, [A-Za-z0-9_:.-], 1-80 chars),
//       page_type?:       string (<= 40),
//       source_component?:string (<= 80),
//       card_slug?:       string (<= 80),
//       set_slug?:        string (<= 200),
//       intent?:          string (<= 40),
//       marketplace?:     string (<= 8),
//       session_id?:      string (<= 64)
//     }
//   → 200 { ok: true } on success
//   → 400 { error } on validation failure
//   → 500 { error } on insert failure (logged server-side)
//   → 503 when the migration has not been applied (table missing)
//
// FAIL-OPEN ON CLIENT
//   The browser-side caller (postAffiliateEvent in src/lib/affiliateEventClient)
//   uses navigator.sendBeacon for clicks and fetch keepalive for views;
//   both are fire-and-forget and ignore any response. The link click
//   navigates regardless of the result.

import 'server-only'
import { NextResponse } from 'next/server'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PLACEMENT_RE = /^[A-Za-z0-9_:.-]+$/

type Body = {
  event_type?:       unknown
  placement?:        unknown
  page_type?:        unknown
  source_component?: unknown
  card_slug?:        unknown
  set_slug?:         unknown
  intent?:           unknown
  marketplace?:      unknown
  session_id?:       unknown
}

function asTrimmed(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function capped(v: unknown, max: number): string | null {
  const s = asTrimmed(v)
  if (s == null) return null
  return s.length <= max ? s : s.slice(0, max)
}

export async function POST(req: Request) {
  let body: Body
  try {
    body = await req.json() as Body
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const eventType = asTrimmed(body.event_type)
  if (eventType !== 'view' && eventType !== 'click') {
    return NextResponse.json({ error: 'event_type must be "view" or "click"' }, { status: 400 })
  }

  const placement = asTrimmed(body.placement)
  if (!placement || placement.length > 80 || !PLACEMENT_RE.test(placement)) {
    return NextResponse.json({ error: 'placement required, <=80 chars, [A-Za-z0-9_:.-]' }, { status: 400 })
  }

  const row = {
    event_type:       eventType,
    placement,
    page_type:        capped(body.page_type,         40),
    source_component: capped(body.source_component,  80),
    card_slug:        capped(body.card_slug,         80),
    set_slug:         capped(body.set_slug,         200),
    intent:           capped(body.intent,            40),
    marketplace:      capped(body.marketplace,        8),
    session_id:       capped(body.session_id,        64),
  }

  try {
    const supa = getSupabaseServiceClient()
    const { error } = await supa.from('affiliate_events').insert(row)
    if (error) {
      // Treat the not-yet-applied migration as a 503 rather than a 500
      // so the admin panel can render the "not yet enabled" copy.
      if (error.code === 'PGRST205' || /Could not find the table/i.test(error.message)) {
        return NextResponse.json({ error: 'affiliate_events table missing — apply migration' }, { status: 503 })
      }
      // eslint-disable-next-line no-console
      console.warn('[affiliate-event] insert failed:', error.message)
      return NextResponse.json({ error: 'insert failed' }, { status: 500 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    // eslint-disable-next-line no-console
    console.warn('[affiliate-event] unexpected:', msg)
    return NextResponse.json({ error: 'unexpected' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
