// src/app/api/admin/alerts/render-instant-digest/route.ts
// Block 5A-W-22 — admin-only POST that renders the EXACT instant
// alert digest the next cron run would send for one user. Mirrors
// the delivery engine's selection pipeline (per-(card, rule) dedupe
// + card cap) and returns the rendered subject / HTML / plain text
// along with the same per-user counters the instant-preview route
// surfaces in batch form.
//
// Unlike preview-email (which renders the RAW undelivered events),
// this route runs `selectDigestPlan` first so the admin sees what
// would actually ship — including dedupe, the card cap, and the
// superseded-duplicate count. Useful for sanity-checking a real user
// before a cron run flips on.
//
// Recipient field is NEVER accepted from the request body. The route
// always operates against the admin's own user_id unless an explicit
// `userId` is supplied; even then the email is NEVER sent — this is
// strictly inspection. No alert_events.delivered_at updates, no Resend
// call, no email_delivery_log row reserved.
//
// Triple gate:
//   1. ALERT_EMAIL_PREVIEW_ENABLED='true' OR ALERTS_EVALUATOR_ENABLED='true'.
//   2. requireAdmin.
//   3. POST-only.

import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/adminAuth'
import { isAlertEmailPreviewEnabled, isAlertsEvaluatorEnabled } from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { buildEmailDigest, type DigestEvent } from '@/lib/alerts/emailDigest'
import { selectDigestPlan } from '@/lib/alerts/delivery'
import type { AlertRule } from '@/lib/alerts/preferences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REAL_EVENT_LIMIT     = 50
const DEFAULT_MAX_CARDS    = 10

export async function POST(req: Request) {
  if (!isAlertEmailPreviewEnabled() && !isAlertsEvaluatorEnabled()) {
    return NextResponse.json({ error: 'instant alert digest preview disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: { userId?: unknown } = {}
  try { body = (await req.json()) as { userId?: unknown } } catch { /* empty body acceptable */ }

  // userId only chooses WHICH user's digest to render. It never
  // affects WHO RECEIVES anything — the route doesn't send. Defaults
  // to the admin's own uid so "render mine" is one click.
  const targetUid = typeof body.userId === 'string' && body.userId.length > 0
    ? body.userId
    : admin.userId

  try {
    const supa   = getSupabaseServiceClient()
    const events = await loadDigestEventsForUser(supa, targetUid, REAL_EVENT_LIMIT)
    const plan   = selectDigestPlan(events, DEFAULT_MAX_CARDS)

    const digest = buildEmailDigest(plan.includedEvents, { sample: false, test: false })

    return NextResponse.json({
      // Counters mirror what the instant-preview route surfaces per
      // user, so the admin sees the same numbers either way.
      eventCountLoaded:     events.length,
      eventCountRendered:   plan.includedEvents.length,
      supersededEventCount: plan.supersededIds.length,
      cardCount:            plan.cardCount,
      leftover:             plan.leftover,
      // Rendered email — admin can inspect via iframe srcdoc or
      // <pre>{text}</pre>. Recipient is NEVER echoed.
      subject:              digest.subject,
      previewText:          digest.previewText,
      html:                 digest.html,
      text:                 digest.text,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'render failed', detail: msg }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────
// Read-only DB plumbing — mirrors preview-email's loader but ALSO
// plumbs `id` + `detectedAt` through so the dedupe step has its
// tie-breaker information.
// ─────────────────────────────────────────────────────────────────────

async function loadDigestEventsForUser(
  supa:   SupabaseClient,
  userId: string,
  limit:  number,
): Promise<DigestEvent[]> {
  if (!userId) return []
  const { data, error } = await supa
    .from('alert_events')
    .select('id, card_slug, card_name, set_name, rule, severity, payload_json, detected_at')
    .eq('user_id', userId)
    .is('delivered_at', null)
    .order('detected_at', { ascending: false })
    .limit(limit)
  if (error || !Array.isArray(data) || data.length === 0) return []
  const rows  = data as Array<Record<string, unknown>>
  const slugs = Array.from(new Set(rows.map(r => String(r.card_slug)).filter(Boolean)))
  const urlMap = await loadCardUrlMap(supa, slugs)
  return rows.map(r => {
    const slug = String(r.card_slug)
    return {
      cardName:   String(r.card_name ?? slug),
      setName:    r.set_name == null ? '' : String(r.set_name),
      cardSlug:   slug,
      cardUrl:    urlMap.get(slug),
      rule:       String(r.rule) as AlertRule,
      severity:   (String(r.severity) as 'low'|'normal'|'high') ?? 'normal',
      payload:    (r.payload_json && typeof r.payload_json === 'object') ? r.payload_json as Record<string, unknown> : {},
      id:         r.id == null ? undefined : String(r.id),
      detectedAt: r.detected_at == null ? undefined : String(r.detected_at),
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
