// src/app/api/admin/insights/[id]/route.ts
//
// EIC Block 0B — admin-only article update + delete.
//
// Gate:
//   1. requireAdmin: Bearer token + ADMIN_ALLOWED_EMAILS allow-list.
//   2. PATCH and DELETE only.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { pickWritableArticleFields, validateArticleWrite, mirrorSeoFields } from '@/lib/insights/adminApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  const { id } = await ctx.params
  if (!id || !UUID_RE.test(id)) return bad(400, 'invalid id')

  let raw: Record<string, unknown>
  try { raw = await req.json() as Record<string, unknown> }
  catch { return bad(400, 'Invalid JSON') }

  const payload = mirrorSeoFields(pickWritableArticleFields(raw))
  const err = validateArticleWrite(payload)
  if (err) return bad(400, err)
  if (Object.keys(payload).length === 0) return bad(400, 'no writable fields supplied')

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('insights')
      .update(payload)
      .eq('id', id)
      .select('*')
      .single()
    if (error) return bad(500, error.message)
    if (!data) return bad(404, 'article not found')
    return NextResponse.json({ article: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'update failed', detail: msg }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  const { id } = await ctx.params
  if (!id || !UUID_RE.test(id)) return bad(400, 'invalid id')

  try {
    const supa = getSupabaseServiceClient()
    const { error } = await supa.from('insights').delete().eq('id', id)
    if (error) return bad(500, error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'delete failed', detail: msg }, { status: 500 })
  }
}
