// src/lib/studio/dataBlocks/factories.ts
//
// EIC Block 8 — evidence → data-block factories.
//
// Called by the Studio "Insert from Research" flow and by the future
// AI Writer. Every factory:
//   * accepts an EvidencePack + optional selector args
//   * returns a fully-validated DataBlock (or throws with a specific
//     reason if the pack cannot support that block)
//   * attaches SnapshotProvenance so evidence traceability survives
//     into the article
//   * refuses to include quarantined rows in publishable content
//   * refuses to build a raw/PSA comparison from a blocked/
//     research-required grading dataset (regression-protects the
//     Block 5C 32.4x failure mode)
//
// The factories are the ONLY sanctioned bridge between Research and
// publishable data blocks. Do not construct block payloads by hand
// in Studio components; go through here so validation + provenance
// stay consistent.

import type {
  EvidencePack, ResearchAnalysis, DataTable, VerifiedFact, DerivedFinding,
} from '@/lib/editorial/research/types'
import type {
  DataBlock, RankingTablePayload, StatCalloutPayload, MethodologyPayload,
  PriceChartPayload, RawPsaComparisonPayload, CardBlockPayload, SetBlockPayload,
  CardIdentity, SnapshotProvenance,
} from './types'
import { validateDataBlockPayload } from './registry'

function provFromPack(pack: EvidencePack, extraRefs: string[] = []): SnapshotProvenance {
  return {
    asOf:         pack.dataAsOf,
    packRecipe:   pack.recipe,
    evidenceRefs: extraRefs,
  }
}

// ─────────────────────────────────────────────────────────────────
// Methodology
// ─────────────────────────────────────────────────────────────────

export function createMethodologyBlock(pack: EvidencePack, analysis?: ResearchAnalysis | null): DataBlock<'methodology'> {
  const bullets: string[] = []
  for (const f of pack.methodology.filters)         bullets.push(`${f.label}: ${f.value}`)
  for (const ex of pack.methodology.excludedGroups) bullets.push(`Excluded ${ex.label}: ${ex.reason}`)
  bullets.push(`Deduplication: ${pack.methodology.dedupKey}`)

  // Reader-facing caveats: prefer Analyst's requiredCaveats when the
  // Analyst has run; otherwise fall back to any caveats already
  // baked into the pack's quality reasons.
  const caveats: string[] = []
  if (analysis?.requiredCaveats?.length) caveats.push(...analysis.requiredCaveats)
  else                                    caveats.push(...pack.quality.reasons.filter(r => /caveat|frame|stale/i.test(r)))

  const payload: MethodologyPayload = {
    title: 'Methodology',
    summary: pack.methodology.summary,
    bullets,
    caveats: caveats.length ? caveats : undefined,
    source: pack.internalSources.map(s => s.table).join(' + '),
    asOf: pack.dataAsOf,
    provenance: provFromPack(pack),
  }
  const validated = validateDataBlockPayload('methodology', payload)
  if (!validated) throw new Error('methodology payload failed validation')
  return { type: 'data_block', variant: 'methodology', payload: validated }
}

// ─────────────────────────────────────────────────────────────────
// Stat callout
// ─────────────────────────────────────────────────────────────────

export function createStatCalloutFromFact(pack: EvidencePack, factId: string, opts: { value: string; label: string; context?: string } ): DataBlock<'stat_callout'> {
  const fact = pack.verifiedFacts.find(f => f.id === factId) ?? pack.derivedFindings.find(f => f.id === factId) as (VerifiedFact | DerivedFinding | undefined)
  if (!fact) throw new Error(`no verified fact or derived finding with id "${factId}" in pack`)
  const payload: StatCalloutPayload = {
    value: opts.value,
    label: opts.label,
    context: opts.context,
    asOf: fact.asOf ?? pack.dataAsOf,
    source: pack.internalSources.map(s => s.table).join(' + '),
    mode: 'snapshot',
    provenance: provFromPack(pack, [factId]),
  }
  const v = validateDataBlockPayload('stat_callout', payload)
  if (!v) throw new Error('stat_callout payload failed validation')
  return { type: 'data_block', variant: 'stat_callout', payload: v }
}

// ─────────────────────────────────────────────────────────────────
// Ranking table
// ─────────────────────────────────────────────────────────────────

export type CreateRankingTableOptions = {
  /** id of the DataTable inside pack.dataTables to convert. */
  dataTableId: string
  /** Override title. Defaults to the DataTable's own title. */
  title?:      string
  intro?:      string
  /** Reduce rows to first N. */
  limit?:      number
  /** Only these column keys (subset of the DataTable's columns). Order preserved. */
  columns?:    string[]
  /** Card-identity resolver — the DataTable rows are anonymous, so
   *  the caller must supply a way to build a CardIdentity from a
   *  row. If absent, the ranking table renders without card links. */
  cardFromRow?: (row: Record<string, string | number | null>) => CardIdentity | null
  /** Rows to EXCLUDE by predicate. Applied BEFORE limit. Defaults
   *  to null; every row from the pack table enters unless removed. */
  excludeRow?: (row: Record<string, string | number | null>) => boolean
}

export function createRankingTableFromResearch(
  pack: EvidencePack,
  opts: CreateRankingTableOptions,
): DataBlock<'ranking_table'> {
  const table = pack.dataTables.find(t => t.id === opts.dataTableId)
  if (!table) throw new Error(`no data table with id "${opts.dataTableId}"`)

  // Belt-and-braces: even though quarantined rows are excluded from
  // dataTables at recipe build time, we forbid the caller from
  // re-introducing them by matching against every quarantine snapshot.
  const quarantineKeys = new Set(pack.quarantinedRows.map(q => quarantineKeyOf(q.rowSnapshot)))

  let rows = table.rows.filter(r => !quarantineKeys.has(rowKey(r)))
  if (opts.excludeRow) rows = rows.filter(r => !opts.excludeRow!(r))
  if (opts.limit != null) rows = rows.slice(0, opts.limit)

  const columnKeys = opts.columns ?? table.columns.map(c => c.key)
  const columns = columnKeys
    .map(k => table.columns.find(c => c.key === k))
    .filter(Boolean)
    .map(c => ({ key: c!.key, label: c!.label, align: c!.align ?? 'left', format: inferFormat(c!) }))

  const built: RankingTablePayload = {
    title:  opts.title ?? table.title,
    intro:  opts.intro,
    columns,
    rows:   rows.map(r => ({
      card: opts.cardFromRow ? opts.cardFromRow(r) : null,
      cells: r,
    })),
    source: `${table.source} (as of ${table.asOf})`,
    mode:  'snapshot',
    provenance: provFromPack(pack, [table.id]),
  }
  const validated = validateDataBlockPayload('ranking_table', built)
  if (!validated) throw new Error('ranking_table payload failed validation')
  return { type: 'data_block', variant: 'ranking_table', payload: validated }
}

function inferFormat(col: DataTable['columns'][number]): RankingTablePayload['columns'][number]['format'] {
  const k = col.key.toLowerCase()
  const l = col.label.toLowerCase()
  if (k.endsWith('usd') || l.includes('$') || /price/.test(k)) return 'usd'
  if (k.includes('pct') || l.includes('%') || /change|pct/.test(k)) return 'percent'
  if (k === 'gemrate' || /gem_rate|gem rate/.test(l)) return 'gem_rate'
  if (k.includes('date') || k.endsWith('asof') || /as of/.test(l)) return 'date'
  if (/^psa10$|^psa_10$|totalgraded|total_graded|^psa9$|^psa_9$/.test(k) || /pop|graded/.test(l)) return 'integer'
  if (k.includes('slug') || l.toLowerCase().includes('slug')) return 'url'
  return 'text'
}

/** Cheap stable identity for a row when we do not have a card slug —
 *  used to catch quarantined-row re-introduction. */
function rowKey(row: Record<string, string | number | null>): string {
  return JSON.stringify(row)
}
function quarantineKeyOf(snapshot: Record<string, string | number | null>): string {
  return JSON.stringify(snapshot)
}

// ─────────────────────────────────────────────────────────────────
// Raw / PSA comparison
// ─────────────────────────────────────────────────────────────────

export type CreateRawPsaComparisonOptions = {
  rows: Array<{
    card: CardIdentity
    rawCents?:   number | null
    psa9Cents?:  number | null
    psa10Cents?: number | null
    psa10Pop?:   number | null
    totalGraded?:number | null
  }>
  showRatios?: boolean
  title?:      string
}

export function createRawPsaComparisonFromResearch(pack: EvidencePack, opts: CreateRawPsaComparisonOptions): DataBlock<'raw_psa_comparison'> {
  // Block 5C regression protection — refuse to build an evidence-
  // backed grading comparison from a pack whose quality is blocked
  // OR whose recipe is grading-adjacent and marked research-required.
  const hasCritical = pack.warnings.some(w => w.severity === 'critical')
  if (pack.quality.status === 'blocked' || !pack.quality.publishable || hasCritical) {
    throw new Error('cannot create a raw/PSA comparison from a blocked or research-required pack — see quality.reasons')
  }
  const payload: RawPsaComparisonPayload = {
    title: opts.title,
    rows: opts.rows,
    showRatios: opts.showRatios === true,
    source: pack.internalSources.map(s => s.table).join(' + '),
    asOf: pack.dataAsOf,
    mode: 'snapshot',
    provenance: provFromPack(pack),
  }
  const v = validateDataBlockPayload('raw_psa_comparison', payload)
  if (!v) throw new Error('raw_psa_comparison payload failed validation')
  return { type: 'data_block', variant: 'raw_psa_comparison', payload: v }
}

// ─────────────────────────────────────────────────────────────────
// Price chart
// ─────────────────────────────────────────────────────────────────

export function createPriceChartSnapshot(input: {
  card: CardIdentity
  series: Array<'raw' | 'psa9' | 'psa10'>
  points: PriceChartPayload['points']
  title?: string
  asOf?: string
  provenance?: SnapshotProvenance
}): DataBlock<'price_chart'> {
  const payload: PriceChartPayload = {
    title: input.title,
    card:  input.card,
    series: input.series,
    mode:  'snapshot',
    points: input.points,
    asOf:   input.asOf,
    provenance: input.provenance,
  }
  const v = validateDataBlockPayload('price_chart', payload)
  if (!v) throw new Error('price_chart payload failed validation')
  return { type: 'data_block', variant: 'price_chart', payload: v }
}

export function createPriceChartLive(input: {
  card:   CardIdentity
  series: Array<'raw' | 'psa9' | 'psa10'>
  days?:  number
  title?: string
}): DataBlock<'price_chart'> {
  const payload: PriceChartPayload = {
    title:  input.title,
    card:   input.card,
    series: input.series,
    mode:   'live',
    points: [],
    days:   input.days ?? 180,
  }
  const v = validateDataBlockPayload('price_chart', payload)
  if (!v) throw new Error('price_chart (live) payload failed validation')
  return { type: 'data_block', variant: 'price_chart', payload: v }
}

// ─────────────────────────────────────────────────────────────────
// Card block / Set block
// ─────────────────────────────────────────────────────────────────

export function createCardBlock(input: {
  card: CardIdentity
  caption?: string
  show?: { raw?: boolean; psa9?: boolean; psa10?: boolean }
  mode?: 'live' | 'snapshot'
  snapshot?: CardBlockPayload['snapshot']
}): DataBlock<'card_block'> {
  const payload: CardBlockPayload = {
    card: input.card,
    caption: input.caption,
    show: { raw: input.show?.raw ?? true, psa9: input.show?.psa9 ?? false, psa10: input.show?.psa10 ?? true },
    mode: input.mode ?? 'live',
    snapshot: input.mode === 'snapshot' ? (input.snapshot ?? { asOf: new Date().toISOString().slice(0, 10) }) : undefined,
  }
  const v = validateDataBlockPayload('card_block', payload)
  if (!v) throw new Error('card_block payload failed validation')
  return { type: 'data_block', variant: 'card_block', payload: v }
}

export function createSetBlock(input: {
  set:      SetBlockPayload['set']
  caption?: string
  summary?: SetBlockPayload['summary']
  mode?:    'live' | 'snapshot'
}): DataBlock<'set_block'> {
  const payload: SetBlockPayload = {
    set: input.set,
    caption: input.caption,
    summary: input.summary,
    mode: input.mode ?? 'live',
  }
  const v = validateDataBlockPayload('set_block', payload)
  if (!v) throw new Error('set_block payload failed validation')
  return { type: 'data_block', variant: 'set_block', payload: v }
}
