// src/app/api/admin/editorial/studio/[projectId]/write/route.ts
//
// EIC Block 9 — POST /api/admin/editorial/studio/[projectId]/write
//
// Generates a full article draft via the AI Writer + Fact Checker
// pipeline. Requires editorial_research.status = 'approved'. Refuses
// to overwrite an existing meaningful draft unless the caller passes
// overwriteExisting: true.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'
import { startGeneration, runNextStage } from '@/lib/editorial/writer/writerActions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Block 9B — pipeline is now split into stages, each ≤ 1 Claude call
// (~30-90s). 120s per HTTP request is generous cover for the tail
// while staying under any Vercel plan's ceiling. The client polls
// this same POST endpoint; each call advances one stage.
export const maxDuration = 120

const RATE_NS   = 'api/admin/editorial/studio/write'
const RATE_MAX  = 20
const RATE_WIN  = 5 * 60 * 1000

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

  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> } catch { /* body is optional */ }

  const mode = typeof body.mode === 'string' ? body.mode : 'auto'   // 'auto' | 'start' | 'step'

  try {
    // Auto mode: start a run if there is none / previous is done,
    // otherwise advance the existing run. This is what the Studio
    // UI uses so it can call the same endpoint repeatedly.
    if (mode === 'auto' || mode === 'start') {
      const started = await startGeneration(projectId, admin.email, { overwriteExisting: body.overwriteExisting === true })
      // If start returned an in-flight run and mode is 'start', end
      // there. Otherwise (auto), immediately advance one stage.
      if (mode === 'start') return NextResponse.json({ ok: true, writer: started.writer, studio: started.studio, factCheck: started.factCheck })
      const stepped = await runNextStage(projectId, admin.email)
      return NextResponse.json({ ok: true, writer: stepped.writer, studio: stepped.studio, factCheck: stepped.factCheck })
    }
    // Step mode: caller assumes a run already exists.
    const result = await runNextStage(projectId, admin.email)
    return NextResponse.json({ ok: true, writer: result.writer, studio: result.studio, factCheck: result.factCheck })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (/existing draft/i.test(msg)) return NextResponse.json({ ok: false, error: msg, needsOverwriteConfirmation: true }, { status: 409 })
    if (/approved research/i.test(msg)) return bad(412, msg)
    return bad(500, msg)
  }
}
