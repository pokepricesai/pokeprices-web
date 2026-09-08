// src/app/api/admin/editorial/studio/[projectId]/preflight/route.ts
//
// EIC Block 10 — GET publication preflight for a project. Called by
// the Studio Publication tab to render check/warning lists.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { runPublicationPreflight } from '@/lib/editorial/publishing/preflight'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ projectId: string }> }
function bad(s: number, e: string) { return NextResponse.json({ ok: false, error: e }, { status: s }) }
function parseId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null
  const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function GET(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  const { projectId: raw } = await ctx.params
  const projectId = parseId(raw)
  if (projectId == null) return bad(400, 'invalid projectId')
  const url = new URL(req.url)
  const slugOverride = url.searchParams.get('slug') ?? undefined
  try {
    const pf = await runPublicationPreflight(projectId, { slugOverride })
    return NextResponse.json({ ok: true, preflight: pf })
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown')
  }
}
