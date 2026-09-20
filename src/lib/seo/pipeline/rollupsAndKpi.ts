// src/lib/seo/pipeline/rollupsAndKpi.ts
// ============================================================================
// Stage 4C — reusable rollup + KPI refresh logic.
//
// Mirrors scripts/seo/refresh-rollups-and-kpi.mjs (Stage 4A behaviour)
// as a Node-friendly module callable from the /api/cron/seo-daily
// orchestrator. Behaviour is byte-for-byte equivalent to the CLI
// script under `--skip-anchors` (automation intentionally skips the
// point-in-time anchor check; the Stage 4A hard reconciliation catches
// any accumulator bug regardless).
//
// Flow:
//   1. Read raw daily rows across the 90d window from asOfDate.
//   2. Aggregate to per-URL accumulator; track site totals in parallel.
//   3. Guard 1 — internal consistency: SUM(per-URL) == site-wide totals.
//   4. Upsert every accumulator URL to seo_page_rollups.
//   5. Delete rows for URLs no longer present in the accumulator
//      (Stage 4A stale prune; snapshot semantics).
//   6. Hard reconciliation: re-read seo_page_rollups, verify 9 invariants
//      against the accumulator. Any mismatch aborts before KPI write.
//   7. Upsert seo_kpi_daily.
//   8. Emit summary + telemetry row.
// ============================================================================

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

const SITE_KEY = 'pokeprices'
const SOURCE   = 'google'
const JOB_KIND = 'rollup_refresh'

export type RefreshResult = {
  status: 'ok' | 'error'
  as_of_date: string
  rollup_rows_written: number
  stale_rows_deleted: number
  invariants_passed: boolean
  totals: {
    clicks_7d: number
    impressions_7d: number
    clicks_28d: number
    impressions_28d: number
    pages_with_impressions_28d: number
    pages_ge1_click_28d: number
    pages_ge10_click_28d: number
    pages_ge28_click_28d: number
  }
  run_id: string | null
  error?: string
}

function isoDay(d: string | Date): string {
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

async function headCount(
  supa: SupabaseClient, table: string, filters: Record<string, any>,
): Promise<number> {
  let q = supa.from(table).select('*', { count: 'exact', head: true })
  for (const [col, val] of Object.entries(filters)) q = q.eq(col, val)
  const { count, error } = await q
  if (error) throw new Error(`headCount(${table}): ${error.message}`)
  return count ?? 0
}

/** Perform the rollup + KPI refresh. Idempotent under identical raw
 *  daily state. Never advances the KPI row if reconciliation fails. */
export async function runRollupRefresh(
  supa: SupabaseClient,
  asOfDate: string,
): Promise<RefreshResult> {
  // Open telemetry run.
  let runId: string | null = null
  {
    const { data, error } = await supa
      .from('seo_bq_ingest_runs')
      .insert({ site_key: SITE_KEY, source: SOURCE, job_kind: JOB_KIND, status: 'in_progress' })
      .select('run_id').single()
    if (error) throw new Error(`open refresh run: ${error.message}`)
    runId = data.run_id as string
  }
  const closeRun = async (patch: { status: string; rows?: number; error?: string }) => {
    if (!runId) return
    await supa.from('seo_bq_ingest_runs').update({
      ended_at: new Date().toISOString(),
      status: patch.status,
      rows_ingested: patch.rows ?? null,
      error: patch.error ?? null,
    }).eq('run_id', runId)
  }

  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) throw new Error(`as_of_date must be YYYY-MM-DD, got ${asOfDate}`)

    const window7Start  = addDaysISO(asOfDate, -6)
    const window28Start = addDaysISO(asOfDate, -27)
    const window90Start = addDaysISO(asOfDate, -89)

    // 1) Read raw daily rows across the 90d window (paginated).
    const rawRows: Array<{ url: string; date: string; impressions: number; clicks: number; sum_position: number }> = []
    {
      const CHUNK = 1000
      let from = 0
      while (true) {
        const { data, error } = await supa
          .from('seo_gsc_page_daily')
          .select('url,date,impressions,clicks,sum_position')
          .eq('site_key', SITE_KEY).eq('source', SOURCE)
          .gte('date', window90Start).lte('date', asOfDate)
          .order('date', { ascending: true }).order('url', { ascending: true })
          .range(from, from + CHUNK - 1)
        if (error) throw new Error(`readWindow page ${from}: ${error.message}`)
        if (!data || data.length === 0) break
        rawRows.push(...(data as any))
        if (data.length < CHUNK) break
        from += CHUNK
      }
    }
    if (rawRows.length === 0) throw new Error('no raw rows in the 90d window — nothing to roll up')

    // 2) Accumulate.
    type Acc = { imp_7d: number; imp_28d: number; imp_90d: number; clk_7d: number; clk_28d: number; clk_90d: number; sumpos_28d: number }
    const perUrl = new Map<string, Acc>()
    let site7dImp = 0, site7dClk = 0
    let site28dImp = 0, site28dClk = 0, site28dSumPos = 0

    for (const r of rawRows) {
      const url = String(r.url)
      const date = isoDay(r.date)
      const imp = Number(r.impressions || 0)
      const clk = Number(r.clicks || 0)
      const sp  = Number(r.sum_position || 0)
      let acc = perUrl.get(url)
      if (!acc) {
        acc = { imp_7d: 0, imp_28d: 0, imp_90d: 0, clk_7d: 0, clk_28d: 0, clk_90d: 0, sumpos_28d: 0 }
        perUrl.set(url, acc)
      }
      acc.imp_90d += imp; acc.clk_90d += clk
      if (date >= window28Start) {
        acc.imp_28d += imp; acc.clk_28d += clk; acc.sumpos_28d += sp
        site28dImp += imp; site28dClk += clk; site28dSumPos += sp
      }
      if (date >= window7Start) {
        acc.imp_7d += imp; acc.clk_7d += clk
        site7dImp += imp; site7dClk += clk
      }
    }

    let pagesWithImpressions28d = 0
    let pagesGe1_28d = 0, pagesGe10_28d = 0, pagesGe28_28d = 0
    let sumPerUrl7dImp = 0, sumPerUrl7dClk = 0
    let sumPerUrl28dImp = 0, sumPerUrl28dClk = 0, sumPerUrl28dSumPos = 0
    perUrl.forEach(acc => {
      sumPerUrl7dImp  += acc.imp_7d
      sumPerUrl7dClk  += acc.clk_7d
      sumPerUrl28dImp += acc.imp_28d
      sumPerUrl28dClk += acc.clk_28d
      sumPerUrl28dSumPos += acc.sumpos_28d
      if (acc.imp_28d > 0)  pagesWithImpressions28d++
      if (acc.clk_28d >= 1)  pagesGe1_28d++
      if (acc.clk_28d >= 10) pagesGe10_28d++
      if (acc.clk_28d >= 28) pagesGe28_28d++
    })

    // 3) Guard 1 — internal consistency.
    const mismatches: string[] = []
    if (sumPerUrl7dImp   !== site7dImp)  mismatches.push(`sum(imp_7d) ${sumPerUrl7dImp} ≠ site ${site7dImp}`)
    if (sumPerUrl7dClk   !== site7dClk)  mismatches.push(`sum(clk_7d) ${sumPerUrl7dClk} ≠ site ${site7dClk}`)
    if (sumPerUrl28dImp  !== site28dImp) mismatches.push(`sum(imp_28d) ${sumPerUrl28dImp} ≠ site ${site28dImp}`)
    if (sumPerUrl28dClk  !== site28dClk) mismatches.push(`sum(clk_28d) ${sumPerUrl28dClk} ≠ site ${site28dClk}`)
    if (Math.abs(sumPerUrl28dSumPos - site28dSumPos) > 1e-6) {
      mismatches.push(`sum(sumpos_28d) ${sumPerUrl28dSumPos} ≠ site ${site28dSumPos}`)
    }
    if (mismatches.length) throw new Error(`internal accumulator inconsistency: ${mismatches.join('; ')}`)

    // 4) Registry HEAD counts for the KPI row.
    const totalUrlsKnown = await headCount(supa, 'seo_pages', { site_key: SITE_KEY })
    const urlsIndexable  = await headCount(supa, 'seo_pages', { site_key: SITE_KEY, is_indexable_now: true })
    const urlsInSitemap  = await headCount(supa, 'seo_pages', { site_key: SITE_KEY, in_sitemap: true })

    // 5) Upsert rollups.
    const nowISO = new Date().toISOString()
    const rollupRows = Array.from(perUrl.entries()).map(([url, acc]) => ({
      site_key: SITE_KEY, source: SOURCE, url,
      clicks_7d:      acc.clk_7d,  clicks_28d:  acc.clk_28d,  clicks_90d:  acc.clk_90d,
      impressions_7d: acc.imp_7d,  impressions_28d: acc.imp_28d, impressions_90d: acc.imp_90d,
      sum_position_28d: acc.imp_28d > 0 ? acc.sumpos_28d : null,
      refreshed_at: nowISO,
    }))
    {
      const CHUNK = 500
      for (let i = 0; i < rollupRows.length; i += CHUNK) {
        const chunk = rollupRows.slice(i, i + CHUNK)
        const { error } = await supa
          .from('seo_page_rollups')
          .upsert(chunk, { onConflict: 'site_key,source,url', ignoreDuplicates: false })
        if (error) throw new Error(`rollups upsert chunk ${i}: ${error.message}`)
      }
    }

    // 6) Stage 4A stale prune — delete rows not in the fresh accumulator.
    const currentUrls = new Set<string>(perUrl.keys())
    const existingRollupUrls: string[] = []
    {
      const CHUNK = 1000
      let off = 0
      while (true) {
        const { data, error } = await supa
          .from('seo_page_rollups').select('url')
          .eq('site_key', SITE_KEY).eq('source', SOURCE)
          .order('url', { ascending: true })
          .range(off, off + CHUNK - 1)
        if (error) throw new Error(`stale scan ${off}: ${error.message}`)
        if (!data || data.length === 0) break
        for (const r of data as any[]) existingRollupUrls.push(String(r.url))
        if (data.length < CHUNK) break
        off += CHUNK
      }
    }
    const staleUrls = existingRollupUrls.filter(u => !currentUrls.has(u))
    if (staleUrls.length > 0) {
      const DEL = 80
      for (let i = 0; i < staleUrls.length; i += DEL) {
        const { error } = await supa
          .from('seo_page_rollups').delete()
          .eq('site_key', SITE_KEY).eq('source', SOURCE)
          .in('url', staleUrls.slice(i, i + DEL))
        if (error) throw new Error(`stale delete chunk ${i}: ${error.message}`)
      }
    }

    // 7) Stage 4A hard reconciliation — re-read + verify.
    let dbRows = 0, dbClk7 = 0, dbImp7 = 0, dbClk28 = 0, dbImp28 = 0
    let dbVisible = 0, dbGe1 = 0, dbGe10 = 0, dbGe28 = 0
    {
      const CHUNK = 1000
      let off = 0
      while (true) {
        const { data, error } = await supa
          .from('seo_page_rollups')
          .select('clicks_7d, clicks_28d, impressions_7d, impressions_28d')
          .eq('site_key', SITE_KEY).eq('source', SOURCE)
          .order('url', { ascending: true })
          .range(off, off + CHUNK - 1)
        if (error) throw new Error(`reconciliation read ${off}: ${error.message}`)
        if (!data || data.length === 0) break
        for (const r of data as any[]) {
          dbRows++
          const c7 = Number(r.clicks_7d ?? 0), c28 = Number(r.clicks_28d ?? 0)
          const i7 = Number(r.impressions_7d ?? 0), i28 = Number(r.impressions_28d ?? 0)
          dbClk7  += c7;  dbImp7  += i7
          dbClk28 += c28; dbImp28 += i28
          if (i28 > 0)   dbVisible++
          if (c28 >= 1)  dbGe1++
          if (c28 >= 10) dbGe10++
          if (c28 >= 28) dbGe28++
        }
        if (data.length < CHUNK) break
        off += CHUNK
      }
    }
    const invariants: Array<[string, number, number]> = [
      ['rollup rowcount',      dbRows,    rollupRows.length],
      ['Σ clicks_7d',          dbClk7,    site7dClk],
      ['Σ impressions_7d',     dbImp7,    site7dImp],
      ['Σ clicks_28d',         dbClk28,   site28dClk],
      ['Σ impressions_28d',    dbImp28,   site28dImp],
      ['count(imp_28d > 0)',   dbVisible, pagesWithImpressions28d],
      ['count(clk_28d >= 1)',  dbGe1,     pagesGe1_28d],
      ['count(clk_28d >= 10)', dbGe10,    pagesGe10_28d],
      ['count(clk_28d >= 28)', dbGe28,    pagesGe28_28d],
    ]
    const failures = invariants.filter(([, a, e]) => a !== e)
    if (failures.length) {
      throw new Error(`rollup ↔ accumulator mismatch: ${failures.map(([l, a, e]) => `${l} ${a}!=${e}`).join('; ')}`)
    }

    // 8) Upsert KPI row.
    const kpiRow = {
      site_key: SITE_KEY, source: SOURCE, date: asOfDate,
      clicks_28d: site28dClk, impressions_28d: site28dImp,
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

    await closeRun({ status: 'ok', rows: rollupRows.length + 1 })
    return {
      status: 'ok',
      as_of_date: asOfDate,
      rollup_rows_written: rollupRows.length,
      stale_rows_deleted: staleUrls.length,
      invariants_passed: true,
      totals: {
        clicks_7d: site7dClk,
        impressions_7d: site7dImp,
        clicks_28d: site28dClk,
        impressions_28d: site28dImp,
        pages_with_impressions_28d: pagesWithImpressions28d,
        pages_ge1_click_28d:  pagesGe1_28d,
        pages_ge10_click_28d: pagesGe10_28d,
        pages_ge28_click_28d: pagesGe28_28d,
      },
      run_id: runId,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    await closeRun({ status: 'error', error: message })
    return {
      status: 'error',
      as_of_date: asOfDate,
      rollup_rows_written: 0,
      stale_rows_deleted: 0,
      invariants_passed: false,
      totals: {
        clicks_7d: 0, impressions_7d: 0, clicks_28d: 0, impressions_28d: 0,
        pages_with_impressions_28d: 0, pages_ge1_click_28d: 0,
        pages_ge10_click_28d: 0, pages_ge28_click_28d: 0,
      },
      run_id: runId,
      error: message,
    }
  }
}
