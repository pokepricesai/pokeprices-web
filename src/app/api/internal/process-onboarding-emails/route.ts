// src/app/api/internal/process-onboarding-emails/route.ts
// Block 3D — Vercel Cron-compatible processor route.
//
// Both GET and POST execute the same internal `runProcessor()` call.
//   * GET   — invoked by Vercel Cron. Vercel sends
//             `Authorization: Bearer <CRON_SECRET>` automatically.
//   * POST  — for operator/manual testing from the CLI or future
//             external schedulers. Body may carry an optional `limit`.
//
// Auth is the same for both: CRON_SECRET is authoritative; the legacy
// ONBOARDING_CRON_SECRET is accepted for one release so the operator
// can roll the new value out before retiring the old one (see
// docs/email-onboarding.md → secret migration). The route never
// echoes the secret in any response or log line.

import 'server-only'
import { NextResponse } from 'next/server'
import { runProcessor } from '@/lib/email/onboardingProcessor'
import { isCronAuthOk } from '@/lib/email/cronAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    // Map missing_secret to 503 so operators can spot a config gap;
    // any other rejection is a plain 401.
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }

  let limit: number | undefined
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      if (body && typeof body === 'object') {
        const v = (body as { limit?: unknown }).limit
        if (typeof v === 'number') limit = v
      }
    } catch { /* empty body acceptable */ }
  } else {
    const url = new URL(req.url)
    const v = url.searchParams.get('limit')
    if (v != null) {
      const n = Number(v)
      if (Number.isFinite(n)) limit = n
    }
  }

  const result = await runProcessor({ source: 'cron', limit })
  return NextResponse.json(result)
}

export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
