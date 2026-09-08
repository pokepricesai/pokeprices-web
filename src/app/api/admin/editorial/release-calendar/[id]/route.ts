// src/app/api/admin/editorial/release-calendar/[id]/route.ts
//
// EIC Block 3 — per-row mutations for release_calendar.
//   PATCH  → update
//   DELETE → delete
// Guard: requireAdmin + service-role writes. See sibling route for
// the RLS note.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { pickWritableReleaseCalendarFields, validateReleaseCalendarWrite } from '@/lib/editorial/releaseCalendarApi'

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

  const payload = pickWritableReleaseCalendarFields(raw)
  if (Object.keys(payload).length === 0) return bad(400, 'no writable fields supplied')
  const err = validateReleaseCalendarWrite(payload)
  if (err) return bad(400, err)

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('release_calendar')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single()
    if (error) return bad(500, error.message)
    if (!data) return bad(404, 'release not found')
    return NextResponse.json({ release: data })
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
    const { error } = await supa.from('release_calendar').delete().eq('id', id)
    if (error) return bad(500, error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'delete failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}
