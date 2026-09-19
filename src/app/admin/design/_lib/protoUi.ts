// src/app/admin/design/_lib/protoUi.ts
// ============================================================================
// Tiny presentation helpers shared by all three card-page prototypes.
// Pure functions only — no fetching, no DB, no side effects.
// ============================================================================

import type { CSSProperties } from 'react'
import type { GradePrices } from '@/components/GradeLadder'
import type { ChartSeries } from '@/components/PriceChart'
import type {
  PrototypeCardRow, PrototypeTrendRow, PrototypePriceHistoryRow,
} from './loadPrototypeCard'

/** Strip the trailing `#NN` (or `#NN/MM`, or `[Variant] #NN`) block that
 *  cards.card_name carries in the DB, so we can show a clean H1. */
export function cleanCardName(name: string): string {
  return String(name || '')
    .replace(/\s*#\d+[\w/-]*\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** USD-cents → "$1,234" / "$1,234.56" — never returns "$0" for null. */
export function fmtUsd(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const v = cents / 100
  if (v >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  return '$' + v.toFixed(2)
}

/** Format a percent-change number (already a percent, not a fraction). */
export function fmtPct(pct: number | null | undefined): string {
  if (pct == null) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

/** Map every price tier the daily_prices RPC returns onto the GradePrices
 *  shape GradeLadder expects. Also converts cents → USD dollars. */
export function gradePricesFromRow(card: PrototypeCardRow): GradePrices {
  const toDollars = (cents: unknown): number | null =>
    typeof cents === 'number' ? cents / 100 : null
  const keys: (keyof GradePrices)[] = [
    'raw_usd','psa7_usd','psa8_usd','psa9_usd','psa10_usd','cgc95_usd',
    'cgc10_usd','bgs10_usd','bgs10black_usd','cgc10pristine_usd',
    'sgc10_usd','ace10_usd','tag10_usd',
    'grade1_usd','grade2_usd','grade3_usd','grade4_usd','grade5_usd','grade6_usd',
  ]
  const out: Record<string, number | null> = {}
  for (const k of keys) out[k] = toDollars((card as Record<string, unknown>)[k])
  return out as GradePrices
}

/** Pick the chart series that actually have any non-null data in the
 *  supplied history — avoids rendering a legend entry for tiers this
 *  particular card has never had a price on. */
export function historySeries(rows: PrototypePriceHistoryRow[]): ChartSeries[] {
  const has = (k: string) => rows.some(r => (r as Record<string, unknown>)[k] != null)
  const all: ChartSeries[] = [
    { key: 'raw_usd',    label: 'Raw',     color: 'var(--primary)',    defaultOn: true  },
    { key: 'psa9_usd',   label: 'PSA 9',   color: 'var(--type-water)', defaultOn: true  },
    { key: 'psa10_usd',  label: 'PSA 10',  color: 'var(--accent)',     defaultOn: true  },
    { key: 'cgc10_usd',  label: 'CGC 10',  color: '#a855f7',           defaultOn: false },
    { key: 'bgs10_usd',  label: 'BGS 10',  color: '#22c55e',           defaultOn: false },
  ]
  return all.filter(s => has(s.key))
}

/** Coerce the DB row into the exact shape getCardFaqItems() expects. */
export function cardFaqInputFrom(card: PrototypeCardRow) {
  return {
    card: {
      card_name:   String(card.card_name ?? ''),
      set_name:    String(card.set_name ?? ''),
      card_number: card.card_number ?? null,
      raw_usd:     card.raw_usd     ?? null,
      psa9_usd:    card.psa9_usd    ?? null,
      psa10_usd:   card.psa10_usd   ?? null,
    },
  }
}

/** Return the 30d/90d/180d/365d raw trend chips that have a value. */
export function priceRowFor(_card: PrototypeCardRow, trend: PrototypeTrendRow | null) {
  if (!trend) return []
  const map: Array<{ label: string; pct: number | null }> = [
    { label: '7d',   pct: (trend.raw_pct_7d   ?? null) as number | null },
    { label: '30d',  pct: (trend.raw_pct_30d  ?? null) as number | null },
    { label: '90d',  pct: (trend.raw_pct_90d  ?? null) as number | null },
    { label: '180d', pct: (trend.raw_pct_180d ?? null) as number | null },
    { label: '365d', pct: (trend.raw_pct_365d ?? null) as number | null },
  ]
  return map.filter(m => m.pct != null)
}

/** Uniform chip style for a signed percentage-change delta. */
export function deltaChipStyle(pct: number | null | undefined): CSSProperties {
  const up = (pct ?? 0) > 0
  const neutral = (pct == null) || Math.abs(pct) < 0.01
  const bg = neutral ? 'var(--bg-light)'
    : up ? 'rgba(34,197,94,0.10)'
    : 'rgba(239,68,68,0.10)'
  const color = neutral ? 'var(--text-muted)'
    : up ? '#15803d'
    : '#b91c1c'
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 9px', borderRadius: 20,
    fontSize: 11.5, fontWeight: 800,
    background: bg, color,
    border: `1px solid ${neutral ? 'var(--border)' : 'transparent'}`,
  }
}

/** Compute grading opportunity summary: PSA 10 multiple of raw, rough
 *  probability-weighted net profit at $25 grading fee. */
export function gradingOpportunity(card: PrototypeCardRow, gemRate: number | null | undefined) {
  const raw = card.raw_usd ?? null
  const psa10 = card.psa10_usd ?? null
  if (raw == null || psa10 == null || raw <= 0) return null
  const multiple = psa10 / raw
  const gr = gemRate == null ? null : gemRate / 100
  const feeCents = 2500 // ~$25
  const psa10Net = psa10 - raw - feeCents
  const expectedValueCents = gr == null ? null : (gr * psa10 + (1 - gr) * (card.psa9_usd ?? raw)) - raw - feeCents
  return {
    multiple,
    psa10NetCents: psa10Net,
    expectedValueCents,
    worthIt: (expectedValueCents ?? psa10Net) > 0,
  }
}
