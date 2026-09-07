// src/app/api/admin/editorial/studio/[projectId]/fact-check/route.ts
//
// EIC Block 9 — POST /api/admin/editorial/studio/[projectId]/fact-check
//
// Runs a fresh Fact Check against the current studio_json + research
// evidence. Called by Studio's "Run fact check" button.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'
import { factCheckCurrentDraft } from '@/lib/editorial/writer/writerActions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const RATE_NS = 'api/admin/editorial/studio/factcheck'
const RATE_MAX = 60
const RATE_WIN = 5 * 60 * 1000

type Ctx = { params: Promise<{ projectId: string }> }
function bad(status: number, error: string) { return NextResponse.json({ ok: false, error }, { status }) }
function parseId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null
  const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function POST(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  const rate = checkAdminRateLimit(RATE_NS, admin.email, RATE_MAX, RATE_WIN)
  if (!rate.ok) return NextResponse.json({ ok: false, error: `Rate limit exceeded. Try again in ${rate.retryAfter}s.` }, { status: 429, headers: { 'retry-after': String(rate.retryAfter) } })

  const { projectId: raw } = await ctx.params
  const projectId = parseId(raw)
  if (projectId == null) return bad(400, 'invalid projectId')

  try {
    const result = await factCheckCurrentDraft(projectId, admin.email)
    return NextResponse.json({ ok: true, factCheck: result })
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown')
  }
}
