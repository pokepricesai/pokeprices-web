// src/app/admin/pilot/migration/actions.ts
//
// Admin Server Actions for the automated-migration dashboard. All
// gated by requireAdminPage; never bypass admin authentication.
//
// Exposes:
//   - createRun(name, config)         → inserts a draft run
//   - enrollRunItems(runId)           → full strict-scan enrol; moves draft → ready
//   - enrollCanary(runId, limit)      → capped canary enrol (≤25); keeps run in draft
//   - transitionRun(runId, newStatus) → draft→ready→running→paused→running→stopped
//   - emergencyRollback(runId)        → bulk-disable verified items in a run
//   - revalidateRolledBack(runId)     → resumable revalidation of rolled-back URLs

'use server'
import { requireAdminPage } from '@/lib/adminAuth'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { revalidatePath } from 'next/cache'
import { enrollRun } from '@/lib/providerData/migration/enroll'
import { urlForSlug, flipCohortIdempotent } from '@/lib/providerData/migration/cohort'
import { verifyLegacyReturned } from '@/lib/providerData/migration/verify'
import { canTransition } from '@/lib/providerData/migration/stateMachine'
import type { MigrationStatus, MigrationRunConfig } from '@/lib/providerData/migration/types'
import { DEFAULT_CONFIG } from '@/lib/providerData/migration/types'

const ADMIN_INDEX = '/admin/pilot/migration'

export async function createRun(name: string, configOverrides: Partial<MigrationRunConfig>): Promise<{ id: string } | { error: string }> {
  await requireAdminPage(ADMIN_INDEX)
  const sb = getSupabaseServiceClient()
  const config = { ...DEFAULT_CONFIG, ...configOverrides }
  const { data, error } = await sb.from('pp_tcg_migration_run').insert({
    name, status: 'draft', config,
  }).select('id').maybeSingle()
  if (error || !data) return { error: `create run: ${error?.message ?? 'no row returned'}` }
  return { id: data.id as string }
}

export async function enrollRunItems(runId: string): Promise<{ report: unknown } | { error: string }> {
  await requireAdminPage(ADMIN_INDEX)
  const sb = getSupabaseServiceClient()
  // Must be draft or ready — refuse enrollment on a running/paused/stopped run.
  const { data: run } = await sb.from('pp_tcg_migration_run').select('status,config').eq('id', runId).maybeSingle()
  if (!run) return { error: 'run not found' }
  if (!['draft', 'ready'].includes(run.status as string)) {
    return { error: `cannot enroll in run with status=${run.status}` }
  }
  try {
    const report = await enrollRun(sb, runId, (run.config as MigrationRunConfig) ?? {})
    // Mark run 'ready' after a successful enrollment pass.
    await sb.from('pp_tcg_migration_run').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', runId)
    return { report }
  } catch (e) {
    return { error: `enroll: ${(e as Error).message}` }
  }
}

/** Canary enrolment. Caps `enrollment_limit` to a small N (default 5,
 *  hard cap 25), forces `selection_strategy='gsc_rank'`, and critically
 *  does NOT transition the run out of draft. The operator must still
 *  move the run through draft → ready → running by hand after reviewing
 *  the selected items. Draft-only — refuses to run on ready/running/etc. */
export async function enrollCanary(runId: string, limit: number): Promise<{ report: unknown } | { error: string }> {
  await requireAdminPage(ADMIN_INDEX)
  const sb = getSupabaseServiceClient()
  const n = Math.max(1, Math.min(25, Math.floor(Number(limit) || 0)))
  const { data: run } = await sb.from('pp_tcg_migration_run').select('status,config').eq('id', runId).maybeSingle()
  if (!run) return { error: 'run not found' }
  if (run.status !== 'draft') {
    return { error: `canary enrolment requires status=draft (current=${run.status})` }
  }
  try {
    const cfg: MigrationRunConfig = {
      ...((run.config as MigrationRunConfig) ?? {}),
      selection_strategy: 'gsc_rank',
      enrollment_limit:   n,
    }
    const report = await enrollRun(sb, runId, cfg)
    // No status transition. canTransition('draft','running')===false so
    // the run cannot start accidentally after enrolment.
    return { report }
  } catch (e) {
    return { error: `canary enroll: ${(e as Error).message}` }
  }
}

export async function transitionRun(runId: string, newStatus: MigrationStatus, pauseReason?: string): Promise<{ ok: true } | { error: string }> {
  await requireAdminPage(ADMIN_INDEX)
  const sb = getSupabaseServiceClient()
  const { data: run } = await sb.from('pp_tcg_migration_run').select('status').eq('id', runId).maybeSingle()
  if (!run) return { error: 'run not found' }
  const cur = run.status as MigrationStatus
  if (!canTransition(cur, newStatus)) {
    return { error: `invalid transition ${cur} → ${newStatus}` }
  }
  const patch: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() }
  if (newStatus === 'running' && cur !== 'running') patch.started_at = new Date().toISOString()
  if (newStatus === 'stopped')                       patch.stopped_at = new Date().toISOString()
  if (newStatus === 'paused')                        patch.pause_reason = pauseReason ?? 'operator pause'
  if (newStatus === 'running')                       patch.pause_reason = null  // clear pause reason on resume
  const { error } = await sb.from('pp_tcg_migration_run').update(patch).eq('id', runId)
  if (error) return { error: `transition: ${error.message}` }
  return { ok: true }
}

/** EMERGENCY — bulk-disable every verified item in a run. Does NOT
 *  automatically revalidate (that's a separate, resumable action).
 *  NEVER re-enables anything. Scope: only slugs that belong to this
 *  run's run_items. The 14 original pilot + 4 thin + 10 manual
 *  expansion cards are not in any run_item and therefore cannot be
 *  touched by this. */
export async function emergencyRollback(runId: string, confirmationPhrase: string): Promise<{ affected: number; error?: string }> {
  await requireAdminPage(ADMIN_INDEX)
  if (confirmationPhrase.trim() !== 'rollback run') {
    return { affected: 0, error: 'confirmation phrase did not match' }
  }
  const sb = getSupabaseServiceClient()
  // (1) Resolve verified slugs for this run.
  const slugs: string[] = []
  let from = 0
  while (true) {
    const { data } = await sb.from('pp_tcg_migration_run_item')
      .select('pp_card_slug').eq('run_id', runId).eq('status', 'verified')
      .order('pp_card_slug').range(from, from + 999)
    if (!data || !data.length) break
    slugs.push(...data.map(r => r.pp_card_slug as string))
    if (data.length < 1000) break
    from += 1000
  }
  if (slugs.length === 0) return { affected: 0 }
  // (2) Bulk UPDATE cohort rows to prices_enabled=false, scoped by slug list.
  //     Chunked to respect PostgREST URL/body limits.
  const now = new Date().toISOString()
  let affected = 0
  for (let i = 0; i < slugs.length; i += 200) {
    const chunk = slugs.slice(i, i + 200)
    const { data, error } = await sb.from('pokemon_tcg_pilot_cohort')
      .update({ prices_enabled: false, deactivated_at: now, updated_at: now })
      .in('pp_card_slug', chunk).eq('prices_enabled', true)
      .select('pp_card_slug')
    if (error) return { affected, error: `bulk disable: ${error.message}` }
    affected += data?.length ?? 0
  }
  // (3) Mark run_items as rolled_back.
  for (let i = 0; i < slugs.length; i += 200) {
    const chunk = slugs.slice(i, i + 200)
    await sb.from('pp_tcg_migration_run_item')
      .update({ status: 'rolled_back', rolled_back_at: now, updated_at: now })
      .eq('run_id', runId).eq('status', 'verified').in('pp_card_slug', chunk)
  }
  // (4) Transition the run to stopped if not already.
  await sb.from('pp_tcg_migration_run').update({
    status: 'stopped', stopped_at: now,
    pause_reason: `emergency_rollback_affected=${affected}`,
    updated_at: now,
  }).eq('id', runId)
  return { affected }
}

/** Resumable revalidation of recently rolled-back URLs. Processes up to
 *  N slugs per invocation. On success, bumps run_item.updated_at and
 *  records verification evidence. On failure, leaves the item for retry. */
export async function revalidateRolledBack(runId: string, batchSize = 10): Promise<{ attempted: number; succeeded: number; failed: Array<{ slug: string; reason: string }>; pending_before: number; pending_after: number }> {
  await requireAdminPage(ADMIN_INDEX)
  const sb = getSupabaseServiceClient()
  // Pending = rolled_back but verification_evidence.rollback_verify_ok is not true.
  const { data: candidatesAll } = await sb.from('pp_tcg_migration_run_item')
    .select('id,pp_card_slug,verification_evidence')
    .eq('run_id', runId).eq('status', 'rolled_back')
    .order('rolled_back_at', { ascending: true })
  const pending = (candidatesAll ?? []).filter(r => {
    const ev = (r.verification_evidence ?? {}) as { rollback_verify_ok?: boolean }
    return ev.rollback_verify_ok !== true
  })
  const pending_before = pending.length
  const batch = pending.slice(0, batchSize)
  const failed: Array<{ slug: string; reason: string }> = []
  let succeeded = 0
  for (const item of batch) {
    const slug = item.pp_card_slug as string
    const url = await urlForSlug(sb, slug)
    if (!url) { failed.push({ slug, reason: 'url_resolve_failed' }); continue }
    try {
      const u = new URL(url)
      revalidatePath(u.pathname)
      const result = await verifyLegacyReturned({ cardUrl: url, pollMaxAttempts: 5, pollIntervalMs: 2000 })
      if (!result.succeeded) {
        failed.push({ slug, reason: `legacy_not_returned_in_${result.evidence.poll_attempts}_polls` })
        continue
      }
      await sb.from('pp_tcg_migration_run_item').update({
        verification_evidence: { ...(item.verification_evidence as object ?? {}), rollback_verify_ok: true, rollback_reverified_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq('id', item.id as string)
      succeeded++
    } catch (e) {
      failed.push({ slug, reason: (e as Error).message })
    }
  }
  return { attempted: batch.length, succeeded, failed, pending_before, pending_after: pending_before - succeeded }
}
