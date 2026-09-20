// src/lib/seo/admin/loadMissionControl.ts
// ============================================================================
// Server-only data loader for /admin/seo.
//
// Aggregates the six SEO tables into a single MissionControlPayload the
// client can render without further round-trips. Every metric is read
// or derived from real DB rows — nothing is fabricated.
//
// Read strategy
//   PostgREST aggregate functions are disabled on this project (see
//   scripts/seo/refresh-rollups-and-kpi.mjs's rationale), so we page
//   through tables and aggregate in Node.js instead of calling SQL
//   aggregates. All paged reads run in parallel where safe.
//
//   Approximate cardinalities:
//     * seo_kpi_daily             ~30 rows for source=google — read all
//     * seo_gsc_page_daily         ~146k rows since 2026-08-19 —
//                                  paged (1k/page), aggregated to
//                                  per-date totals
//     * seo_page_rollups           ~27k rows for source=google — paged
//     * seo_pages                  ~66k rows                  — paged
//     * seo_bq_ingest_runs         small; latest by started_at DESC
//
// Every read filters (site_key, source) explicitly.
// ============================================================================

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import type {
  MissionControlPayload, LatestKpi, DailyPoint, PeriodTotals,
  MomentumBlock, PageTypeRow, TopPageRow, PageTypeKey, PageTypeBucketKey,
  FunnelBlock, VisibilityBlock, DataHealthBlock, ReconciliationBlock,
} from './types'

const SITE_KEY = 'pokeprices'
const SOURCE   = 'google'
const TARGET_DATE = '2026-12-25'
const TARGET_MIN  = 4000
const TARGET_MAX  = 5000
const BQ_EXPORT_STARTED_ON = '2026-09-16'   // annotation for the chart

// Canonical URL constants — mirror scripts/seo/refresh-page-registry.mjs
// exactly. Do NOT invent a second normalisation model; the registry
// writes canonical URLs under these rules and the dashboard must join
// against those same canonicals.
const CANONICAL_ORIGIN = 'https://www.pokeprices.io'
const CANONICAL_HOST   = 'www.pokeprices.io'

/** Fold a raw GSC/rollup URL to the same canonical form used by
 *  seo_pages. Returns null when the URL is not one of ours (wrong host
 *  or unparseable). Mirrors refresh-page-registry.mjs canonicaliseUrl. */
function canonicaliseUrl(u: string | null | undefined): string | null {
  if (typeof u !== 'string' || u.length === 0) return null
  try {
    const parsed = new URL(u)
    if (parsed.host !== CANONICAL_HOST && parsed.host !== 'pokeprices.io') return null
    let p = parsed.pathname || '/'
    if (p !== '/' && p.endsWith('/')) p = p.slice(0, -1)
    return `${CANONICAL_ORIGIN}${p}`
  } catch {
    return null
  }
}

// ── date helpers ─────────────────────────────────────────────────────────
function isoDay(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10)
  const yr = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dy = String(d.getUTCDate()).padStart(2, '0')
  return `${yr}-${mo}-${dy}`
}
function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + n * 86400_000
  return isoDay(new Date(t))
}
function daysBetween(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split('-').map(Number)
  const [y2, m2, d2] = toISO.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400_000)
}

// ── generic paged reader ─────────────────────────────────────────────────
async function pagedRead<Row>(
  builder: (offset: number, chunk: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>,
  chunk = 1000,
): Promise<Row[]> {
  const rows: Row[] = []
  let offset = 0
  while (true) {
    const { data, error } = await builder(offset, chunk)
    if (error) throw new Error(`pagedRead failed at offset ${offset}: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < chunk) break
    offset += chunk
  }
  return rows
}

// ── individual section loaders ───────────────────────────────────────────

async function loadLatestKpi(): Promise<LatestKpi | null> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('seo_kpi_daily')
    .select('*')
    .eq('site_key', SITE_KEY)
    .eq('source', SOURCE)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`loadLatestKpi: ${error.message}`)
  if (!data) return null
  const clicks = Number(data.clicks_28d ?? 0)
  const impr = Number(data.impressions_28d ?? 0)
  const sp = data.sum_position_28d == null ? null : Number(data.sum_position_28d)
  return {
    as_of_date: isoDay(data.date),
    clicks_28d: clicks,
    impressions_28d: impr,
    pages_with_impressions_28d: Number(data.pages_with_impressions_28d ?? 0),
    pages_ge1_click_28d:  Number(data.pages_ge1_click_28d  ?? 0),
    pages_ge10_click_28d: Number(data.pages_ge10_click_28d ?? 0),
    pages_ge28_click_28d: Number(data.pages_ge28_click_28d ?? 0),
    total_urls_known: Number(data.total_urls_known ?? 0),
    urls_indexable:   Number(data.urls_indexable   ?? 0),
    urls_in_sitemap:  Number(data.urls_in_sitemap  ?? 0),
    sum_position_28d: sp,
    ctr_28d:          impr > 0 ? clicks / impr : null,
    avg_position_28d: (sp != null && impr > 0) ? (sp / impr) + 1 : null,
    refreshed_at: (data.refreshed_at as string | null) ?? null,
  }
}

/** Latest date in seo_gsc_page_daily (may lag or lead the KPI date). */
async function loadLatestGscDate(): Promise<{ date: string | null; source: 'google' | null }> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('seo_gsc_page_daily')
    .select('date')
    .eq('site_key', SITE_KEY)
    .eq('source', SOURCE)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`loadLatestGscDate: ${error.message}`)
  return { date: data ? isoDay(data.date) : null, source: data ? 'google' : null }
}

/** Per-day aggregates of seo_gsc_page_daily. Paged + summed in Node.
 *  Ordered by (date, url) so pagination is stable — a `.order('date')`
 *  alone lets rows with the same date shuffle across page boundaries,
 *  duplicating some and skipping others, which produces phantom
 *  inflated totals. seo_gsc_page_daily.PK is (site_key, source, url,
 *  date) so (date, url) is a unique sort key within our filter. */
async function loadDailyTrend(): Promise<DailyPoint[]> {
  const supa = getSupabaseServiceClient()
  const rows = await pagedRead<{ date: string; url: string; impressions: number; clicks: number; sum_position: number }>(
    async (offset, chunk) => {
      const res = await supa
        .from('seo_gsc_page_daily')
        .select('date, url, impressions, clicks, sum_position')
        .eq('site_key', SITE_KEY)
        .eq('source', SOURCE)
        .order('date', { ascending: true })
        .order('url', { ascending: true })
        .range(offset, offset + chunk - 1)
      return { data: res.data as any, error: res.error }
    },
  )
  const byDate = new Map<string, { imp: number; clk: number; sp: number }>()
  for (const r of rows) {
    const key = isoDay(r.date)
    const acc = byDate.get(key) ?? { imp: 0, clk: 0, sp: 0 }
    acc.imp += Number(r.impressions || 0)
    acc.clk += Number(r.clicks || 0)
    acc.sp  += Number(r.sum_position || 0)
    byDate.set(key, acc)
  }
  const points: DailyPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      clicks: v.clk,
      impressions: v.imp,
      ctr: v.imp > 0 ? v.clk / v.imp : null,
      avg_position: v.imp > 0 ? (v.sp / v.imp) + 1 : null,
    }))
  return points
}

/** Momentum: current 7d window vs previous 7d window, ending at the
 *  latest date that has data. */
function computeMomentum(daily: DailyPoint[]): MomentumBlock | null {
  if (daily.length === 0) return null
  const latest = daily[daily.length - 1].date
  const cur_from  = addDaysISO(latest, -6)
  const prev_to   = addDaysISO(latest, -7)
  const prev_from = addDaysISO(latest, -13)
  const sum = (a: string, b: string): PeriodTotals => {
    let imp = 0, clk = 0, sp = 0, days = 0
    for (const d of daily) {
      if (d.date >= a && d.date <= b) {
        imp += d.impressions; clk += d.clicks
        // sum_position stored only via imp * (avg - 1); recover it
        if (d.avg_position != null && d.impressions > 0) {
          sp += (d.avg_position - 1) * d.impressions
        }
        days++
      }
    }
    return {
      from: a, to: b, days,
      impressions: imp, clicks: clk, sum_position: sp,
      ctr: imp > 0 ? clk / imp : null,
      avg_position: imp > 0 ? sp / imp + 1 : null,
    }
  }
  const cur = sum(cur_from, latest)
  const prev = sum(prev_from, prev_to)
  const pct = (nowV: number, prevV: number): number | null => {
    if (prevV === 0) return nowV === 0 ? 0 : null
    return (nowV - prevV) / prevV * 100
  }
  return {
    current: cur,
    previous: prev,
    click_pct_change:      pct(cur.clicks, prev.clicks),
    impression_pct_change: pct(cur.impressions, prev.impressions),
    ctr_delta:             (cur.ctr != null && prev.ctr != null) ? (cur.ctr - prev.ctr) : null,
    avg_position_delta:    (cur.avg_position != null && prev.avg_position != null) ? (cur.avg_position - prev.avg_position) : null,
  }
}

type PageRow    = { url: string; page_type: string; entity_id: string | null }
type RollupRow  = {
  url: string
  clicks_7d: number
  clicks_28d: number
  impressions_7d: number
  impressions_28d: number
  sum_position_28d: number | null
  productive_28d: boolean
}

async function loadPagesMap(): Promise<Map<string, PageRow>> {
  const supa = getSupabaseServiceClient()
  const rows = await pagedRead<PageRow>(async (offset, chunk) => {
    const res = await supa
      .from('seo_pages')
      .select('url, page_type, entity_id')
      .eq('site_key', SITE_KEY)
      .order('url', { ascending: true })
      .range(offset, offset + chunk - 1)
    return { data: res.data as any, error: res.error }
  })
  const m = new Map<string, PageRow>()
  for (const r of rows) m.set(r.url, r)
  return m
}

async function loadRollups(): Promise<RollupRow[]> {
  const supa = getSupabaseServiceClient()
  // Order by `url` (which is unique per row within our filter — the PK
  // of seo_page_rollups is (site_key, source, url)) so pagination is
  // stable. Ordering by clicks_28d desc alone was NOT stable — most
  // rows share the same clicks_28d (usually 0) and rows shuffle across
  // page boundaries, producing phantom duplicated/skipped rows.
  return pagedRead<RollupRow>(async (offset, chunk) => {
    const res = await supa
      .from('seo_page_rollups')
      .select('url, clicks_7d, clicks_28d, impressions_7d, impressions_28d, sum_position_28d, productive_28d')
      .eq('site_key', SITE_KEY)
      .eq('source', SOURCE)
      .order('url', { ascending: true })
      .range(offset, offset + chunk - 1)
    return { data: res.data as any, error: res.error }
  })
}

/** Canonical-URL-keyed aggregate of one or more rollup rows. */
type CanonicalRollup = {
  canonical_url: string
  raw_urls: string[]                  // one or more raw variants folded here
  clicks_7d: number
  clicks_28d: number
  impressions_7d: number
  impressions_28d: number
  sum_position_28d: number
  productive_28d: boolean             // recomputed from summed clicks
}

/**
 * Fold raw rollup URLs to canonical form and sum any duplicates. This
 * matters because seo_page_rollups is keyed on the RAW URL that was
 * ingested from GSC — non-www and query-string variants show up as
 * separate rollup rows even though they represent the same page. The
 * dashboard must dedup to the same canonical form the registry uses
 * or the page-type totals over-count.
 */
function canonicalisRollups(rollups: RollupRow[]): {
  canonical: Map<string, CanonicalRollup>
  parseFailedRows: RollupRow[]
} {
  const canonical = new Map<string, CanonicalRollup>()
  const parseFailedRows: RollupRow[] = []
  for (const r of rollups) {
    const c = canonicaliseUrl(r.url)
    if (!c) { parseFailedRows.push(r); continue }
    const entry = canonical.get(c) ?? {
      canonical_url: c, raw_urls: [],
      clicks_7d: 0, clicks_28d: 0,
      impressions_7d: 0, impressions_28d: 0,
      sum_position_28d: 0, productive_28d: false,
    }
    entry.raw_urls.push(r.url)
    entry.clicks_7d       += Number(r.clicks_7d ?? 0)
    entry.clicks_28d      += Number(r.clicks_28d ?? 0)
    entry.impressions_7d  += Number(r.impressions_7d ?? 0)
    entry.impressions_28d += Number(r.impressions_28d ?? 0)
    entry.sum_position_28d += Number(r.sum_position_28d ?? 0)
    canonical.set(c, entry)
  }
  // Recompute productive_28d from the deduped click totals so it stays
  // consistent with the summed value (a URL might cross the 28-click
  // threshold only after its variants are combined).
  canonical.forEach(e => { e.productive_28d = e.clicks_28d >= 28 })
  return { canonical, parseFailedRows }
}

/** Join canonical-deduped rollups with seo_pages + rank by page_type.
 *  Every canonical rollup lands in exactly one bucket — either the
 *  page's `page_type` from the registry, or the explicit `unmatched`
 *  bucket. Nothing is silently dropped. */
function computePageTypeBreakdown(
  pagesByUrl: Map<string, PageRow>,
  canonicalRollups: Map<string, CanonicalRollup>,
): { rows: PageTypeRow[]; topPages: TopPageRow[]; unmatched: {
    visible: number; clicks: number; impressions: number; page_lookup_fails: number
  } } {
  const perType = new Map<PageTypeBucketKey, PageTypeRow>()

  // urls_known counted across the whole registry per page_type.
  const knownByType = new Map<PageTypeKey, number>()
  pagesByUrl.forEach(p => {
    const pt = p.page_type as PageTypeKey
    knownByType.set(pt, (knownByType.get(pt) ?? 0) + 1)
  })

  const unmatched = { visible: 0, clicks: 0, impressions: 0, page_lookup_fails: 0 }

  const empty = (page_type: PageTypeBucketKey, urls_known: number): PageTypeRow => ({
    page_type, urls_known, urls_visible_28d: 0,
    clicks_28d: 0, impressions_28d: 0, sum_position_28d: 0,
    productive_28d: 0, ctr_28d: null, avg_position_28d: null,
  })

  canonicalRollups.forEach(entry => {
    const page = pagesByUrl.get(entry.canonical_url)
    const pt: PageTypeBucketKey =
      page ? (page.page_type as PageTypeKey) : 'unmatched'
    if (!page) {
      unmatched.page_lookup_fails++
      unmatched.clicks      += entry.clicks_28d
      unmatched.impressions += entry.impressions_28d
      if (entry.impressions_28d > 0) unmatched.visible++
    }
    const acc = perType.get(pt) ?? empty(
      pt,
      pt === 'unmatched' ? 0 : (knownByType.get(pt as PageTypeKey) ?? 0),
    )
    if (entry.impressions_28d > 0) acc.urls_visible_28d++
    acc.clicks_28d       += entry.clicks_28d
    acc.impressions_28d  += entry.impressions_28d
    acc.sum_position_28d += entry.sum_position_28d
    if (entry.productive_28d) acc.productive_28d++
    perType.set(pt, acc)
  })

  // Registry page_types that carry no rollup rows still appear with
  // zero visibility metrics — makes the "known URLs" column honest.
  knownByType.forEach((known, pt) => {
    if (!perType.has(pt)) perType.set(pt, empty(pt, known))
  })

  const rows = Array.from(perType.values())
    .map(a => ({
      ...a,
      ctr_28d: a.impressions_28d > 0 ? a.clicks_28d / a.impressions_28d : null,
      avg_position_28d: a.impressions_28d > 0 ? (a.sum_position_28d / a.impressions_28d) + 1 : null,
    }))
    .sort((a, b) => b.clicks_28d - a.clicks_28d || b.impressions_28d - a.impressions_28d)

  // Top pages ranked by 28d clicks, then impressions. Uses canonical
  // rollups so www/non-www variants of the same page count once.
  const top: TopPageRow[] = Array.from(canonicalRollups.values())
    .sort((a, b) => b.clicks_28d - a.clicks_28d || b.impressions_28d - a.impressions_28d)
    .slice(0, 20)
    .map(entry => {
      const page = pagesByUrl.get(entry.canonical_url)
      const pt: PageTypeBucketKey =
        page ? (page.page_type as PageTypeKey) : 'unmatched'
      const imp = entry.impressions_28d
      const clk = entry.clicks_28d
      const sp = entry.sum_position_28d
      return {
        url: entry.canonical_url,
        raw_urls: entry.raw_urls,
        page_type: pt,
        entity_id: page?.entity_id ?? null,
        clicks_28d: clk,
        impressions_28d: imp,
        sum_position_28d: sp,
        ctr_28d: imp > 0 ? clk / imp : null,
        avg_position_28d: imp > 0 ? sp / imp + 1 : null,
        productive_28d: entry.productive_28d,
      }
    })

  return { rows, topPages: top, unmatched }
}

/** Full pages+rollups+in_sitemap join for the visibility block. Small
 *  extra fetch on seo_pages (in_sitemap column) — we only paged
 *  page_type + entity_id above. */
async function loadInSitemapFlags(): Promise<Map<string, boolean>> {
  const supa = getSupabaseServiceClient()
  const rows = await pagedRead<{ url: string; in_sitemap: boolean }>(async (offset, chunk) => {
    const res = await supa
      .from('seo_pages')
      .select('url, in_sitemap')
      .eq('site_key', SITE_KEY)
      .order('url', { ascending: true })
      .range(offset, offset + chunk - 1)
    return { data: res.data as any, error: res.error }
  })
  const m = new Map<string, boolean>()
  for (const r of rows) m.set(r.url, !!r.in_sitemap)
  return m
}

async function loadRegistryLastSeenMax(): Promise<string | null> {
  const supa = getSupabaseServiceClient()
  const { data, error } = await supa
    .from('seo_pages')
    .select('last_seen_at')
    .eq('site_key', SITE_KEY)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`loadRegistryLastSeenMax: ${error.message}`)
  return (data?.last_seen_at as string | undefined) ?? null
}

async function loadDataHealth(kpi: LatestKpi | null, latestGscDate: string | null, registrySize: number): Promise<DataHealthBlock> {
  const supa = getSupabaseServiceClient()
  const registry_last_seen_max = await loadRegistryLastSeenMax()

  const { data: lastRun, error: e1 } = await supa
    .from('seo_bq_ingest_runs')
    .select('started_at, ended_at, job_kind, source, status')
    .eq('site_key', SITE_KEY)
    .eq('status', 'ok')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (e1) throw new Error(`data health (last ok): ${e1.message}`)

  const since = new Date(Date.now() - 14 * 86400_000).toISOString()
  const { data: fails, error: e2 } = await supa
    .from('seo_bq_ingest_runs')
    .select('started_at, ended_at, job_kind, source, error, status')
    .eq('site_key', SITE_KEY)
    .in('status', ['error', 'aborted_budget'])
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(10)
  if (e2) throw new Error(`data health (failures): ${e2.message}`)

  return {
    latest_gsc_date: latestGscDate,
    latest_gsc_date_source: latestGscDate ? 'google' : null,
    latest_kpi_date: kpi?.as_of_date ?? null,
    latest_kpi_refreshed_at: kpi?.refreshed_at ?? null,
    latest_ingest_at: (lastRun?.ended_at ?? lastRun?.started_at) as string | null,
    latest_ingest_kind: (lastRun?.job_kind as string | undefined) ?? null,
    latest_ingest_status: (lastRun?.status as string | undefined) ?? null,
    registry_size: registrySize,
    registry_last_seen_max,
    recent_failures: (fails ?? []).map(r => ({
      started_at: r.started_at as string,
      ended_at:   (r.ended_at as string | null) ?? null,
      job_kind:   r.job_kind as string,
      source:     r.source as string,
      error:      (r.error as string | null) ?? null,
    })),
  }
}

// ── main entry point ─────────────────────────────────────────────────────

export async function loadMissionControl(): Promise<MissionControlPayload> {
  // Parallel A: the small, fast reads.
  const [kpi, latestGscInfo] = await Promise.all([
    loadLatestKpi(),
    loadLatestGscDate(),
  ])
  if (!kpi) throw new Error('loadMissionControl: no seo_kpi_daily row for google/pokeprices')

  // Parallel B: the large paged reads. Independent of each other.
  const [daily, pagesByUrl, rollups, inSitemapFlags] = await Promise.all([
    loadDailyTrend(),
    loadPagesMap(),
    loadRollups(),
    loadInSitemapFlags(),
  ])

  // Fold www / non-www / query-string variants of the same URL to the
  // single canonical form used by seo_pages. Every downstream aggregate
  // (page-type breakdown, top pages, visibility, reconciliation) works
  // off `canonicalRollups` — no raw-URL lookups against seo_pages.
  const { canonical: canonicalRollups, parseFailedRows } = canonicalisRollups(rollups)

  const { rows: page_types, topPages, unmatched } =
    computePageTypeBreakdown(pagesByUrl, canonicalRollups)

  // Visibility block — join canonical rollups with the registry so
  // www/non-www duplicates in the rollup table don't inflate the
  // "known URLs with zero visibility" count.
  let known_zero_visibility = 0
  let sitemap_zero_visibility = 0
  let visible_no_clicks = 0
  let visible_ge1_click = 0
  let visible_productive = 0
  pagesByUrl.forEach(p => {
    const r = canonicalRollups.get(p.url)
    const impressions_28d = r ? r.impressions_28d : 0
    const clicks_28d      = r ? r.clicks_28d      : 0
    const in_sitemap      = !!inSitemapFlags.get(p.url)
    if (impressions_28d === 0) {
      known_zero_visibility++
      if (in_sitemap) sitemap_zero_visibility++
    } else {
      if (clicks_28d === 0) visible_no_clicks++
      if (clicks_28d >= 1)  visible_ge1_click++
      if (clicks_28d >= 28) visible_productive++
    }
  })
  const visibility: VisibilityBlock = {
    known_zero_visibility,
    sitemap_zero_visibility,
    visible_no_clicks, visible_ge1_click, visible_productive,
  }

  // ── Reconciliation block ────────────────────────────────────────
  // Canonical-deduped rollup totals — the "truth" the page-type table
  // must reconcile to. Any discrepancy between these and the
  // per-page-type sums indicates a bug in the aggregation, not an
  // upstream data issue.
  let rollup_clicks_28d = 0
  let rollup_impressions_28d = 0
  let rollup_visible_28d = 0
  let rollup_productive_28d = 0
  canonicalRollups.forEach(e => {
    rollup_clicks_28d      += e.clicks_28d
    rollup_impressions_28d += e.impressions_28d
    if (e.impressions_28d > 0) rollup_visible_28d++
    if (e.productive_28d) rollup_productive_28d++
  })

  let pt_clicks = 0, pt_impressions = 0, pt_visible = 0, pt_productive = 0
  for (const row of page_types) {
    pt_clicks      += row.clicks_28d
    pt_impressions += row.impressions_28d
    pt_visible     += row.urls_visible_28d
    pt_productive  += row.productive_28d
  }

  let matched_pages_lookup = 0
  canonicalRollups.forEach(e => {
    if (pagesByUrl.get(e.canonical_url)) matched_pages_lookup++
  })

  const reconciliation: ReconciliationBlock = {
    rollup_clicks_28d,
    rollup_impressions_28d,
    rollup_visible_28d,
    rollup_productive_28d,
    rollup_rows_loaded: rollups.length,
    rollup_rows_canonicalisation_failed: parseFailedRows.length,
    rollup_canonical_urls: canonicalRollups.size,
    matched_pages_lookup,
    unmatched_pages_lookup: unmatched.page_lookup_fails,
    unmatched_visible_28d: unmatched.visible,
    unmatched_clicks_28d: unmatched.clicks,
    unmatched_impressions_28d: unmatched.impressions,
    invariants: {
      clicks_match_rollup:     pt_clicks      === rollup_clicks_28d,
      impressions_match_rollup: pt_impressions === rollup_impressions_28d,
      visible_match_rollup:    pt_visible     === rollup_visible_28d,
      productive_match_rollup: pt_productive  === rollup_productive_28d,
    },
    kpi_clicks_28d:      kpi.clicks_28d,
    kpi_impressions_28d: kpi.impressions_28d,
    kpi_visible_28d:     kpi.pages_with_impressions_28d,
    kpi_productive_28d:  kpi.pages_ge28_click_28d,
    kpi_vs_rollup_delta: {
      clicks:      rollup_clicks_28d      - kpi.clicks_28d,
      impressions: rollup_impressions_28d - kpi.impressions_28d,
      visible:     rollup_visible_28d     - kpi.pages_with_impressions_28d,
      productive:  rollup_productive_28d  - kpi.pages_ge28_click_28d,
    },
  }

  // Data health — uses count of pages already fetched.
  const data_health = await loadDataHealth(kpi, latestGscInfo.date, pagesByUrl.size)

  const momentum = computeMomentum(daily)

  const funnel: FunnelBlock = {
    known:            kpi.total_urls_known,
    in_sitemap:       kpi.urls_in_sitemap,
    visible_28d:      kpi.pages_with_impressions_28d,
    clicks_ge1_28d:   kpi.pages_ge1_click_28d,
    clicks_ge10_28d:  kpi.pages_ge10_click_28d,
    clicks_ge28_28d:  kpi.pages_ge28_click_28d,
  }

  const asOf = kpi.as_of_date
  // Days-to-target counts down from the actual server-render date, NOT
  // the KPI as-of date. The KPI date can lag ingest by 1-3 days; a
  // countdown anchored to it would drift as data refreshes. UTC "today"
  // is stable within the revalidate window (5 min).
  const nowDate = new Date()
  const today_iso = isoDay(nowDate)
  const generated_at = nowDate.toISOString()
  const days_to_target = Math.max(0, daysBetween(today_iso, TARGET_DATE))
  // Number of GSC daily dates beyond the current KPI snapshot. When
  // this is > 0 the dashboard renders a "newer data ingested, KPI
  // awaiting refresh" advisory so the mixed dates are not mistaken
  // for one coherent current snapshot.
  const newer_gsc_days = (latestGscInfo.date && latestGscInfo.date > asOf)
    ? Math.max(0, daysBetween(asOf, latestGscInfo.date))
    : 0

  return {
    target_date: TARGET_DATE,
    target_clicks_per_day_min: TARGET_MIN,
    target_clicks_per_day_max: TARGET_MAX,
    as_of_date: asOf,
    latest_gsc_date: latestGscInfo.date,
    today_iso,
    generated_at,
    days_to_target,
    newer_gsc_days,
    bq_export_started_on: BQ_EXPORT_STARTED_ON,
    kpi,
    funnel,
    visibility,
    daily,
    momentum,
    page_types,
    top_pages: topPages,
    reconciliation,
    data_health,
  }
}
