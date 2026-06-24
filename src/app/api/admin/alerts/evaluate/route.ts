// src/app/api/admin/alerts/evaluate/route.ts
// Block 5A-W-2 — admin-only POST endpoint that runs the alert
// evaluator. dryRun is TRUE by default; pass { "dryRun": false } to
// actually insert into alert_events. NO emails are sent regardless.
//
// Triple gate:
//   1. ALERTS_EVALUATOR_ENABLED must be the literal "true" (503 otherwise)
//   2. requireAdmin: Bearer token + ADMIN_ALLOWED_EMAILS allow-list
//   3. POST-only. No GET / PUT / DELETE.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isAlertsEvaluatorEnabled } from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { evaluateAlerts } from '@/lib/alerts/evaluator'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

type Body = {
  dryRun?:     unknown
  limitUsers?: unknown
}

export async function POST(req: Request) {
  if (!isAlertsEvaluatorEnabled()) {
    return NextResponse.json({ error: 'alerts evaluator disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  // Body is optional — bare POST defaults to a dry run.
  let body: Body = {}
  try { body = (await req.json()) as Body } catch { /* fine: empty body */ }

  // Default dryRun=true; only the exact boolean `false` triggers a write.
  const dryRun     = body.dryRun !== false
  const limitUsers = typeof body.limitUsers === 'number' && Number.isFinite(body.limitUsers)
    ? Math.max(1, Math.min(Math.floor(body.limitUsers), 5000))
    : undefined

  try {
    const supa   = getSupabaseServiceClient()
    const result = await evaluateAlerts(supa, { dryRun, limitUsers })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'evaluator failed', detail: msg }, { status: 500 })
  }
}
