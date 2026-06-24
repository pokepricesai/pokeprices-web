// src/app/api/admin/alerts/deliver/route.ts
// Block 5A-W-6 — admin-triggered batch delivery of REAL alert digest
// emails to users with undelivered alert_events.
//
// Triple gate:
//   1. ALERT_DELIVERY_ENABLED='true' (literal) — 503 otherwise. THIS
//      FLAG ALONE unlocks the route; the preview / test-send flags do
//      NOT. Real delivery is a separate authorisation surface.
//   2. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS)
//   3. POST-only
//
// Body (all optional):
//   {
//     "dryRun":           true | false,    // default TRUE
//     "maxUsers":         number,          // clamped server-side
//     "maxEventsPerUser": number           // clamped server-side
//   }
//
// SAFETY: see src/lib/alerts/delivery.ts header for the full invariants
// list. Notable here: only the literal boolean `false` triggers a real
// send; any other value (including the string "false") stays in dry-run.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isAlertDeliveryEnabled } from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { deliverAlerts, makeAuthEmailLookup } from '@/lib/alerts/delivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = {
  dryRun?:           unknown
  maxUsers?:         unknown
  maxEventsPerUser?: unknown
}

function asPositiveInt(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const i = Math.floor(v)
  return i > 0 ? i : undefined
}

export async function POST(req: Request) {
  if (!isAlertDeliveryEnabled()) {
    return NextResponse.json({ error: 'alert delivery disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: Body = {}
  try { body = (await req.json()) as Body } catch { /* empty body acceptable */ }

  // Default dryRun=true; only literal boolean false flips to send.
  const dryRun           = body.dryRun !== false
  const maxUsers         = asPositiveInt(body.maxUsers)
  const maxEventsPerUser = asPositiveInt(body.maxEventsPerUser)

  try {
    const supa  = getSupabaseServiceClient()
    const result = await deliverAlerts(supa, {
      dryRun,
      maxUsers,
      maxEventsPerUser,
      getUserEmail: makeAuthEmailLookup(supa),
    })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'delivery failed', detail: msg }, { status: 500 })
  }
}
