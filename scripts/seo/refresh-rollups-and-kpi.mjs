#!/usr/bin/env node
// scripts/seo/refresh-rollups-and-kpi.mjs
// ============================================================================
// SEO Mission Control — Stage 1 Part 1c · rollups + KPI daily refresh.
// ============================================================================
//
// Recomputes public.seo_page_rollups and writes / updates a
// public.seo_kpi_daily row for a given --as-of-date, using the additive
// primitives already stored in public.seo_gsc_page_daily.
//
// Both target tables use ONLY the columns their existing migrations define:
//   - seo_page_rollups   → migrations/2026-09-18-seo-03-page-rollups.sql
//   - seo_kpi_daily      → migrations/2026-09-18-seo-04-kpi-daily.sql
//
// No schema is added. No REST aggregate functions are used (the project
// has aggregate REST disabled). All aggregation happens client-side over
// paginated rows.
//
// ── Windows ────────────────────────────────────────────────────────────────
// Calendar-inclusive:
//   7d  = [as_of - 6,  as_of]   → 7 days
//   28d = [as_of - 27, as_of]   → 28 days
//   90d = [as_of - 89, as_of]   → 90 days
//
// Rules:
//   clicks_Nd       = SUM(clicks)
//   impressions_Nd  = SUM(impressions)
//   sum_position_28d = SUM(sum_position) over the 28d window
//                      (additive primitive; kept NULL if impressions_28d = 0)
//   ctr_Nd          = SUM(clicks) / SUM(impressions)      — DERIVED (never stored)
//   avg_position_Nd = SUM(sum_position) / SUM(impressions) + 1  — DERIVED
//                     (only 28d is derivable per-URL — schema stores only
//                      sum_position_28d)
//   productive_28d  = clicks_28d >= 28   — generated column, never inserted
//
// ── Combined-source ────────────────────────────────────────────────────────
// Only source='google' is written by this refresh. No fabricated Bing rows
// and no fabricated 'combined' rows. Combined semantics land later when a
// Bing series exists.
//
// ── Registry KPIs ──────────────────────────────────────────────────────────
// seo_kpi_daily has three registry snapshot columns that are NOT NULL:
//     total_urls_known, urls_indexable, urls_in_sitemap
// They are populated from seo_pages via HEAD counts. seo_pages is currently
// empty (Stage 2 will populate it), so all three write as 0. This is
// truthful, not fabricated. When Stage 2 populates the registry, rerun
// this refresh to backfill correct values into the KPI row.
//
// ── Snapshot semantics (Stage 4A) ─────────────────────────────────────────
// seo_page_rollups is a CURRENT SNAPSHOT convenience table, not a
// historical accumulator. After this script completes for a given
// (site_key, source, as_of_date), the persisted rows MUST equal the
// fresh accumulator derived from raw daily rows — no stale rows from
// prior windows may survive.
//
// V1 was UPSERT-only. Stage 4A adds:
//   * an explicit prune step that deletes rows present in the table
//     but absent from the current accumulator (scoped strictly to the
//     current site_key + source), and
//   * a hard reconciliation pass that re-reads seo_page_rollups after
//     writing and verifies nine invariants against the accumulator
//     BEFORE the KPI upsert. Any mismatch aborts before KPI writes,
//     so the KPI row is never disagreeing with the rollup snapshot
//     that produced it.
//
// ── Idempotency ────────────────────────────────────────────────────────────
// Every write is an UPSERT on the target table's PK plus a scoped
// stale-row delete:
//   seo_page_rollups : onConflict='site_key,source,url'  (+ prune)
//   seo_kpi_daily    : onConflict='site_key,source,date'
// Re-running for the same --as-of-date is safe. Second run for the
// same raw daily state deletes zero rows, upserts identical rows,
// and passes all invariants.
//
// ── Reconciliation ─────────────────────────────────────────────────────────
// Guards, all fail loudly with exit code 2 before touching the KPI:
//   1. INTERNAL consistency: SUM(per-URL rollup) MUST equal site-wide
//      totals tracked during the same pass. Catches accumulator bugs.
//   2. ANCHOR check: site-wide 7d / 28d totals MUST equal user-supplied
//      expected values (defaults hardcoded for as_of=2026-09-16 —
//      204,450 imp / 1,072 clicks (7d) and 658,982 imp / 3,847 clicks
//      (28d)). Override with --expected-* args for other dates.
//      Anchors are point-in-time baselines against raw daily; a
//      subsequent re-ingest of any 28d-window date will shift the raw
//      sums and require updated anchors (or --skip-anchors).
//   3. ROLLUP RECONCILIATION: after prune + upsert, re-read
//      seo_page_rollups and verify Σ / cohort-count invariants match
//      the fresh accumulator exactly.
//
// ── Telemetry ──────────────────────────────────────────────────────────────
// One seo_bq_ingest_runs row per invocation:
//   job_kind='rollup_refresh', source='google', site_key='pokeprices'.
// The KPI update is subsumed by this job kind for V1; if we split them
// later we will emit two rows.
//
// ── Usage ──────────────────────────────────────────────────────────────────
//   node scripts/seo/refresh-rollups-and-kpi.mjs
//   node scripts/seo/refresh-rollups-and-kpi.mjs --as-of-date 2026-09-16
//   node scripts/seo/refresh-rollups-and-kpi.mjs --skip-anchors
//   node scripts/seo/refresh-rollups-and-kpi.mjs \
//     --as-of-date 2026-09-16 \
//     --expected-7d-impressions 204450 --expected-7d-clicks 1072 \
//     --expected-28d-impressions 658982 --expected-28d-clicks 3847
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

// ── env loader ────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let val = m[2]
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

// ── args ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const val = argv[i + 1]
    if (val === undefined || val.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = val
      i++
    }
  }
  return out
}
const args = parseArgs(process.argv)

function die(msg) {
  console.error(`[refresh] FATAL: ${msg}`)
  process.exit(1)
}

const SITE_KEY = args['site-key'] || 'pokeprices'
const SOURCE = args.source || 'google'
if (!['pokeprices', 'mtgprices'].includes(SITE_KEY)) die(`--site-key must be pokeprices or mtgprices, got ${SITE_KEY}`)
if (!['google', 'bing'].includes(SOURCE)) die(`--source must be google or bing (combined is derived), got ${SOURCE}`)

// ── env / supabase ────────────────────────────────────────────────────────
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPA_URL || !SUPA_KEY) die('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
const supa = createClient(SUPA_URL, SUPA_KEY)

// ── date helpers ──────────────────────────────────────────────────────────
function toISO(d) {
  // Accept 'YYYY-MM-DD' or Date; return 'YYYY-MM-DD'.
  if (typeof d === 'string') return d.slice(0, 10)
  const yr = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dy = String(d.getUTCDate()).padStart(2, '0')
  return `${yr}-${mo}-${dy}`
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + n * 86400000
  return toISO(new Date(t))
}
function isValidISO(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s)
}

// ── telemetry ─────────────────────────────────────────────────────────────
let runId = null
async function openRun() {
  const { data, error } = await supa
    .from('seo_bq_ingest_runs')
    .insert({
      site_key: SITE_KEY,
      source: SOURCE,
      job_kind: 'rollup_refresh',
      status: 'in_progress',
    })
    .select('run_id')
    .single()
  if (error) die(`could not open ingest run row: ${error.message}`)
  runId = data.run_id
  console.log(`[refresh] opened run ${runId}`)
}
async function closeRun({ status, rows, error }) {
  if (!runId) return
  await supa
    .from('seo_bq_ingest_runs')
    .update({
      ended_at: new Date().toISOString(),
      status,
      rows_ingested: rows ?? null,
      error: error ?? null,
    })
    .eq('run_id', runId)
}

// ── HEAD count helper (uses PostgREST count header — safe when
// aggregate REST is disabled) ────────────────────────────────────────────
async function headCount(table, filters) {
  let q = supa.from(table).select('*', { count: 'exact', head: true })
  for (const [col, val] of Object.entries(filters)) {
    q = q.eq(col, val)
  }
  const { count, error } = await q
  if (error) throw new Error(`headCount(${table}): ${error.message}`)
  return count ?? 0
}

// ── discover latest as-of date if not supplied ───────────────────────────
async function discoverLatestAsOf() {
  const { data, error } = await supa
    .from('seo_gsc_page_daily')
    .select('date')
    .eq('site_key', SITE_KEY)
    .eq('source', SOURCE)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`discoverLatestAsOf: ${error.message}`)
  if (!data) return null
  return toISO(data.date)
}

// ── paginated read of raw daily rows across the 90d window ───────────────
async function readWindow(startISO, endISO) {
  const CHUNK = 1000
  let from = 0
  let pageIndex = 0
  const rows = []
  while (true) {
    const { data, error } = await supa
      .from('seo_gsc_page_daily')
      .select('url,date,impressions,clicks,sum_position')
      .eq('site_key', SITE_KEY)
      .eq('source', SOURCE)
      .gte('date', startISO)
      .lte('date', endISO)
      .order('date', { ascending: true })
      .order('url', { ascending: true })
      .range(from, from + CHUNK - 1)
    if (error) throw new Error(`readWindow page ${from}: ${error.message}`)
    if (!data || data.length === 0) break
    for (const r of data) rows.push(r)
    pageIndex++
    if (pageIndex % 20 === 0) {
      console.log(`[refresh]   … ${rows.length.toLocaleString()} rows read so far`)
    }
    if (data.length < CHUNK) break
    from += CHUNK
  }
  return rows
}

// ── main ──────────────────────────────────────────────────────────────────
try {
  await openRun()

  // Resolve as_of_date ────────────────────────────────────────────────────
  let asOfDate = args['as-of-date'] || null
  if (asOfDate && !isValidISO(asOfDate)) die(`--as-of-date must be YYYY-MM-DD, got ${asOfDate}`)
  if (!asOfDate) {
    console.log('[refresh] --as-of-date not supplied; discovering latest date in seo_gsc_page_daily…')
    asOfDate = await discoverLatestAsOf()
    if (!asOfDate) die('no rows in seo_gsc_page_daily for this site_key/source')
  }

  const window7Start  = addDaysISO(asOfDate, -6)
  const window28Start = addDaysISO(asOfDate, -27)
  const window90Start = addDaysISO(asOfDate, -89)

  console.log(`[refresh] site_key=${SITE_KEY} source=${SOURCE} as_of_date=${asOfDate}`)
  console.log(`[refresh] windows:`)
  console.log(`[refresh]    7d = ${window7Start}..${asOfDate}`)
  console.log(`[refresh]   28d = ${window28Start}..${asOfDate}`)
  console.log(`[refresh]   90d = ${window90Start}..${asOfDate}`)

  // Read raw daily rows across the 90d window ────────────────────────────
  console.log('[refresh] reading raw daily rows across 90d window (paginated)…')
  const rawRows = await readWindow(window90Start, asOfDate)
  console.log(`[refresh]   ${rawRows.length.toLocaleString()} raw daily rows`)

  if (rawRows.length === 0) die('no raw rows in the 90d window — nothing to roll up')

  // Accumulate ────────────────────────────────────────────────────────────
  const perUrl = new Map() // url -> accumulator
  let site7dImp = 0, site7dClk = 0, site7dSumPos = 0
  let site28dImp = 0, site28dClk = 0, site28dSumPos = 0

  for (const r of rawRows) {
    const url = String(r.url)
    const date = toISO(r.date)
    const imp = Number(r.impressions || 0)
    const clk = Number(r.clicks || 0)
    const sp  = Number(r.sum_position || 0)

    let acc = perUrl.get(url)
    if (!acc) {
      acc = {
        imp_7d: 0, imp_28d: 0, imp_90d: 0,
        clk_7d: 0, clk_28d: 0, clk_90d: 0,
        sumpos_28d: 0,
      }
      perUrl.set(url, acc)
    }
    // 90d — always (read scope IS the 90d window).
    acc.imp_90d += imp
    acc.clk_90d += clk
    if (date >= window28Start) {
      acc.imp_28d += imp
      acc.clk_28d += clk
      acc.sumpos_28d += sp
      site28dImp += imp
      site28dClk += clk
      site28dSumPos += sp
    }
    if (date >= window7Start) {
      acc.imp_7d += imp
      acc.clk_7d += clk
      site7dImp += imp
      site7dClk += clk
      site7dSumPos += sp
    }
  }

  // Derive cohort counts + reconcile per-URL totals ─────────────────────
  let pagesWithImpressions28d = 0
  let pagesGe1_28d = 0, pagesGe10_28d = 0, pagesGe28_28d = 0
  let urlsVisible7d = 0, urlsClicks7d = 0
  let urlsVisible28d = 0, urlsClicks28d = 0
  let sumOfPerUrl7dImp = 0, sumOfPerUrl7dClk = 0
  let sumOfPerUrl28dImp = 0, sumOfPerUrl28dClk = 0
  let sumOfPerUrl28dSumPos = 0

  for (const acc of perUrl.values()) {
    sumOfPerUrl7dImp   += acc.imp_7d
    sumOfPerUrl7dClk   += acc.clk_7d
    sumOfPerUrl28dImp  += acc.imp_28d
    sumOfPerUrl28dClk  += acc.clk_28d
    sumOfPerUrl28dSumPos += acc.sumpos_28d
    if (acc.imp_7d  > 0) urlsVisible7d++
    if (acc.clk_7d  > 0) urlsClicks7d++
    if (acc.imp_28d > 0) urlsVisible28d++
    if (acc.clk_28d > 0) urlsClicks28d++
    if (acc.imp_28d > 0) pagesWithImpressions28d++
    if (acc.clk_28d >= 1)  pagesGe1_28d++
    if (acc.clk_28d >= 10) pagesGe10_28d++
    if (acc.clk_28d >= 28) pagesGe28_28d++
  }

  // ── Guard 1: INTERNAL consistency ────────────────────────────────────
  const internalMismatches = []
  if (sumOfPerUrl7dImp   !== site7dImp)  internalMismatches.push(`sum(per-URL imp_7d) ${sumOfPerUrl7dImp} ≠ site7dImp ${site7dImp}`)
  if (sumOfPerUrl7dClk   !== site7dClk)  internalMismatches.push(`sum(per-URL clk_7d) ${sumOfPerUrl7dClk} ≠ site7dClk ${site7dClk}`)
  if (sumOfPerUrl28dImp  !== site28dImp) internalMismatches.push(`sum(per-URL imp_28d) ${sumOfPerUrl28dImp} ≠ site28dImp ${site28dImp}`)
  if (sumOfPerUrl28dClk  !== site28dClk) internalMismatches.push(`sum(per-URL clk_28d) ${sumOfPerUrl28dClk} ≠ site28dClk ${site28dClk}`)
  // Float-tolerant equality on sum_position (BQ writes double precision).
  if (Math.abs(sumOfPerUrl28dSumPos - site28dSumPos) > 1e-6) {
    internalMismatches.push(`sum(per-URL sumpos_28d) ${sumOfPerUrl28dSumPos} ≠ site28dSumPos ${site28dSumPos}`)
  }
  if (internalMismatches.length) {
    for (const m of internalMismatches) console.error(`  ✘ ${m}`)
    await closeRun({ status: 'error', error: `internal accumulator mismatch: ${internalMismatches.join('; ')}` })
    die('internal accumulator inconsistency — refusing to write')
  }

  // ── Guard 2: ANCHOR check ────────────────────────────────────────────
  // Defaults are only meaningful for as_of_date = 2026-09-16. For other
  // dates, either pass --expected-* explicitly or pass --skip-anchors.
  //
  // These four values are the raw-daily 28d/7d aggregate truth for
  // 2026-09-16 verified by the Stage 4A refresh script itself. Note
  // that a prior audit iteration reported 693,881/4,890 for the 28d
  // window — that number was produced by an unstable paginator
  // (`.order('date')` with no secondary sort) that duplicated rows
  // across page boundaries. The refresh script's own paginator
  // orders by (date, url) and reads each row exactly once; 658,982
  // impressions and 3,847 clicks is the true 28d sum from raw daily.
  let anchorImp7  = args['expected-7d-impressions']  != null ? Number(args['expected-7d-impressions'])  : null
  let anchorClk7  = args['expected-7d-clicks']       != null ? Number(args['expected-7d-clicks'])       : null
  let anchorImp28 = args['expected-28d-impressions'] != null ? Number(args['expected-28d-impressions']) : null
  let anchorClk28 = args['expected-28d-clicks']      != null ? Number(args['expected-28d-clicks'])      : null
  const skipAnchors = args['skip-anchors'] === true
  const usingBuiltinAnchors = !skipAnchors && anchorImp7 == null && asOfDate === '2026-09-16'
  if (usingBuiltinAnchors) {
    anchorImp7  = 204450
    anchorClk7  = 1072
    anchorImp28 = 658982
    anchorClk28 = 3847
  }
  const anchorMismatches = []
  if (!skipAnchors && anchorImp7  != null && site7dImp   !== anchorImp7)  anchorMismatches.push(`site 7d impressions ${site7dImp} ≠ expected ${anchorImp7}`)
  if (!skipAnchors && anchorClk7  != null && site7dClk   !== anchorClk7)  anchorMismatches.push(`site 7d clicks ${site7dClk} ≠ expected ${anchorClk7}`)
  if (!skipAnchors && anchorImp28 != null && site28dImp  !== anchorImp28) anchorMismatches.push(`site 28d impressions ${site28dImp} ≠ expected ${anchorImp28}`)
  if (!skipAnchors && anchorClk28 != null && site28dClk  !== anchorClk28) anchorMismatches.push(`site 28d clicks ${site28dClk} ≠ expected ${anchorClk28}`)
  if (anchorMismatches.length) {
    for (const m of anchorMismatches) console.error(`  ✘ ${m}`)
    await closeRun({ status: 'error', error: `anchor mismatch: ${anchorMismatches.join('; ')}` })
    die('anchor reconciliation failed — refusing to write')
  }

  // ── Registry snapshots (HEAD counts, aggregate-safe) ─────────────────
  console.log('[refresh] reading registry counts (seo_pages)…')
  const totalUrlsKnown = await headCount('seo_pages', { site_key: SITE_KEY })
  const urlsIndexable  = await headCount('seo_pages', { site_key: SITE_KEY, is_indexable_now: true })
  const urlsInSitemap  = await headCount('seo_pages', { site_key: SITE_KEY, in_sitemap: true })

  // ── Derived (report-only) ────────────────────────────────────────────
  const ctr7d  = site7dImp  > 0 ? site7dClk  / site7dImp  : null
  const ctr28d = site28dImp > 0 ? site28dClk / site28dImp : null
  const avgPos7d  = site7dImp  > 0 ? (site7dSumPos  / site7dImp)  + 1 : null
  const avgPos28d = site28dImp > 0 ? (site28dSumPos / site28dImp) + 1 : null

  // ── Report BEFORE writing ────────────────────────────────────────────
  console.log('')
  console.log('=== Site-level rollup summary (pre-write) ===')
  console.log(`  URLs in 90d accumulator:      ${perUrl.size.toLocaleString()}`)
  console.log(`  URLs visible in 7d:           ${urlsVisible7d.toLocaleString()}`)
  console.log(`  URLs with clicks in 7d:       ${urlsClicks7d.toLocaleString()}`)
  console.log(`  URLs visible in 28d:          ${urlsVisible28d.toLocaleString()}`)
  console.log(`  URLs with clicks in 28d:      ${urlsClicks28d.toLocaleString()}`)
  console.log(`  pages_with_impressions_28d:   ${pagesWithImpressions28d.toLocaleString()}`)
  console.log(`  pages_ge1_click_28d:          ${pagesGe1_28d.toLocaleString()}`)
  console.log(`  pages_ge10_click_28d:         ${pagesGe10_28d.toLocaleString()}`)
  console.log(`  pages_ge28_click_28d:         ${pagesGe28_28d.toLocaleString()}   ← productive`)
  console.log('')
  console.log(`  site 7d:   ${site7dImp.toLocaleString().padStart(9)} impressions · ${site7dClk.toLocaleString().padStart(6)} clicks  · CTR ${ctr7d  != null ? (ctr7d  * 100).toFixed(3) + '%' : '—'} · avg_pos ${avgPos7d  != null ? avgPos7d.toFixed(2)  : '—'}`)
  console.log(`  site 28d:  ${site28dImp.toLocaleString().padStart(9)} impressions · ${site28dClk.toLocaleString().padStart(6)} clicks  · CTR ${ctr28d != null ? (ctr28d * 100).toFixed(3) + '%' : '—'} · avg_pos ${avgPos28d != null ? avgPos28d.toFixed(2) : '—'}`)
  console.log('')
  console.log(`  registry: total_urls_known=${totalUrlsKnown} · urls_indexable=${urlsIndexable} · urls_in_sitemap=${urlsInSitemap}${totalUrlsKnown === 0 ? '   (seo_pages empty — Stage 2 will populate)' : ''}`)
  if (usingBuiltinAnchors) {
    console.log('  anchor check: PASSED against built-in 2026-09-16 baseline (204,450 / 1,072 · 658,982 / 3,847)')
  } else if (skipAnchors) {
    console.log('  anchor check: SKIPPED (--skip-anchors)')
  } else if (anchorImp7 != null || anchorImp28 != null) {
    console.log('  anchor check: PASSED against user-supplied --expected-* values')
  } else {
    console.log('  anchor check: NOT APPLIED (no built-in defaults for this as_of_date; pass --expected-* or --skip-anchors)')
  }
  console.log('')

  // ── Build rollup rows ────────────────────────────────────────────────
  const nowISO = new Date().toISOString()
  const rollupRows = []
  for (const [url, acc] of perUrl.entries()) {
    rollupRows.push({
      site_key: SITE_KEY,
      source: SOURCE,
      url,
      clicks_7d:      acc.clk_7d,
      clicks_28d:     acc.clk_28d,
      clicks_90d:     acc.clk_90d,
      impressions_7d:  acc.imp_7d,
      impressions_28d: acc.imp_28d,
      impressions_90d: acc.imp_90d,
      // Store the additive primitive; NULL when the 28d window carries no
      // impressions (position undefined). productive_28d is GENERATED and
      // MUST NOT be included in the insert payload.
      sum_position_28d: acc.imp_28d > 0 ? acc.sumpos_28d : null,
      refreshed_at: nowISO,
    })
  }

  // ── Upsert rollups in chunks ─────────────────────────────────────────
  console.log(`[refresh] upserting ${rollupRows.length.toLocaleString()} rollup rows (chunks of 500)…`)
  const chunkSize = 500
  let written = 0
  for (let i = 0; i < rollupRows.length; i += chunkSize) {
    const chunk = rollupRows.slice(i, i + chunkSize)
    const { error } = await supa
      .from('seo_page_rollups')
      .upsert(chunk, { onConflict: 'site_key,source,url', ignoreDuplicates: false })
    if (error) throw new Error(`rollups upsert chunk ${i}: ${error.message}`)
    written += chunk.length
    if ((i / chunkSize) % 20 === 0 && i > 0) {
      console.log(`[refresh]   … ${written}/${rollupRows.length} upserted`)
    }
  }
  console.log(`[refresh]   ${written} rollup rows upserted`)

  // ── Stage 4A · Prune stale rollup rows ──────────────────────────────
  //
  // seo_page_rollups is a CURRENT SNAPSHOT convenience table (see
  // migration 2026-09-18-seo-03-page-rollups.sql). Its rows must
  // represent EXACTLY the current accumulator derived from raw daily
  // rows. Prior versions of this script only UPSERTed — URLs that had
  // activity in an earlier as_of_date's 90-day window but no longer
  // appear in the current 90-day accumulator survived indefinitely,
  // carrying stale imp_28d / clk_28d values that inflated site-level
  // aggregates when read by Mission Control.
  //
  // Fix: read all existing rollup URLs for (site_key, source), diff
  // against the fresh accumulator, and delete any URL not present in
  // the current accumulator. Scope is strictly the current
  // (site_key, source) pair — no cross-source or cross-site rows are
  // touched. Idempotent: on a second run with the same raw daily
  // state, the delete set is empty.
  console.log('[refresh] scanning seo_page_rollups for stale URLs…')
  const currentUrls = new Set(perUrl.keys())
  const existingRollupUrls = []
  {
    const CHUNK = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supa
        .from('seo_page_rollups')
        .select('url')
        .eq('site_key', SITE_KEY)
        .eq('source', SOURCE)
        .order('url', { ascending: true })
        .range(offset, offset + CHUNK - 1)
      if (error) throw new Error(`stale scan chunk at ${offset}: ${error.message}`)
      if (!data || data.length === 0) break
      for (const r of data) existingRollupUrls.push(String(r.url))
      if (data.length < CHUNK) break
      offset += CHUNK
    }
  }
  console.log(`[refresh]   ${existingRollupUrls.length.toLocaleString()} existing rollup rows`)
  const staleUrls = existingRollupUrls.filter(u => !currentUrls.has(u))
  console.log(`[refresh]   ${staleUrls.length.toLocaleString()} stale URLs to delete (in table but not in current accumulator)`)

  if (staleUrls.length > 0) {
    // Delete in modest chunks. `.in()` inline URL lists must stay
    // under PostgREST's request-URL length limit (~2 KB). URL slugs
    // here can be long (encoded set names + card slugs), so keep
    // chunk size conservative.
    const DELETE_CHUNK = 80
    let deleted = 0
    for (let i = 0; i < staleUrls.length; i += DELETE_CHUNK) {
      const chunk = staleUrls.slice(i, i + DELETE_CHUNK)
      const { error } = await supa
        .from('seo_page_rollups')
        .delete()
        .eq('site_key', SITE_KEY)
        .eq('source', SOURCE)
        .in('url', chunk)
      if (error) throw new Error(`stale delete chunk ${i}: ${error.message}`)
      deleted += chunk.length
      if ((i / DELETE_CHUNK) % 10 === 0 && i > 0) {
        console.log(`[refresh]     … ${deleted}/${staleUrls.length} deleted`)
      }
    }
    console.log(`[refresh]   ${deleted.toLocaleString()} stale rows deleted`)
  }

  // ── Stage 4A · Hard reconciliation before writing KPI ───────────────
  //
  // Read seo_page_rollups back and confirm the persisted state matches
  // the fresh accumulator BEFORE upserting the KPI row. If any
  // invariant fails, abort — an inconsistent rollup with a matching
  // KPI would look consistent to the dashboard but silently deceive.
  console.log('[refresh] hard reconciliation: re-reading seo_page_rollups…')
  let dbClk7 = 0, dbImp7 = 0
  let dbClk28 = 0, dbImp28 = 0
  let dbVisible = 0, dbGe1 = 0, dbGe10 = 0, dbGe28 = 0
  let dbRows = 0
  {
    const CHUNK = 1000
    let offset = 0
    while (true) {
      const { data, error } = await supa
        .from('seo_page_rollups')
        .select('clicks_7d, clicks_28d, impressions_7d, impressions_28d')
        .eq('site_key', SITE_KEY)
        .eq('source', SOURCE)
        .order('url', { ascending: true })
        .range(offset, offset + CHUNK - 1)
      if (error) throw new Error(`reconciliation read at ${offset}: ${error.message}`)
      if (!data || data.length === 0) break
      for (const r of data) {
        dbRows++
        const c7  = Number(r.clicks_7d ?? 0)
        const c28 = Number(r.clicks_28d ?? 0)
        const i7  = Number(r.impressions_7d ?? 0)
        const i28 = Number(r.impressions_28d ?? 0)
        dbClk7 += c7; dbImp7 += i7
        dbClk28 += c28; dbImp28 += i28
        if (i28 > 0)  dbVisible++
        if (c28 >= 1)  dbGe1++
        if (c28 >= 10) dbGe10++
        if (c28 >= 28) dbGe28++
      }
      if (data.length < CHUNK) break
      offset += CHUNK
    }
  }

  const invariants = [
    ['rollup rowcount',        dbRows,     rollupRows.length],
    ['Σ clicks_7d',            dbClk7,     site7dClk],
    ['Σ impressions_7d',       dbImp7,     site7dImp],
    ['Σ clicks_28d',           dbClk28,    site28dClk],
    ['Σ impressions_28d',      dbImp28,    site28dImp],
    ['count(imp_28d > 0)',     dbVisible,  pagesWithImpressions28d],
    ['count(clk_28d >= 1)',    dbGe1,      pagesGe1_28d],
    ['count(clk_28d >= 10)',   dbGe10,     pagesGe10_28d],
    ['count(clk_28d >= 28)',   dbGe28,     pagesGe28_28d],
  ]
  const reconciliationFailures = invariants.filter(([, actual, expected]) => actual !== expected)
  console.log('[refresh]   rollup reconciliation:')
  for (const [label, actual, expected] of invariants) {
    const ok = actual === expected
    console.log(`     ${ok ? '✓' : '✗'} ${label.padEnd(24)} db=${String(actual).padStart(9)}  fresh=${String(expected).padStart(9)}`)
  }
  if (reconciliationFailures.length > 0) {
    await closeRun({
      status: 'error',
      error: `rollup ↔ accumulator mismatch: ${reconciliationFailures.map(([l, a, e]) => `${l} ${a}!=${e}`).join('; ')}`,
    })
    die('rollup reconciliation FAILED — refusing to write KPI. The rollup table state does not match the fresh accumulator; investigate before rerunning.')
  }
  console.log('[refresh]   reconciliation OK — persisted rollups match the fresh accumulator exactly.')

  // ── Upsert KPI daily row ────────────────────────────────────────────
  console.log('[refresh] upserting seo_kpi_daily row…')
  const kpiRow = {
    site_key: SITE_KEY,
    source: SOURCE,
    date: asOfDate,
    clicks_28d: site28dClk,
    impressions_28d: site28dImp,
    pages_with_impressions_28d: pagesWithImpressions28d,
    pages_ge1_click_28d:  pagesGe1_28d,
    pages_ge10_click_28d: pagesGe10_28d,
    pages_ge28_click_28d: pagesGe28_28d,
    total_urls_known: totalUrlsKnown,
    urls_indexable:   urlsIndexable,
    urls_in_sitemap:  urlsInSitemap,
    sum_position_28d: site28dSumPos,
    refreshed_at: nowISO,
  }
  {
    const { error } = await supa
      .from('seo_kpi_daily')
      .upsert(kpiRow, { onConflict: 'site_key,source,date', ignoreDuplicates: false })
    if (error) throw new Error(`kpi upsert: ${error.message}`)
  }

  // ── Post-write verification ─────────────────────────────────────────
  // Stage 4A note: the stale-prune + hard reconciliation above already
  // guarantee dbRollupCount === rollupRows.length. This check remains
  // as a belt-and-braces confirmation and would fail loudly if the
  // KPI upsert somehow disturbed row counts.
  console.log('[refresh] verifying writes…')
  const dbRollupCount = await headCount('seo_page_rollups', { site_key: SITE_KEY, source: SOURCE })
  if (dbRollupCount !== rollupRows.length) {
    throw new Error(
      `seo_page_rollups row count ${dbRollupCount} != accumulator ${rollupRows.length} after prune + upsert. ` +
      'This should be impossible after the Stage 4A prune step; investigate before rerunning.'
    )
  }
  const { data: kpiCheck, error: kpiCheckErr } = await supa
    .from('seo_kpi_daily')
    .select('*')
    .eq('site_key', SITE_KEY)
    .eq('source', SOURCE)
    .eq('date', asOfDate)
    .single()
  if (kpiCheckErr || !kpiCheck) throw new Error(`kpi verification read: ${kpiCheckErr?.message ?? 'no row'}`)
  const kpiChecks = []
  if (Number(kpiCheck.clicks_28d)      !== site28dClk)          kpiChecks.push(`kpi.clicks_28d`)
  if (Number(kpiCheck.impressions_28d) !== site28dImp)          kpiChecks.push(`kpi.impressions_28d`)
  if (Number(kpiCheck.pages_ge28_click_28d) !== pagesGe28_28d)  kpiChecks.push(`kpi.pages_ge28_click_28d`)
  if (Number(kpiCheck.pages_ge1_click_28d)  !== pagesGe1_28d)   kpiChecks.push(`kpi.pages_ge1_click_28d`)
  if (Number(kpiCheck.pages_ge10_click_28d) !== pagesGe10_28d)  kpiChecks.push(`kpi.pages_ge10_click_28d`)
  if (Number(kpiCheck.pages_with_impressions_28d) !== pagesWithImpressions28d) kpiChecks.push(`kpi.pages_with_impressions_28d`)
  if (kpiChecks.length) {
    throw new Error(`kpi read-back mismatch on: ${kpiChecks.join(', ')}`)
  }

  // ── Final report ─────────────────────────────────────────────────────
  console.log('')
  console.log('=== Refresh complete ===')
  console.log(`  as_of_date:                   ${asOfDate}`)
  console.log(`  page rollup rows written:     ${written.toLocaleString()}`)
  console.log(`  stale rows deleted:           ${staleUrls.length.toLocaleString()}`)
  console.log(`  KPI rows written/updated:     1  (site_key=${SITE_KEY}, source=${SOURCE}, date=${asOfDate})`)
  console.log(`  db rollup row count:          ${dbRollupCount.toLocaleString()}`)
  console.log(`  invariants verified:          ${invariants.length}/${invariants.length}`)
  console.log('')
  console.log('Result: PASS')

  await closeRun({ status: 'ok', rows: written + 1 })
} catch (err) {
  await closeRun({ status: 'error', error: err.message })
  console.error(`[refresh] FAILED: ${err.message}`)
  process.exit(1)
}
