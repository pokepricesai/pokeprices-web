// src/lib/studio/dataBlocks/registry.ts
//
// EIC Block 8 — data-block variant registry.
//
// Pure module (no React, no server-only). Every variant declares:
//   * a display label + description
//   * a validator that returns a sanitised payload or null
//   * the intended snapshot/live capability
//
// The Studio picker, the AI Writer factories, and the public renderer
// all resolve variants through this registry. Adding a new variant is
// two lines here plus a renderer entry.

import type {
  DataBlockVariant, DataBlockMode,
  RankingTablePayload, CardBlockPayload, CardGridPayload, SetBlockPayload,
  StatCalloutPayload, MethodologyPayload, PriceChartPayload, RawPsaComparisonPayload,
  DataBlockPayloadByVariant, SnapshotProvenance, CardIdentity, SetIdentity,
} from './types'

// ─────────────────────────────────────────────────────────────────
// Sanitisation helpers
// ─────────────────────────────────────────────────────────────────

const MAX_TITLE      = 300
const MAX_LABEL      = 200
const MAX_INTRO      = 4_000
const MAX_ROWS       = 100
const MAX_COLUMNS    = 15
const MAX_CELL_STR   = 500
const MAX_CARDS_GRID = 24
const MAX_CHART_POINTS = 400

function str(v: unknown, cap = MAX_LABEL): string { return typeof v === 'string' ? v.slice(0, cap) : '' }
function optStr(v: unknown, cap = MAX_LABEL): string | undefined { const s = str(v, cap); return s || undefined }
function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function optBool(v: unknown): boolean | undefined { return typeof v === 'boolean' ? v : undefined }

function sanitiseCard(v: unknown): CardIdentity | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const cardSlug = str(r.cardSlug, 80)
  const cardName = str(r.cardName, 300)
  if (!cardSlug || !cardName) return null
  const out: CardIdentity = { cardSlug, cardName }
  if (r.cardNumber) out.cardNumber = str(r.cardNumber, 30)
  if (r.setName)    out.setName    = str(r.setName,    200)
  if (r.urlSlug)    out.urlSlug    = str(r.urlSlug,    250)
  if (r.imageUrl && typeof r.imageUrl === 'string' && /^https:\/\//.test(r.imageUrl)) out.imageUrl = r.imageUrl.slice(0, 800)
  if (r.language)   out.language   = str(r.language,   10)
  return out
}
function sanitiseSet(v: unknown): SetIdentity | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const setName = str(r.setName, 200)
  if (!setName) return null
  const out: SetIdentity = { setName }
  if (r.releaseDate) out.releaseDate = str(r.releaseDate, 30)
  if (r.cardCount != null) { const n = toNum(r.cardCount); if (n != null) out.cardCount = Math.trunc(n) }
  if (r.imageUrl && typeof r.imageUrl === 'string' && /^https:\/\//.test(r.imageUrl)) out.imageUrl = r.imageUrl.slice(0, 800)
  if (r.urlSlug)    out.urlSlug    = str(r.urlSlug,    250)
  return out
}

function sanitiseProvenance(v: unknown): SnapshotProvenance | undefined {
  if (!v || typeof v !== 'object') return undefined
  const r = v as any
  const asOf = str(r.asOf, 30)
  if (!asOf) return undefined
  const out: SnapshotProvenance = { asOf }
  if (r.researchId != null) { const n = toNum(r.researchId); if (n != null) out.researchId = Math.trunc(n) }
  if (r.packRecipe) out.packRecipe = str(r.packRecipe, 80)
  if (Array.isArray(r.evidenceRefs)) out.evidenceRefs = r.evidenceRefs.filter((x: unknown) => typeof x === 'string').slice(0, 20)
  if (r.evidenceDetached === true) out.evidenceDetached = true
  if (r.detachReason)              out.detachReason    = str(r.detachReason, 500)
  return out
}

// ─────────────────────────────────────────────────────────────────
// Per-variant validators
// ─────────────────────────────────────────────────────────────────

function validateRankingTable(v: unknown): RankingTablePayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const title = str(r.title, MAX_TITLE)
  if (!title) return null
  const columns = Array.isArray(r.columns) ? r.columns.slice(0, MAX_COLUMNS).map((c: any): any => ({
    key:    str(c?.key, 60),
    label:  str(c?.label, 120),
    align:  c?.align === 'right' ? 'right' : 'left',
    format: ['text','integer','usd','gbp','percent','gem_rate','date','url'].includes(c?.format) ? c.format : 'text',
    hint:   optStr(c?.hint, 200),
  })).filter((c: any) => c.key) : []
  if (columns.length === 0) return null
  const rows = Array.isArray(r.rows) ? r.rows.slice(0, MAX_ROWS).map((row: any): any => {
    const cells: Record<string, string | number | null> = {}
    if (row && typeof row.cells === 'object' && row.cells) {
      for (const [k, val] of Object.entries(row.cells)) {
        if (typeof val === 'number' && Number.isFinite(val)) cells[k] = val
        else if (typeof val === 'string')                    cells[k] = val.slice(0, MAX_CELL_STR)
        else if (val === null)                               cells[k] = null
      }
    }
    return { card: sanitiseCard(row?.card), cells }
  }) : []
  const provenance = sanitiseProvenance(r.provenance) ?? { asOf: new Date().toISOString().slice(0, 10) }
  const out: RankingTablePayload = {
    title,
    columns,
    rows,
    mode: 'snapshot',
    provenance,
  }
  if (r.intro)  out.intro  = str(r.intro,  MAX_INTRO)
  if (r.source) out.source = str(r.source, 400)
  if (typeof r.highlightRowIndex === 'number' && Number.isInteger(r.highlightRowIndex) && r.highlightRowIndex >= 0 && r.highlightRowIndex < rows.length) {
    out.highlightRowIndex = r.highlightRowIndex
  }
  return out
}

function validateCardBlock(v: unknown): CardBlockPayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const card = sanitiseCard(r.card)
  if (!card) return null
  const show = {
    raw:   optBool(r.show?.raw)   ?? true,
    psa9:  optBool(r.show?.psa9)  ?? false,
    psa10: optBool(r.show?.psa10) ?? true,
  }
  const mode: DataBlockMode = r.mode === 'live' ? 'live' : 'snapshot'
  const out: CardBlockPayload = { card, show, mode }
  if (r.caption) out.caption = str(r.caption, 400)
  if (mode === 'snapshot') {
    out.snapshot = {
      rawUsd:   toNum(r.snapshot?.rawUsd),
      psa9Usd:  toNum(r.snapshot?.psa9Usd),
      psa10Usd: toNum(r.snapshot?.psa10Usd),
      asOf:     str(r.snapshot?.asOf, 30) || new Date().toISOString().slice(0, 10),
      provenance: sanitiseProvenance(r.snapshot?.provenance),
    }
  }
  return out
}

function validateCardGrid(v: unknown): CardGridPayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const cards = Array.isArray(r.cards) ? r.cards.slice(0, MAX_CARDS_GRID).map((c: any) => {
    const card = sanitiseCard(c?.card)
    if (!card) return null
    const out: { card: CardIdentity; stat?: { label: string; value: string | number } } = { card }
    if (c?.stat && typeof c.stat === 'object') {
      const label = str(c.stat.label, 60)
      const rawVal = c.stat.value
      const value = typeof rawVal === 'number' && Number.isFinite(rawVal) ? rawVal
                  : typeof rawVal === 'string' ? rawVal.slice(0, 60) : ''
      if (label) out.stat = { label, value }
    }
    return out
  }).filter(Boolean) as CardGridPayload['cards'] : []
  if (cards.length === 0) return null
  const out: CardGridPayload = {
    cards,
    mode: r.mode === 'live' ? 'live' : 'snapshot',
  }
  if (r.title) out.title = str(r.title, MAX_TITLE)
  return out
}

function validateSetBlock(v: unknown): SetBlockPayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const set = sanitiseSet(r.set)
  if (!set) return null
  const out: SetBlockPayload = {
    set,
    mode: r.mode === 'live' ? 'live' : 'snapshot',
  }
  if (r.caption) out.caption = str(r.caption, 400)
  if (r.summary && typeof r.summary === 'object') {
    const s = r.summary
    out.summary = {
      totalCards:     toNum(s.totalCards)     ?? undefined,
      cardsOver100:   toNum(s.cardsOver100)   ?? undefined,
      setTotalValue:  toNum(s.setTotalValue)  ?? undefined,
      setMedianValue: toNum(s.setMedianValue) ?? undefined,
      asOf:           str(s.asOf, 30) || new Date().toISOString().slice(0, 10),
    }
  }
  return out
}

function validateStatCallout(v: unknown): StatCalloutPayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const value = str(r.value, 60)
  const label = str(r.label, MAX_LABEL)
  if (!value || !label) return null
  const out: StatCalloutPayload = { value, label, mode: 'snapshot' }
  if (r.context) out.context = str(r.context, 400)
  if (r.asOf)    out.asOf    = str(r.asOf,    30)
  if (r.source)  out.source  = str(r.source,  400)
  const prov = sanitiseProvenance(r.provenance)
  if (prov) out.provenance = prov
  return out
}

function validateMethodology(v: unknown): MethodologyPayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const title   = str(r.title, MAX_TITLE) || 'Methodology'
  const summary = str(r.summary, MAX_INTRO)
  if (!summary) return null
  const bullets = Array.isArray(r.bullets) ? r.bullets.filter((b: unknown) => typeof b === 'string' && b).slice(0, 20).map((b: any) => b.slice(0, 500)) : []
  const caveats = Array.isArray(r.caveats) ? r.caveats.filter((b: unknown) => typeof b === 'string' && b).slice(0, 10).map((b: any) => b.slice(0, 500)) : []
  const asOf = str(r.asOf, 30) || new Date().toISOString().slice(0, 10)
  const out: MethodologyPayload = { title, summary, bullets, asOf }
  if (caveats.length > 0) out.caveats = caveats
  if (r.source) out.source = str(r.source, 400)
  const prov = sanitiseProvenance(r.provenance)
  if (prov) out.provenance = prov
  return out
}

function validatePriceChart(v: unknown): PriceChartPayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const card = sanitiseCard(r.card)
  if (!card) return null
  const seriesValid = ['raw', 'psa9', 'psa10'] as const
  const series = Array.isArray(r.series)
    ? r.series.filter((s: any) => (seriesValid as readonly string[]).includes(s))
    : ['raw']
  if (series.length === 0) return null
  const mode: DataBlockMode = r.mode === 'live' ? 'live' : 'snapshot'
  const rawPts = Array.isArray(r.points) ? r.points : []
  const points = rawPts.slice(0, MAX_CHART_POINTS).map((p: any) => {
    const date = str(p?.date, 30)
    if (!date) return null
    return {
      date,
      raw:   toNum(p?.raw),
      psa9:  toNum(p?.psa9),
      psa10: toNum(p?.psa10),
    }
  }).filter(Boolean) as PriceChartPayload['points']
  const out: PriceChartPayload = { card, series: series as any, mode, points }
  if (r.title) out.title = str(r.title, MAX_TITLE)
  if (r.days && Number.isFinite(r.days)) out.days = Math.min(3650, Math.max(7, Math.trunc(r.days)))
  if (r.asOf) out.asOf = str(r.asOf, 30)
  const prov = sanitiseProvenance(r.provenance)
  if (prov) out.provenance = prov
  return out
}

function validateRawPsaComparison(v: unknown): RawPsaComparisonPayload | null {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const rows = Array.isArray(r.rows) ? r.rows.slice(0, MAX_ROWS).map((row: any) => {
    const card = sanitiseCard(row?.card)
    if (!card) return null
    return {
      card,
      rawCents:    toNum(row?.rawCents),
      psa9Cents:   toNum(row?.psa9Cents),
      psa10Cents:  toNum(row?.psa10Cents),
      psa10Pop:    toNum(row?.psa10Pop),
      totalGraded: toNum(row?.totalGraded),
    }
  }).filter(Boolean) as RawPsaComparisonPayload['rows'] : []
  if (rows.length === 0) return null
  const out: RawPsaComparisonPayload = {
    rows,
    showRatios: r.showRatios === true,
    mode: 'snapshot',
  }
  if (r.title)  out.title  = str(r.title,  MAX_TITLE)
  if (r.source) out.source = str(r.source, 400)
  if (r.asOf)   out.asOf   = str(r.asOf,   30)
  const prov = sanitiseProvenance(r.provenance)
  if (prov) out.provenance = prov
  return out
}

// ─────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────

export type DataBlockRegistryEntry<V extends DataBlockVariant> = {
  variant:      V
  label:        string
  description:  string
  supportsSnapshot: boolean
  supportsLive:     boolean
  validate:     (v: unknown) => DataBlockPayloadByVariant[V] | null
}

export const DATA_BLOCK_REGISTRY: { [V in DataBlockVariant]: DataBlockRegistryEntry<V> } = {
  ranking_table: {
    variant: 'ranking_table', label: 'Ranking table',
    description: 'Card-shaped ranked list with rank, name, set, and formatted numeric columns. Snapshot only.',
    supportsSnapshot: true, supportsLive: false, validate: validateRankingTable,
  },
  card_block: {
    variant: 'card_block', label: 'Card block',
    description: 'Single canonical card with image, prices, and link. Snapshot or live.',
    supportsSnapshot: true, supportsLive: true, validate: validateCardBlock,
  },
  card_grid: {
    variant: 'card_grid', label: 'Card grid',
    description: 'Grid of canonical cards. Optional stat under each. Snapshot or live.',
    supportsSnapshot: true, supportsLive: true, validate: validateCardGrid,
  },
  set_block: {
    variant: 'set_block', label: 'Set block',
    description: 'Canonical set overview: name, release date, card count, link. Snapshot or live.',
    supportsSnapshot: true, supportsLive: true, validate: validateSetBlock,
  },
  stat_callout: {
    variant: 'stat_callout', label: 'Stat callout',
    description: 'Large headline number with label + optional evidence provenance.',
    supportsSnapshot: true, supportsLive: false, validate: validateStatCallout,
  },
  methodology: {
    variant: 'methodology', label: 'Methodology',
    description: 'Reader-facing methodology box: sample, dates, filters, caveats. Snapshot only.',
    supportsSnapshot: true, supportsLive: false, validate: validateMethodology,
  },
  price_chart: {
    variant: 'price_chart', label: 'Price chart',
    description: 'Card price history (raw / PSA 9 / PSA 10). Snapshot bounded series, or live query with day-range cap.',
    supportsSnapshot: true, supportsLive: true, validate: validatePriceChart,
  },
  raw_psa_comparison: {
    variant: 'raw_psa_comparison', label: 'Raw / PSA comparison',
    description: 'Raw vs PSA 9 vs PSA 10 side-by-side for one or several cards. Snapshot only.',
    supportsSnapshot: true, supportsLive: false, validate: validateRawPsaComparison,
  },
}

export function validateDataBlockPayload<V extends DataBlockVariant>(variant: V, payload: unknown): DataBlockPayloadByVariant[V] | null {
  const entry = DATA_BLOCK_REGISTRY[variant]
  if (!entry) return null
  return entry.validate(payload) as DataBlockPayloadByVariant[V] | null
}
