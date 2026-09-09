// src/app/api/admin/editorial/studio/[projectId]/publish/route.ts
//
// EIC Block 10 — single publication dispatcher.
//
// POST body: { action: 'prepare_draft'|'publish'|'update_published'|'unpublish'|'mark_ready', slugOverride?: string }
//
// The browser never sends a full insights payload. Server-side code
// re-runs preflight and constructs the payload from trusted state.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'
import { runPublicationAction, type PublicationActionKind } from '@/lib/editorial/publishing/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RATE_NS  = 'api/admin/editorial/studio/publish'
const RATE_MAX = 40
const RATE_WIN = 5 * 60 * 1000

type Ctx = { params: Promise<{ projectId: string }> }
function bad(s: number, e: string, extra: Record<string, unknown> = {}) { return NextResponse.json({ ok: false, error: e, ...extra }, { status: s }) }
function parseId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null
  const n = Number(raw); return Number.isSafeInteger(n) && n > 0 ? n : null
}
function isAction(v: unknown): v is PublicationActionKind {
  return v === 'prepare_draft' || v === 'publish' || v === 'update_published' || v === 'unpublish' || v === 'mark_ready' || v === 'override_checks' || v === 'clear_override'
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
  try { body = (await req.json()) as Record<string, unknown> } catch { /* optional */ }
  const action = body.action
  if (!isAction(action)) return bad(400, `invalid action: ${String(action ?? '')}`)
  const slugOverride = typeof body.slugOverride === 'string' ? body.slugOverride : undefined

  try {
    const result = await runPublicationAction(projectId, action, { slugOverride, adminEmail: admin.email })
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    if (/preflight failed/i.test(msg)) return bad(412, msg)
    if (/slug already exists/i.test(msg)) return bad(409, msg)
    return bad(500, msg)
  }
}
