// src/app/api/admin/insights/route.ts
//
// EIC Block 0B — admin-only article list + create.
//
// Gate:
//   1. requireAdmin: Bearer token + ADMIN_ALLOWED_EMAILS allow-list.
//   2. GET and POST only. No PUT / PATCH / DELETE at collection level;
//      per-article mutations live under /[id]/route.ts.
//
// Uses the service-role client for the writes so we do not depend on
// permissive RLS on the insights table. The client no longer touches
// Supabase for article rows.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { pickWritableArticleFields, validateArticleWrite, mirrorSeoFields } from '@/lib/insights/adminApi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

// ── GET — list all articles (drafts + published) for the admin UI ──
export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('insights')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return bad(500, error.message)
    return NextResponse.json({ articles: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'list failed', detail: msg }, { status: 500 })
  }
}

// ── POST — create a new article ────────────────────────────────────
export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  let raw: Record<string, unknown>
  try { raw = await req.json() as Record<string, unknown> }
  catch { return bad(400, 'Invalid JSON') }

  const payload = mirrorSeoFields(pickWritableArticleFields(raw))
  const err = validateArticleWrite(payload)
  if (err) return bad(400, err)

  if (!('headline' in payload) || typeof payload.headline !== 'string' || !payload.headline.trim()) {
    return bad(400, 'headline is required')
  }

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('insights')
      .insert([payload])
      .select('*')
      .single()
    if (error) return bad(500, error.message)
    return NextResponse.json({ article: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'insert failed', detail: msg }, { status: 500 })
  }
}
