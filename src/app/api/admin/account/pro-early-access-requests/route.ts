// src/app/api/admin/account/pro-early-access-requests/route.ts
// Block 5A-W-29 — admin-only GET that returns the latest 50 Pro
// early-access signups. Read-only inspection so the operator can
// see who's waiting on a paid plan without bouncing through the
// Supabase dashboard.
//
// Double gate:
//   1. requireAdmin (Bearer + ADMIN_ALLOWED_EMAILS) — same pattern
//      every admin route uses today.
//   2. GET-only (POST/PUT/DELETE not defined → 405).
//
// SAFETY
//   * Read-only — never writes to pro_early_access_requests.
//   * Email is masked the same way the watchlist_alert log surface
//     handles recipient addresses — first two local-part chars + the
//     domain. user_id is masked to its first 8 chars so the operator
//     can correlate without exposing the full UUID.
//   * Message body is trimmed + capped to 200 chars in the response
//     payload so a 1000-char message can't dominate the operator's
//     console — the FULL message stays in the DB for follow-up.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

const LIMIT                = 50
const MESSAGE_SNIPPET_CHARS = 200

type Row = {
  id:               string
  created_at:       string
  source:           string
  plan_interest:    string
  email_masked:     string | null
  user_id_masked:   string | null
  message_snippet:  string | null
}

function maskUserId(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  return `${raw.slice(0, 8)}***`
}

function maskEmail(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  const at = raw.indexOf('@')
  if (at <= 0 || at === raw.length - 1) return '***'
  const local  = raw.slice(0, at)
  const domain = raw.slice(at + 1)
  const visible = Math.min(2, Math.max(1, local.length))
  return `${local.slice(0, visible)}***@${domain}`
}

function snippetMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed.length > MESSAGE_SNIPPET_CHARS
    ? trimmed.slice(0, MESSAGE_SNIPPET_CHARS) + '…'
    : trimmed
}

export async function GET(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  try {
    const supa = getSupabaseServiceClient()
    const { data, error } = await supa
      .from('pro_early_access_requests')
      .select('id, created_at, source, plan_interest, email, user_id, message')
      .order('created_at', { ascending: false })
      .limit(LIMIT)
    if (error) {
      return NextResponse.json(
        { error: 'fetch failed', detail: error.message },
        { status: 500 },
      )
    }
    const rows: Row[] = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
      id:              String(r.id ?? ''),
      created_at:      r.created_at == null ? '' : String(r.created_at),
      source:          r.source == null ? 'unknown' : String(r.source),
      plan_interest:   r.plan_interest == null ? 'pro' : String(r.plan_interest),
      email_masked:    maskEmail(r.email),
      user_id_masked:  maskUserId(r.user_id),
      message_snippet: snippetMessage(r.message),
    }))

    return NextResponse.json({
      rows,
      total: rows.length,
      limit: LIMIT,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'pro early-access fetch failed', detail: msg }, { status: 500 })
  }
}
