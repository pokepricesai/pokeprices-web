// src/app/api/admin/editorial/projects/[id]/route.ts
//
// EIC Block 2 — per-project mutations.
//   PATCH  → update
//   DELETE → hard delete (archiving is done via status='archived',
//             this endpoint only exists for genuine removals)

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { pickWritableProjectFields, validateProjectWrite } from '@/lib/editorial/projects'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

type Ctx = { params: Promise<{ id: string }> }

function parseId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  const { id: idStr } = await ctx.params
  const id = parseId(idStr)
  if (id == null) return bad(400, 'invalid id')

  let raw: Record<string, unknown>
  try { raw = await req.json() as Record<string, unknown> }
  catch { return bad(400, 'Invalid JSON') }

  const payload = pickWritableProjectFields(raw)
  if (Object.keys(payload).length === 0) return bad(400, 'no writable fields supplied')
  const err = validateProjectWrite(payload)
  if (err) return bad(400, err)

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('editorial_projects')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) return bad(500, error.message)
    if (!data) return bad(404, 'project not found')
    return NextResponse.json({ project: data })
  } catch (e) {
    return NextResponse.json({ error: 'update failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  const { id: idStr } = await ctx.params
  const id = parseId(idStr)
  if (id == null) return bad(400, 'invalid id')

  try {
    const supa = getSupabaseServiceClient()
    const { error } = await supa.from('editorial_projects').delete().eq('id', id)
    if (error) return bad(500, error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'delete failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}
