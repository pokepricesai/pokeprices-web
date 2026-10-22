// PP-TCG migration — enrollment. Build the queue of run_items for a
// run, with cohort row insertion for slugs that have no existing row.
//
// Scope invariants (critical):
//   - Skip any slug currently prices_enabled=true in the cohort — it's
//     already active; nothing to migrate.
//   - Skip any slug already enrolled in ANY run_item (across all runs).
//   - Preserve existing cohort rows' notes field — do NOT overwrite.
//   - Insert new cohort rows with marker `PP-TCG-MIGRATE-ENROLL · run=<id>`.
//   - 14 original pilot + 4 thin + 10 manual expansion cards are protected
//     by (a) already-active OR (b) existing cohort notes that we don't rewrite
//     AND (c) not in any run_item — the enrollment never selects them.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listStrictCandidates, type ReconciliationRow } from './strict'
import type { MigrationRunConfig } from './types'

export interface EnrollmentReport {
  run_id:                      string
  strict_candidates_scanned:   number
  skipped_already_active:      number
  skipped_already_enrolled:    number
  new_cohort_rows_inserted:    number
  existing_cohort_rows_reused: number
  run_items_inserted:          number
  errors:                      string[]
}

/** Enroll all strict-corrected candidates (per cfg.language and
 *  cfg.selection_strategy) into the given run. Returns detailed counts
 *  — call once per run from the admin dashboard "Enroll items" button. */
export async function enrollRun(
  sb: SupabaseClient,
  run_id: string,
  cfg: MigrationRunConfig,
): Promise<EnrollmentReport> {
  const errors: string[] = []
  // (1) Scan the reconciliation view for all strict-corrected candidates.
  const candidates = await listStrictCandidates(sb, { language: cfg.language ?? 'any' })
  const strict_candidates_scanned = candidates.length

  // (2) Pre-fetch exclusions in bulk:
  //    (a) Slugs currently prices_enabled=true in cohort (already active).
  //    (b) Slugs already in any run_item (owned by another run).
  const { data: activeRows } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug').eq('prices_enabled', true)
  const activeSet = new Set((activeRows ?? []).map(r => r.pp_card_slug as string))

  const existingItemsAll: string[] = []
  let from = 0
  while (true) {
    const { data } = await sb.from('pp_tcg_migration_run_item')
      .select('pp_card_slug').order('pp_card_slug').range(from, from + 999)
    if (!data || !data.length) break
    existingItemsAll.push(...data.map(r => r.pp_card_slug as string))
    if (data.length < 1000) break
    from += 1000
  }
  const enrolledSet = new Set(existingItemsAll)

  const { data: cohortRowsAll } = await sb.from('pokemon_tcg_pilot_cohort').select('pp_card_slug')
  const existingCohortSet = new Set((cohortRowsAll ?? []).map(r => r.pp_card_slug as string))

  // (3) Classify + compute priority ranking.
  const toEnroll: Array<ReconciliationRow & { priority_tier: string; priority_rank: number }> = []
  let skipped_already_active   = 0
  let skipped_already_enrolled = 0
  const prioritisedCandidates = prioritise(candidates, cfg.selection_strategy ?? 'gsc_rank')

  prioritisedCandidates.forEach((row, idx) => {
    if (activeSet.has(row.pp_card_slug))   { skipped_already_active++;   return }
    if (enrolledSet.has(row.pp_card_slug)) { skipped_already_enrolled++; return }
    const { tier, rank } = assignPriority(row, idx)
    toEnroll.push({ ...row, priority_tier: tier, priority_rank: rank })
  })

  // (4) Insert cohort rows (ON CONFLICT DO NOTHING on unique pp_card_slug)
  //     for slugs we don't already have a row for.
  const needsCohortInsert = toEnroll.filter(r => !existingCohortSet.has(r.pp_card_slug))
  const existing_cohort_rows_reused = toEnroll.length - needsCohortInsert.length
  let new_cohort_rows_inserted = 0

  for (let i = 0; i < needsCohortInsert.length; i += 200) {
    const chunk = needsCohortInsert.slice(i, i + 200)
    const rows = chunk.map(r => ({
      pp_card_slug:    r.pp_card_slug,
      prices_enabled:  false,
      images_enabled:  false,
      history_enabled: false,
      notes:           `PP-TCG-MIGRATE-ENROLL · run=${run_id} · gsc_rank=${r.gsc_rank ?? 'null'}`,
    }))
    const { data, error } = await sb.from('pokemon_tcg_pilot_cohort')
      .upsert(rows, { onConflict: 'pp_card_slug', ignoreDuplicates: true })
      .select('pp_card_slug')
    if (error) { errors.push(`cohort insert chunk ${i}: ${error.message}`); continue }
    new_cohort_rows_inserted += data?.length ?? 0
  }

  // (5) Insert run_items. ON CONFLICT (run_id, pp_card_slug) DO NOTHING
  //     via upsert ignoreDuplicates.
  let run_items_inserted = 0
  for (let i = 0; i < toEnroll.length; i += 200) {
    const chunk = toEnroll.slice(i, i + 200)
    const items = chunk.map(r => ({
      run_id,
      pp_card_slug:          r.pp_card_slug,
      gsc_rank:              r.gsc_rank,
      effective_eligibility: r.effective_eligibility,
      priority_tier:         r.priority_tier,
      priority_rank:         r.priority_rank,
      status:                'pending' as const,
    }))
    const { data, error } = await sb.from('pp_tcg_migration_run_item')
      .upsert(items, { onConflict: 'run_id,pp_card_slug', ignoreDuplicates: true })
      .select('id')
    if (error) { errors.push(`run_item insert chunk ${i}: ${error.message}`); continue }
    run_items_inserted += data?.length ?? 0
  }

  return {
    run_id, strict_candidates_scanned,
    skipped_already_active, skipped_already_enrolled,
    new_cohort_rows_inserted, existing_cohort_rows_reused,
    run_items_inserted, errors,
  }
}

/** Prioritise candidates for enrollment ordering. Exported for tests. */
export function prioritise(rows: ReconciliationRow[], strategy: 'gsc_rank' | 'set_proximity_then_rank' | 'all_strict'): ReconciliationRow[] {
  if (strategy === 'gsc_rank') {
    return [...rows].sort((a, b) =>
      (a.gsc_rank ?? Number.MAX_SAFE_INTEGER) - (b.gsc_rank ?? Number.MAX_SAFE_INTEGER)
      || a.pp_card_slug.localeCompare(b.pp_card_slug)
    )
  }
  if (strategy === 'all_strict') {
    return [...rows].sort((a, b) => a.pp_card_slug.localeCompare(b.pp_card_slug))
  }
  // set_proximity_then_rank:
  //   1. GSC-ranked cards first, in rank order
  //   2. Within unranked, group by set and prefer sets whose GSC-ranked
  //      card count is highest
  //   3. Within a set, order by pp_card_slug for determinism
  const rankedSets = new Map<string, number>()
  for (const r of rows) {
    if (r.gsc_rank == null || !r.pp_set_name) continue
    rankedSets.set(r.pp_set_name, (rankedSets.get(r.pp_set_name) ?? 0) + 1)
  }
  const ranked   = rows.filter(r => r.gsc_rank != null).sort((a,b) => (a.gsc_rank! - b.gsc_rank!))
  const unranked = rows.filter(r => r.gsc_rank == null).sort((a,b) => {
    const aw = rankedSets.get(a.pp_set_name ?? '') ?? 0
    const bw = rankedSets.get(b.pp_set_name ?? '') ?? 0
    if (aw !== bw) return bw - aw
    return a.pp_card_slug.localeCompare(b.pp_card_slug)
  })
  return [...ranked, ...unranked]
}

export function assignPriority(row: ReconciliationRow, globalIdx: number): { tier: string; rank: number } {
  if (row.gsc_rank != null && row.gsc_rank <= 500)   return { tier: 'gsc_top_500',  rank: row.gsc_rank }
  if (row.gsc_rank != null && row.gsc_rank <= 1000)  return { tier: 'gsc_1k',       rank: row.gsc_rank }
  if (row.gsc_rank != null)                           return { tier: 'gsc_tail',     rank: row.gsc_rank }
  return { tier: 'unranked_set_prio', rank: globalIdx }
}
