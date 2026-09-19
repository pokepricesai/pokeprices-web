// src/app/admin/design/_lib/loadPrototypeCard.ts
// ============================================================================
// Server-only data loader shared by all three card-page prototypes.
// Fetches the SAME payload the production card page fetches, so any
// visual differences between prototypes are strictly layout, not data.
//
// Uses the service-role client because these routes are admin-only
// (requireAdminPage() already authorised the caller) and the loader
// mirrors the read-only shape used by the equivalent editorial admin
// pages. All queries are read-only.
// ============================================================================

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { PROTOTYPE_SET_NAME, PROTOTYPE_CARD_URL_SLUG } from './prototypeCard'

// Loose shape — the RPC returns 40+ nullable columns; we index into it
// permissively rather than restating every tier here.
export type PrototypeCardRow = {
  card_slug?: string | null
  card_name?: string | null
  set_name?: string | null
  card_number?: string | null
  card_number_display?: string | null
  set_printed_total?: number | string | null
  image_url?: string | null
  is_sealed?: boolean | null
  language?: string | null
  set_release_date?: string | null
  raw_usd?: number | null
  psa7_usd?: number | null
  psa8_usd?: number | null
  psa9_usd?: number | null
  psa10_usd?: number | null
  cgc10_usd?: number | null
  cgc95_usd?: number | null
  bgs10_usd?: number | null
  bgs95_usd?: number | null
  bgs10black_usd?: number | null
  cgc10pristine_usd?: number | null
  sgc10_usd?: number | null
  ace10_usd?: number | null
  tag10_usd?: number | null
  grade1_usd?: number | null
  grade2_usd?: number | null
  grade3_usd?: number | null
  grade4_usd?: number | null
  grade5_usd?: number | null
  grade6_usd?: number | null
  [key: string]: unknown
}

export type PrototypeTrendRow = {
  raw_pct_7d?: number | null
  raw_pct_30d?: number | null
  raw_pct_90d?: number | null
  raw_pct_180d?: number | null
  raw_pct_365d?: number | null
  psa10_pct_30d?: number | null
  psa10_pct_90d?: number | null
  current_raw?: number | null
  current_psa9?: number | null
  current_psa10?: number | null
  updated_at?: string | null
  [key: string]: unknown
}

export type PrototypePriceHistoryRow = {
  date: string
  raw_usd?: number | null
  psa9_usd?: number | null
  psa10_usd?: number | null
  cgc10_usd?: number | null
  bgs10_usd?: number | null
  [key: string]: unknown
}

export type PrototypePopulationRow = {
  card_name?: string | null
  variant?: string | null
  set_name?: string | null
  card_number?: string | null
  psa_7?: number | null
  psa_8?: number | null
  psa_9?: number | null
  psa_10?: number | null
  total_graded?: number | null
  gem_rate?: number | null
}

export type PrototypeCardPayload = {
  card: PrototypeCardRow | null
  trend: PrototypeTrendRow | null
  priceHistory: PrototypePriceHistoryRow[]
  population: PrototypePopulationRow | null
  loadedAt: string
}

/** Load the fixed prototype card + all the data the real card page uses. */
export async function loadPrototypeCard(): Promise<PrototypeCardPayload> {
  const supa = getSupabaseServiceClient()

  const cardP = supa.rpc('get_card_detail_by_url_slug', {
    p_set_name: PROTOTYPE_SET_NAME,
    p_card_url_slug: PROTOTYPE_CARD_URL_SLUG,
  })

  // Cheap first fetch so we know the pc_id for the follow-up trend / history
  // calls. All follow-ups run in parallel afterwards.
  const cardRes = await cardP
  const card = (cardRes.data ?? null) as PrototypeCardRow | null
  const slug = card?.card_slug ? String(card.card_slug) : null

  if (!slug) {
    return {
      card,
      trend: null,
      priceHistory: [],
      population: null,
      loadedAt: new Date().toISOString(),
    }
  }

  const [trendRes, historyRes, popRes] = await Promise.all([
    supa.rpc('get_card_trends_detail',  { slug }),
    supa.rpc('get_card_price_history',  { slug }),
    // Population matcher — the production page uses a broader
    // name/variant/set lookup; here we just take the best-matched row.
    supa.from('psa_population')
      .select('card_name,variant,set_name,card_number,psa_7,psa_8,psa_9,psa_10,total_graded,gem_rate')
      .ilike('card_name', `%${(card?.card_name ?? '').split('#')[0].trim().replace(/[[\]]/g, '').trim()}%`)
      .eq('card_number', card?.card_number ?? '')
      .order('total_graded', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    card,
    trend: (trendRes.data ?? null) as PrototypeTrendRow | null,
    priceHistory: (Array.isArray(historyRes.data) ? historyRes.data : []) as PrototypePriceHistoryRow[],
    population: (popRes.data ?? null) as PrototypePopulationRow | null,
    loadedAt: new Date().toISOString(),
  }
}
