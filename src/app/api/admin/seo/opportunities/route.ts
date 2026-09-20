// src/app/api/admin/seo/opportunities/route.ts
// ============================================================================
// SEO Mission Control · Stage 4B — admin API for the opportunity queues.
//
// POST /api/admin/seo/opportunities
//   Body: {
//     queue: 'ctr_gold' | 'ranking_push',
//     thresholds: {
//       min_impressions?: number
//       max_position?: number           (CTR Gold)
//       max_ctr?: number                (CTR Gold, e.g. 0.005)
//       min_position?: number           (Ranking Push, exclusive lower bound)
//       max_position_ranking?: number   (Ranking Push, inclusive upper bound)
//     },
//     page_type?: string | null,
//     limit?: number,
//     offset?: number,
//   }
//
// Returns:
//   {
//     summary: { ... },
//     candidates: [ { url, page_type, entity_id, ... } ]
//   }
//
// Auth: requireAdmin (Bearer token, same pattern as every other
// /api/admin/* route). Service-role Supabase for the RPC calls.
// ============================================================================

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE_KEY = 'pokeprices'
const SOURCE   = 'google'

const DEFAULTS = {
  ctr_gold: {
    min_impressions: 100,
    max_position:    10,
    max_ctr:         0.005,
  },
  ranking_push: {
    min_impressions:       50,
    min_position:          10,
    max_position_ranking:  20,
  },
}

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

type ReqBody = {
  queue?: 'ctr_gold' | 'ranking_push'
  thresholds?: {
    min_impressions?: number
    max_position?: number
    max_ctr?: number
    min_position?: number
    max_position_ranking?: number
  }
  page_type?: string | null
  limit?: number
  offset?: number
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? Number(v) : (typeof v === 'number' ? v : NaN)
  return Number.isFinite(n) ? n : fallback
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)

  let body: ReqBody
  try { body = await req.json() } catch { return bad(400, 'invalid json body') }

  const queue = body.queue
  if (queue !== 'ctr_gold' && queue !== 'ranking_push') return bad(400, 'queue must be ctr_gold or ranking_push')

  const th = body.thresholds ?? {}
  const pageType = (typeof body.page_type === 'string' && body.page_type.length > 0) ? body.page_type : null
  const limit  = Math.max(1,  Math.min(200, num(body.limit,  50)))
  const offset = Math.max(0,               num(body.offset, 0))

  const supa = getSupabaseServiceClient()

  try {
    if (queue === 'ctr_gold') {
      const min_impressions = Math.max(0,        num(th.min_impressions, DEFAULTS.ctr_gold.min_impressions))
      const max_position    = Math.max(1,        num(th.max_position,    DEFAULTS.ctr_gold.max_position))
      const max_ctr         = Math.max(0,        num(th.max_ctr,         DEFAULTS.ctr_gold.max_ctr))

      const args = {
        p_site_key:        SITE_KEY,
        p_source:          SOURCE,
        p_min_impressions: min_impressions,
        p_max_position:    max_position,
        p_max_ctr:         max_ctr,
        p_page_type:       pageType,
      }

      const [candidatesRes, summaryRes] = await Promise.all([
        supa.rpc('seo_admin_ctr_gold_candidates', { ...args, p_limit: limit, p_offset: offset }),
        supa.rpc('seo_admin_ctr_gold_summary',    args),
      ])
      if (candidatesRes.error) return bad(500, `candidates rpc: ${candidatesRes.error.message}`)
      if (summaryRes.error)    return bad(500, `summary rpc: ${summaryRes.error.message}`)
      const summary = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data

      return NextResponse.json({
        queue: 'ctr_gold',
        thresholds:  { min_impressions, max_position, max_ctr, page_type: pageType, limit, offset },
        summary,
        candidates: candidatesRes.data ?? [],
      })
    }

    // ranking_push
    const min_impressions = Math.max(0,  num(th.min_impressions,        DEFAULTS.ranking_push.min_impressions))
    const min_position    = Math.max(0,  num(th.min_position,           DEFAULTS.ranking_push.min_position))
    const max_position_rp = Math.max(min_position + 0.01,
                                     num(th.max_position_ranking,       DEFAULTS.ranking_push.max_position_ranking))

    const args = {
      p_site_key:        SITE_KEY,
      p_source:          SOURCE,
      p_min_impressions: min_impressions,
      p_min_position:    min_position,
      p_max_position:    max_position_rp,
      p_page_type:       pageType,
    }

    const [candidatesRes, summaryRes] = await Promise.all([
      supa.rpc('seo_admin_ranking_push_candidates', { ...args, p_limit: limit, p_offset: offset }),
      supa.rpc('seo_admin_ranking_push_summary',    args),
    ])
    if (candidatesRes.error) return bad(500, `candidates rpc: ${candidatesRes.error.message}`)
    if (summaryRes.error)    return bad(500, `summary rpc: ${summaryRes.error.message}`)
    const summary = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data

    return NextResponse.json({
      queue: 'ranking_push',
      thresholds:  { min_impressions, min_position, max_position: max_position_rp, page_type: pageType, limit, offset },
      summary,
      candidates: candidatesRes.data ?? [],
    })
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown error')
  }
}
