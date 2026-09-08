// src/app/api/admin/editorial/projects/route.ts
//
// EIC Block 2 — collection endpoint for editorial_projects.
//   GET  → list (all statuses; server-side filter/sort happens in the
//          client UI over a small dataset).
//   POST → create.
// Guard: requireAdmin + service-role writes.

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

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('editorial_projects')
      .select('*')
      .order('target_publish_at', { ascending: true, nullsFirst: false })
      .order('priority',          { ascending: true })
      .order('created_at',        { ascending: false })
      .limit(500)
    if (error) return bad(500, error.message)
    return NextResponse.json({ projects: data ?? [] })
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

  const payload = pickWritableProjectFields(raw)
  if (!('title' in payload) || typeof payload.title !== 'string' || !payload.title.trim()) {
    return bad(400, 'title is required')
  }
  const err = validateProjectWrite(payload)
  if (err) return bad(400, err)

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('editorial_projects')
      .insert([{ ...payload, updated_at: new Date().toISOString() }])
      .select('*')
      .single()
    if (error) return bad(500, error.message)
    return NextResponse.json({ project: data })
  } catch (e) {
    return NextResponse.json({ error: 'insert failed', detail: e instanceof Error ? e.message : 'unknown' }, { status: 500 })
  }
}
