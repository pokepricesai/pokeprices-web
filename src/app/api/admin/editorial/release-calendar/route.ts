// src/app/api/admin/editorial/release-calendar/route.ts
//
// EIC Block 3 — collection endpoint for release_calendar admin CRUD.
//   GET  → list within a wide window (past 60d + next 365d)
//   POST → create a new release_calendar row
// Guard: requireAdmin + service-role writes. RLS on release_calendar
// is CURRENTLY DISABLED at the DB layer (see Block 3 report). This
// endpoint therefore does NOT depend on RLS; all authorisation is
// enforced here in app code. Tightening the table RLS is left as
// separate security follow-up.

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

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('release_calendar')
      .select('id, set_name, set_code, release_date, region, jp_release_date, confirmed, notes, created_at, updated_at')
      .order('release_date', { ascending: false, nullsFirst: false })
      .limit(500)
    if (error) return bad(500, error.message)
    return NextResponse.json({ releases: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: 'list failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  let raw: Record<string, unknown>
  try { raw = await req.json() as Record<string, unknown> }
  catch { return bad(400, 'Invalid JSON') }

  const payload = pickWritableReleaseCalendarFields(raw)
  if (!('set_name' in payload) || typeof payload.set_name !== 'string' || !payload.set_name.trim()) {
    return bad(400, 'set_name is required')
  }
  const err = validateReleaseCalendarWrite(payload)
  if (err) return bad(400, err)

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('release_calendar')
      .insert([{ ...payload, updated_at: new Date().toISOString() }])
      .select('*')
      .single()
    if (error) return bad(500, error.message)
    return NextResponse.json({ release: data })
  } catch (e) {
    return NextResponse.json({ error: 'insert failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}
