// PP-TCG migration — strict provider-safe re-check against the live
// reconciliation view. CORRECTED filter: `has_graded_prices` is only
// required for `bulk_safe` cards; `market_only` cards suppress graded
// surface via the adapter anyway, so requiring graded unnecessarily
// excluded ~14k eligible cards.
//
// Called in two places:
//   1. Enrollment: scan the view for all strict-corrected candidates.
//   2. Pre-activation re-check: verify the card is STILL strict-safe
//      at the moment of flip, not just at enrollment time.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface ReconciliationRow {
  pp_card_slug:           string
  pp_card_name:           string
  pp_set_name:            string
  pp_language:            string | null
  outcome:                string
  risk_class:             string
  confidence:             string
  review_status:          string
  printing_active_status: string
  has_image:              boolean
  has_market_prices:      boolean
  has_graded_prices:      boolean
  effective_eligibility:  string
  gsc_rank:               number | null
}

export type StrictCheckResult =
  | { ok: true;  row: ReconciliationRow }
  | { ok: false; reason: string }

/** Does this ONE slug still satisfy the strict-corrected filter right now?
 *  Called immediately before every activation. */
export async function strictRecheckOne(
  sb: SupabaseClient,
  pp_card_slug: string,
): Promise<StrictCheckResult> {
  const { data, error } = await sb.from('v_pp_tcg_card_reconciliation')
    .select('pp_card_slug,pp_card_name,pp_set_name,pp_language,outcome,risk_class,confidence,review_status,printing_active_status,has_image,has_market_prices,has_graded_prices,effective_eligibility,gsc_rank')
    .eq('pp_card_slug', pp_card_slug)
    .maybeSingle()
  if (error) return { ok: false, reason: `strict_recheck_db_error: ${error.message}` }
  if (!data)  return { ok: false, reason: 'strict_recheck_no_row' }
  const r = data as ReconciliationRow
  if (r.outcome !== 'approved_active')           return { ok: false, reason: `outcome=${r.outcome}` }
  if (r.risk_class !== 'catalogue_corroborated') return { ok: false, reason: `risk=${r.risk_class}` }
  if (r.confidence !== 'verified')               return { ok: false, reason: `conf=${r.confidence}` }
  if (r.review_status !== 'approved')            return { ok: false, reason: `review=${r.review_status}` }
  if (r.printing_active_status !== 'active')     return { ok: false, reason: `printing=${r.printing_active_status}` }
  if (!r.has_image)                              return { ok: false, reason: 'no_image' }
  if (!r.has_market_prices)                      return { ok: false, reason: 'no_market' }
  if (!['bulk_safe','market_only'].includes(r.effective_eligibility)) {
    return { ok: false, reason: `elig=${r.effective_eligibility}` }
  }
  if (r.effective_eligibility === 'bulk_safe' && !r.has_graded_prices) {
    return { ok: false, reason: 'bulk_safe_without_graded' }
  }
  return { ok: true, row: r }
}

/** Scan the entire reconciliation view for strict-corrected candidates.
 *  Used by enrollment. Returns rows ordered by gsc_rank asc nulls last. */
export async function listStrictCandidates(
  sb: SupabaseClient,
  opts: { language?: 'en' | 'jp' | 'any'; limit?: number } = {},
): Promise<ReconciliationRow[]> {
  const lang = opts.language ?? 'any'
  const out: ReconciliationRow[] = []
  let from = 0
  const pageSize = 1000
  while (true) {
    let q = sb.from('v_pp_tcg_card_reconciliation')
      .select('pp_card_slug,pp_card_name,pp_set_name,pp_language,outcome,risk_class,confidence,review_status,printing_active_status,has_image,has_market_prices,has_graded_prices,effective_eligibility,gsc_rank')
      .eq('outcome', 'approved_active')
      .eq('risk_class', 'catalogue_corroborated')
      .eq('confidence', 'verified')
      .eq('review_status', 'approved')
      .eq('printing_active_status', 'active')
      .eq('has_image', true)
      .eq('has_market_prices', true)
      .in('effective_eligibility', ['bulk_safe', 'market_only'])
      .order('gsc_rank', { ascending: true, nullsFirst: false })
      .order('pp_card_slug', { ascending: true })
    if (lang !== 'any') q = q.eq('pp_language', lang)
    const { data, error } = await q.range(from, from + pageSize - 1)
    if (error) throw new Error(`strict scan: ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data as ReconciliationRow[]) {
      // Enforce the asymmetric graded gate (view can't express this directly)
      if (r.effective_eligibility === 'bulk_safe' && !r.has_graded_prices) continue
      out.push(r)
      if (opts.limit && out.length >= opts.limit) return out
    }
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}
