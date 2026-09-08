// src/app/api/admin/editorial/opportunity-radar/refresh/route.ts
//
// EIC — force-recompute the Opportunity Radar and persist the new
// row so subsequent page loads today see the fresh set.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { buildEditorialContext } from '@/lib/editorial/context'
import { loadOrComputeRadar } from '@/lib/editorial/opportunityRadarCache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return NextResponse.json({ ok: false, error: admin.error }, { status: admin.status })

  try {
    const context = await buildEditorialContext()
    const result  = await loadOrComputeRadar(context, { force: true })
    return NextResponse.json({
      ok:          true,
      computedAt:  result.computedAt,
      calendarDay: result.calendarDay,
      opportunityCount: result.radar.opportunities.length,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}
