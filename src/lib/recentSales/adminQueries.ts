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

export type AdminInspectionSnapshot = {
  generatedAt:      string
  importRuns:       ImportRunRow[]
  recentSales:      RecentSalesSummary
  perCard:          PerCardSummaryRow[]
  quarantine:       QuarantineSummary
  duplicateCheck:   DuplicateSaleKeyCheck
  latestSamples:    LatestSampleRow[]
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
  return rows.map(r => ({
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
    notes:           r.notes            == null ? null : String(r.notes),
  }))
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
// Combined snapshot — the only function the route handler needs.
// ─────────────────────────────────────────────────────────────────────

export async function readAdminInspectionSnapshot(
  supa: SupabaseClient,
): Promise<AdminInspectionSnapshot> {
  const [importRuns, recentSales, perCard, quarantine, duplicateCheck, latestSamples] = await Promise.all([
    getLatestImportRuns(supa, 20),
    getRecentSalesSummary(supa),
    getPerCardSummary(supa),
    getQuarantineSummary(supa),
    getDuplicateSaleKeyCheck(supa),
    getLatestSampleRows(supa, 25),
  ])
  return {
    generatedAt: new Date().toISOString(),
    importRuns,
    recentSales,
    perCard,
    quarantine,
    duplicateCheck,
    latestSamples,
  }
}
