// src/lib/recentSales/adminQueries.ts
// Block 4B-W-3A — server-only read queries for the recent-sales admin
// inspection surface. No PII anywhere — only marketplace facts the
// scraper has already observed, plus run-level counters.
//
// Designed to be small enough to fetch all rows into memory (the pilot
// allow-list is 58 cards / ~410 sales rows). When the cohort grows we
// move per-card aggregation into a SECURITY DEFINER RPC.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveGradeKey, type CardPageRecentSale } from './cardQueries'

// ─────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────

export type ImportRunRow = {
  id:              string
  provider:        string
  source:          string
  status:          string
  startedAt:       string
  completedAt:     string | null
  durationMs:      number | null
  pagesProcessed:  number
  rowsOk:          number
  rowsQuarantined: number
  rowsRejected:    number
  rowsDuplicate:   number
  parserVersion:   string | null
  layoutSignature: string | null
  notes:           string | null
  /** Parsed JSON view of `notes`. Null when notes is null, not JSON,
   *  or the JSON root is not an object. */
  notesParsed:     Record<string, unknown> | null
}

export type RecentSalesSummary = {
  totalRows:               number
  okRows:                  number
  activeRows:              number   // parse_status='ok' AND review_status='active'
  distinctProviderCards:   number
  distinctMarketplaces:    number
  bestOfferStatusBreakdown: Record<string, number>
  conditionBucketBreakdown: Record<string, number>
  rawOrGradedBreakdown:     Record<string, number>
  parseStatusBreakdown:     Record<string, number>
  reviewStatusBreakdown:    Record<string, number>
}

export type PerCardSummaryRow = {
  providerCardId:      string
  internalCardSlug:    string
  cardSlug:            string | null
  rowCount:            number
  latestSaleDate:      string | null
  marketplaceBreakdown: Record<string, number>
  rawCount:            number
  gradedCount:         number
}

export type QuarantineSummary = {
  quarantinedRowsInTable: number
  rejectedRowsInTable:    number
  runQuarantinedTotal:    number
  runRejectedTotal:       number
  latestQuarantineReasons: Array<{ reason: string | null; count: number }>
}

export type DuplicateSaleKeyCheck = {
  duplicateCount:   number
  duplicateSamples: Array<{ providerSaleKey: string; n: number }>
}

export type LatestSampleRow = {
  saleDate:           string
  marketplaceSource:  string
  marketplaceCountry: string | null
  providerCardId:     string
  internalCardSlug:   string
  observedSection:    string
  gradingCompany:     string | null
  grade:              string | null
  rawOrGraded:        string | null
  conditionBucket:    string | null
  bestOfferStatus:    string | null
  salePriceCents:     number
  parseStatus:        string
  reviewStatus:       string
  parseConfidence:    number
  firstSeenAt:        string
}

/**
 * Recognised import-run notes fields. Every field is optional — older
 * runs only emit a subset; future scraper versions may add more.
 * Anything not in this list is still shown via `extras`.
 */
export type ImportRunNotes = {
  // Pagination / scheduling
  allow_list_total?:        number
  offset?:                  number
  effective_offset?:        number
  batch_size?:              number
  selected_start?:          number
  selected_end?:            number

  // Grade-cap enforcement
  max_sales_per_grade?:     number
  rows_after_grade_cap?:    number
  rows_dropped_by_grade_cap?: number
  rows_pruned_old_active?:  number

  // Fetch counters
  fetched?:                 number
  cards_allowlisted?:       number
  cards_parsed?:            number
  rows_upserted?:           number

  // Failure counters
  skipped_429?:             number
  skipped_http_error?:      number
  skipped_no_html?:         number
  errors_count?:            number

  // Scraper-managed metadata
  import_type?:             string
}

export type GradeCapViolation = {
  internalCardSlug: string
  gradeKey:         string
  gradeLabel:       string
  activeRowCount:   number
}

export type FreshnessDistribution = {
  /** Latest sale_date observed among ok+active rows, or null. */
  anchorDate: string | null
  last7d:     number
  last30d:    number
  last90d:    number
  older:      number
}

export type RecentSalesHealth = {
  totalRows:           number
  okActiveRows:        number
  okSupersededRows:    number
  distinctActiveCards: number
  /** Buckets whose (internal_card_slug, gradeKey) active-row count
   *  exceeds the 5-per-grade cap. Should always be 0 after the cap
   *  enforcement is live. */
  gradeCapViolations: {
    cap:           number
    violationCount: number
    samples:       GradeCapViolation[]
  }
  /** Top 20 cards by ok+active row count, sorted desc. */
  topActiveCards: Array<{
    providerCardId:   string
    internalCardSlug: string
    rowCount:         number
    latestSaleDate:   string | null
  }>
  freshness: FreshnessDistribution
}

export type AffiliateMonitoringPanel = {
  /** Whether server-side storage for affiliate events exists. False
   *  today (analytics flows entirely to GA4 via gtag — see
   *  src/lib/analytics.ts) — so this panel is informational only. */
  available:    boolean
  /** Human-readable explanation of where events live. */
  source:       string
  /** Operator note about what is and isn't available. */
  note:         string
  /** Placement strings the operator can filter by in GA4. */
  placements:   string[]
}

export type AdminInspectionSnapshot = {
  generatedAt:        string
  importRuns:         ImportRunRow[]
  recentSales:        RecentSalesSummary
  recentSalesHealth:  RecentSalesHealth
  perCard:            PerCardSummaryRow[]
  quarantine:         QuarantineSummary
  duplicateCheck:     DuplicateSaleKeyCheck
  latestSamples:      LatestSampleRow[]
  affiliateMonitoring: AffiliateMonitoringPanel
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function bucket<T extends string | null | undefined>(
  rows: Array<{ key: T }>,
  nullLabel: string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const k = r.key == null ? nullLabel : String(r.key)
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

/**
 * Safely parse a `notes` blob. Returns null when the input is null/
 * empty, not valid JSON, or its root is not a plain object. The
 * scraper has historically emitted both plain-text strings and JSON
 * objects in this column, so the caller must tolerate either.
 * Exported for unit tests.
 */
export function parseRunNotes(raw: string | null): Record<string, unknown> | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed || trimmed[0] !== '{') return null
  try {
    const v = JSON.parse(trimmed)
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function diffDaysIso(a: string, b: string): number {
  // Inputs are YYYY-MM-DD ISO date strings. Returns floor((a - b) in days).
  const am = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a)
  const bm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b)
  if (!am || !bm) return Number.NaN
  const at = Date.UTC(+am[1], +am[2] - 1, +am[3])
  const bt = Date.UTC(+bm[1], +bm[2] - 1, +bm[3])
  return Math.floor((at - bt) / 86_400_000)
}

function gradeKeyForRawRow(r: Record<string, unknown>): { key: string; label: string } {
  // Reuse the same key derivation the card-page query uses so admin
  // violation counts line up exactly with what end users see in the
  // grade tabs.
  const synth: CardPageRecentSale = {
    saleDate:           '',
    marketplaceSource:  '',
    marketplaceCountry: null,
    observedSection:    '',
    rawOrGraded:        r.raw_or_graded   == null ? null : String(r.raw_or_graded),
    gradingCompany:     r.grading_company == null ? null : String(r.grading_company),
    grade:              r.grade           == null ? null : String(r.grade),
    conditionBucket:    null,
    conditionText:      null,
    bestOfferStatus:    null,
    salePriceCents:     0,
  }
  return deriveGradeKey(synth)
}

// ─────────────────────────────────────────────────────────────────────
// Individual queries (exported so the route can call selectively).
// ─────────────────────────────────────────────────────────────────────

export async function getLatestImportRuns(
  supa: SupabaseClient,
  limit = 20,
): Promise<ImportRunRow[]> {
  const { data, error } = await supa
    .from('market_import_runs')
    .select('id, provider, source, status, started_at, completed_at, duration_ms, pages_processed, rows_ok, rows_quarantined, rows_rejected, rows_duplicate, parser_version, layout_signature, notes')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`market_import_runs select failed: ${error.message}`)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows.map(r => {
    const notesRaw = r.notes == null ? null : String(r.notes)
    return {
      id:              String(r.id),
      provider:        String(r.provider),
      source:          String(r.source),
      status:          String(r.status),
      startedAt:       String(r.started_at),
      completedAt:     r.completed_at == null ? null : String(r.completed_at),
      durationMs:      r.duration_ms   == null ? null : Number(r.duration_ms),
      pagesProcessed:  Number(r.pages_processed  ?? 0),
      rowsOk:          Number(r.rows_ok          ?? 0),
      rowsQuarantined: Number(r.rows_quarantined ?? 0),
      rowsRejected:    Number(r.rows_rejected    ?? 0),
      rowsDuplicate:   Number(r.rows_duplicate   ?? 0),
      parserVersion:   r.parser_version   == null ? null : String(r.parser_version),
      layoutSignature: r.layout_signature == null ? null : String(r.layout_signature),
      notes:           notesRaw,
      notesParsed:     parseRunNotes(notesRaw),
    }
  })
}

export async function getRecentSalesSummary(supa: SupabaseClient): Promise<RecentSalesSummary> {
  const { data, error } = await supa
    .from('recent_sales')
    .select('provider_card_id, marketplace_source, best_offer_status, condition_bucket, raw_or_graded, parse_status, review_status')
  if (error) throw new Error(`recent_sales summary select failed: ${error.message}`)
  const rows = (data ?? []) as Array<Record<string, unknown>>

  const providerCardIds = new Set<string>()
  const marketplaces    = new Set<string>()
  for (const r of rows) {
    providerCardIds.add(String(r.provider_card_id))
    marketplaces   .add(String(r.marketplace_source))
  }

  const okRows     = rows.filter(r => r.parse_status === 'ok').length
  const activeRows = rows.filter(r => r.parse_status === 'ok' && r.review_status === 'active').length

  return {
    totalRows:               rows.length,
    okRows,
    activeRows,
    distinctProviderCards:   providerCardIds.size,
    distinctMarketplaces:    marketplaces.size,
    bestOfferStatusBreakdown: bucket(rows.map(r => ({ key: r.best_offer_status as string | null })), '(null)'),
    conditionBucketBreakdown: bucket(rows.map(r => ({ key: r.condition_bucket  as string | null })), '(null)'),
    rawOrGradedBreakdown:     bucket(rows.map(r => ({ key: r.raw_or_graded     as string | null })), '(null)'),
    parseStatusBreakdown:     bucket(rows.map(r => ({ key: r.parse_status      as string })),       '(null)'),
    reviewStatusBreakdown:    bucket(rows.map(r => ({ key: r.review_status     as string })),       '(null)'),
  }
}

export async function getPerCardSummary(supa: SupabaseClient): Promise<PerCardSummaryRow[]> {
  const { data, error } = await supa
    .from('recent_sales')
    .select('provider_card_id, internal_card_slug, card_slug, marketplace_source, raw_or_graded, sale_date')
    .eq('parse_status', 'ok')
    .eq('review_status', 'active')
  if (error) throw new Error(`recent_sales per-card select failed: ${error.message}`)
  const rows = (data ?? []) as Array<Record<string, unknown>>

  const grouped = new Map<string, {
    providerCardId:   string
    internalCardSlug: string
    cardSlug:         string | null
    rowCount:         number
    latestSaleDate:   string | null
    marketplaceBreakdown: Record<string, number>
    rawCount:         number
    gradedCount:      number
  }>()
  for (const r of rows) {
    const pcid = String(r.provider_card_id)
    const slug = String(r.internal_card_slug)
    const key  = `${pcid}|${slug}`
    let g = grouped.get(key)
    if (!g) {
      g = {
        providerCardId:   pcid,
        internalCardSlug: slug,
        cardSlug:         r.card_slug == null ? null : String(r.card_slug),
        rowCount:         0,
        latestSaleDate:   null,
        marketplaceBreakdown: {},
        rawCount:         0,
        gradedCount:      0,
      }
      grouped.set(key, g)
    }
    g.rowCount++
    const sd = r.sale_date == null ? null : String(r.sale_date)
    if (sd && (g.latestSaleDate == null || sd > g.latestSaleDate)) g.latestSaleDate = sd
    const m = String(r.marketplace_source)
    g.marketplaceBreakdown[m] = (g.marketplaceBreakdown[m] ?? 0) + 1
    if (r.raw_or_graded === 'raw')    g.rawCount++
    if (r.raw_or_graded === 'graded') g.gradedCount++
  }
  return Array.from(grouped.values()).sort((a, b) => b.rowCount - a.rowCount)
}

export async function getQuarantineSummary(supa: SupabaseClient): Promise<QuarantineSummary> {
  // (a) rows in recent_sales by parse_status
  const { data: psData, error: psErr } = await supa
    .from('recent_sales')
    .select('parse_status, rejection_reason')
  if (psErr) throw new Error(`recent_sales parse_status select failed: ${psErr.message}`)
  const psRows = (psData ?? []) as Array<Record<string, unknown>>
  const quarantinedRowsInTable = psRows.filter(r => r.parse_status === 'quarantined').length
  const rejectedRowsInTable    = psRows.filter(r => r.parse_status === 'rejected').length

  const reasonCounts = new Map<string | null, number>()
  for (const r of psRows) {
    if (r.parse_status === 'quarantined' || r.parse_status === 'rejected') {
      const reason = r.rejection_reason == null ? null : String(r.rejection_reason)
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1)
    }
  }
  const latestQuarantineReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  // (b) run-level counters (since quarantined/rejected rows are not always persisted)
  const { data: runData, error: runErr } = await supa
    .from('market_import_runs')
    .select('rows_quarantined, rows_rejected')
  if (runErr) throw new Error(`market_import_runs quarantine sum select failed: ${runErr.message}`)
  const runRows = (runData ?? []) as Array<Record<string, unknown>>
  const runQuarantinedTotal = runRows.reduce((acc, r) => acc + Number(r.rows_quarantined ?? 0), 0)
  const runRejectedTotal    = runRows.reduce((acc, r) => acc + Number(r.rows_rejected    ?? 0), 0)

  return {
    quarantinedRowsInTable,
    rejectedRowsInTable,
    runQuarantinedTotal,
    runRejectedTotal,
    latestQuarantineReasons,
  }
}

export async function getDuplicateSaleKeyCheck(supa: SupabaseClient): Promise<DuplicateSaleKeyCheck> {
  // provider_sale_key is UNIQUE in the schema — this query must
  // return zero. We surface it explicitly so the operator can prove
  // the invariant from the panel.
  const { data, error } = await supa
    .from('recent_sales')
    .select('provider_sale_key')
  if (error) throw new Error(`recent_sales sale_key check failed: ${error.message}`)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const counts = new Map<string, number>()
  for (const r of rows) {
    const k = String(r.provider_sale_key)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const dups: Array<{ providerSaleKey: string; n: number }> = []
  for (const [k, n] of Array.from(counts.entries())) {
    if (n > 1) dups.push({ providerSaleKey: k, n })
  }
  dups.sort((a, b) => b.n - a.n)
  return {
    duplicateCount:   dups.length,
    duplicateSamples: dups.slice(0, 10),
  }
}

export async function getLatestSampleRows(
  supa: SupabaseClient,
  limit = 25,
): Promise<LatestSampleRow[]> {
  const { data, error } = await supa
    .from('recent_sales')
    .select('sale_date, marketplace_source, marketplace_country, provider_card_id, internal_card_slug, observed_section, grading_company, grade, raw_or_graded, condition_bucket, best_offer_status, sale_price_cents, parse_status, review_status, parse_confidence, first_seen_at')
    .order('first_seen_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`recent_sales latest samples select failed: ${error.message}`)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows.map(r => ({
    saleDate:           String(r.sale_date),
    marketplaceSource:  String(r.marketplace_source),
    marketplaceCountry: r.marketplace_country == null ? null : String(r.marketplace_country),
    providerCardId:     String(r.provider_card_id),
    internalCardSlug:   String(r.internal_card_slug),
    observedSection:    String(r.observed_section),
    gradingCompany:     r.grading_company == null ? null : String(r.grading_company),
    grade:              r.grade           == null ? null : String(r.grade),
    rawOrGraded:        r.raw_or_graded   == null ? null : String(r.raw_or_graded),
    conditionBucket:    r.condition_bucket== null ? null : String(r.condition_bucket),
    bestOfferStatus:    r.best_offer_status == null ? null : String(r.best_offer_status),
    salePriceCents:     Number(r.sale_price_cents),
    parseStatus:        String(r.parse_status),
    reviewStatus:       String(r.review_status),
    parseConfidence:    Number(r.parse_confidence ?? 0),
    firstSeenAt:        String(r.first_seen_at),
  }))
}

// ─────────────────────────────────────────────────────────────────────
// Recent-sales health — combines violation, freshness and top-cards.
// ─────────────────────────────────────────────────────────────────────

const GRADE_CAP = 5

export async function getRecentSalesHealth(supa: SupabaseClient): Promise<RecentSalesHealth> {
  // Two reads in parallel:
  //   * count(*) so the panel reports total rows (incl. non-ok) without
  //     pulling them
  //   * the ok rows themselves so we can compute violations / freshness
  //     / top-cards in one pass without per-card round-trips.
  // PII is unaffected — only marketplace facts and slugs are read.
  const [totalRes, okRes] = await Promise.all([
    supa.from('recent_sales').select('*', { count: 'exact', head: true }),
    supa.from('recent_sales')
      .select('internal_card_slug, provider_card_id, sale_date, raw_or_graded, grading_company, grade, review_status')
      .eq('parse_status', 'ok'),
  ])
  if (totalRes.error) throw new Error(`recent_sales total count failed: ${totalRes.error.message}`)
  if (okRes.error)    throw new Error(`recent_sales ok pull failed: ${okRes.error.message}`)
  const totalRows = totalRes.count ?? 0
  const rows = (okRes.data ?? []) as Array<Record<string, unknown>>

  const activeRows = rows.filter(r => r.review_status === 'active')
  const supersededRows = rows.filter(r => r.review_status === 'superseded')

  // Distinct active cards
  const activeSlugs = new Set<string>()
  for (const r of activeRows) activeSlugs.add(String(r.internal_card_slug))

  // Grade-cap violations (active only). Bucket on (internal_card_slug, gradeKey).
  const bucketCounts = new Map<string, { internalCardSlug: string; gradeKey: string; gradeLabel: string; activeRowCount: number }>()
  for (const r of activeRows) {
    const slug = String(r.internal_card_slug)
    const { key, label } = gradeKeyForRawRow(r)
    const k = `${slug}|${key}`
    const existing = bucketCounts.get(k)
    if (existing) existing.activeRowCount++
    else bucketCounts.set(k, { internalCardSlug: slug, gradeKey: key, gradeLabel: label, activeRowCount: 1 })
  }
  const violations = Array.from(bucketCounts.values())
    .filter(b => b.activeRowCount > GRADE_CAP)
    .sort((a, b) => b.activeRowCount - a.activeRowCount)

  // Top 20 active cards
  const perCardCounts = new Map<string, { providerCardId: string; internalCardSlug: string; rowCount: number; latestSaleDate: string | null }>()
  for (const r of activeRows) {
    const slug = String(r.internal_card_slug)
    const pcid = String(r.provider_card_id)
    const k = `${pcid}|${slug}`
    let g = perCardCounts.get(k)
    if (!g) {
      g = { providerCardId: pcid, internalCardSlug: slug, rowCount: 0, latestSaleDate: null }
      perCardCounts.set(k, g)
    }
    g.rowCount++
    const sd = r.sale_date == null ? null : String(r.sale_date)
    if (sd && (g.latestSaleDate == null || sd > g.latestSaleDate)) g.latestSaleDate = sd
  }
  const topActiveCards = Array.from(perCardCounts.values())
    .sort((a, b) => b.rowCount - a.rowCount)
    .slice(0, 20)

  // Freshness — anchor on max sale_date of active rows, NOT Date.now(),
  // so a stalled scraper does not mislead the panel into reporting
  // "all old". Buckets are mutually exclusive.
  let anchor: string | null = null
  for (const r of activeRows) {
    const sd = r.sale_date == null ? null : String(r.sale_date)
    if (sd && (anchor == null || sd > anchor)) anchor = sd
  }
  const freshness: FreshnessDistribution = { anchorDate: anchor, last7d: 0, last30d: 0, last90d: 0, older: 0 }
  if (anchor) {
    for (const r of activeRows) {
      const sd = r.sale_date == null ? null : String(r.sale_date)
      if (!sd) { freshness.older++; continue }
      const d = diffDaysIso(anchor, sd)
      if (!Number.isFinite(d)) { freshness.older++; continue }
      if      (d <= 7)  freshness.last7d++
      else if (d <= 30) freshness.last30d++
      else if (d <= 90) freshness.last90d++
      else              freshness.older++
    }
  }

  return {
    totalRows,
    okActiveRows:        activeRows.length,
    okSupersededRows:    supersededRows.length,
    distinctActiveCards: activeSlugs.size,
    gradeCapViolations: {
      cap:            GRADE_CAP,
      violationCount: violations.length,
      samples:        violations.slice(0, 10),
    },
    topActiveCards,
    freshness,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Affiliate monitoring — informational panel only.
// ─────────────────────────────────────────────────────────────────────

const AFFILIATE_PLACEMENTS = [
  'recent_sales_all',
  'recent_sales_raw',
  'recent_sales_psa10',
  'recent_sales_psa9',
  'recent_sales_psa8',
  'recent_sales_psa_7',
  'recent_sales_cgc_10',
  'recent_sales_bgs_9_5',
  'recent_sales_graded',
]

export function getAffiliateMonitoringPanel(): AffiliateMonitoringPanel {
  return {
    available:  false,
    source:    'Google Analytics 4 (gtag) — no server-side persistence',
    note:      'affiliate_link_view and affiliate_click events are sent client-side to GA4 only (see src/lib/analytics.ts). No Supabase table stores them, so click-through rates can only be inspected in GA4. Filter by event "affiliate_click" with placement starting "recent_sales_".',
    placements: AFFILIATE_PLACEMENTS,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Combined snapshot — the only function the route handler needs.
// ─────────────────────────────────────────────────────────────────────

export async function readAdminInspectionSnapshot(
  supa: SupabaseClient,
): Promise<AdminInspectionSnapshot> {
  const [importRuns, recentSales, recentSalesHealth, perCard, quarantine, duplicateCheck, latestSamples] = await Promise.all([
    getLatestImportRuns(supa, 20),
    getRecentSalesSummary(supa),
    getRecentSalesHealth(supa),
    getPerCardSummary(supa),
    getQuarantineSummary(supa),
    getDuplicateSaleKeyCheck(supa),
    getLatestSampleRows(supa, 25),
  ])
  return {
    generatedAt: new Date().toISOString(),
    importRuns,
    recentSales,
    recentSalesHealth,
    perCard,
    quarantine,
    duplicateCheck,
    latestSamples,
    affiliateMonitoring: getAffiliateMonitoringPanel(),
  }
}
