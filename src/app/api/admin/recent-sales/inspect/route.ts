// src/app/api/admin/recent-sales/inspect/route.ts
// Block 4B-W-3A — admin-only read snapshot of the recent-sales pipeline.
//
// Triple gate:
//   1. RECENT_SALES_ADMIN_VIEW_ENABLED must be the literal "true"
//      (otherwise 503 — surface is invisible). Fail-closed.
//   2. requireAdmin: Bearer token + ADMIN_ALLOWED_EMAILS allow-list.
//   3. GET-only. No POST/PUT/PATCH/DELETE — no mutation surface.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { isAdminViewEnabled } from '@/lib/recentSales/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { readAdminInspectionSnapshot } from '@/lib/recentSales/adminQueries'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

export async function GET(req: Request) {
  if (!isAdminViewEnabled()) {
    // Fail closed. No body detail beyond "not enabled" to avoid surface
    // probing.
    return NextResponse.json({ error: 'recent-sales admin view disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  try {
    const supa = getSupabaseServiceClient()
    const snap = await readAdminInspectionSnapshot(supa)
    return NextResponse.json(snap)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'inspection failed', detail: msg }, { status: 500 })
  }
}
