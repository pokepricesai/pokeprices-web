// scripts/seo/analyze-search-opportunities.ts
// Block 5A-W-33 — analyse the GSC / Bing / eBay export files under
// seo/exports/ and emit a markdown report (+ optional CSV) into
// seo/reports/.
//
// Usage (Node 24+ runs .ts natively, no tsx/ts-node required):
//
//   node scripts/seo/analyze-search-opportunities.ts
//
// Files expected in seo/exports/ for the W33 run:
//   * pokeprices.io-Performance-on-Search-*__Chart.csv    (GSC time series)
//   * pokeprices.io-Coverage-*__Chart.csv                  (GSC coverage chart)
//   * pokeprices.io_SearchPerformanceOverview_*.csv        (Bing search overview)
//   * pokeprices.io_AIPerformanceOverviewStats_*.csv       (Bing AI overview)
//   * 8941-TransactionDetail__*.csv                        (eBay transaction detail)
//
// If you have query-level / page-level GSC exports, drop them in too
// and re-run — the analyzer detects them and adds the CTR opportunity
// section. Without them, the report calls out the data gap.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { parseCsv, type CsvRow } from '../../src/lib/seo-analysis/csvParse.ts'
import { classifyPage, type PageType } from '../../src/lib/seo-analysis/pageClassifier.ts'
import { isBrandedQuery, splitBrandedNonBranded } from '../../src/lib/seo-analysis/brandedQueries.ts'
import { findOpportunities, type RankingRow } from '../../src/lib/seo-analysis/ctrOpportunity.ts'
import { summarise, type DailyPoint } from '../../src/lib/seo-analysis/timeSeries.ts'
import { summariseCoverage, type CoveragePoint } from '../../src/lib/seo-analysis/coverageAnalysis.ts'
import { summariseEbay, type EbayRow } from '../../src/lib/seo-analysis/ebayAnalysis.ts'

const REPO_ROOT   = resolve(import.meta.dirname ?? __dirname, '..', '..')
const EXPORTS_DIR = join(REPO_ROOT, 'seo', 'exports')
const REPORTS_DIR = join(REPO_ROOT, 'seo', 'reports')

const TODAY = new Date().toISOString().slice(0, 10)

// ─── small file helpers ─────────────────────────────────────────────

function readCsv(name: string): CsvRow[] {
  const path = join(EXPORTS_DIR, name)
  const text = readFileSync(path, 'utf8')
  return parseCsv(text)
}

function find(prefix: string, suffix: string): string | null {
  if (!existsSync(EXPORTS_DIR)) return null
  const hit = readdirSync(EXPORTS_DIR).find(f => f.startsWith(prefix) && f.endsWith(suffix))
  return hit ?? null
}

function findAll(prefix: string, suffix: string): string[] {
  if (!existsSync(EXPORTS_DIR)) return []
  return readdirSync(EXPORTS_DIR).filter(f => f.startsWith(prefix) && f.endsWith(suffix))
}

// ─── parse helpers (CSV row → typed shape) ──────────────────────────

function toNum(v: string | undefined): number {
  if (!v) return 0
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function gscChartRow(r: CsvRow): DailyPoint & { clicks: number; impressions: number; ctr: number; position: number } {
  return {
    date:        (r.Date ?? '').trim(),
    value:       toNum(r.Clicks),
    clicks:      toNum(r.Clicks),
    impressions: toNum(r.Impressions),
    ctr:         toNum(r.CTR),
    position:    toNum(r.Position),
  }
}

function coverageRow(r: CsvRow): CoveragePoint {
  return {
    date:        (r.Date ?? '').trim(),
    indexed:     toNum(r.Indexed),
    notIndexed:  toNum(r['Not indexed']),
    impressions: toNum(r.Impressions),
  }
}

function bingChartRow(r: CsvRow): DailyPoint {
  return { date: parseBingDate(r.Date ?? ''), value: toNum(r.Clicks) }
}

function bingAiRow(r: CsvRow): { date: string; citations: number; citedPages: number } {
  return {
    date:        parseBingDate(r.Date ?? ''),
    citations:   toNum(r.Citations),
    citedPages:  toNum(r['Cited Pages']),
  }
}

function parseBingDate(raw: string): string {
  // Bing exports as "5/11/2026 12:00:00 AM" — coerce to ISO yyyy-mm-dd.
  if (!raw) return ''
  const m = raw.match(/^(\d+)\/(\d+)\/(\d+)/)
  if (!m) return raw
  const [_, mm, dd, yyyy] = m
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

function ebayRow(r: CsvRow): EbayRow {
  return {
    eventDate:      r['Event Date'] ?? null,
    eventName:      r['Event Name'] ?? null,
    campaignId:     r['Campaign ID'] ?? null,
    campaignName:   r['Campaign Name'] ?? null,
    itemId:         r['Item ID'] ?? null,
    itemName:       r['Item Name'] ?? null,
    quantity:       toNum(r.Quantity),
    earnings:       toNum(r.Earnings),
    sales:          toNum(r.Sales),
    checkoutSite:   r['Checkout Site'] ?? null,
    buyerCountry:   r['Buyer Country'] ?? null,
    trafficType:    r['Traffic Type'] ?? null,
    landingPageUrl: r['Landing Page URL'] ?? null,
    status:         r.Status ?? null,
  }
}

// ─── attempt to find a query/page-level GSC export ──────────────────
// (Looks for any csv with a Top queries / Top pages header. None
// present in the initial W33 export drop — analyzer surfaces this
// as a gap in the report.)

function looksLikeGscQueryExport(name: string, headerKeys: string[]): boolean {
  const lower = name.toLowerCase()
  if (lower.includes('queries') || lower.includes('top-queries')) return true
  return headerKeys.some(k => /^query$/i.test(k)) && headerKeys.some(k => /^impressions$/i.test(k))
}

function looksLikeGscPageExport(name: string, headerKeys: string[]): boolean {
  const lower = name.toLowerCase()
  if (lower.includes('pages') && !lower.includes('performance')) return true
  return headerKeys.some(k => /^(page|url|landing\s*page)$/i.test(k)) && headerKeys.some(k => /^impressions$/i.test(k))
}

function readMaybeRankingExports(): { queries: RankingRow[]; pages: RankingRow[]; foundFiles: string[] } {
  const queries: RankingRow[] = []
  const pages:   RankingRow[] = []
  const found:   string[]      = []
  if (!existsSync(EXPORTS_DIR)) return { queries, pages, foundFiles: found }
  for (const f of readdirSync(EXPORTS_DIR)) {
    if (!f.endsWith('.csv')) continue
    if (f.includes('__Chart')) continue           // time-series, not query/page
    if (f.includes('AIPerformance')) continue
    if (f.includes('SearchPerformanceOverview')) continue
    if (f.startsWith('8941-')) continue
    const text = readFileSync(join(EXPORTS_DIR, f), 'utf8')
    const rows = parseCsv(text)
    if (rows.length === 0) continue
    const header = Object.keys(rows[0]!)
    if (looksLikeGscQueryExport(f, header)) {
      for (const r of rows) {
        const query = pickFirst(r, ['Query', 'Top queries', 'Top query'])
        queries.push({
          page:        null,
          query,
          pageType:    undefined,
          branded:     query ? isBrandedQuery(query) : false,
          clicks:      toNum(pickFirst(r, ['Clicks'])),
          impressions: toNum(pickFirst(r, ['Impressions'])),
          ctr:         toNum(pickFirst(r, ['CTR'])),
          avgPosition: toNum(pickFirst(r, ['Position', 'Average position'])),
        })
      }
      found.push(f)
    } else if (looksLikeGscPageExport(f, header)) {
      for (const r of rows) {
        const page = pickFirst(r, ['Page', 'URL', 'Top pages', 'Landing Page'])
        pages.push({
          page,
          query:       null,
          pageType:    classifyPage(page),
          branded:     false,
          clicks:      toNum(pickFirst(r, ['Clicks'])),
          impressions: toNum(pickFirst(r, ['Impressions'])),
          ctr:         toNum(pickFirst(r, ['CTR'])),
          avgPosition: toNum(pickFirst(r, ['Position', 'Average position'])),
        })
      }
      found.push(f)
    }
  }
  return { queries, pages, foundFiles: found }
}

function pickFirst(r: CsvRow, keys: string[]): string {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== '') return r[k]!
  }
  return ''
}

// ─── report rendering ───────────────────────────────────────────────

function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-GB')
  return n.toString()
}

type Findings = {
  gscPresent:           boolean
  gscPerformance?:      ReturnType<typeof summariseGscChart>
  coverage?:            ReturnType<typeof summariseCoverage>
  bingPerformance?:     ReturnType<typeof summarise>
  bingAi?:              { citations: ReturnType<typeof summarise>; pages: ReturnType<typeof summarise> }
  ebay?:                ReturnType<typeof summariseEbay>
  rankingFiles:         string[]
  queryOpportunities:   ReturnType<typeof findOpportunities>
  pageOpportunities:    ReturnType<typeof findOpportunities>
  pageTypeBreakdown:    Array<{ type: PageType; rows: number; impressions: number; clicks: number; ctr: number; pos: number }>
}

function summariseGscChart(rows: Array<DailyPoint & { clicks: number; impressions: number; ctr: number; position: number }>) {
  const clicks      = summarise(rows.map(r => ({ date: r.date, value: r.clicks })))
  const impressions = summarise(rows.map(r => ({ date: r.date, value: r.impressions })))
  const meanCtr  = rows.length === 0 ? 0 : rows.reduce((a, r) => a + r.ctr, 0) / rows.length
  const meanPos  = rows.length === 0 ? 0 : rows.reduce((a, r) => a + r.position, 0) / rows.length
  return { clicks, impressions, meanCtr, meanPos, rowCount: rows.length }
}

function buildPageTypeBreakdown(pageRows: RankingRow[]): Findings['pageTypeBreakdown'] {
  if (pageRows.length === 0) return []
  const byType = new Map<PageType, { rows: number; impressions: number; clicks: number; ctrWeighted: number; posWeighted: number; impressionsForAvg: number }>()
  for (const r of pageRows) {
    const t = r.pageType ?? 'other'
    const cur = byType.get(t) ?? { rows: 0, impressions: 0, clicks: 0, ctrWeighted: 0, posWeighted: 0, impressionsForAvg: 0 }
    cur.rows         += 1
    cur.impressions  += r.impressions
    cur.clicks       += r.clicks
    cur.ctrWeighted  += r.ctr * r.impressions
    cur.posWeighted  += r.avgPosition * r.impressions
    cur.impressionsForAvg += r.impressions
    byType.set(t, cur)
  }
  return [...byType.entries()]
    .map(([type, v]) => ({
      type,
      rows:        v.rows,
      impressions: v.impressions,
      clicks:      v.clicks,
      ctr:         v.impressionsForAvg > 0 ? v.ctrWeighted / v.impressionsForAvg : 0,
      pos:         v.impressionsForAvg > 0 ? v.posWeighted / v.impressionsForAvg : 0,
    }))
    .sort((a, b) => b.impressions - a.impressions)
}

function renderReport(f: Findings): string {
  const lines: string[] = []
  lines.push(`# Search Opportunity Report — ${TODAY}`)
  lines.push('')
  lines.push('_Block 5A-W-33 — automated analysis of GSC, Bing, Bing AI and eBay exports under `seo/exports/`._')
  lines.push('')

  // ── Executive summary
  lines.push('## Executive summary')
  lines.push('')
  if (f.gscPerformance) {
    const wow = f.gscPerformance.clicks.weekOverWeekPct
    lines.push(`* **Google search** (last ${f.gscPerformance.rowCount} days): ${fmtNum(f.gscPerformance.clicks.total)} clicks, ${fmtNum(f.gscPerformance.impressions.total)} impressions, mean CTR ${(f.gscPerformance.meanCtr * 100).toFixed(2)}%, mean position ${f.gscPerformance.meanPos.toFixed(1)}. Week-over-week click delta: ${fmtPct(wow)}.`)
  }
  if (f.coverage) {
    lines.push(`* **Indexing** (Coverage chart): ${f.coverage.firstDate} → ${f.coverage.lastDate}. Indexed ${fmtNum(f.coverage.firstIndexed)} → ${fmtNum(f.coverage.lastIndexed)}; Not-indexed ${fmtNum(f.coverage.firstNotIndexed)} → ${fmtNum(f.coverage.lastNotIndexed)}. Trend: **${f.coverage.trend}** (${f.coverage.trendReason}).`)
  }
  if (f.bingPerformance) {
    const wow = f.bingPerformance.weekOverWeekPct
    lines.push(`* **Bing search**: ${fmtNum(f.bingPerformance.total)} clicks over ${f.bingPerformance.totalDays} days. Week-over-week: ${fmtPct(wow)}.`)
  }
  if (f.bingAi) {
    lines.push(`* **Bing AI citations**: ${fmtNum(f.bingAi.citations.total)} total citations, ${fmtNum(f.bingAi.pages.total)} total cited-page instances. Last day vs first day citation rate: ${fmtPct(f.bingAi.citations.weekOverWeekPct)} week-over-week.`)
  }
  if (f.ebay) {
    lines.push(`* **eBay affiliate**: ${fmtNum(f.ebay.rowCount)} rows, ${fmtNum(f.ebay.totalQuantity)} items, total sales **${fmtNum(f.ebay.totalSalesNumeric)}** and earnings **${fmtNum(f.ebay.totalEarningsNumeric)}** (currency unspecified in export — see eBay section).`)
  }
  if (f.rankingFiles.length === 0) {
    lines.push('')
    lines.push('> ⚠ **Data gap:** no per-query or per-page GSC/Bing export was found in `seo/exports/`. CTR opportunity tables below are empty. To populate them, export the **Top queries** and **Top pages** tabs from GSC Performance as CSV and re-run.')
  }
  lines.push('')

  // ── Google
  lines.push('## Google search summary')
  lines.push('')
  if (f.gscPerformance) {
    lines.push(`* Days covered: ${f.gscPerformance.rowCount}`)
    lines.push(`* Total clicks: ${fmtNum(f.gscPerformance.clicks.total)}`)
    lines.push(`* Total impressions: ${fmtNum(f.gscPerformance.impressions.total)}`)
    lines.push(`* Mean CTR: ${(f.gscPerformance.meanCtr * 100).toFixed(2)}%`)
    lines.push(`* Mean position: ${f.gscPerformance.meanPos.toFixed(1)}`)
    lines.push(`* First 7-day mean clicks / last 7-day mean clicks: ${(f.gscPerformance.clicks.weekOverWeekDelta ?? 0).toFixed(1)} delta`)
    lines.push(`* Impressions week-over-week: ${fmtPct(f.gscPerformance.impressions.weekOverWeekPct)}`)
  } else {
    lines.push('_No GSC chart export found._')
  }
  lines.push('')

  // ── Bing
  lines.push('## Bing search summary')
  lines.push('')
  if (f.bingPerformance) {
    lines.push(`* Days covered: ${f.bingPerformance.totalDays}`)
    lines.push(`* Total clicks: ${fmtNum(f.bingPerformance.total)}`)
    lines.push(`* Mean daily clicks: ${f.bingPerformance.mean.toFixed(1)}`)
    lines.push(`* Week-over-week click delta: ${fmtPct(f.bingPerformance.weekOverWeekPct)}`)
  } else {
    lines.push('_No Bing search export found._')
  }
  lines.push('')

  // ── Bing AI
  lines.push('## Bing AI / citation summary')
  lines.push('')
  if (f.bingAi) {
    lines.push(`* Total citations: ${fmtNum(f.bingAi.citations.total)}`)
    lines.push(`* Total cited-page instances: ${fmtNum(f.bingAi.pages.total)}`)
    lines.push(`* Citations week-over-week: ${fmtPct(f.bingAi.citations.weekOverWeekPct)}`)
    lines.push(`* Cited pages week-over-week: ${fmtPct(f.bingAi.pages.weekOverWeekPct)}`)
  } else {
    lines.push('_No Bing AI export found._')
  }
  lines.push('')

  // ── Coverage
  lines.push('## Coverage / indexing summary')
  lines.push('')
  if (f.coverage) {
    lines.push(`* First date: ${f.coverage.firstDate}`)
    lines.push(`* Last date: ${f.coverage.lastDate}`)
    lines.push(`* Indexed first → last: ${fmtNum(f.coverage.firstIndexed)} → ${fmtNum(f.coverage.lastIndexed)}`)
    lines.push(`* Not-indexed first → last: ${fmtNum(f.coverage.firstNotIndexed)} → ${fmtNum(f.coverage.lastNotIndexed)}`)
    lines.push(`* Indexed share first → last: ${fmtPct((f.coverage.firstIndexedShare ?? 0) * 100)} → ${fmtPct((f.coverage.lastIndexedShare ?? 0) * 100)}`)
    lines.push(`* Trend: **${f.coverage.trend}** — ${f.coverage.trendReason}`)
    if (f.coverage.largeNotIndexedDrops.length > 0) {
      lines.push('* Large not-indexed drops (≥5,000 in a day):')
      for (const d of f.coverage.largeNotIndexedDrops) {
        lines.push(`  * ${d.date}: ${fmtNum(d.from)} → ${fmtNum(d.to)} (Δ ${d.delta})`)
      }
    }
    if (f.coverage.largeNotIndexedSpikes.length > 0) {
      lines.push('* Large not-indexed spikes (≥5,000 in a day):')
      for (const d of f.coverage.largeNotIndexedSpikes) {
        lines.push(`  * ${d.date}: ${fmtNum(d.from)} → ${fmtNum(d.to)} (Δ +${d.delta})`)
      }
    }
    lines.push('')
    lines.push('> ⚠ **Detail gap:** the Coverage chart only carries day-level counts. To classify the not-indexed bucket into Crawled-not-indexed / Discovered-not-indexed / Soft-404 / Duplicate canonical / Alternate canonical / Redirect / 404, export GSC → Indexing → Pages → Why pages aren\'t indexed and drop into `seo/exports/`.')
  } else {
    lines.push('_No coverage export found._')
  }
  lines.push('')

  // ── eBay
  lines.push('## eBay affiliate summary')
  lines.push('')
  if (f.ebay) {
    lines.push(`* Rows: ${fmtNum(f.ebay.rowCount)}`)
    lines.push(`* Total quantity: ${fmtNum(f.ebay.totalQuantity)}`)
    lines.push(`* Total sales (numeric, currency NOT stated in export): **${fmtNum(f.ebay.totalSalesNumeric)}**`)
    lines.push(`* Total earnings (numeric, currency NOT stated in export): **${fmtNum(f.ebay.totalEarningsNumeric)}**`)
    lines.push(`* Campaigns seen: ${f.ebay.campaigns.join(', ') || '—'}`)
    lines.push('')
    lines.push(`> ${f.ebay.currencyNote}`)
    lines.push('')
    lines.push('### Checkout site breakdown')
    for (const r of f.ebay.checkoutSites) lines.push(`* ${r.site}: ${r.rows} rows`)
    lines.push('')
    lines.push('### Buyer country breakdown')
    for (const r of f.ebay.buyerCountries) lines.push(`* ${r.country}: ${r.rows} rows`)
    lines.push('')
    lines.push('### Traffic type')
    for (const r of f.ebay.trafficTypes) lines.push(`* ${r.type}: ${r.rows} rows`)
    lines.push('')
    lines.push('### Landing pages (top 10)')
    for (const r of f.ebay.landingPages.slice(0, 10)) lines.push(`* ${r.url} — ${r.rows} rows`)
    lines.push('')
    lines.push('### Top 25 items by earnings')
    for (const it of f.ebay.topItemsByEarnings) {
      lines.push(`* ${it.itemName} — earnings ${it.earnings}, qty ${it.quantity}`)
    }
  } else {
    lines.push('_No eBay transaction export found._')
  }
  lines.push('')

  // ── Page type breakdown
  if (f.pageTypeBreakdown.length > 0) {
    lines.push('## Page-type performance (from per-page GSC export)')
    lines.push('')
    lines.push('| Page type | URLs | Impressions | Clicks | CTR | Avg pos |')
    lines.push('|---|---:|---:|---:|---:|---:|')
    for (const r of f.pageTypeBreakdown) {
      lines.push(`| ${r.type} | ${r.rows} | ${fmtNum(r.impressions)} | ${fmtNum(r.clicks)} | ${(r.ctr * 100).toFixed(2)}% | ${r.pos.toFixed(1)} |`)
    }
    lines.push('')
  }

  // ── Opportunities
  if (f.queryOpportunities.length > 0) {
    lines.push('## Top 50 CTR opportunities — queries')
    lines.push('')
    lines.push('| # | Query | Impr | Clicks | CTR | Pos | Branded | Reason |')
    lines.push('|---:|---|---:|---:|---:|---:|---|---|')
    for (let i = 0; i < Math.min(50, f.queryOpportunities.length); i++) {
      const o = f.queryOpportunities[i]!
      lines.push(`| ${i + 1} | ${o.query ?? '—'} | ${fmtNum(o.impressions)} | ${fmtNum(o.clicks)} | ${(o.ctr * 100).toFixed(2)}% | ${o.avgPosition.toFixed(1)} | ${o.branded ? 'Y' : 'N'} | ${o.opportunityReason} |`)
    }
    lines.push('')
  }
  if (f.pageOpportunities.length > 0) {
    lines.push('## Top 50 CTR opportunities — pages')
    lines.push('')
    lines.push('| # | Page | Type | Impr | Clicks | CTR | Pos | Reason |')
    lines.push('|---:|---|---|---:|---:|---:|---:|---|')
    for (let i = 0; i < Math.min(50, f.pageOpportunities.length); i++) {
      const o = f.pageOpportunities[i]!
      lines.push(`| ${i + 1} | ${o.page ?? '—'} | ${o.pageType ?? '—'} | ${fmtNum(o.impressions)} | ${fmtNum(o.clicks)} | ${(o.ctr * 100).toFixed(2)}% | ${o.avgPosition.toFixed(1)} | ${o.opportunityReason} |`)
    }
    lines.push('')
  }
  if (f.queryOpportunities.length === 0 && f.pageOpportunities.length === 0) {
    lines.push('## CTR opportunities')
    lines.push('')
    lines.push('_No query- or page-level export available — see the data gap note above._')
    lines.push('')
  }

  // ── Suspicious-query investigation
  lines.push('## Suspicious technical-query investigation')
  lines.push('')
  lines.push('Strings flagged in GSC that look like technical / data-import / chart-state tokens:')
  lines.push('')
  lines.push('### `vgpc.chart_data`')
  lines.push('* `grep -r "vgpc.chart_data" src/` → **no matches**.')
  lines.push('* `grep -ri "vgpc" src/` → one false-positive match (substring of `avgPct30d` in `WatchlistClient.tsx` — unrelated).')
  lines.push('* `grep -r "chart_data|chartData|chart-data" src/` → no matches.')
  lines.push('* **Conclusion:** the string is NOT emitted by our source. It is most likely external referrer / scraper noise. Not actionable from our side.')
  lines.push('')
  lines.push('### `pricecharting`')
  lines.push('* Found in:')
  lines.push('  * `src/lib/faqs.ts` (3 visible-FAQ mentions — intentional transparency copy crediting the data source).')
  lines.push('  * `src/app/roadmap/page.tsx` (1 visible mention — roadmap item about set-level price index from PriceCharting).')
  lines.push('  * `src/lib/cardSlug.ts` + tests (internal comments / provider string — not user-visible).')
  lines.push('* **Conclusion:** intentional. Worth confirming for W34/W35 whether body-text mention is the right placement vs a footnote / data-sources page, but no bug.')
  lines.push('')
  lines.push('### `maxivoraspecial.xyz`')
  lines.push('* `grep -ri "maxivoraspecial" src/` → **no matches**.')
  lines.push('* `grep -ri ".xyz" src/` → no matches.')
  lines.push('* **Conclusion:** not in our source. Almost certainly spam referrer / index-poisoning noise. Ignore.')
  lines.push('')

  // ── Recommendations
  lines.push('## Recommended actions')
  lines.push('')
  lines.push('### Before W34 can rank opportunities')
  lines.push('* Export GSC → Performance → **Top queries** tab → CSV, drop in `seo/exports/`, re-run.')
  lines.push('* Export GSC → Performance → **Top pages** tab → CSV, drop in `seo/exports/`, re-run.')
  lines.push('* Export Bing Webmaster → **Search performance → Pages** and **Queries** tabs as CSV if available.')
  lines.push('* Export GSC → Indexing → Pages → **Why pages aren\'t indexed** (per-URL coverage detail) so W35 can identify soft-404 / thin-page candidates by URL.')
  lines.push('')
  lines.push('### W34 — title / meta description tests')
  lines.push('* Run this script with the query/page exports loaded. The "Top 50 CTR opportunities" tables become the W34 candidate list.')
  lines.push('* Prioritise card-page rewrites first (largest URL count + already covered by `getCardSeo()` so testing variants is cheap).')
  lines.push('* Add weekly chart snapshots so W34 has a before/after baseline.')
  lines.push('')
  lines.push('### W35 — page-quality / soft-404 fixes')
  lines.push('* Use the per-URL coverage detail (once exported) to identify the "Crawled — currently not indexed" + "Soft 404" buckets. Most likely cause: card pages with no recent price data.')
  lines.push('* Implement a server-side gate that 404s a card when it has zero recent prices AND zero recent sales.')
  lines.push('* Filter sitemap-sets / sitemap-pokemon to only sets / species that have at least one linked card.')
  lines.push('* Noindex card-show detail pages once the show date is >30 days in the past.')
  lines.push('* Minimum-content gate for vendor / creator profiles before they enter the sitemap.')
  lines.push('')
  lines.push('### W39 — eBay affiliate optimisation')
  if (f.ebay) {
    const distinctLandings = f.ebay.landingPages.length
    const allGeneric = f.ebay.landingPages.every(p => /\/sch\/i\.html(\?|$)/.test(p.url))
    if (allGeneric && distinctLandings <= 3) {
      lines.push(`* **Landing-page diversity is zero**: every commission ties back to a generic eBay search page (\`/sch/i.html\`), ${distinctLandings} distinct URL${distinctLandings === 1 ? '' : 's'} total. Switching to per-card / per-item affiliate URLs should lift the per-impression earn rate without changing traffic volume.`)
    } else {
      lines.push(`* Distinct landing pages in the export: ${distinctLandings}. Audit whether deeper item-specific links are converting better than generic search URLs.`)
    }
    if (f.ebay.campaigns.length >= 2) {
      lines.push(`* Both \`${f.ebay.campaigns.join('` and `')}\` campaigns are active — UK/US routing is correctly split. Confirm the campaign-currency mapping (UK rows → GBP, US rows → USD) at the analytics layer so the dashboard doesn't sum apples to oranges.`)
    } else if (f.ebay.campaigns.length === 1) {
      lines.push(`* Only one EPN campaign in the export (\`${f.ebay.campaigns[0]}\`). If the site genuinely targets multiple regions, set up a second EPN campaign so clicks route to the right marketplace.`)
    }
    lines.push('* Currency is not in the export schema. Add a derived `currency` column before any aggregated dashboard ("UK checkout site → GBP, US checkout site → USD") so future reports can speak in currency-correct figures.')
    lines.push('* Top-25-items table above shows the actual conversions. Cross-reference with `card_url_slug` to identify which on-site placements drove these specific clicks, then prioritise affiliate deep-linking on those card pages first.')
  } else {
    lines.push('* (eBay transaction export missing — drop the TransactionDetail file in `seo/exports/` to populate this section.)')
  }
  lines.push('')
  return lines.join('\n')
}

function renderOpportunitiesCsv(rows: ReturnType<typeof findOpportunities>): string {
  const header = ['page', 'page_type', 'query', 'clicks', 'impressions', 'ctr', 'avg_position', 'branded', 'opportunity_reason', 'recommended_action']
  const lines = [header.join(',')]
  for (const r of rows) {
    const row = [
      csvCell(r.page ?? ''),
      csvCell(r.pageType ?? ''),
      csvCell(r.query ?? ''),
      String(r.clicks),
      String(r.impressions),
      r.ctr.toFixed(4),
      r.avgPosition.toFixed(2),
      r.branded === true ? 'branded' : 'non-branded',
      csvCell(r.opportunityReason),
      csvCell(r.recommendedAction),
    ]
    lines.push(row.join(','))
  }
  return lines.join('\n')
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

// ─── main ───────────────────────────────────────────────────────────

function main(): void {
  if (!existsSync(EXPORTS_DIR)) {
    console.error(`No exports dir at ${EXPORTS_DIR}`)
    process.exit(1)
  }
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true })

  const findings: Findings = {
    gscPresent:           false,
    rankingFiles:         [],
    queryOpportunities:   [],
    pageOpportunities:    [],
    pageTypeBreakdown:    [],
  }

  // GSC search performance chart (prefer the file without (1) duplicate suffix
  // if both exist — but happy with either since they were identical in the
  // initial W33 drop. We dedupe by date below).
  const gscCsvs = findAll('pokeprices.io-Performance-on-Search-', '__Chart.csv')
  if (gscCsvs.length > 0) {
    const dateMap = new Map<string, ReturnType<typeof gscChartRow>>()
    for (const f of gscCsvs) {
      const rows = readCsv(f).map(gscChartRow)
      for (const r of rows) {
        if (!r.date) continue
        if (!dateMap.has(r.date)) dateMap.set(r.date, r)
      }
    }
    const merged = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date))
    findings.gscPresent     = true
    findings.gscPerformance = summariseGscChart(merged)
    console.log(`✓ GSC performance: ${merged.length} day rows (sources: ${gscCsvs.map(f => basename(f)).join(', ')})`)
  } else {
    console.log('! GSC performance chart CSV not found.')
  }

  // GSC coverage chart
  const coverageFile = find('pokeprices.io-Coverage-', '__Chart.csv')
  if (coverageFile) {
    const rows = readCsv(coverageFile).map(coverageRow).filter(r => r.date)
    findings.coverage = summariseCoverage(rows)
    console.log(`✓ GSC coverage: ${rows.length} day rows`)
  } else {
    console.log('! GSC coverage chart CSV not found.')
  }

  // Bing search overview
  const bingPerfFile = find('pokeprices.io_SearchPerformanceOverview', '.csv')
  if (bingPerfFile) {
    const rows = readCsv(bingPerfFile).map(bingChartRow).filter(r => r.date)
    findings.bingPerformance = summarise(rows)
    console.log(`✓ Bing performance: ${rows.length} day rows`)
  } else {
    console.log('! Bing performance CSV not found.')
  }

  // Bing AI overview
  const bingAiFile = find('pokeprices.io_AIPerformanceOverview', '.csv')
  if (bingAiFile) {
    const rows = readCsv(bingAiFile).map(bingAiRow).filter(r => r.date)
    findings.bingAi = {
      citations: summarise(rows.map(r => ({ date: r.date, value: r.citations }))),
      pages:     summarise(rows.map(r => ({ date: r.date, value: r.citedPages }))),
    }
    console.log(`✓ Bing AI: ${rows.length} day rows`)
  } else {
    console.log('! Bing AI CSV not found.')
  }

  // eBay
  const ebayFile = find('8941-TransactionDetail', '.csv')
  if (ebayFile) {
    const rows = readCsv(ebayFile).map(ebayRow)
    findings.ebay = summariseEbay(rows)
    console.log(`✓ eBay: ${rows.length} transaction rows`)
  } else {
    console.log('! eBay transaction CSV not found.')
  }

  // Optional query / page level ranking exports
  const { queries, pages, foundFiles } = readMaybeRankingExports()
  findings.rankingFiles       = foundFiles
  if (foundFiles.length > 0) console.log(`✓ Ranking exports: ${foundFiles.join(', ')}`)
  findings.queryOpportunities = findOpportunities(queries)
  findings.pageOpportunities  = findOpportunities(pages)
  findings.pageTypeBreakdown  = buildPageTypeBreakdown(pages)

  // Branded split for the optional query file
  if (queries.length > 0) {
    const { branded, nonBranded } = splitBrandedNonBranded(queries)
    console.log(`  queries: ${branded.length} branded / ${nonBranded.length} non-branded`)
  }

  // Write outputs
  const report = renderReport(findings)
  const reportPath = join(REPORTS_DIR, `${TODAY}-search-opportunity-report.md`)
  writeFileSync(reportPath, report, 'utf8')
  console.log(`→ Wrote ${reportPath}`)

  // CSV — only meaningful if we found opportunities.
  if (findings.queryOpportunities.length > 0 || findings.pageOpportunities.length > 0) {
    const all = [...findings.queryOpportunities, ...findings.pageOpportunities]
    const csvPath = join(REPORTS_DIR, `${TODAY}-ctr-opportunities.csv`)
    writeFileSync(csvPath, renderOpportunitiesCsv(all), 'utf8')
    console.log(`→ Wrote ${csvPath}`)
  } else {
    console.log('  (no opportunities — CSV not written. Drop query/page GSC exports in seo/exports/ and re-run.)')
  }
}

main()
