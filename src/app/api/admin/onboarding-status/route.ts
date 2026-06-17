// src/app/api/admin/onboarding-status/route.ts
// Block 3D — admin-only snapshot endpoint backing the Content Studio
// status panel. Returns operator-safe counts only; never PII.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { readOnboardingStatusSnapshot } from '@/lib/email/onboardingStatus'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  const snap = await readOnboardingStatusSnapshot()
  return NextResponse.json(snap)
}
