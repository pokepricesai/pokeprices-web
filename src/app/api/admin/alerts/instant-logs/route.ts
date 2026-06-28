// src/app/api/admin/alerts/instant-logs/route.ts
// Block 5A-W-22 — admin-only POST that returns the most recent 20
// email_delivery_log rows in the `watchlist_alert` category, so the
// admin UI can show what's actually shipped and what the post-Block
// 5A-W-22 metadata captured for each send.
//
// Triple gate:
//   1. ALERT_EMAIL_PREVIEW_ENABLED='true' OR ALERT_DELIVERY_ENABLED='true'.
//   2. requireAdmin.
//   3. POST-only.
//
// SAFETY
//   * Read-only — never writes to email_delivery_log.
//   * Never echoes the raw email address (we only have recipient_email_hash
//     on the row anyway). user_id is masked to first 8 chars so the
//     operator can correlate logs without seeing the full UUID.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import {
  isAlertEmailPreviewEnabled,
  isAlertDeliveryEnabled,
} from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIMIT = 20

type LogRow = {
  id:                       string
  sent_at:                  string | null
  failed_at:                string | null
  status:                   string
  template_key:             string | null
  campaign_key:             string | null
  user_id_masked:           string
  resend_email_id:          string | null
  error_code:               string | null
  card_count:               number | null
  event_count:              number | null
  event_count_loaded:       number | null
  event_count_rendered:     number | null
  superseded_event_count:   number | null
  source:                   string | null
  delivery_engine_version:  string | null
  dedupe_applied:           boolean | null
}

function maskUserId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return '***'
  // First 8 chars of the UUID is plenty for an operator to spot
  // patterns ("same user 4 times") without exposing the full id.
  const head = raw.slice(0, 8)
  return `${head}***`
}

function pickStr(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key]
  return typeof v === 'string' ? v : null
}
function pickNum(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function pickBool(meta: Record<string, unknown>, key: string): boolean | null {
  const v = meta[key]
  return typeof v === 'boolean' ? v : null
}

export async function POST(req: Request) {
  if (!isAlertEmailPreviewEnabled() && !isAlertDeliveryEnabled()) {
    return NextResponse.json({ error: 'instant alert logs disabled' }, { status: 503 })
  }
  const admin = await requireAdmin(req)
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status })
  }

  try {
    const supa = getSupabaseServiceClient()
    // Most-recent first. We exclude the raw recipient_email_hash and
    // recipient_email_hash from the response — operator-friendly
    // fields only.
    const { data, error } = await supa
      .from('email_delivery_log')
      .select('id, user_id, sent_at, failed_at, status, template_key, campaign_key, resend_email_id, error_code, metadata_json, created_at')
      .eq('category', 'watchlist_alert')
      .order('created_at', { ascending: false })
      .limit(LIMIT)
    if (error) {
      return NextResponse.json({ error: 'logs fetch failed', detail: error.message }, { status: 500 })
    }
    const rows: LogRow[] = (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => {
      const meta = (r.metadata_json && typeof r.metadata_json === 'object')
        ? r.metadata_json as Record<string, unknown>
        : {}
      return {
        id:                      String(r.id ?? ''),
        sent_at:                 r.sent_at   == null ? null : String(r.sent_at),
        failed_at:               r.failed_at == null ? null : String(r.failed_at),
        status:                  String(r.status ?? ''),
        template_key:            r.template_key == null ? null : String(r.template_key),
        campaign_key:            r.campaign_key == null ? null : String(r.campaign_key),
        user_id_masked:          maskUserId(r.user_id),
        resend_email_id:         r.resend_email_id   == null ? null : String(r.resend_email_id),
        error_code:              r.error_code        == null ? null : String(r.error_code),
        card_count:              pickNum(meta, 'card_count'),
        event_count:             pickNum(meta, 'event_count'),
        event_count_loaded:      pickNum(meta, 'event_count_loaded'),
        event_count_rendered:    pickNum(meta, 'event_count_rendered'),
        superseded_event_count:  pickNum(meta, 'superseded_event_count'),
        source:                  pickStr(meta, 'source'),
        delivery_engine_version: pickStr(meta, 'delivery_engine_version'),
        dedupe_applied:          pickBool(meta, 'dedupe_applied'),
      }
    })

    return NextResponse.json({ rows, limit: LIMIT })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'instant alert logs failed', detail: msg }, { status: 500 })
  }
}
