// src/app/api/internal/process-onboarding-emails/route.ts
// Block 3B — internal processor for the onboarding email sequence.
//
// Protected by a server-only bearer secret (ONBOARDING_CRON_SECRET).
// No scheduler is wired in this block — the operator decides when to
// activate Vercel Cron / pg_cron / an external trigger per
// docs/email-onboarding.md.

import 'server-only'
import { NextResponse } from 'next/server'
import { processOnboardingBatch, isOnboardingEnabled } from '@/lib/email/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readSecret(): string {
  return (process.env.ONBOARDING_CRON_SECRET ?? '').trim()
}

function authOk(req: Request): boolean {
  const expected = readSecret()
  if (!expected) return false
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : ''
  // Length-aware comparison so the timing path is at least uniform per
  // request — the secret is never echoed.
  if (bearer.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= bearer.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export async function POST(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  if (!isOnboardingEnabled()) {
    return NextResponse.json({
      processed: 0, sent: 0, skipped: 0, retried: 0, cancelled: 0, failed: 0,
      disabled: true,
    })
  }

  // The optional limit is operator-controlled; bounded to the
  // processor's internal cap.
  let limit: number | undefined
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && typeof (body as { limit?: number }).limit === 'number') {
      limit = (body as { limit: number }).limit
    }
  } catch { /* empty body acceptable */ }

  const summary = await processOnboardingBatch({ limit })
  return NextResponse.json(summary)
}
