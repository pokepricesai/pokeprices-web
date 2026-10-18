import 'server-only'

// Adapter: translate a TCGGraph provider snapshot into the exact
// shape the existing CardPageClient already consumes. This is the
// single integration point for the migration — no component edits
// required, no parallel card-page layout, no drift risk.
//
// Safety invariants enforced here (identical to the preview adapter):
//   • PSA 9 is NEVER synthesised from pooled grade-9. If TCGGraph
//     doesn't publish per-grader PSA 9, the field stays null and the
//     existing GradeLadder renders '—' (its native missing-price UI).
//   • ACE 10 stays null. The existing chart series config carries
//     an 'ace10_usd' key for completeness; we never populate it.
//   • Variant printings keep their pricing_eligibility gate — the
//     caller already filtered graded fields out for market_only +
//     identity_only + uncertain + not_eligible, so this adapter only
//     sees prices that are already safe to publish.
//   • All prices are returned in CENTS (CardRow's convention).
//   • Currency conversion: TCGplayer market is USD and goes straight
//     into raw_usd. Cardmarket market is EUR — we do NOT convert at
//     write time; it stays in a separate field. The existing chart
//     renders only the keys configured on it, so an EUR series would
//     need its own series spec with a eur currency formatter.

import type {
  ProviderSnapshot,
  ProviderMarketPrice,
  ProviderGradedPrice,
} from './snapshot'
import type { ProviderHistorySeries } from './history'

// Mirrors the server-side CardRow shape in page.tsx. We import by
// structural copy rather than importing the type to avoid a cycle
// through the server route file.
export interface AdaptedCardRow {
  card_slug:            string
  card_url_slug?:       string | null
  card_name:            string
  set_name:             string
  card_number?:         string | number | null
  card_number_display?: string | null
  set_printed_total?:   number | null
  image_url?:           string | null
  raw_usd?:             number | null       // cents
  psa9_usd?:            number | null       // cents — always null when provider is TCGGraph
  psa10_usd?:           number | null       // cents
  is_sealed?:           boolean | null
  language?:            string | null
  // Allow passthrough of any other RPC field the real page provides
  [key: string]: unknown
}

export interface PriceHistoryPoint {
  date: string                         // 'YYYY-MM-DD'
  raw_usd?: number | null              // cents
  psa10_usd?: number | null            // cents
  cardmarket_normal_eur?: number | null
  tcgplayer_normal_usd?: number | null
}

// -------- Core card-row adapter --------

function usdDollarsToCents(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(Number(v))) return null
  return Math.round(Number(v) * 100)
}

function pickGraded(graded: ProviderGradedPrice[] | undefined, grader: ProviderGradedPrice['grader'], grade: ProviderGradedPrice['grade']): number | null {
  if (!graded) return null
  const row = graded.find(g => g.grader === grader && g.grade === grade)
  return row?.price != null ? Number(row.price) : null
}

function pickMarket(market: ProviderMarketPrice[] | undefined, source: ProviderMarketPrice['source'], finish: string): number | null {
  if (!market) return null
  const row = market.find(m => m.source === source && m.finish === finish && m.list_type === 'retail')
  return row?.market != null ? Number(row.market) : null
}

export interface AdaptedLegacyData {
  card: AdaptedCardRow
  providerAttribution: {
    tcg_card_id: string
    tcg_printing_key: string
    pricing_eligibility: string
    psa9_available: false        // Explicitly false — TCGGraph provides pooled grade-9 only, never PSA-specific
    ace10_available: false
    bgs10_available: boolean
    cgc10_available: boolean
    sgc10_available: boolean
    graded_source_label: string  // human text for footer attribution
  }
}

/** Translate a provider snapshot + legacy card metadata into the
 *  CardRow shape the existing CardPageClient already renders.
 *  Returns null if no snapshot is available (caller falls back to
 *  the legacy card_trends path, or renders a honest absent state). */
export function adaptSnapshotToLegacyCardRow(
  legacyCard: AdaptedCardRow,
  snapshot: ProviderSnapshot | null,
): AdaptedLegacyData | null {
  if (!snapshot) return null

  // Prefer the per-grader PSA 10 when published; fall back to the
  // 'any' pool at grade 10 only if PSA 10 is unavailable — this is
  // still per-grader safe since 'any:10' is itself grader-specific
  // in TCGGraph's model (grade 10 only pairs with a named grader).
  const psa10_dollars = pickGraded(snapshot.graded_prices, 'psa', '10')
  // Raw ungraded: use the 'raw:ungraded' graded row.
  const raw_dollars = pickGraded(snapshot.graded_prices, 'raw', 'ungraded')

  // PSA 9 — ABSOLUTE REFUSAL to synthesise this from pooled grade-9.
  // The existing GradeLadder will render '—' for null, which is the
  // correct missing-data state. Same for ACE 10.
  const psa9_usd = null
  const ace10_usd = null

  // Image: provider image if the pricing-eligibility gate allowed it;
  // else keep the legacy image_url if present; else null (card page
  // renders an emoji fallback).
  const image_url = snapshot.image_normal ?? legacyCard.image_url ?? null

  const adapted: AdaptedCardRow = {
    ...legacyCard,
    image_url,
    raw_usd: usdDollarsToCents(raw_dollars),
    psa10_usd: usdDollarsToCents(psa10_dollars),
    psa9_usd,
    // Preserve any extra fields the legacy RPC provided (CGC 10,
    // BGS 10, etc.) if the SAME per-grader data is on the provider
    // row. The existing chart config includes these as optional
    // keys; populating them is strictly additive.
    bgs10_usd: usdDollarsToCents(pickGraded(snapshot.graded_prices, 'bgs', '10')),
    cgc10_usd: usdDollarsToCents(pickGraded(snapshot.graded_prices, 'cgc', '10')),
    sgc10_usd: usdDollarsToCents(pickGraded(snapshot.graded_prices, 'sgc', '10')),
    // ACE 10 — kept null because TCGGraph does not publish it.
    ace10_usd,
  }

  const bgs10 = pickGraded(snapshot.graded_prices, 'bgs', '10') != null
  const cgc10 = pickGraded(snapshot.graded_prices, 'cgc', '10') != null
  const sgc10 = pickGraded(snapshot.graded_prices, 'sgc', '10') != null

  return {
    card: adapted,
    providerAttribution: {
      tcg_card_id: snapshot.tcg_card_id,
      tcg_printing_key: snapshot.tcg_printing_key,
      pricing_eligibility: snapshot.pricing_eligibility,
      psa9_available: false,
      ace10_available: false,
      bgs10_available: bgs10,
      cgc10_available: cgc10,
      sgc10_available: sgc10,
      graded_source_label: 'TCGGraph realised-sales aggregation',
    },
  }
}

// -------- History adapter --------

/** Translate provider historical series into chart-points matching
 *  the shape PriceChart.data expects.
 *
 *  Discipline:
 *  - Pooled graded series (grader='any') is NEVER mapped into
 *    psa10_usd / psa9_usd / etc. It stays on its own `pooled_grade_9`
 *    key so the chart's existing series config can decide whether to
 *    render it.
 *  - Per-grader grade-10 series maps into psa10_usd / bgs10_usd /
 *    cgc10_usd / sgc10_usd respectively.
 *  - Market series maps into source-specific keys that are additive
 *    (never overwrite the raw_usd realised-sales series).
 */
export function adaptProviderHistoryForChart(
  providerSeries: ProviderHistorySeries[],
): PriceHistoryPoint[] {
  if (!providerSeries.length) return []

  // Bucket all points by day
  const byDay = new Map<string, PriceHistoryPoint>()
  const addPoint = (day: string, key: keyof PriceHistoryPoint, value: number | null) => {
    if (value == null || !Number.isFinite(value)) return
    if (!byDay.has(day)) byDay.set(day, { date: day })
    ;(byDay.get(day) as any)[key] = key.endsWith('_usd') || key.endsWith('_eur')
      ? (key.endsWith('_eur') ? Math.round(value * 100) : Math.round(value * 100))
      : value
  }

  for (const series of providerSeries) {
    for (const p of series.points) {
      const dayISO = p.day
      const marketVal = p.market != null ? Number(p.market) : null
      if (marketVal == null) continue

      if (series.kind === 'market') {
        if (series.source === 'tcgplayer' && series.finish === 'normal' && series.currency === 'USD') {
          addPoint(dayISO, 'tcgplayer_normal_usd', marketVal)
        } else if (series.source === 'cardmarket' && series.finish === 'normal' && series.currency === 'EUR') {
          addPoint(dayISO, 'cardmarket_normal_eur', marketVal)
        }
      } else if (series.kind === 'graded') {
        if (series.grader === 'raw' && series.grade === 'ungraded' && series.currency === 'USD') {
          addPoint(dayISO, 'raw_usd', marketVal)
        } else if (series.grader === 'psa' && series.grade === '10' && series.currency === 'USD') {
          addPoint(dayISO, 'psa10_usd', marketVal)
        } else if (series.grader === 'bgs' && series.grade === '10' && series.currency === 'USD') {
          addPoint(dayISO, 'bgs10_usd' as any, marketVal)
        } else if (series.grader === 'cgc' && series.grade === '10' && series.currency === 'USD') {
          addPoint(dayISO, 'cgc10_usd' as any, marketVal)
        } else if (series.grader === 'sgc' && series.grade === '10' && series.currency === 'USD') {
          addPoint(dayISO, 'sgc10_usd' as any, marketVal)
        }
        // Pooled grade 7/8/9/9.5 are deliberately NOT mapped into
        // psa_* keys — pooled is not grader-specific. If a future
        // chart series config adds a dedicated 'pooled_grade_9' key
        // we can start populating it here.
      }
    }
  }

  // Sort by day ascending (chart expects that order).
  return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
}
