// src/app/api/admin/vendors/route.ts
// Block 5A-W-50A — server-side admin surface for vendor moderation.
//
// Replaces the prior "log into Supabase and flip a boolean" workflow.
// Reuses the existing requireAdmin bearer-token gate + service-role
// client pattern used by /api/admin/content-studio.
//
// GET  — list every vendor (all statuses) so the admin UI can show
//        pending, active, verified, and everything in between.
// PATCH — update `active` and/or `verified` for one vendor id.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'

type IncomingPatch = {
  id?: unknown
  active?: unknown
  verified?: unknown
}

function isUuid(x: unknown): x is string {
  return typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('vendors')
    .select(
      'id,name,slug,vendor_type,city,country,website,ebay_store_url,' +
      'logo_url,active,verified,created_at,updated_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[admin/vendors] list error:', error)
    return NextResponse.json({ error: 'Load failed' }, { status: 500 })
  }
  return NextResponse.json({ vendors: data ?? [] })
}

export async function PATCH(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  let body: IncomingPatch
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  if (!isUuid(body.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const update: Record<string, boolean> = {}
  if (typeof body.active === 'boolean')   update.active   = body.active
  if (typeof body.verified === 'boolean') update.verified = body.verified
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'No supported field (active|verified) supplied' },
      { status: 400 },
    )
  }

  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('vendors')
    .update(update)
    .eq('id', body.id)
    .select('id,name,slug,active,verified,updated_at')

  if (error) {
    console.error('[admin/vendors] update error:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
  }
  return NextResponse.json({ vendor: data[0] })
}
