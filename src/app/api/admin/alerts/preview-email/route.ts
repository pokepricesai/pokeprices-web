// src/app/api/admin/alerts/preview-email/route.ts
// Block 5A-W-4 — admin-only POST endpoint that renders an alert email
// digest preview WITHOUT sending or persisting anything.
//
// Triple gate:
//   1. ALERTS_EVALUATOR_ENABLED='true' OR ALERT_EMAIL_PREVIEW_ENABLED='true' (503 otherwise)
//   2. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS)
//   3. POST-only
//
// Modes (body { "mode"?: "auto" | "real" | "sample" }):
//   auto    (default) — real if the admin has undelivered alert_events,
//                       else fall back to sample so the design can
//                       still be reviewed on an empty system.
//   real              — always read alert_events for the admin's own
//                       user_id; never sample.
//   sample            — always render hand-crafted events; never read
//                       alert_events.
//
// Response (success):
//   {
//     mode:        'real' | 'sample',
//     sample:      boolean,
//     eventCount:  number,
//     subject:     string,
//     previewText: string,
//     html:        string,
//     text:        string,
//   }
//
// SAFETY: no email send, no Resend call, no insert/update/delete on
// alert_events, no delivery log write. The response never includes
// user_id, email or any field that could identify a recipient.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isAlertEmailPreviewEnabled, isAlertsEvaluatorEnabled } from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import {
  buildEmailDigest,
  buildSampleEvents,
  type DigestEvent,
} from '@/lib/alerts/emailDigest'
import type { AlertRule } from '@/lib/alerts/preferences'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

const REAL_EVENT_LIMIT = 20

type Mode = 'auto' | 'real' | 'sample'

function parseMode(v: unknown): Mode {
  if (v === 'real' || v === 'sample' || v === 'auto') return v
  return 'auto'
}

export async function POST(req: Request) {
  if (!isAlertsEvaluatorEnabled() && !isAlertEmailPreviewEnabled()) {
    return NextResponse.json({ error: 'alerts preview disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: { mode?: unknown } = {}
  try { body = (await req.json()) as { mode?: unknown } } catch { /* empty body acceptable */ }
  const mode = parseMode(body.mode)

  try {
    const supa  = getSupabaseServiceClient()
    let events: DigestEvent[] = []
    let resolvedMode: 'real' | 'sample' = 'sample'

    if (mode !== 'sample') {
      events = await loadAdminAlertEvents(supa, admin.userId, REAL_EVENT_LIMIT)
      if (events.length > 0 || mode === 'real') {
        resolvedMode = 'real'
      } else {
        // mode === 'auto' and no real events → sample fallback.
        events = buildSampleEvents()
        resolvedMode = 'sample'
      }
    } else {
      events = buildSampleEvents()
      resolvedMode = 'sample'
    }

    const digest = buildEmailDigest(events, { sample: resolvedMode === 'sample' })
    return NextResponse.json({
      mode:        resolvedMode,
      sample:      resolvedMode === 'sample',
      eventCount:  events.length,
      subject:     digest.subject,
      previewText: digest.previewText,
      html:        digest.html,
      text:        digest.text,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'preview failed', detail: msg }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────
// DB plumbing — read-only
// ─────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

async function loadAdminAlertEvents(
  supa:   SupabaseClient,
  userId: string,
  limit:  number,
): Promise<DigestEvent[]> {
  if (!userId) return []
  // Read only the admin's OWN undelivered events. Returning another
  // user's data would leak their watch list via inference — keep it
  // strictly scoped.
  const { data, error } = await supa
    .from('alert_events')
    .select('card_slug, card_name, set_name, rule, severity, payload_json')
    .eq('user_id', userId)
    .is('delivered_at', null)
    .order('detected_at', { ascending: false })
    .limit(limit)
  if (error || !Array.isArray(data) || data.length === 0) return []

  // Resolve card URLs from the `cards` table by bare numeric slug.
  // One batched read; missing rows just leave cardUrl undefined and
  // the digest renders the event without a link.
  const rows = data as Array<Record<string, unknown>>
  const slugs = Array.from(new Set(rows.map(r => String(r.card_slug)).filter(Boolean)))
  const urlMap = await loadCardUrlMap(supa, slugs)

  return rows.map(r => {
    const slug = String(r.card_slug)
    return {
      cardName: String(r.card_name ?? slug),
      setName:  r.set_name == null ? '' : String(r.set_name),
      cardUrl:  urlMap.get(slug),
      rule:     String(r.rule) as AlertRule,
      severity: (String(r.severity) as 'low'|'normal'|'high') ?? 'normal',
      payload:  (r.payload_json && typeof r.payload_json === 'object') ? r.payload_json as Record<string, unknown> : {},
    }
  })
}

async function loadCardUrlMap(supa: SupabaseClient, bareSlugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (bareSlugs.length === 0) return out
  const { data, error } = await supa
    .from('cards')
    .select('card_slug, set_name, card_url_slug')
    .in('card_slug', bareSlugs)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const slug    = String(r.card_slug)
    const setName = r.set_name      == null ? '' : String(r.set_name)
    const urlSlug = r.card_url_slug == null ? '' : String(r.card_url_slug)
    if (slug && setName && urlSlug) {
      out.set(slug, `https://www.pokeprices.io/set/${encodeURIComponent(setName)}/card/${urlSlug}`)
    }
  }
  return out
}
