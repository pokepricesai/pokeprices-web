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
import { generateArticleForProject } from '@/lib/editorial/writer/writerActions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

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

  try {
    const result = await generateArticleForProject(projectId, admin.email, { overwriteExisting: body.overwriteExisting === true })
    return NextResponse.json({
      ok: true,
      studio:    result.studio,
      writer:    result.writer,
      factCheck: result.factCheck,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    // Existing-draft guard → 409 so the UI can prompt the user.
    if (/existing draft/i.test(msg)) return NextResponse.json({ ok: false, error: msg, needsOverwriteConfirmation: true }, { status: 409 })
    if (/approved research/i.test(msg)) return bad(412, msg)
    return bad(500, msg)
  }
}
