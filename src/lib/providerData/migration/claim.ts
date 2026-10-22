// PP-TCG migration — call the atomic claim RPC.
// FOR UPDATE SKIP LOCKED on the DB side guarantees two concurrent cron
// invocations never pick the same item. Items with an expired lease
// (status='claimed' AND lease_expires_at < now()) are re-claimed —
// this is the crash-recovery path.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MigrationRunItem } from './types'

export async function claimBatch(
  sb: SupabaseClient,
  args: { runId: string; batchSize: number; workerId: string; leaseDurationSec: number },
): Promise<MigrationRunItem[]> {
  const { data, error } = await sb.rpc('pp_tcg_migration_claim_batch', {
    p_run_id:             args.runId,
    p_batch_size:         args.batchSize,
    p_worker_id:          args.workerId,
    p_lease_duration_sec: args.leaseDurationSec,
  })
  if (error) throw new Error(`claim_batch rpc: ${error.message}`)
  return (data ?? []) as MigrationRunItem[]
}

/** Transition an item to a terminal status. Idempotent on `status`. */
export async function markItem(
  sb: SupabaseClient,
  itemId: string,
  patch: {
    status?:                'activated' | 'verified' | 'failed' | 'skipped' | 'rolled_back' | 'pending'
    activated_at?:          string | null
    verified_at?:           string | null
    rolled_back_at?:        string | null
    last_error?:            string | null
    verification_evidence?: Record<string, unknown> | null
    lease_expires_at?:      string | null
    worker_id?:             string | null
  },
): Promise<void> {
  const { error } = await sb.from('pp_tcg_migration_run_item')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', itemId)
  if (error) throw new Error(`mark item: ${error.message}`)
}

/** Release lease on a claimed item (for cleanup when the handler
 *  exits without reaching a terminal state — e.g., out of time). */
export async function releaseLease(sb: SupabaseClient, itemId: string): Promise<void> {
  await sb.from('pp_tcg_migration_run_item')
    .update({ lease_expires_at: null, worker_id: null, status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('status', 'claimed')  // only release if still claimed; don't downgrade a verified/failed item
}
