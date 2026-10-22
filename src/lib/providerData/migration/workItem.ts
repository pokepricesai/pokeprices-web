// PP-TCG migration — per-item state machine.
//
// Called by the cron handler once per claimed item. Each stage checks
// the item's current state and resumes safely from any prior point:
//   - If strict re-check regresses, mark `skipped` (not failed).
//   - If activated_at is null, strict-recheck and flipCohort(true).
//   - If activated but not verified, revalidate + poll. On success,
//     mark `verified`. On failure, flipCohort(false), revalidate again,
//     verify legacy returned, mark `failed`.
//
// Idempotent: a reclaimed item (crashed worker) resumes from its
// recorded state without re-flipping cards that are already active.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { strictRecheckOne } from './strict'
import { urlForSlug, flipCohortIdempotent } from './cohort'
import { verifyProviderActive, verifyLegacyReturned } from './verify'
import { markItem } from './claim'
import type { MigrationRunItem, MigrationRunConfig, VerificationEvidence } from './types'
import { DEFAULT_CONFIG } from './types'

export interface WorkResult {
  itemId:         string
  slug:           string
  terminal:       'verified' | 'failed' | 'skipped'
  evidence:       VerificationEvidence | null
  error?:         string
  activation_ms:  number
}

function revalidatePathForUrl(cardUrl: string) {
  // cardUrl is already encodeURIComponent'd. revalidatePath wants the
  // same pathname shape the ISR cache key uses.
  const u = new URL(cardUrl)
  revalidatePath(u.pathname)
}

export async function processWorkItem(
  sb: SupabaseClient,
  item: MigrationRunItem,
  cfg: MigrationRunConfig,
): Promise<WorkResult> {
  const activation_started_at = Date.now()
  const pollMax = cfg.poll_max_attempts ?? DEFAULT_CONFIG.poll_max_attempts
  const pollInt = cfg.poll_interval_ms ?? DEFAULT_CONFIG.poll_interval_ms

  // Resolve URL first — needed by every subsequent stage.
  const cardUrl = await urlForSlug(sb, item.pp_card_slug)
  if (!cardUrl) {
    await markItem(sb, item.id, {
      status: 'skipped', last_error: 'url_resolution_failed',
      lease_expires_at: null, worker_id: null,
    })
    return { itemId: item.id, slug: item.pp_card_slug, terminal: 'skipped', evidence: null, error: 'url_resolution_failed', activation_ms: 0 }
  }

  // Stage 1: strict re-check (always, including on reclaim).
  const check = await strictRecheckOne(sb, item.pp_card_slug)
  if (check.ok === false) {
    const reason = check.reason
    await markItem(sb, item.id, {
      status: 'skipped', last_error: `strict_recheck_failed: ${reason}`,
      lease_expires_at: null, worker_id: null,
    })
    return { itemId: item.id, slug: item.pp_card_slug, terminal: 'skipped', evidence: null, error: reason, activation_ms: 0 }
  }

  // Stage 2: flip cohort to prices_enabled=true (idempotent). Skip if
  // activated_at is already recorded (reclaim path).
  if (item.activated_at === null) {
    const flip = await flipCohortIdempotent(sb, item.pp_card_slug, true)
    if (flip.error) {
      await markItem(sb, item.id, {
        status: 'failed', last_error: flip.error,
        lease_expires_at: null, worker_id: null,
      })
      return { itemId: item.id, slug: item.pp_card_slug, terminal: 'failed', evidence: null, error: flip.error, activation_ms: Date.now() - activation_started_at }
    }
    await markItem(sb, item.id, {
      status:       'activated',
      activated_at: new Date().toISOString(),
    })
  }

  const activation_ms = Date.now() - activation_started_at

  // Stage 3: revalidate the public URL + poll until provider-active.
  // revalidatePath called in-process (no admin JWT needed; this handler
  // is already a route handler with revalidate rights).
  revalidatePathForUrl(cardUrl)
  const verify = await verifyProviderActive({
    cardUrl, pollMaxAttempts: pollMax, pollIntervalMs: pollInt,
  })

  if (verify.succeeded) {
    const evidence = { ...verify.evidence, activation_duration_ms: activation_ms }
    await markItem(sb, item.id, {
      status: 'verified', verified_at: new Date().toISOString(),
      verification_evidence: evidence, last_error: null,
      lease_expires_at: null, worker_id: null,
    })
    return { itemId: item.id, slug: item.pp_card_slug, terminal: 'verified', evidence, activation_ms }
  }

  // Stage 4: verification failed → rollback. flipCohort(false), revalidate,
  // confirm legacy returned. Mark `failed` even if rollback-verification
  // itself can't confirm — the DB is already in prices_enabled=false,
  // the public cache will clear naturally on next visitor if revalidate
  // propagation lags. We NEVER auto-re-enable a failed card.
  const rollback = await flipCohortIdempotent(sb, item.pp_card_slug, false)
  revalidatePathForUrl(cardUrl)
  const legacyVerify = await verifyLegacyReturned({
    cardUrl, pollMaxAttempts: pollMax, pollIntervalMs: pollInt,
  })
  const evidence = {
    ...verify.evidence,
    activation_duration_ms: activation_ms,
    rollback_cohort_changed: rollback.changed,
    rollback_cohort_error:   rollback.error ?? null,
    rollback_verify_ok:      legacyVerify.succeeded,
    rollback_verify_evidence: legacyVerify.evidence,
  } as unknown as VerificationEvidence
  await markItem(sb, item.id, {
    status: 'failed', rolled_back_at: new Date().toISOString(),
    verification_evidence: evidence as unknown as Record<string, unknown>,
    last_error: `verification_failed_after_${verify.evidence.poll_attempts}_polls`,
    lease_expires_at: null, worker_id: null,
  })
  return { itemId: item.id, slug: item.pp_card_slug, terminal: 'failed', evidence, error: 'verification_failed', activation_ms }
}
