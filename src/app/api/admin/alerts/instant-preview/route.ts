// src/app/api/admin/alerts/instant-preview/route.ts
// Block 5A-W-22 — admin-only dry-run preview of the NEXT instant alert
// batch. Runs the same selection pipeline the cron + admin batch
// would use, but with dryRun=true so:
//   * no emails are sent
//   * no alert_events.delivered_at is written
//   * no email_delivery_log row is reserved
//
// Surfaces the per-user counters from Block 5A-W-22:
//   eventCountLoaded, eventCountRendered, supersededEventCount,
//   salesOnlyCardCount — plus the staged-rollout allowlist state.
//
// On top of the raw DeliveryResult, the route aggregates a `warnings`
// summary so the admin UI can flag noisy batches at a glance:
//   * any user with > 10 rendered events
//   * any user with > 5 cards
//   * any user with > 3 sales-only cards
//   * any user with > 0 superseded duplicates (the pre-dedupe pool
//     would have rendered the same card/rule twice)
//
// Triple gate:
//   1. ALERT_EMAIL_PREVIEW_ENABLED='true' OR ALERT_DELIVERY_ENABLED='true'.
//      (Either flag is enough — the route is dry-run only.)
//   2. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS)
//   3. POST-only.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import {
  isAlertEmailPreviewEnabled,
  isAlertDeliveryEnabled,
} from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import {
  deliverAlerts,
  makeAuthEmailLookup,
  type UserDeliveryResult,
} from '@/lib/alerts/delivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WARNING_THRESHOLDS = {
  events:        10,   // rendered events
  cards:         5,
  salesOnlyCards: 3,
} as const

type Warnings = {
  usersWithHighEventCount:        number
  usersWithHighCardCount:         number
  usersWithManySalesOnlyCards:    number
  usersWithPreDedupeDuplicates:   number
  flagged:                        boolean
}

function aggregateWarnings(perUser: UserDeliveryResult[]): Warnings {
  let hi   = 0
  let hc   = 0
  let so   = 0
  let dup  = 0
  for (const u of perUser) {
    if ((u.eventCountRendered ?? 0)   > WARNING_THRESHOLDS.events)         hi++
    if ((u.cardCount ?? 0)            > WARNING_THRESHOLDS.cards)          hc++
    if ((u.salesOnlyCardCount ?? 0)   > WARNING_THRESHOLDS.salesOnlyCards) so++
    if ((u.supersededEventCount ?? 0) > 0)                                 dup++
  }
  return {
    usersWithHighEventCount:      hi,
    usersWithHighCardCount:       hc,
    usersWithManySalesOnlyCards:  so,
    usersWithPreDedupeDuplicates: dup,
    flagged:                      hi + hc + so + dup > 0,
  }
}

export async function POST(req: Request) {
  if (!isAlertEmailPreviewEnabled() && !isAlertDeliveryEnabled()) {
    return NextResponse.json({ error: 'instant alert preview disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  try {
    const supa = getSupabaseServiceClient()
    const result = await deliverAlerts(supa, {
      // dryRun is HARD-CODED true — this route is preview-only. We
      // never accept a `dryRun` body field so an attacker / admin
      // mis-click cannot turn it into a real send.
      dryRun:       true,
      maxCardsPerEmail: 10,
      getUserEmail: makeAuthEmailLookup(supa),
    })
    return NextResponse.json({
      ...result,
      warnings:           aggregateWarnings(result.perUser),
      warningThresholds:  WARNING_THRESHOLDS,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'instant alert preview failed', detail: msg }, { status: 500 })
  }
}
