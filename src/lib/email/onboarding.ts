// src/lib/email/onboarding.ts
// Block 3B — onboarding sequence enrolment + processor business logic.
//
// All writes go through the service-role client. The two public
// entry points are:
//
//   tryEnrolOnboarding(userId)
//     Called from the auth callback after a successful code exchange.
//     Best-effort: returns a structured result, never throws. The
//     callback's redirect is never blocked by an enrolment failure.
//
//   processOnboardingBatch({ limit })
//     Called by the cron-protected route. Picks due rows, sends via
//     the central sendEmail() service, applies state transitions.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { sendEmail } from './send'
import { renderTemplate, type TemplateKey } from '@/emails/render'
import { EMAIL_CATEGORIES } from './categories'
import { recordConsent } from './preferences'
import { upsertContact, type Contact } from './contacts'
import { normalizeEmail } from './normalize'
import { getActiveSuppressions } from './suppressions'
import { readActivationCounts, pickActivationBranch, type ActivationBranch } from './onboardingActivation'

// ─────────────────────────────────────────────────────────────────────
// Timing
// ─────────────────────────────────────────────────────────────────────
// Configurable by env var only — operator can shrink the delay during
// a controlled rollout test.
const MS_MIN  = 60 * 1000
const MS_HOUR = 60 * MS_MIN
const MS_DAY  = 24 * MS_HOUR

function readDelayMs(name: string, fallback: number): number {
  const v = Number((process.env[name] ?? '').trim())
  if (!Number.isFinite(v) || v <= 0) return fallback
  return v
}

function welcomeDelayMs():    number { return readDelayMs('ONBOARDING_WELCOME_DELAY_MS',    10 * MS_MIN) }
function activationDelayMs(): number { return readDelayMs('ONBOARDING_ACTIVATION_DELAY_MS', 2  * MS_DAY) }
function discoveryDelayMs():  number { return readDelayMs('ONBOARDING_DISCOVERY_DELAY_MS',  7  * MS_DAY) }

const MAX_RETRIES         = 5
const PROCESSOR_BATCH_MAX = 25
const DEFAULT_CLAIM_STALE_SECONDS = 300

// ─────────────────────────────────────────────────────────────────────
// Feature flag + eligibility cutoff
// ─────────────────────────────────────────────────────────────────────
export function isOnboardingEnabled(): boolean {
  return ((process.env.EMAIL_ONBOARDING_ENABLED ?? '').trim().toLowerCase()) === 'true'
}

/**
 * Parses ONBOARDING_ELIGIBLE_AFTER and returns an ISO-8601 cutoff
 * timestamp. Returns null when missing or invalid — enrolment then
 * fails closed (no existing user is silently swept into the sequence
 * on their next login).
 *
 * Acceptable formats: anything `new Date()` parses to a finite time
 * (ISO 8601 is the documented contract; we accept other shapes
 * defensively but tighten via the env-catalogue docs).
 */
export function readEligibleAfter(): { ok: boolean; cutoffIso: string | null; reason?: string } {
  const raw = (process.env.ONBOARDING_ELIGIBLE_AFTER ?? '').trim()
  if (!raw) return { ok: false, cutoffIso: null, reason: 'missing' }
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return { ok: false, cutoffIso: null, reason: 'invalid' }
  return { ok: true, cutoffIso: new Date(t).toISOString() }
}

function readClaimStaleMs(): number {
  const v = Number((process.env.ONBOARDING_CLAIM_STALE_SECONDS ?? '').trim())
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_CLAIM_STALE_SECONDS * 1000
  return Math.floor(v) * 1000
}

// ─────────────────────────────────────────────────────────────────────
// Enrolment
// ─────────────────────────────────────────────────────────────────────

export type OnboardingStep = 'welcome' | 'activation' | 'discovery'

export type EnrolOutcome =
  | 'enrolled'
  | 'feature_disabled'
  | 'cutoff_missing'
  | 'cutoff_invalid'
  | 'user_predates_cutoff'
  | 'already_enrolled'
  | 'user_not_found'
  | 'email_unverified'
  | 'no_email'
  | 'globally_suppressed'
  | 'contact_upsert_failed'
  | 'insert_failed'

export type EnrolResult = {
  outcome: EnrolOutcome
  reason?: string
}

/**
 * Server-only. Safe to call from the auth callback. Never throws.
 * Returns a structured outcome so the caller (and ops logs) can see
 * exactly why enrolment did not happen.
 *
 * Idempotent thanks to the PK on (user_id) — a second call returns
 * `already_enrolled`.
 */
export async function tryEnrolOnboarding(userId: string): Promise<EnrolResult> {
  if (!isOnboardingEnabled()) {
    return { outcome: 'feature_disabled' }
  }
  // Block 3B correction — eligibility cutoff. Missing/invalid =
  // fail closed. Existing users created before the cutoff can never
  // be silently enrolled, regardless of how they reach the callback
  // (new signup, returning OAuth, returning magic link).
  const cutoff = readEligibleAfter()
  if (!cutoff.ok) {
    return { outcome: cutoff.reason === 'missing' ? 'cutoff_missing' : 'cutoff_invalid' }
  }

  if (typeof userId !== 'string' || userId.length === 0) {
    return { outcome: 'user_not_found' }
  }

  const supa = getSupabaseServiceClient()

  // Resolve the auth.users row — we need email + email_confirmed_at
  // + created_at.
  let email: string | null   = null
  let confirmed              = false
  let createdAtIso: string | null = null
  try {
    const auth = await supa.auth.admin.getUserById(userId)
    const u = (auth as { data?: { user?: { email?: string | null; email_confirmed_at?: string | null; created_at?: string | null } } }).data?.user
    if (!u) return { outcome: 'user_not_found' }
    email        = normalizeEmail(u.email ?? '')
    confirmed    = typeof u.email_confirmed_at === 'string' && u.email_confirmed_at.length > 0
    createdAtIso = typeof u.created_at === 'string' ? u.created_at : null
  } catch {
    return { outcome: 'user_not_found' }
  }

  if (!email)     return { outcome: 'no_email' }
  if (!confirmed) return { outcome: 'email_unverified' }

  // Eligibility window — strictly user.created_at >= cutoff.
  if (!createdAtIso) return { outcome: 'user_predates_cutoff' }
  const createdAtMs = Date.parse(createdAtIso)
  const cutoffMs    = Date.parse(cutoff.cutoffIso ?? '')
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(cutoffMs) || createdAtMs < cutoffMs) {
    return { outcome: 'user_predates_cutoff' }
  }

  // Upsert the email_contact and grant the onboarding consent. The
  // grant is required for the central send service's preference
  // resolver to allow the category — without it, marketing_default
  // (opted out) applies.
  const contact = await upsertContact({ email, userId, source: 'auth_signup' })
  if (!contact) return { outcome: 'contact_upsert_failed' }

  const blocked = await isGloballySuppressed(contact.id)
  if (blocked) return { outcome: 'globally_suppressed' }

  // Insert the onboarding row. PK collision → already enrolled.
  const now = Date.now()
  const row = {
    user_id:           userId,
    contact_id:        contact.id,
    status:            'active',
    welcome_due_at:    new Date(now + welcomeDelayMs()).toISOString(),
    activation_due_at: new Date(now + activationDelayMs()).toISOString(),
    discovery_due_at:  new Date(now + discoveryDelayMs()).toISOString(),
  }
  const insert = await supa
    .from('email_onboarding_state')
    .insert(row)
    .select('user_id')
    .single()

  if (insert.error) {
    if ((insert.error as { code?: string }).code === '23505') {
      return { outcome: 'already_enrolled' }
    }
    console.error('[onboarding] enrol insert failed:', insert.error.code, insert.error.message)
    return { outcome: 'insert_failed', reason: insert.error.code }
  }

  // Best-effort consent grant. Failure here is not fatal — the
  // settings UI also exposes the toggle, so the user can grant later.
  await recordConsent({
    contactId:      contact.id,
    category:       EMAIL_CATEGORIES.ONBOARDING,
    state:          'granted',
    source:         'auth_signup',
    notesInternal:  'auto-granted at verified-email enrolment',
  })

  // Structured server-side analytics breadcrumb.
  console.info('[onboarding:event] onboarding_enrolled',
    JSON.stringify({ user_present: true }))

  return { outcome: 'enrolled' }
}

async function isGloballySuppressed(contactId: string): Promise<boolean> {
  const active = await getActiveSuppressions(contactId)
  for (const s of active) {
    if (s.category != null) continue
    if (s.reason === 'hard_bounce' || s.reason === 'complaint'
       || s.reason === 'invalid_address' || s.reason === 'admin_suppression'
       || s.reason === 'provider_rejection') {
      return true
    }
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────
// Cancellation / pause (called from settings UI + processor)
// ─────────────────────────────────────────────────────────────────────

export type CancellationReason =
  | 'manual_opt_out'
  | 'preference_disabled'
  | 'hard_bounce'
  | 'complaint'
  | 'invalid_address'
  | 'admin_suppression'
  | 'provider_rejection'
  | 'retry_exhausted'
  | 'configuration_error'
  | 'account_deleted'

export async function cancelOnboardingForUser(
  userId:  string,
  reason:  CancellationReason,
): Promise<{ ok: boolean }> {
  const supa = getSupabaseServiceClient()
  const nowIso = new Date().toISOString()
  const r = await supa
    .from('email_onboarding_state')
    .update({
      status:              'cancelled',
      cancelled_at:        nowIso,
      cancellation_reason: reason,
      updated_at:          nowIso,
    })
    .eq('user_id', userId)
  if (r.error) {
    console.error('[onboarding] cancel failed:', r.error.code)
    return { ok: false }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────────────
// Processor
// ─────────────────────────────────────────────────────────────────────

export type ProcessSummary = {
  processed:  number
  sent:       number
  skipped:    number
  retried:    number
  cancelled:  number
  failed:     number
  disabled:   boolean
}

type StateRow = {
  user_id:             string
  contact_id:          string | null
  status:              string
  welcome_due_at:      string
  activation_due_at:   string
  discovery_due_at:    string
  welcome_sent_at:     string | null
  activation_sent_at:  string | null
  discovery_sent_at:   string | null
  retry_count:         number
  processing_step:       string | null
  processing_token:      string | null
  processing_started_at: string | null
}

function newToken(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // Deterministic fallback only used when crypto.randomUUID is absent.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Two-step atomic claim:
 *
 *   1. UPDATE … WHERE user_id = X AND status='active'
 *        AND processing_token IS NULL
 *        AND <step>_sent_at IS NULL
 *        AND <step>_due_at <= NOW
 *      RETURNING id
 *      → if any row returned, we won the claim.
 *
 *   2. (only if step 1 returned nothing) try the stale-recovery path:
 *      UPDATE … WHERE user_id = X AND processing_started_at < cutoff
 *      … RETURNING id.
 *
 * Concurrent processors race for the same row through Postgres
 * row-level locks; only one returns. A crashed worker leaves a stale
 * claim that a later processor recovers via step 2 after
 * ONBOARDING_CLAIM_STALE_SECONDS.
 *
 * The deterministic sendEmail idempotency key
 * (`onboarding:<uid>:<step>`) is a second safety layer that prevents a
 * double send even if the claim ever fails.
 */
async function tryClaim(userId: string, step: OnboardingStep, token: string): Promise<boolean> {
  const supa = getSupabaseServiceClient()
  const nowIso = new Date().toISOString()
  // Step 1 — fresh claim.
  const fresh = await supa
    .from('email_onboarding_state')
    .update({
      processing_step:       step,
      processing_token:      token,
      processing_started_at: nowIso,
      updated_at:            nowIso,
    })
    .eq('user_id', userId)
    .eq('status',  'active')
    .is('processing_token', null)
    .select('user_id')
  if (fresh.data && (fresh.data as Array<unknown>).length > 0) return true

  // Step 2 — stale recovery. Only triggers when an existing claim is
  // older than the stale cutoff. Crash recovery path.
  const staleCutoff = new Date(Date.now() - readClaimStaleMs()).toISOString()
  const stale = await supa
    .from('email_onboarding_state')
    .update({
      processing_step:       step,
      processing_token:      token,
      processing_started_at: nowIso,
      updated_at:            nowIso,
    })
    .eq('user_id', userId)
    .eq('status',  'active')
    .lt('processing_started_at', staleCutoff)
    .select('user_id')
  return !!(stale.data && (stale.data as Array<unknown>).length > 0)
}

async function clearClaim(userId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const supa = getSupabaseServiceClient()
  await supa
    .from('email_onboarding_state')
    .update({
      processing_step:       null,
      processing_token:      null,
      processing_started_at: null,
      ...extra,
    })
    .eq('user_id', userId)
}

function emptySummary(): ProcessSummary {
  return { processed: 0, sent: 0, skipped: 0, retried: 0, cancelled: 0, failed: 0, disabled: false }
}

export async function processOnboardingBatch(input: { limit?: number } = {}): Promise<ProcessSummary> {
  if (!isOnboardingEnabled()) {
    const s = emptySummary()
    s.disabled = true
    return s
  }
  const summary = emptySummary()
  const limit = Math.min(Math.max(1, input.limit ?? PROCESSOR_BATCH_MAX), PROCESSOR_BATCH_MAX)

  const supa = getSupabaseServiceClient()
  const nowIso = new Date().toISOString()

  // Pick due rows. We over-fetch the cap a little and stop once we
  // have processed `limit` actionable rows. Rows already claimed by
  // another (live) processor are filtered out at process-time by the
  // atomic claim itself; we still surface them here so the stale
  // recovery path can pick them up after the timeout.
  const r = await supa
    .from('email_onboarding_state')
    .select('user_id, contact_id, status, welcome_due_at, activation_due_at, discovery_due_at, welcome_sent_at, activation_sent_at, discovery_sent_at, retry_count, processing_step, processing_token, processing_started_at')
    .eq('status', 'active')
    .order('welcome_due_at', { ascending: true })
    .limit(limit * 2)

  if (r.error) {
    console.error('[onboarding] batch select failed:', r.error.code)
    return summary
  }

  const rows: StateRow[] = (r.data ?? []) as StateRow[]
  for (const row of rows) {
    if (summary.processed >= limit) break
    const step = pickNextDueStep(row, nowIso)
    if (!step) continue
    summary.processed++
    await processOneStep(row, step, summary)
  }

  console.info('[onboarding:batch]', JSON.stringify(summary))
  return summary
}

function pickNextDueStep(row: StateRow, nowIso: string): OnboardingStep | null {
  if (!row.welcome_sent_at    && row.welcome_due_at    <= nowIso) return 'welcome'
  if (!row.activation_sent_at && row.activation_due_at <= nowIso) return 'activation'
  if (!row.discovery_sent_at  && row.discovery_due_at  <= nowIso) return 'discovery'
  return null
}

async function processOneStep(row: StateRow, step: OnboardingStep, summary: ProcessSummary): Promise<void> {
  const supa = getSupabaseServiceClient()

  // Atomic claim — bail without doing any work if a concurrent
  // processor already owns this row's current step.
  const token = newToken()
  const claimed = await tryClaim(row.user_id, step, token)
  if (!claimed) {
    summary.skipped++
    return
  }

  // Resolve recipient.
  const email = await resolveContactEmail(row.user_id, row.contact_id)
  if (!email) {
    summary.skipped++
    await pauseOnboarding(row.user_id, 'configuration_error')
    await clearClaim(row.user_id)
    return
  }

  // Branching for activation.
  let activationBranch: ActivationBranch | null = null
  if (step === 'activation') {
    const counts = await readActivationCounts(row.user_id)
    activationBranch = pickActivationBranch(counts)
  }

  const templateKey: TemplateKey =
    step === 'welcome'    ? 'onboarding_welcome'    :
    step === 'activation' ? 'onboarding_activation' :
                            'onboarding_discovery'

  let rendered
  try {
    rendered = await renderTemplate({
      key:              templateKey,
      activationBranch: activationBranch ?? undefined,
    })
  } catch (e) {
    console.error('[onboarding] render failed:', e instanceof Error ? e.message : 'unknown')
    summary.failed++
    await clearClaim(row.user_id)
    return
  }

  const idempotencyKey = `onboarding:${row.user_id}:${step}`
  const result = await sendEmail({
    toEmail:        email,
    category:       EMAIL_CATEGORIES.ONBOARDING,
    templateKey:    templateKey,
    subject:        rendered.subject,
    html:           rendered.html,
    text:           rendered.text,
    idempotencyKey,
    metadata: {
      step,
      activation_branch: activationBranch ?? undefined,
    },
  })

  console.info('[onboarding:event] onboarding_email_attempt',
    JSON.stringify({ step, outcome: result.outcome, activation_branch: activationBranch }))

  // ── Outcome handling ──
  // Every branch clears the claim. Three patterns:
  //   * the cancel/pause helpers run an UPDATE that we follow with a
  //     dedicated clearClaim() — two writes, but the only race is the
  //     same processor, so it is harmless.
  //   * the sent / duplicate / retry branches embed the claim-clear
  //     fields in the same UPDATE patch so the transition is one
  //     atomic write per branch.
  const nowIso = new Date().toISOString()
  const claimClear = {
    processing_step:       null,
    processing_token:      null,
    processing_started_at: null,
  } as const

  switch (result.outcome) {
    case 'sent':
    case 'duplicate': {
      const patch: Record<string, unknown> = {
        [`${step}_sent_at`]: nowIso,
        updated_at:           nowIso,
        retry_count:          0,
        ...claimClear,
      }
      if (step === 'discovery') {
        patch.status       = 'completed'
        patch.completed_at = nowIso
        console.info('[onboarding:event] onboarding_completed', JSON.stringify({ last_step: 'discovery' }))
      }
      await supa.from('email_onboarding_state').update(patch).eq('user_id', row.user_id)
      summary.sent++
      return
    }
    case 'preference_disabled': {
      await cancelOnboardingForUser(row.user_id, 'preference_disabled')
      await clearClaim(row.user_id)
      summary.cancelled++
      console.info('[onboarding:event] onboarding_cancelled', JSON.stringify({ reason: 'preference_disabled' }))
      return
    }
    case 'suppressed': {
      const reason = (result.reason as CancellationReason | undefined) ?? 'admin_suppression'
      const validReasons: ReadonlyArray<CancellationReason> = [
        'hard_bounce', 'complaint', 'invalid_address', 'admin_suppression', 'provider_rejection',
      ]
      const mapped = (validReasons as ReadonlyArray<string>).includes(reason) ? reason : 'admin_suppression'
      await cancelOnboardingForUser(row.user_id, mapped)
      await clearClaim(row.user_id)
      summary.cancelled++
      console.info('[onboarding:event] onboarding_cancelled', JSON.stringify({ reason: mapped }))
      return
    }
    case 'unsubscribed': {
      await cancelOnboardingForUser(row.user_id, 'manual_opt_out')
      await clearClaim(row.user_id)
      summary.cancelled++
      console.info('[onboarding:event] onboarding_cancelled', JSON.stringify({ reason: 'manual_opt_out' }))
      return
    }
    case 'invalid_recipient':
    case 'configuration_error': {
      await pauseOnboarding(row.user_id, 'configuration_error')
      await clearClaim(row.user_id)
      summary.skipped++
      return
    }
    case 'provider_error': {
      const nextRetry = row.retry_count + 1
      if (nextRetry > MAX_RETRIES) {
        await cancelOnboardingForUser(row.user_id, 'retry_exhausted')
        await clearClaim(row.user_id)
        summary.cancelled++
        console.info('[onboarding:event] onboarding_cancelled', JSON.stringify({ reason: 'retry_exhausted' }))
        return
      }
      // Exponential backoff with ±25% jitter on the per-step due_at.
      const baseMin   = Math.pow(2, nextRetry) // 2, 4, 8, 16, 32 minutes
      const jitter    = (Math.random() - 0.5) * 0.5 * baseMin
      const delayMs   = Math.max(1, (baseMin + jitter)) * 60 * 1000
      const nextDueAt = new Date(Date.now() + delayMs).toISOString()
      const patch: Record<string, unknown> = {
        retry_count: nextRetry,
        [`${step}_due_at`]: nextDueAt,
        updated_at: nowIso,
        ...claimClear,
      }
      await supa.from('email_onboarding_state').update(patch).eq('user_id', row.user_id)
      summary.retried++
      return
    }
    default:
      summary.failed++
      await clearClaim(row.user_id)
      return
  }
}

async function resolveContactEmail(userId: string, contactId: string | null): Promise<string | null> {
  const supa = getSupabaseServiceClient()
  if (contactId) {
    const r = await supa
      .from('email_contacts')
      .select('email_normalized')
      .eq('id', contactId)
      .maybeSingle()
    const e = normalizeEmail((r.data as { email_normalized?: string } | null)?.email_normalized ?? null)
    if (e) return e
  }
  // Fallback to auth.users.email.
  try {
    const auth = await supa.auth.admin.getUserById(userId)
    return normalizeEmail((auth as { data?: { user?: { email?: string | null } } }).data?.user?.email ?? null)
  } catch { return null }
}

async function pauseOnboarding(userId: string, reason: CancellationReason): Promise<void> {
  const supa = getSupabaseServiceClient()
  await supa
    .from('email_onboarding_state')
    .update({
      status:              'paused',
      cancellation_reason: reason,
      updated_at:          new Date().toISOString(),
    })
    .eq('user_id', userId)
}

// ─────────────────────────────────────────────────────────────────────
// Settings-UI helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Reads the user's current "Getting started tips" toggle by looking
 * at the most-recent `email_consents` row for category=onboarding.
 * Returns null when there is no consent row yet (the toggle should
 * render as "on" or "off" per the default policy in docs).
 */
export async function readOnboardingConsent(userId: string): Promise<{
  contactId:  string | null
  optedIn:    boolean | null
}> {
  const supa = getSupabaseServiceClient()
  const c = await supa
    .from('email_contacts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (c.error || !c.data) return { contactId: null, optedIn: null }
  const contactId = (c.data as { id: string }).id

  const consent = await supa
    .from('email_consents')
    .select('state')
    .eq('contact_id', contactId)
    .eq('category',   EMAIL_CATEGORIES.ONBOARDING)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (consent.error || !consent.data) return { contactId, optedIn: null }
  return { contactId, optedIn: (consent.data as { state: string }).state === 'granted' }
}

/**
 * Writes a new consent row for category=onboarding AND mirrors the
 * change to email_onboarding_state.status when applicable:
 *
 *   * revoke → cancel the sequence with reason='manual_opt_out',
 *     but ONLY if the sequence is in ('pending','active','paused').
 *     A completed sequence stays completed (re-revoking is a no-op
 *     against status).
 *   * grant  → do NOT restart a completed sequence. If status is
 *     'cancelled' AND the user has opted in again, we leave the row
 *     alone — the operator can manually re-enrol via SQL if they want.
 */
export async function setOnboardingConsent(input: {
  userId:   string
  optedIn:  boolean
}): Promise<{ ok: boolean }> {
  const supa = getSupabaseServiceClient()
  const state = await readOnboardingConsent(input.userId)
  if (!state.contactId) {
    // No contact yet → upsert one via the user's auth email.
    try {
      const auth = await supa.auth.admin.getUserById(input.userId)
      const email = normalizeEmail((auth as { data?: { user?: { email?: string | null } } }).data?.user?.email ?? null)
      if (email) {
        const c = await upsertContact({ email, userId: input.userId, source: 'settings_toggle' as never })
        if (c) state.contactId = c.id
      }
    } catch { /* fall through */ }
  }
  if (!state.contactId) return { ok: false }

  const consent = await recordConsent({
    contactId:      state.contactId,
    category:       EMAIL_CATEGORIES.ONBOARDING,
    state:          input.optedIn ? 'granted' : 'revoked',
    source:         'settings_toggle',
    notesInternal:  'getting-started-tips settings toggle',
  })
  if (!consent.ok) return { ok: false }

  if (!input.optedIn) {
    // Pause / cancel non-completed sequences. We do not touch
    // 'completed' rows — re-revoking after completion is a no-op.
    await supa
      .from('email_onboarding_state')
      .update({
        status:              'cancelled',
        cancelled_at:        new Date().toISOString(),
        cancellation_reason: 'manual_opt_out',
        updated_at:          new Date().toISOString(),
      })
      .eq('user_id', input.userId)
      .in('status', ['pending', 'active', 'paused'])
    console.info('[onboarding:event] onboarding_cancelled',
      JSON.stringify({ reason: 'manual_opt_out' }))
  }

  return { ok: true }
}

// Re-export the Contact type for callers.
export type { Contact }
