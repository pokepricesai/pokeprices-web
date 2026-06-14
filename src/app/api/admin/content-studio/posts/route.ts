// src/app/api/admin/content-studio/posts/route.ts
// Server-side admin mutation route for social_content_posts.
//
// Replaces the previous client-side anon-key UPDATE/DELETE flow. The
// caller must:
//   1. Sign in via Supabase Auth (any provider).
//   2. Send the resulting access token as `Authorization: Bearer <token>`.
//   3. Have their email present in the server-only env var
//      ADMIN_ALLOWED_EMAILS (comma-separated).
//
// After authorisation the route uses the service-role client to perform
// the mutation, bypassing RLS in the controlled server context.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'

const ALLOWED_STATUS = new Set(['draft', 'approved', 'rejected', 'used'])
const MAX_IDS_PER_REQUEST = 200

type IncomingPatch  = { ids?: unknown; status?: unknown }
type IncomingDelete = { ids?: unknown }

function pickIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  // UUIDs are 36 chars max with hyphens; cap the per-string length just
  // in case a misuse sends huge strings to the query builder.
  return value
    .filter((x): x is string => typeof x === 'string')
    .map(s => s.trim())
    .filter(s => s.length > 0 && s.length <= 64)
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: IncomingPatch
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const ids    = pickIds(body.ids)
  const status = typeof body.status === 'string' ? body.status : ''

  if (ids.length === 0) {
    return NextResponse.json({ error: 'No ids' }, { status: 400 })
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json({ error: 'Too many ids' }, { status: 400 })
  }
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('social_content_posts')
    .update({ status })
    .in('id', ids)
    .select('*')

  if (error) {
    // Never echo internal SQL errors verbatim to the caller; log
    // server-side and return a generic message.
    console.error('[admin/content-studio/posts] update error:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ updated: data?.length ?? 0, rows: data ?? [] })
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: IncomingDelete
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const ids = pickIds(body.ids)
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No ids' }, { status: 400 })
  }
  if (ids.length > MAX_IDS_PER_REQUEST) {
    return NextResponse.json({ error: 'Too many ids' }, { status: 400 })
  }

  const supa = getSupabaseServiceClient()
  const { error, count } = await supa
    .from('social_content_posts')
    .delete({ count: 'exact' })
    .in('id', ids)

  if (error) {
    console.error('[admin/content-studio/posts] delete error:', error)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ deleted: count ?? 0 })
}
