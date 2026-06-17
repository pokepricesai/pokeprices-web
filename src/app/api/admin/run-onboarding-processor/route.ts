// src/app/api/admin/run-onboarding-processor/route.ts
// Block 3D — admin manual-run wrapper.
//
// Admin sessions never need to know CRON_SECRET. They authenticate
// with their normal Supabase bearer (Block 1A `requireAdmin`) and the
// route invokes the same internal runProcessor function the cron path
// uses — only with `source: 'manual'` so the operator can distinguish
// cron-driven runs from manual smoke tests in `email_onboarding_runs`.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { runProcessor } from '@/lib/email/onboardingProcessor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }
  // Admin manual runs cannot supply a limit — the hard cap inside
  // runProcessor + the bounded batch in processOnboardingBatch are the
  // safety net; the operator can not amplify a misconfiguration from
  // the browser.
  const result = await runProcessor({ source: 'manual' })
  return NextResponse.json(result)
}
