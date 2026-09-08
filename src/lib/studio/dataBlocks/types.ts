// src/lib/studio/dataBlocks/types.ts
//
// EIC Block 8 — canonical shapes for PokePrices data + visual blocks.
//
// Every data block persisted in a StudioDocument (or, after
// conversion, in insights.body_json) has the shape:
//
//   { type: 'data_block', variant, payload }
//
// This module owns:
//   * the discriminant union of variant keys
//   * a shared `BaseSnapshotProvenance` shape for evidence-derived
//     snapshot blocks
//   * the concrete payload types for each of the 8 core variants
//
// The registry (registry.ts) wires each variant to its validator,
// public renderer, and factory. NodeView UI + Studio picker read the
// same registry so there is exactly one source of truth per variant.

export const DATA_BLOCK_VARIANTS = [
  'ranking_table',
  'card_block',
  'card_grid',
  'set_block',
  'stat_callout',
  'methodology',
  'price_chart',
  'raw_psa_comparison',
] as const

export type DataBlockVariant = typeof DATA_BLOCK_VARIANTS[number]

export type DataBlockMode = 'snapshot' | 'live'

// ─────────────────────────────────────────────────────────────────
// Shared shapes
// ─────────────────────────────────────────────────────────────────

/**
 * Attached to every SNAPSHOT payload derived from a Research pack.
 * Lets the Studio "View evidence" affordance walk back to the
 * originating fact/finding/table.
 */
export type SnapshotProvenance = {
  asOf:          string                 // ISO date the underlying data represents
  researchId?:   number                 // editorial_research.id
  packRecipe?:   string                 // e.g. 'population_scarcity'
  evidenceRefs?: string[]               // ids from EvidencePack (fact-*, finding-*, data-table-*)
  /** True when a human has manually mutated an evidence-derived cell.
   *  The block's "backed by research" badge is downgraded in the UI. */
  evidenceDetached?: boolean
  /** Free-text reason attached whenever `evidenceDetached` is true. */
  detachReason?: string
}

export type CardIdentity = {
  cardSlug:    string   // bare numeric slug (e.g. "849998")
  cardName:    string   // display name without trailing #NN
  cardNumber?: string   // e.g. "31" or "31/165"
  setName?:    string
  urlSlug?:    string   // canonical /set/<set>/card/<urlSlug>
  imageUrl?:   string
  language?:   string   // 'en' | 'jp' | ...
}

export type SetIdentity = {
  setName:      string
  releaseDate?: string
  cardCount?:   number
  imageUrl?:    string
  urlSlug?:     string  // /set/<slug>
}

// ─────────────────────────────────────────────────────────────────
// Variant payloads
// ─────────────────────────────────────────────────────────────────

// A. ranking_table ────────────────────────────────────────────────

export type RankingTableColumn = {
  key:      string
  label:    string
  align?:   'left' | 'right'
  format?:  'text' | 'integer' | 'usd' | 'gbp' | 'percent' | 'gem_rate' | 'date' | 'url'
  hint?:    string
}

export type RankingTableRow = {
  /** Optional canonical card identity so the row can link to the
   *  right card page. Null when the row is not card-shaped. */
  card?:   CardIdentity | null
  /** Column key → cell value. Numbers stay numbers so the renderer
   *  can format them; strings pass through. */
  cells:   Record<string, string | number | null>
}

export type RankingTablePayload = {
  title:   string
  intro?:  string
  columns: RankingTableColumn[]
  rows:    RankingTableRow[]
  /** Optional footnote source line, e.g. "psa_population + card_latest_prices (as of 2026-09-06)". */
  source?: string
  /** Row index (0-based) to highlight in the rendered table. */
  highlightRowIndex?: number
  mode:    'snapshot'   // ranking tables always snapshot
  provenance: SnapshotProvenance
}

// B. card_block ────────────────────────────────────────────────────

export type CardBlockPayload = {
  card:    CardIdentity
  caption?: string
  /** Which price fields to show; missing values render as
   *  "Unavailable" rather than "$0". */
  show:    { raw?: boolean; psa9?: boolean; psa10?: boolean }
  mode:    DataBlockMode
  /** Present when mode === 'snapshot'. Frozen values from the
   *  moment the block was created. */
  snapshot?: {
    rawUsd?:   number | null
    psa9Usd?:  number | null
    psa10Usd?: number | null
    asOf:      string
    provenance?: SnapshotProvenance
  }
}

// C. card_grid ─────────────────────────────────────────────────────

export type CardGridPayload = {
  title?:  string
  cards:   Array<{
    card:    CardIdentity
    /** Optional stat/price shown under the name. Snapshot only. */
    stat?:   { label: string; value: string | number }
  }>
  mode:    'snapshot' | 'live'
}

// D. set_block ─────────────────────────────────────────────────────

export type SetBlockPayload = {
  set:      SetIdentity
  caption?: string
  /** Summary shown alongside the set. Snapshot fields only. */
  summary?: {
    totalCards?:     number
    cardsOver100?:   number
    setTotalValue?:  number   // cents
    setMedianValue?: number   // cents
    asOf:            string
  }
  mode:     DataBlockMode
}

// E. stat_callout ──────────────────────────────────────────────────

export type StatCalloutPayload = {
  value:    string            // pre-formatted display value, e.g. "62,645" or "39.1%"
  label:    string            // short caption, e.g. "cards priced at both August endpoints"
  context?: string            // optional secondary line
  /** ISO date + source line rendered as "Data as of ..." */
  asOf?:    string
  source?:  string
  mode:     'snapshot'        // stat callouts always snapshot
  provenance?: SnapshotProvenance
}

// F. methodology ───────────────────────────────────────────────────

export type MethodologyPayload = {
  title:       string   // usually "Methodology"
  summary:     string
  bullets:     string[]                     // filters, exclusions, sample
  caveats?:    string[]                     // required caveats surfaced to the reader
  source?:     string
  asOf:        string
  provenance?: SnapshotProvenance
}

// G. price_chart ───────────────────────────────────────────────────

export type PriceChartSeriesKey = 'raw' | 'psa9' | 'psa10'

export type PriceChartPoint = {
  date:  string   // ISO date
  raw?:  number | null   // cents
  psa9?: number | null   // cents
  psa10?:number | null   // cents
}

export type PriceChartPayload = {
  title?: string
  card:   CardIdentity
  series: PriceChartSeriesKey[]           // which lines to show
  /** SNAPSHOT: bounded points frozen at build time.
   *  LIVE: `points` empty; renderer resolves from daily_prices at
   *  render time (client-side query bounded to `days`). */
  mode:   DataBlockMode
  points: PriceChartPoint[]
  days?:  number                          // typical: 90/180/365
  asOf?:  string
  provenance?: SnapshotProvenance
}

// H. raw_psa_comparison ────────────────────────────────────────────

export type RawPsaComparisonRow = {
  card:      CardIdentity
  rawCents?: number | null
  psa9Cents?:number | null
  psa10Cents?:number | null
  /** Optional PSA-10 population column when the source pack has it. */
  psa10Pop?: number | null
  totalGraded?: number | null
}

export type RawPsaComparisonPayload = {
  title?:  string
  rows:    RawPsaComparisonRow[]
  /** Show computed ratios (psa10/raw, psa9/raw). Blocked when the
   *  underlying evidence pack is marked research-required for
   *  grading — see registry.ts / rawPsaComparison.ts. */
  showRatios: boolean
  source?: string
  asOf?:   string
  mode:    'snapshot'
  provenance?: SnapshotProvenance
}

// ─────────────────────────────────────────────────────────────────
// Union
// ─────────────────────────────────────────────────────────────────

export type DataBlockPayloadByVariant = {
  ranking_table:       RankingTablePayload
  card_block:          CardBlockPayload
  card_grid:           CardGridPayload
  set_block:           SetBlockPayload
  stat_callout:        StatCalloutPayload
  methodology:         MethodologyPayload
  price_chart:         PriceChartPayload
  raw_psa_comparison:  RawPsaComparisonPayload
}

export type DataBlock<V extends DataBlockVariant = DataBlockVariant> = {
  type:    'data_block'
  variant: V
  payload: DataBlockPayloadByVariant[V]
}

export function isDataBlockVariant(v: unknown): v is DataBlockVariant {
  return typeof v === 'string' && (DATA_BLOCK_VARIANTS as readonly string[]).includes(v)
}
