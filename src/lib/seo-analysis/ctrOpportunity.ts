// src/lib/seo-analysis/ctrOpportunity.ts
// Block 5A-W-33 — find CTR opportunities in GSC / Bing rows.
//
// An "opportunity" row is one where there's clearly room to improve
// click-through without first needing to improve rankings:
//   * impressions >= MIN_IMPRESSIONS       (significant visibility)
//   * average position in OPPORTUNITY_BAND (close enough to convert)
//   * CTR < CTR_THRESHOLD                  (under-performing for the position)
//
// These rules are the W34 candidate list — we are not editing
// metadata in W33.

import type { PageType } from './pageClassifier'

export type RankingRow = {
  page?:         string | null
  query?:        string | null
  pageType?:     PageType
  branded?:      boolean
  clicks:        number
  impressions:   number
  /** Decimal CTR (0–1). GSC exports CTR as a fraction. */
  ctr:           number
  /** Average position (1 = top of SERP). */
  avgPosition:   number
}

export type OpportunityRow = RankingRow & {
  /** Short tag describing why it's flagged. */
  opportunityReason: string
  /** Suggested high-level action. Plain string for the CSV column. */
  recommendedAction: string
}

export const MIN_IMPRESSIONS    = 100
export const OPPORTUNITY_BAND   = { min: 5,    max: 20    } as const
export const CTR_THRESHOLD      = 0.01

export function findOpportunities(rows: RankingRow[]): OpportunityRow[] {
  const out: OpportunityRow[] = []
  for (const r of rows) {
    if (!Number.isFinite(r.impressions) || r.impressions < MIN_IMPRESSIONS) continue
    if (!Number.isFinite(r.avgPosition))                                     continue
    if (r.avgPosition < OPPORTUNITY_BAND.min)                                continue
    if (r.avgPosition > OPPORTUNITY_BAND.max)                                continue
    if (!Number.isFinite(r.ctr))                                             continue
    if (r.ctr >= CTR_THRESHOLD)                                              continue

    const reason = buildReason(r)
    out.push({
      ...r,
      opportunityReason: reason,
      recommendedAction: buildAction(r),
    })
  }
  // Highest impressions first — biggest visibility gets attention first.
  out.sort((a, b) => b.impressions - a.impressions)
  return out
}

function buildReason(r: RankingRow): string {
  const parts: string[] = []
  parts.push(`pos ${r.avgPosition.toFixed(1)}`)
  parts.push(`${r.impressions} impr`)
  parts.push(`${(r.ctr * 100).toFixed(2)}% CTR`)
  if (r.pageType)        parts.push(`type=${r.pageType}`)
  if (r.branded === true)  parts.push('branded')
  if (r.branded === false) parts.push('non-branded')
  return parts.join(' · ')
}

function buildAction(r: RankingRow): string {
  // Light heuristic — full title / meta rewrites happen in W34.
  if (r.pageType === 'card')     return 'card-template title/meta rewrite (W34)'
  if (r.pageType === 'set')      return 'set-template title/meta rewrite (W34)'
  if (r.pageType === 'pokemon')  return 'pokemon-template title/meta rewrite (W34)'
  if (r.pageType === 'insights') return 'insights title/excerpt tune (W34)'
  if (r.pageType === 'tools')    return 'tool-page title/snippet review (W34)'
  return 'review page title + meta description (W34)'
}
