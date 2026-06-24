// src/lib/alerts/delivery.ts
// Block 5A-W-6 — admin-triggered batch delivery of real alert digest
// emails. Pulls candidate users with undelivered alert_events,
// re-checks each user's preference state, groups events per user,
// sends ONE digest per user via the central email service, and only
// marks alert_events.delivered_at when the send outcome is 'sent'.
//
// SAFETY INVARIANTS (enforced server-side, not by the UI):
//   * dryRun defaults to TRUE. Only the literal boolean `false`
//     triggers a real send.
//   * No sample data ever reaches a real user — this module reads
//     alert_events only; it never invokes buildSampleEvents().
//   * Users without user_alert_preferences.enabled=true are skipped
//     even if alert_events rows exist for them (consent can be
//     revoked between evaluation and delivery).
//   * Hard caps: HARD_MAX_USERS and HARD_MAX_EVENTS_PER_USER clamp
//     any caller-supplied limit.
//   * delivered_at is only updated for the events that were carried
//     in a send whose outcome === 'sent'. Suppressed / preference-
//     disabled / provider_error sends never mark events delivered.
//   * Recipient emails are masked in the returned summary so the
//     admin UI never has to render full addresses.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildEmailDigest,
  type DigestEvent,
} from './emailDigest'
import { sendEmail } from '@/lib/email/send'
import type { SendEmailInput, SendResult } from '@/lib/email/types'
import {
  rowToPreferences,
  type AlertRule,
  type UserAlertPreferences,
} from './preferences'

// ─────────────────────────────────────────────────────────────────────
// Hard caps. Caller-supplied limits are clamped to these values.
// ─────────────────────────────────────────────────────────────────────
const HARD_MAX_USERS            = 50
const HARD_MAX_EVENTS_PER_USER  = 50
const DEFAULT_MAX_USERS         = 5
const DEFAULT_MAX_EVENTS_PER_U  = 20

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type DeliveryOutcome =
  | 'sent'                  // send mode, outcome=sent — delivered_at written
  | 'would_send'            // dry-run mode, ready to be sent in send mode
  | 'suppressed'            // sendEmail: suppressed (terminal or non-terminal)
  | 'unsubscribed'          // sendEmail: unsubscribed
  | 'preference_disabled'   // sendEmail: per-category preference off
  | 'provider_error'        // sendEmail: Resend SDK error
  | 'invalid_recipient'     // sendEmail: email failed normalisation
  | 'configuration_error'   // sendEmail: missing key, etc.
  | 'duplicate'             // sendEmail: idempotency conflict
  | 'prefs_disabled'        // user_alert_preferences.enabled = false (or no row)
  | 'no_email'              // could not resolve a recipient address
  | 'no_events'             // no undelivered events at delivery time (rare race)

export type UserDeliveryResult = {
  recipientMasked: string
  eventCount:      number
  outcome:         DeliveryOutcome
  emailId?:        string | null
  deliveryLogId?:  string | null
  reason?:         string | null
}

export type DeliveryResult = {
  dryRun:               boolean
  asOf:                 string
  usersConsidered:      number
  usersEmailed:         number    // sent (or would_send in dry run)
  eventsDelivered:      number    // sum of eventCount for outcomes counted in usersEmailed
  suppressedOrSkipped:  number
  failed:               number
  perUser:              UserDeliveryResult[]
}

export type DeliveryOptions = {
  /** Default TRUE. Only literal boolean false triggers a real send. */
  dryRun?:           boolean
  /** Clamped to HARD_MAX_USERS. */
  maxUsers?:         number
  /** Clamped to HARD_MAX_EVENTS_PER_USER. */
  maxEventsPerUser?: number
  /** Override "now" for deterministic tests. */
  asOf?:             Date
  /** Email-resolution dependency. The route handler passes a function
   *  that wraps `supabase.auth.admin.getUserById`. Tests pass a
   *  Map-backed stub so they don't need an auth surface. Required at
   *  runtime — if missing, delivery acts as if every user has no email. */
  getUserEmail?:     (userId: string) => Promise<string | null>
  /** Send dependency, defaults to the real sendEmail service. Tests
   *  pass a stub to record calls and control outcomes. */
  sendFn?:           (input: SendEmailInput) => Promise<SendResult>
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────

/** "ab*****@example.com". Operator-friendly identifier, no PII fidelity. */
export function maskEmail(email: string): string {
  const trimmed = (email ?? '').trim()
  const at = trimmed.indexOf('@')
  if (at <= 0 || at === trimmed.length - 1) return '***'
  const local  = trimmed.slice(0, at)
  const domain = trimmed.slice(at + 1)
  const visible = Math.min(2, Math.max(1, local.length))
  return `${local.slice(0, visible)}***@${domain}`
}

function clampLimit(n: number | undefined, def: number, hardMax: number): number {
  if (n == null || !Number.isFinite(n)) return def
  const i = Math.floor(n)
  if (i <= 0) return def
  return Math.min(i, hardMax)
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

type AlertEventRow = {
  id:           string
  user_id:      string
  card_slug:    string
  card_name:    string | null
  set_name:     string | null
  rule:         AlertRule
  severity:     'low'|'normal'|'high'
  payload_json: Record<string, unknown> | null
  detected_at:  string
}

export async function deliverAlerts(
  supa: SupabaseClient,
  opts: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const dryRun           = opts.dryRun !== false   // default TRUE
  const maxUsers         = clampLimit(opts.maxUsers,         DEFAULT_MAX_USERS,        HARD_MAX_USERS)
  const maxEventsPerUser = clampLimit(opts.maxEventsPerUser, DEFAULT_MAX_EVENTS_PER_U, HARD_MAX_EVENTS_PER_USER)
  const asOfDate         = opts.asOf ?? new Date()
  const asOfIso          = asOfDate.toISOString()
  const getEmail         = opts.getUserEmail ?? (async () => null)
  const send             = opts.sendFn       ?? sendEmail

  // 1. Discover candidate user_ids with undelivered events. Pull a bit
  //    more than maxUsers in case some are skipped by prefs / no_email,
  //    but DO cap to maxUsers after the prefs filter so the batch
  //    cannot grow past the operator's request.
  const candidateUserIds = await loadCandidateUserIds(supa, maxUsers)

  // 2. Load prefs for the candidates so we can re-check enabled at
  //    delivery time (consent can change after the evaluator ran).
  const prefsByUser = await loadPrefsForUsers(supa, candidateUserIds)

  const perUser: UserDeliveryResult[] = []

  for (const userId of candidateUserIds) {
    const prefs = prefsByUser.get(userId)
    if (!prefs || !prefs.enabled) {
      perUser.push({ recipientMasked: '***', eventCount: 0, outcome: 'prefs_disabled' })
      continue
    }

    const events = await loadUndeliveredEvents(supa, userId, maxEventsPerUser)
    if (events.length === 0) {
      perUser.push({ recipientMasked: '***', eventCount: 0, outcome: 'no_events' })
      continue
    }

    const email = await getEmail(userId)
    if (!email) {
      perUser.push({ recipientMasked: '***', eventCount: events.length, outcome: 'no_email' })
      continue
    }
    const masked = maskEmail(email)

    if (dryRun) {
      perUser.push({ recipientMasked: masked, eventCount: events.length, outcome: 'would_send' })
      continue
    }

    // ── Real send path ────────────────────────────────────────────
    const digestEvents = await toDigestEvents(supa, events)
    // sample=false and test=false — REAL digest going to a real user.
    const digest = buildEmailDigest(digestEvents, { sample: false, test: false })

    let result: SendResult
    try {
      result = await send({
        toEmail:        email,
        category:       'watchlist_alert',
        templateKey:    'alert-digest',
        subject:        digest.subject,
        html:           digest.html,
        text:           digest.text,
        // Fresh idempotency key per batch attempt so retries don't
        // collapse with prior failed attempts.
        idempotencyKey: `alert-digest-${userId}-${asOfDate.getTime()}`,
        metadata: {
          source:      'alert_delivery_batch',
          event_count: events.length,
        },
      })
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown'
      perUser.push({ recipientMasked: masked, eventCount: events.length, outcome: 'provider_error', reason })
      continue
    }

    perUser.push({
      recipientMasked: masked,
      eventCount:      events.length,
      outcome:         result.outcome as DeliveryOutcome,
      emailId:         result.emailId ?? null,
      deliveryLogId:   result.deliveryLogId ?? null,
      reason:          result.reason ?? null,
    })

    // ── Mark delivered ONLY when the send actually went through ──
    if (result.outcome === 'sent') {
      await markEventsDelivered(supa, events.map(e => e.id), asOfIso)
    }
  }

  return summarise(perUser, dryRun, asOfIso, candidateUserIds.length)
}

// ─────────────────────────────────────────────────────────────────────
// Summary aggregation (pure, exported for tests)
// ─────────────────────────────────────────────────────────────────────

const COUNTS_AS_EMAILED = new Set<DeliveryOutcome>(['sent', 'would_send'])
const COUNTS_AS_SKIPPED = new Set<DeliveryOutcome>(['suppressed','unsubscribed','preference_disabled','prefs_disabled','no_email','no_events','duplicate'])
const COUNTS_AS_FAILED  = new Set<DeliveryOutcome>(['provider_error','invalid_recipient','configuration_error'])

export function summarise(perUser: UserDeliveryResult[], dryRun: boolean, asOf: string, usersConsidered: number): DeliveryResult {
  let usersEmailed     = 0
  let eventsDelivered  = 0
  let suppressedSkip   = 0
  let failed           = 0
  for (const r of perUser) {
    if (COUNTS_AS_EMAILED.has(r.outcome)) {
      usersEmailed++
      eventsDelivered += r.eventCount
    } else if (COUNTS_AS_SKIPPED.has(r.outcome)) {
      suppressedSkip++
    } else if (COUNTS_AS_FAILED.has(r.outcome)) {
      failed++
    }
  }
  return {
    dryRun,
    asOf,
    usersConsidered,
    usersEmailed,
    eventsDelivered,
    suppressedOrSkipped: suppressedSkip,
    failed,
    perUser,
  }
}

// ─────────────────────────────────────────────────────────────────────
// DB plumbing (read + write)
// ─────────────────────────────────────────────────────────────────────

async function loadCandidateUserIds(supa: SupabaseClient, maxUsers: number): Promise<string[]> {
  // Pull a small sample of undelivered rows and derive the distinct
  // user_ids client-side. Cap at maxUsers — duplicates are fine; we
  // dedupe before iteration.
  const { data, error } = await supa
    .from('alert_events')
    .select('user_id, detected_at')
    .is('delivered_at', null)
    .order('detected_at', { ascending: false })
    .limit(maxUsers * 20)   // headroom: a single user can dominate, so pull more than maxUsers
  if (error || !Array.isArray(data)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of data as Array<Record<string, unknown>>) {
    const uid = String(r.user_id ?? '')
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    out.push(uid)
    if (out.length >= maxUsers) break
  }
  return out
}

async function loadPrefsForUsers(supa: SupabaseClient, userIds: string[]): Promise<Map<string, UserAlertPreferences>> {
  const out = new Map<string, UserAlertPreferences>()
  if (userIds.length === 0) return out
  const { data, error } = await supa
    .from('user_alert_preferences')
    .select('*')
    .in('user_id', userIds)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    out.set(String(r.user_id), rowToPreferences(r))
  }
  return out
}

async function loadUndeliveredEvents(supa: SupabaseClient, userId: string, limit: number): Promise<AlertEventRow[]> {
  const { data, error } = await supa
    .from('alert_events')
    .select('id, user_id, card_slug, card_name, set_name, rule, severity, payload_json, detected_at')
    .eq('user_id', userId)
    .is('delivered_at', null)
    .order('detected_at', { ascending: false })
    .limit(limit)
  if (error || !Array.isArray(data)) return []
  return (data as Array<Record<string, unknown>>).map(r => ({
    id:           String(r.id),
    user_id:      String(r.user_id),
    card_slug:    String(r.card_slug),
    card_name:    r.card_name == null ? null : String(r.card_name),
    set_name:     r.set_name  == null ? null : String(r.set_name),
    rule:         String(r.rule) as AlertRule,
    severity:    (String(r.severity) as 'low'|'normal'|'high') ?? 'normal',
    payload_json: (r.payload_json && typeof r.payload_json === 'object') ? r.payload_json as Record<string, unknown> : null,
    detected_at:  String(r.detected_at),
  }))
}

async function toDigestEvents(supa: SupabaseClient, events: AlertEventRow[]): Promise<DigestEvent[]> {
  const slugs = Array.from(new Set(events.map(e => e.card_slug).filter(Boolean)))
  const urlMap = await loadCardUrlMap(supa, slugs)
  return events.map(e => ({
    cardName: e.card_name ?? e.card_slug,
    setName:  e.set_name ?? '',
    cardUrl:  urlMap.get(e.card_slug),
    rule:     e.rule,
    severity: e.severity,
    payload:  e.payload_json ?? {},
  }))
}

async function loadCardUrlMap(supa: SupabaseClient, bareSlugs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (bareSlugs.length === 0) return out
  const { data, error } = await supa
    .from('cards')
    .select('card_slug, set_name, card_url_slug')
    .in('card_slug', bareSlugs)
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const slug    = String(r.card_slug)
    const setName = r.set_name      == null ? '' : String(r.set_name)
    const urlSlug = r.card_url_slug == null ? '' : String(r.card_url_slug)
    if (slug && setName && urlSlug) {
      out.set(slug, `https://www.pokeprices.io/set/${encodeURIComponent(setName)}/card/${urlSlug}`)
    }
  }
  return out
}

async function markEventsDelivered(supa: SupabaseClient, eventIds: string[], deliveredAtIso: string): Promise<void> {
  if (eventIds.length === 0) return
  await supa
    .from('alert_events')
    .update({ delivered_at: deliveredAtIso, delivery_channel: 'email' })
    .in('id', eventIds)
}

// ─────────────────────────────────────────────────────────────────────
// Email resolution helper for the route handler
// ─────────────────────────────────────────────────────────────────────

type AuthAdminCapable = SupabaseClient & {
  auth: { admin: { getUserById: (id: string) => Promise<{ data: { user: { email: string | null } | null } | null; error: { message: string } | null }> } }
}

/**
 * Bind a getUserEmail callback that resolves an auth.users email via
 * the service-role client. Used by the route handler. Tests pass a
 * Map-backed stub directly to deliverAlerts() instead of using this.
 */
export function makeAuthEmailLookup(supa: SupabaseClient): (userId: string) => Promise<string | null> {
  return async (userId: string) => {
    try {
      const client = supa as AuthAdminCapable
      const r = await client.auth.admin.getUserById(userId)
      if (r.error || !r.data?.user) return null
      const email = r.data.user.email
      return typeof email === 'string' && email.trim().length > 0 ? email.trim() : null
    } catch {
      return null
    }
  }
}
