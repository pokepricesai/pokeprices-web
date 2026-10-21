// src/app/api/admin/pilot/revalidate/route.ts
//
// PP-TCG-CUTOVER-PREP-02 §3 — targeted ISR revalidation for pilot
// cohort activation + rollback. Not a sitewide purge.
//
// Why this exists: `/set/[slug]/card/[cardSlug]` uses `revalidate =
// 86400` (24h ISR window). After an operator flips a pilot slug's
// `prices_enabled` / `images_enabled` / `history_enabled` or an env
// flag, the stale ISR cache keeps serving legacy for up to 24 hours.
// This endpoint invalidates ONLY the specific card URLs supplied, so
// the next visitor-driven render reads the new state.
//
// Request:
//   POST /api/admin/pilot/revalidate
//   { "pp_card_slugs": ["5732721", "5732710", ...] }
//
// Response:
//   { "revalidated": N, "warnings": [...] }
//
// Triple gate: Bearer admin auth + POST-only + bounded body size.
// Fails closed on any auth / lookup error. Never crashes publish.

import 'server-only'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_SLUGS = 50       // bounded — single pilot activations expected

type Body = { pp_card_slugs?: unknown }

// PP-TCG-PUBLIC-PILOT-02 §2 — authenticated non-interactive path.
//
// The original `requireAdmin` path is a Supabase user JWT whose email
// is in ADMIN_ALLOWED_EMAILS. That works for a human operator with a
// live admin session, but not for a non-interactive caller (CI,
// pilot automation) that doesn't own a user identity.
//
// Shared-secret fallback: if the request carries
// `Authorization: Bearer <PILOT_REVALIDATE_SECRET>` AND that env var
// is set AND the bearer matches exactly (constant-time compare), we
// accept the call. This reuses the same authorisation surface — the
// secret is admin-owned, lives in the project env, is never
// client-side, and only unlocks this one single-purpose endpoint.
// Human JWT auth continues to work unchanged alongside it.
//
// The secret path still enforces: POST-only, bounded body size, slug
// resolution via the real `cards` table, and single-path
// revalidation. No sitewide purge is possible from this endpoint.
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function POST(req: Request) {
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : ''
  const envSecret = process.env.PILOT_REVALIDATE_SECRET ?? ''
  const secretAuthed = Boolean(bearer) && Boolean(envSecret) && constantTimeEq(bearer, envSecret)

  if (!secretAuthed) {
    const auth = await requireAdmin(req)
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status })
    }
  }

  let body: Body
  try { body = (await req.json()) as Body }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 }) }

  const slugs = Array.isArray(body.pp_card_slugs)
    ? body.pp_card_slugs.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 128)
    : null
  if (!slugs || slugs.length === 0) {
    return NextResponse.json({ ok: false, error: 'pp_card_slugs must be a non-empty string array' }, { status: 400 })
  }
  if (slugs.length > MAX_SLUGS) {
    return NextResponse.json({ ok: false, error: `too many slugs (max ${MAX_SLUGS})` }, { status: 400 })
  }

  const sb = getSupabaseServiceClient()
  // Resolve each slug to its public card URL. The route uses
  // encodeURIComponent on the set name — mirror that here so the
  // path we invalidate matches the Next.js cache key exactly.
  const { data, error } = await sb
    .from('cards')
    .select('card_slug, set_name, card_url_slug, url_slug')
    .in('card_slug', slugs)
  if (error) {
    return NextResponse.json({ ok: false, error: `card lookup: ${error.message}` }, { status: 500 })
  }

  const warnings: Array<{ slug: string; detail: string }> = []
  let revalidated = 0
  for (const row of (data ?? [])) {
    const setName = row.set_name ? String(row.set_name) : null
    const cardSlugForPath = row.card_url_slug ?? row.card_slug
    if (!setName || !cardSlugForPath) {
      warnings.push({ slug: String(row.card_slug), detail: 'missing set_name or card_url_slug' })
      continue
    }
    const path = `/set/${encodeURIComponent(setName)}/card/${encodeURIComponent(String(cardSlugForPath))}`
    try {
      revalidatePath(path)
      revalidated += 1
    } catch (e) {
      warnings.push({ slug: String(row.card_slug), detail: e instanceof Error ? e.message : 'unknown' })
    }
  }

  // Report slugs we couldn't resolve to a card row at all
  const resolved = new Set((data ?? []).map(r => String(r.card_slug)))
  for (const s of slugs) {
    if (!resolved.has(s)) warnings.push({ slug: s, detail: 'no cards row — path not resolvable' })
  }

  return NextResponse.json({ ok: true, revalidated, warnings, request_count: slugs.length })
}
