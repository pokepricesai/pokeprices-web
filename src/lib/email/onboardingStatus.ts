// src/lib/email/onboardingStatus.ts
// Block 3D — server-only snapshot of the onboarding automation
// state. Used by the admin status route + the Content Studio panel.
//
// Returns operator-safe counts only. No email addresses, no user
// IDs, no onboarding row IDs, no Resend IDs.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { isOnboardingEnabled } from './onboarding'

const DEFAULT_STALE_SECONDS = 300

function staleCutoffIso(): string {
  const raw = (process.env.ONBOARDING_CLAIM_STALE_SECONDS ?? '').trim()
  const n = Number(raw)
  const seconds = Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_SECONDS
  return new Date(Date.now() - seconds * 1000).toISOString()
}

export type OnboardingStatusSnapshot = {
  enabled:              boolean
  /** Only the most recent run, regardless of status. */
  lastRun: {
    startedAt:   string
    completedAt: string | null
    status:      string
    durationMs:  number | null
    source:      string
  } | null
  /** Most recent run with status='success'. May predate lastRun. */
  lastSuccessfulRun: {
    startedAt:   string
    durationMs:  number | null
    source:      string
  } | null
  /** Counts from the most recent run (any status). */
  lastSummary: {
    processed: number
    sent:      number
    skipped:   number
    retried:   number
    cancelled: number
    failed:    number
  } | null
  state: {
    active:      number
    dueNow:      number
    paused:      number
    cancelled:   number
    completed:   number
    staleClaims: number
  }
}

export async function readOnboardingStatusSnapshot(): Promise<OnboardingStatusSnapshot> {
  const supa    = getSupabaseServiceClient()
  const nowIso  = new Date().toISOString()
  const staleIso = staleCutoffIso()

  // ── Last run (any status) ──
  const lastRunR = await supa
    .from('email_onboarding_runs')
    .select('started_at, completed_at, status, duration_ms, source, processed_count, sent_count, skipped_count, retried_count, cancelled_count, failed_count')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastRunData = lastRunR.data as Record<string, unknown> | null
  const lastRun = lastRunData ? {
    startedAt:   String(lastRunData.started_at),
    completedAt: lastRunData.completed_at ? String(lastRunData.completed_at) : null,
    status:      String(lastRunData.status),
    durationMs:  lastRunData.duration_ms == null ? null : Number(lastRunData.duration_ms),
    source:      String(lastRunData.source),
  } : null
  const lastSummary = lastRunData ? {
    processed: Number(lastRunData.processed_count ?? 0),
    sent:      Number(lastRunData.sent_count      ?? 0),
    skipped:   Number(lastRunData.skipped_count   ?? 0),
    retried:   Number(lastRunData.retried_count   ?? 0),
    cancelled: Number(lastRunData.cancelled_count ?? 0),
    failed:    Number(lastRunData.failed_count    ?? 0),
  } : null

  // ── Last successful run ──
  const lastOkR = await supa
    .from('email_onboarding_runs')
    .select('started_at, duration_ms, source')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const lastOkData = lastOkR.data as Record<string, unknown> | null
  const lastSuccessfulRun = lastOkData ? {
    startedAt:  String(lastOkData.started_at),
    durationMs: lastOkData.duration_ms == null ? null : Number(lastOkData.duration_ms),
    source:     String(lastOkData.source),
  } : null

  // ── State counts on email_onboarding_state ──
  async function countWith(filter: (q: ReturnType<typeof supa.from>) => unknown): Promise<number> {
    const q = (filter as (q: unknown) => unknown)(
      supa.from('email_onboarding_state').select('user_id', { count: 'exact', head: true }),
    )
    const r = await (q as Promise<{ count?: number | null }>)
    return r?.count ?? 0
  }

  type QB = ReturnType<ReturnType<typeof supa.from>['select']>
  const active    = await countWith(q => (q as unknown as QB & { eq: (c: string, v: unknown) => unknown }).eq('status', 'active'))
  const paused    = await countWith(q => (q as unknown as QB & { eq: (c: string, v: unknown) => unknown }).eq('status', 'paused'))
  const cancelled = await countWith(q => (q as unknown as QB & { eq: (c: string, v: unknown) => unknown }).eq('status', 'cancelled'))
  const completed = await countWith(q => (q as unknown as QB & { eq: (c: string, v: unknown) => unknown }).eq('status', 'completed'))

  // ── Due-now: rows whose next step has *_due_at <= now AND *_sent_at IS NULL.
  // The three steps are mutually exclusive (a row can have at most one
  // un-sent step), so summing is safe.
  type Chain = QB & {
    eq: (c: string, v: unknown) => Chain
    is: (c: string, v: unknown) => Chain
    lte: (c: string, v: unknown) => Chain
    not: (c: string, op: string, v: unknown) => Chain
  }
  const dueWelcome = await countWith(q => {
    const c = q as unknown as Chain
    return c.eq('status', 'active').is('welcome_sent_at', null).lte('welcome_due_at', nowIso)
  })
  const dueActivation = await countWith(q => {
    const c = q as unknown as Chain
    return c.eq('status', 'active').not('welcome_sent_at', 'is', null).is('activation_sent_at', null).lte('activation_due_at', nowIso)
  })
  const dueDiscovery = await countWith(q => {
    const c = q as unknown as Chain
    return c.eq('status', 'active').not('activation_sent_at', 'is', null).is('discovery_sent_at', null).lte('discovery_due_at', nowIso)
  })

  // ── Stale claims ──
  const staleClaims = await countWith(q => {
    const c = q as unknown as Chain
    return c.not('processing_token', 'is', null).lt('processing_started_at', staleIso) as unknown as Chain
  })

  return {
    enabled: isOnboardingEnabled(),
    lastRun,
    lastSuccessfulRun,
    lastSummary,
    state: {
      active,
      dueNow: dueWelcome + dueActivation + dueDiscovery,
      paused,
      cancelled,
      completed,
      staleClaims,
    },
  }
}
