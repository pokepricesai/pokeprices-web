// PP-TCG migration — throughput, ETA, and failure-rate metrics.
// Read-only. Used by the admin dashboard.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface RunMetrics {
  run_id:            string
  totals: {
    total:        number
    pending:      number
    claimed:      number
    verified:     number
    failed:       number
    skipped:      number
    rolled_back:  number
  }
  throughput: {
    last_hour:    number    // verified in last 60 min
    last_24h:     number    // verified in last 24 h
    today:        number    // verified since UTC midnight
  }
  eta_hours:         number | null  // based on last-24h throughput
  consecutive_failures: number  // consecutive items ending in failed, latest-first
  recent_failure_pct: number    // failures / (failures + verified) over last 100
}

export async function runMetrics(sb: SupabaseClient, run_id: string): Promise<RunMetrics> {
  const [{ count: total }, { count: pending }, { count: claimed }, { count: verified }, { count: failed }, { count: skipped }, { count: rolled_back }] = await Promise.all([
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'pending'),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'claimed'),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'verified'),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'failed'),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'skipped'),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'rolled_back'),
  ])

  const nowIso    = new Date().toISOString()
  const hourAgo   = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const dayAgo    = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const todayISO  = new Date().toISOString().slice(0, 10) + 'T00:00:00Z'

  const [{ count: lastHour }, { count: last24h }, { count: todayCount }] = await Promise.all([
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'verified').gte('verified_at', hourAgo),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'verified').gte('verified_at', dayAgo),
    sb.from('pp_tcg_migration_run_item').select('*', { count: 'exact', head: true }).eq('run_id', run_id).eq('status', 'verified').gte('verified_at', todayISO),
  ])

  // Consecutive failures: look at last 20 terminal transitions, latest-first
  const { data: recent } = await sb.from('pp_tcg_migration_run_item')
    .select('status,verified_at,rolled_back_at,updated_at')
    .eq('run_id', run_id)
    .in('status', ['verified','failed'])
    .order('updated_at', { ascending: false })
    .limit(100)
  const recentArr = (recent ?? []) as Array<{ status: 'verified' | 'failed' }>
  let consecutive_failures = 0
  for (const r of recentArr) {
    if (r.status === 'failed') consecutive_failures++
    else break
  }
  const failedInWindow = recentArr.filter(r => r.status === 'failed').length
  const recent_failure_pct = recentArr.length === 0 ? 0 : Math.round((failedInWindow / recentArr.length) * 100)

  const pendingItems = (pending ?? 0) + (claimed ?? 0)
  const rate_per_hour = ((last24h ?? 0) / 24) || 0
  const eta_hours = rate_per_hour > 0 ? Math.ceil(pendingItems / rate_per_hour) : null

  return {
    run_id,
    totals: {
      total:       total       ?? 0,
      pending:     pending     ?? 0,
      claimed:     claimed     ?? 0,
      verified:    verified    ?? 0,
      failed:      failed      ?? 0,
      skipped:     skipped     ?? 0,
      rolled_back: rolled_back ?? 0,
    },
    throughput: {
      last_hour: lastHour ?? 0,
      last_24h:  last24h  ?? 0,
      today:     todayCount ?? 0,
    },
    eta_hours,
    consecutive_failures,
    recent_failure_pct,
  }
}
