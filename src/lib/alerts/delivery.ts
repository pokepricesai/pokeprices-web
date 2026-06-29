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
//   * Block 5A-W-12 — per-recipient cooldown: if the user's most
//     recent alert_event delivered_at is within the cooldown window
//     (default 24h, env-overridable), the orchestrator SKIPS them
//     with outcome=recent_delivery_cooldown — both in preview AND
//     send mode. Prevents repeat digest emails to the same person
//     when the operator runs back-to-back batches.
//   * Recipient emails are masked in the returned summary so the
//     admin UI never has to render full addresses.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildEmailDigest,
  dedupeEventsPerCardRule,
  groupEventsByCard,
  sortCardBlocksByPriority,
  type DigestEvent,
} from './emailDigest'
import { sendEmail } from '@/lib/email/send'
import type { SendEmailInput, SendResult } from '@/lib/email/types'
import {
  rowToPreferences,
  type AlertRule,
  type UserAlertPreferences,
} from './preferences'
import {
  getAlertDeliveryUserCooldownHours,
  getAlertInstantDeliveryAllowedUserIds,
} from './flags'
import { isInstantAlertEntitled } from '@/lib/account/serverEntitlements'

// ─────────────────────────────────────────────────────────────────────
// Hard caps. Caller-supplied limits are clamped to these values.
// ─────────────────────────────────────────────────────────────────────
const HARD_MAX_USERS                = 50
const HARD_MAX_EVENTS_PER_USER      = 50
const DEFAULT_MAX_USERS             = 5
const DEFAULT_MAX_EVENTS_PER_U      = 20
// Block 5A-W-11 — cap is now CARD-based, not event-based. A card with
// five reasons (raw + psa10 + spread + sales + activity) is one card
// in the digest, not five rows.
const DEFAULT_MAX_CARDS_PER_EMAIL   = 10
const HARD_MAX_CARDS_PER_EMAIL      = 50
// Per-card safety: if a single card somehow accumulated dozens of
// reasons we still trim the digest to a readable size. Surplus events
// stay undelivered and roll into the next batch.
const MAX_EVENTS_PER_CARD           = 10

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type DeliveryOutcome =
  | 'sent'                       // send mode, outcome=sent — delivered_at written
  | 'would_send'                 // dry-run mode, ready to be sent in send mode
  | 'suppressed'                 // sendEmail: suppressed (terminal or non-terminal)
  | 'unsubscribed'               // sendEmail: unsubscribed
  | 'preference_disabled'        // sendEmail: per-category preference off
  | 'provider_error'             // sendEmail: Resend SDK error
  | 'invalid_recipient'          // sendEmail: email failed normalisation
  | 'configuration_error'        // sendEmail: missing key, etc.
  | 'duplicate'                  // sendEmail: idempotency conflict
  | 'prefs_disabled'             // user_alert_preferences.enabled = false (or no row)
  | 'entitlement_blocked'        // Block 5A-W-27: free user / no instant-alerts entitlement
  | 'no_email'                   // could not resolve a recipient address
  | 'no_events'                  // no undelivered events at delivery time (rare race)
  | 'recent_delivery_cooldown'   // Block 5A-W-12 — skipped because the user
                                 // got a digest within the cooldown window

export type UserDeliveryResult = {
  recipientMasked: string
  /** Number of events INCLUDED in the digest (after card grouping +
   *  cap). When outcome=sent this is also the number marked delivered. */
  eventCount:      number
  /** Number of distinct cards included in the digest. Always ≤ the
   *  configured maxCardsPerEmail. */
  cardCount:       number
  /** Block 5A-W-12 — TOTAL undelivered alert_events for this user
   *  AFTER subtracting events included in this digest. Counts the full
   *  backlog, not just what fit in the loaded slice. If a user has 89
   *  undelivered and the email carries 20, this is 69. */
  eventsLeftUndelivered: number
  outcome:         DeliveryOutcome
  emailId?:        string | null
  deliveryLogId?:  string | null
  reason?:         string | null
  /** Block 5A-W-22 — raw event count loaded from alert_events for this
   *  user, BEFORE per-(card, rule) dedupe. Optional because skipped
   *  paths (cooldown, prefs_disabled, no_events) never reach the load
   *  step. Surfaced for admin preview visibility. */
  eventCountLoaded?:    number
  /** Block 5A-W-22 — events actually rendered into the digest (post-
   *  dedupe + card cap). Equal to `eventCount`; named explicitly to
   *  read symmetrically with `eventCountLoaded` in preview output. */
  eventCountRendered?:  number
  /** Block 5A-W-22 — count of superseded duplicate events that got
   *  rolled into this digest's winners (and so will be marked
   *  delivered on a successful send). */
  supersededEventCount?: number
  /** Block 5A-W-22 — count of cards in this digest whose rule mix is
   *  EXCLUSIVELY sales/activity (recent_sales, market_activity). Used
   *  by the admin preview to flag "this batch is mostly trade noise". */
  salesOnlyCardCount?:  number
}

export type DeliveryResult = {
  dryRun:                 boolean
  asOf:                   string
  usersConsidered:        number
  usersEmailed:           number    // sent (or would_send in dry run)
  eventsDelivered:        number    // sum of eventCount for outcomes counted in usersEmailed
  /** Block 5A-W-11 — sum of cardCount across users that were emailed
   *  (or would have been in dry-run). */
  cardsDelivered:         number
  /** Block 5A-W-12 — aggregate of remaining undelivered alert_events
   *  across ALL considered users (emailed users' post-digest backlog
   *  PLUS cooldown-skipped users' full backlog). Lets the operator see
   *  the total queue depth at a glance. */
  eventsLeftUndelivered:  number
  /** Block 5A-W-12 — count of users skipped specifically because of
   *  the per-recipient cooldown. Surfaced separately so the admin can
   *  tell "we have 30 candidates but 25 are in cooldown" from "30
   *  candidates, 5 had no events to send". */
  usersInCooldown:        number
  /** Block 5A-W-27 — count of users skipped because their plan
   *  doesn't entitle them to instant alerts (free plan). Surfaced
   *  alongside cooldown so the admin preview can show "12 candidates
   *  total, 5 blocked by plan, 3 in cooldown, 4 eligible" without
   *  having to grep through `perUser` for outcome=entitlement_blocked. */
  usersBlockedByEntitlement: number
  suppressedOrSkipped:    number
  failed:                 number
  /** Block 5A-W-12 — effective cooldown window the batch ran with,
   *  in hours. Echoed back so the admin UI can label things. */
  cooldownHours:          number
  perUser:                UserDeliveryResult[]
  /** Block 5A-W-22 — staged-rollout allowlist visibility. When
   *  `active=true`, only the listed user_ids were considered; every
   *  other candidate the SQL pool surfaced was filtered out before
   *  any prefs / cooldown / digest work. The admin preview UI uses
   *  this to render a clear "staged rollout" banner. */
  allowlist:              { active: boolean; size: number; filteredOut: number }
}

export type DeliveryOptions = {
  /** Default TRUE. Only literal boolean false triggers a real send. */
  dryRun?:           boolean
  /** Clamped to HARD_MAX_USERS. */
  maxUsers?:         number
  /** Clamped to HARD_MAX_EVENTS_PER_USER. */
  maxEventsPerUser?: number
  /** Block 5A-W-11 — max distinct cards (not events) included in a
   *  single user's digest. Defaults to DEFAULT_MAX_CARDS_PER_EMAIL,
   *  clamped to HARD_MAX_CARDS_PER_EMAIL. */
  maxCardsPerEmail?: number
  /** Block 5A-W-12 — per-recipient cooldown in hours. When omitted,
   *  reads ALERT_DELIVERY_USER_COOLDOWN_HOURS (default 24). Users
   *  whose most-recent alert_events.delivered_at falls inside this
   *  window are SKIPPED with outcome=recent_delivery_cooldown in both
   *  preview and send modes. Out-of-range values fall back to the env
   *  default rather than disabling the cooldown. */
  cooldownHours?:    number
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
  const maxCardsPerEmail = clampLimit(opts.maxCardsPerEmail, DEFAULT_MAX_CARDS_PER_EMAIL, HARD_MAX_CARDS_PER_EMAIL)
  const asOfDate         = opts.asOf ?? new Date()
  const asOfIso          = asOfDate.toISOString()
  const getEmail         = opts.getUserEmail ?? (async () => null)
  const send             = opts.sendFn       ?? sendEmail
  const cooldownHours    = resolveCooldownHours(opts.cooldownHours)
  const cooldownMs       = Math.round(cooldownHours * 60 * 60 * 1000)
  const cooldownCutoff   = new Date(asOfDate.getTime() - cooldownMs)

  // 1. Discover a wider pool of candidate user_ids so we can prefer
  //    non-cooldown users when filling the batch. Without this, a
  //    single user with hundreds of undelivered events can dominate
  //    the first maxUsers slots even when other users are waiting.
  const rawPool = await loadCandidateUserIds(supa, maxUsers * 4)

  // Block 5A-W-22 — staged-rollout allowlist. When set, only the
  // listed user_ids reach the prefs / cooldown / digest pipeline.
  // Everyone else is silently filtered out (we report the filtered
  // count in the result so the admin can see the gate is active).
  const allowlist        = getAlertInstantDeliveryAllowedUserIds()
  const allowlistActive  = allowlist.length > 0
  const allowlistSet     = allowlistActive ? new Set(allowlist) : null
  const pool             = allowlistSet
    ? rawPool.filter(uid => allowlistSet.has(uid))
    : rawPool
  const usersFilteredByAllowlist = allowlistActive ? rawPool.length - pool.length : 0

  // 2. Load prefs for the WHOLE pool so we can re-check enabled at
  //    delivery time (consent can change after the evaluator ran).
  const prefsByUser = await loadPrefsForUsers(supa, pool)

  // 3. Block 5A-W-12 — load each candidate's most-recent delivered_at
  //    so we can apply the per-recipient cooldown BEFORE doing any
  //    other work (no email lookup, no digest build, no send) for
  //    users we know we are going to skip.
  const lastDeliveredByUser = await loadLastDeliveredAt(supa, pool, cooldownCutoff)

  // 4. Partition the pool — eligible users get first call on the
  //    maxUsers budget; cooldown users are still surfaced in the
  //    result so the admin can see "u1 has 89 waiting, eligible in
  //    13h" rather than guessing why nothing was sent.
  const eligible:    string[] = []
  const inCooldown:  string[] = []
  for (const uid of pool) {
    const t = lastDeliveredByUser.get(uid)
    if (t && t.getTime() > cooldownCutoff.getTime()) inCooldown.push(uid)
    else eligible.push(uid)
  }
  const candidateUserIds = [...eligible.slice(0, maxUsers), ...inCooldown]

  const perUser: UserDeliveryResult[] = []

  for (const userId of candidateUserIds) {
    const prefs = prefsByUser.get(userId)
    if (!prefs || !prefs.enabled) {
      perUser.push({ recipientMasked: '***', eventCount: 0, cardCount: 0, eventsLeftUndelivered: 0, outcome: 'prefs_disabled' })
      continue
    }

    // Block 5A-W-27 — instant alert entitlement gate. Free users
    // (anyone not in ACCOUNT_PRO_USER_IDS today) are skipped here
    // BEFORE any email lookup / digest build / send. Their existing
    // alert_events stay where they are; delivered_at is NEVER
    // mutated as a side effect of being blocked, so any future
    // upgrade to pro picks up the backlog cleanly. The evaluator
    // already prevents new events being inserted for these users
    // (Block 5A-W-27 §2), so this branch is mostly defence in depth
    // for the legacy-events case.
    if (!isInstantAlertEntitled(userId)) {
      // Surface the per-user backlog count so the admin preview can
      // tell "this user has 12 stale events from when they were on
      // the trial" — not strictly necessary for behaviour, but the
      // operator visibility is worth the extra count query.
      const totalUndelivered = await countUndeliveredEventsForUser(supa, userId)
      perUser.push({
        recipientMasked:       '***',
        eventCount:            0,
        cardCount:             0,
        eventsLeftUndelivered: totalUndelivered,
        outcome:               'entitlement_blocked',
        reason:                'instant alerts not allowed on free plan',
      })
      continue
    }

    // ── Cooldown gate (preview + send) ─────────────────────────────
    const lastDelivered = lastDeliveredByUser.get(userId)
    if (lastDelivered && lastDelivered.getTime() > cooldownCutoff.getTime()) {
      // We still want the backlog count to be informative so an
      // operator can see "this user has N waiting, will be eligible
      // again at T".
      const totalUndelivered = await countUndeliveredEventsForUser(supa, userId)
      const hoursAgo = (asOfDate.getTime() - lastDelivered.getTime()) / (60 * 60 * 1000)
      perUser.push({
        recipientMasked:       '***',
        eventCount:            0,
        cardCount:             0,
        eventsLeftUndelivered: totalUndelivered,
        outcome:               'recent_delivery_cooldown',
        reason:                `last digest ${hoursAgo.toFixed(1)}h ago, cooldown ${cooldownHours}h`,
      })
      continue
    }

    const events = await loadUndeliveredEvents(supa, userId, maxEventsPerUser)
    if (events.length === 0) {
      perUser.push({ recipientMasked: '***', eventCount: 0, cardCount: 0, eventsLeftUndelivered: 0, outcome: 'no_events' })
      continue
    }

    const email = await getEmail(userId)
    if (!email) {
      perUser.push({ recipientMasked: '***', eventCount: events.length, cardCount: 0, eventsLeftUndelivered: 0, outcome: 'no_email' })
      continue
    }
    const masked = maskEmail(email)

    // ── Group + cap (shared by dry-run and send paths) ────────────
    const allDigestEvents = await toDigestEvents(supa, events)
    const plan            = selectDigestPlan(allDigestEvents, maxCardsPerEmail)
    // Block 5A-W-22 — preview counters shared by dry-run + send.
    const eventCountLoaded     = events.length
    const eventCountRendered   = plan.includedEvents.length
    const supersededEventCount = plan.supersededIds.length
    const salesOnlyCardCount   = countSalesOnlyCards(plan.includedEvents)

    // Block 5A-W-12 — count the FULL backlog (not just the loaded
    // slice). leftAfterDigest = (total undelivered for the user) -
    // (events going into this digest). Never negative.
    const totalUndelivered  = await countUndeliveredEventsForUser(supa, userId)
    const leftAfterDigest   = Math.max(0, totalUndelivered - plan.includedEvents.length)

    if (dryRun) {
      perUser.push({
        recipientMasked:       masked,
        eventCount:            eventCountRendered,
        cardCount:             plan.cardCount,
        eventsLeftUndelivered: leftAfterDigest,
        outcome:               'would_send',
        eventCountLoaded,
        eventCountRendered,
        supersededEventCount,
        salesOnlyCardCount,
      })
      continue
    }

    // ── Real send path ────────────────────────────────────────────
    // sample=false and test=false — REAL digest going to a real user.
    const digest = buildEmailDigest(plan.includedEvents, { sample: false, test: false })

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
        // Block 5A-W-22 — richer metadata so the admin email log
        // pane can show what each send actually shipped, AND so a
        // future block can diff "loaded vs rendered" trends without
        // re-running the engine. `source`, `event_count`, `card_count`
        // preserved verbatim for backward-compat with any pre-22
        // inspecting tool.
        metadata: {
          source:                   'alert_delivery_batch',
          event_count:              eventCountRendered,
          card_count:               plan.cardCount,
          event_count_loaded:       eventCountLoaded,
          event_count_rendered:     eventCountRendered,
          superseded_event_count:   supersededEventCount,
          max_cards_per_email:      maxCardsPerEmail,
          dedupe_applied:           true,
          delivery_engine_version:  'deduped-card-rule-v1',
        },
      })
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'unknown'
      perUser.push({
        recipientMasked:       masked,
        eventCount:            eventCountRendered,
        cardCount:             plan.cardCount,
        eventsLeftUndelivered: leftAfterDigest,
        outcome:               'provider_error',
        reason,
        eventCountLoaded,
        eventCountRendered,
        supersededEventCount,
        salesOnlyCardCount,
      })
      continue
    }

    perUser.push({
      recipientMasked:       masked,
      eventCount:            eventCountRendered,
      cardCount:             plan.cardCount,
      eventsLeftUndelivered: leftAfterDigest,
      outcome:               result.outcome as DeliveryOutcome,
      emailId:               result.emailId ?? null,
      deliveryLogId:         result.deliveryLogId ?? null,
      reason:                result.reason ?? null,
      eventCountLoaded,
      eventCountRendered,
      supersededEventCount,
      salesOnlyCardCount,
    })

    // ── Mark delivered ONLY when the send actually went through ──
    // SELECTIVE: only the events that fit in the digest are marked.
    // Events trimmed by the card cap stay undelivered and roll into
    // the next batch.
    //
    // Block 5A-W-20 — plus any "superseded" IDs from the per-(card,
    // rule) dedupe step whose winner is in includedEvents. The user
    // has effectively been notified about that (card, rule)
    // condition by the winner event; leaving the duplicates
    // undelivered would just re-stack them on top of the next
    // digest. selectDigestPlan only returns supersededIds whose
    // winner survived the card cap, so this is safe.
    if (result.outcome === 'sent') {
      const winnerIds = plan.includedEvents
        .map(e => e.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      const allIds = [...winnerIds, ...plan.supersededIds]
      if (allIds.length > 0) {
        await markEventsDelivered(supa, allIds, asOfIso)
      }
    }
  }

  return summarise(perUser, dryRun, asOfIso, candidateUserIds.length, cooldownHours, {
    active:      allowlistActive,
    size:        allowlist.length,
    filteredOut: usersFilteredByAllowlist,
  })
}

/** Block 5A-W-22 — count cards in a digest whose ONLY rules are
 *  sales/activity. The brief flags batches with >3 of these so an
 *  operator can spot when an instant alert run is mostly trade
 *  noise rather than meaningful price moves. Pure. */
function countSalesOnlyCards(events: DigestEvent[]): number {
  const rulesByKey = new Map<string, Set<string>>()
  for (const e of events) {
    const k = e.cardSlug ? `slug:${e.cardSlug}` : `name:${e.cardName}|${e.setName}`
    let set = rulesByKey.get(k)
    if (!set) { set = new Set(); rulesByKey.set(k, set) }
    set.add(e.rule)
  }
  const SALES_RULES = new Set(['recent_sales', 'market_activity'])
  let count = 0
  for (const ruleSet of Array.from(rulesByKey.values())) {
    let allSales = true
    for (const r of Array.from(ruleSet)) {
      if (!SALES_RULES.has(r)) { allSales = false; break }
    }
    if (allSales && ruleSet.size > 0) count++
  }
  return count
}

/** Resolve the effective cooldown window. Caller-supplied option wins,
 *  falling back to ALERT_DELIVERY_USER_COOLDOWN_HOURS (default 24).
 *  Invalid caller values (non-finite / ≤ 0) fall back to the env
 *  default rather than silently disabling the cooldown. */
function resolveCooldownHours(callerSupplied: number | undefined): number {
  if (typeof callerSupplied === 'number' && Number.isFinite(callerSupplied) && callerSupplied > 0) {
    return callerSupplied
  }
  return getAlertDeliveryUserCooldownHours()
}

// ─────────────────────────────────────────────────────────────────────
// Card-first digest plan (pure, exported for tests)
// ─────────────────────────────────────────────────────────────────────

export type DigestPlan = {
  /** Events kept after grouping + capping. Pass directly to
   *  buildEmailDigest — it will re-group internally. */
  includedEvents: DigestEvent[]
  /** Distinct cards represented in includedEvents. */
  cardCount:      number
  /** Events that were loaded but excluded because of the card cap or
   *  per-card safety cap. Surface this in the admin response so the
   *  operator can spot a leftover trend. */
  leftover:       number
  /** Block 5A-W-20 — alert_events ids that were dropped by the
   *  per-(card, rule) dedupe step AND whose winning sibling event
   *  survives in `includedEvents`. The orchestrator marks these
   *  delivered alongside the winners on a successful send, on the
   *  theory that the user has effectively been notified about the
   *  same (card, rule) condition.
   *
   *  IDs from losers whose winner ALSO got cut by the card cap are
   *  NOT included here — neither side of that pair was put in front
   *  of the user, so neither side should be marked delivered. */
  supersededIds:  string[]
}

/** Group raw digest events into card blocks, sort blocks by priority,
 *  trim to the card cap, and trim each card to MAX_EVENTS_PER_CARD.
 *  Returns the flat list of surviving events plus counters. Pure.
 *
 *  Block 5A-W-20 — dedupes per (card, rule) BEFORE grouping so the
 *  card-cap loop sees the deduped event count, not the raw count.
 *  This keeps the digest visually tight (one line per rule per card)
 *  AND prevents the card cap from eating real cards when one card
 *  has dozens of near-duplicate events stacked on it. */
export function selectDigestPlan(events: DigestEvent[], maxCards: number): DigestPlan {
  if (events.length === 0) return { includedEvents: [], cardCount: 0, leftover: 0, supersededIds: [] }
  // 1. Dedupe per (card, rule). Winners proceed; losers are tracked
  //    so we can roll them into delivered_at when the winner ships.
  const { keptEvents, supersededByWinnerId } = dedupeEventsPerCardRule(events)

  // 2. Group + sort + cap (same as pre-5A-W-20, but on the deduped set).
  const blocks = sortCardBlocksByPriority(groupEventsByCard(keptEvents))
  const capped = blocks.slice(0, maxCards).map(b => ({
    ...b,
    events: b.events.slice(0, MAX_EVENTS_PER_CARD),
  }))
  const includedEvents = capped.flatMap(b => b.events)

  // 3. Pick only the superseded IDs whose winner survived to
  //    includedEvents — others got cut and shouldn't be claimed
  //    as "user was notified".
  const includedWinnerIds = new Set(
    includedEvents.map(e => e.id).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  const supersededIds: string[] = []
  for (const winnerId of Array.from(includedWinnerIds)) {
    const losers = supersededByWinnerId.get(winnerId)
    if (losers && losers.length > 0) supersededIds.push(...losers)
  }

  return {
    includedEvents,
    cardCount: capped.length,
    // leftover counts events DROPPED by the card cap (or the per-card
    // safety cap) — superseded duplicates are intentionally NOT
    // counted as leftover because they were never going to render
    // even if no cap had applied. Matches the operator's mental
    // model: "leftover means unrendered cards we couldn't fit", not
    // "every event the dedupe collapsed".
    leftover:  Math.max(0, keptEvents.length - includedEvents.length),
    supersededIds,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Summary aggregation (pure, exported for tests)
// ─────────────────────────────────────────────────────────────────────

const COUNTS_AS_EMAILED = new Set<DeliveryOutcome>(['sent', 'would_send'])
const COUNTS_AS_SKIPPED = new Set<DeliveryOutcome>(['suppressed','unsubscribed','preference_disabled','prefs_disabled','entitlement_blocked','no_email','no_events','duplicate','recent_delivery_cooldown'])
const COUNTS_AS_FAILED  = new Set<DeliveryOutcome>(['provider_error','invalid_recipient','configuration_error'])

export function summarise(
  perUser:         UserDeliveryResult[],
  dryRun:          boolean,
  asOf:            string,
  usersConsidered: number,
  cooldownHours:   number,
  /** Block 5A-W-22 — staged-rollout allowlist state. Optional so
   *  pre-22 callers (and the existing test suite) still compile;
   *  defaults to "inactive" when omitted. */
  allowlist:       { active: boolean; size: number; filteredOut: number } = {
    active: false, size: 0, filteredOut: 0,
  },
): DeliveryResult {
  let usersEmailed              = 0
  let eventsDelivered           = 0
  let cardsDelivered            = 0
  let eventsLeftUndelivered     = 0
  let usersInCooldown           = 0
  let usersBlockedByEntitlement = 0
  let suppressedSkip            = 0
  let failed                    = 0
  for (const r of perUser) {
    if (COUNTS_AS_EMAILED.has(r.outcome)) {
      usersEmailed++
      eventsDelivered       += r.eventCount
      cardsDelivered        += r.cardCount ?? 0
      eventsLeftUndelivered += r.eventsLeftUndelivered ?? 0
    } else if (COUNTS_AS_SKIPPED.has(r.outcome)) {
      suppressedSkip++
      // Cooldown-skipped users carry the full backlog count; roll it
      // into the aggregate so the admin sees real queue depth.
      if (r.outcome === 'recent_delivery_cooldown') {
        usersInCooldown++
        eventsLeftUndelivered += r.eventsLeftUndelivered ?? 0
      }
      // Block 5A-W-27 — entitlement-blocked users also carry their
      // existing backlog (legacy events from before they were
      // downgraded / from a pre-plan deploy). Add to the aggregate
      // so the admin sees there's still data parked on free users.
      if (r.outcome === 'entitlement_blocked') {
        usersBlockedByEntitlement++
        eventsLeftUndelivered += r.eventsLeftUndelivered ?? 0
      }
    } else if (COUNTS_AS_FAILED.has(r.outcome)) {
      failed++
      // Failed sends still represent real events that didn't get out;
      // surface their backlog under leftover so the admin notices.
      eventsLeftUndelivered += r.eventsLeftUndelivered ?? 0
    }
  }
  return {
    dryRun,
    asOf,
    usersConsidered,
    usersEmailed,
    eventsDelivered,
    cardsDelivered,
    eventsLeftUndelivered,
    usersInCooldown,
    usersBlockedByEntitlement,
    suppressedOrSkipped: suppressedSkip,
    failed,
    cooldownHours,
    perUser,
    allowlist,
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

/** Block 5A-W-12 — most-recent delivered_at per candidate user, scoped
 *  to events inside the cooldown window. Returns one Date per user
 *  who has ≥1 delivery within the window; users with no recent
 *  delivery (or no delivery at all) are absent from the map. The
 *  cutoff filter keeps the result small even when a user has hundreds
 *  of historical delivered_at rows. */
async function loadLastDeliveredAt(
  supa:           SupabaseClient,
  userIds:        string[],
  cooldownCutoff: Date,
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (userIds.length === 0) return out
  const { data, error } = await supa
    .from('alert_events')
    .select('user_id, delivered_at')
    .in('user_id', userIds)
    .gte('delivered_at', cooldownCutoff.toISOString())
    .order('delivered_at', { ascending: false })
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const uid = String(r.user_id ?? '')
    if (!uid) continue
    if (out.has(uid)) continue   // first row per user wins (we ordered DESC)
    const raw = r.delivered_at
    if (raw == null) continue
    const d = new Date(String(raw))
    if (!Number.isNaN(d.getTime())) out.set(uid, d)
  }
  return out
}

/** Block 5A-W-12 — exact backlog count per user. Used for the
 *  accurate eventsLeftUndelivered figure that the previous block was
 *  computing from the loaded slice (which capped at maxEventsPerUser
 *  and so under-reported the queue depth). */
async function countUndeliveredEventsForUser(supa: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supa
    .from('alert_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('delivered_at', null)
  if (error || typeof count !== 'number' || !Number.isFinite(count)) return 0
  return count
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
  // Block 5A-W-11 — plumb `id` and `cardSlug` so the digest builder
  // groups by card AND the delivery orchestrator can map blocks back
  // to alert_events ids for selective delivered_at marking.
  // Block 5A-W-20 — also plumb `detectedAt` so the renderer's
  // dedupe helper has a tie-breaker when two events for the same
  // (card, rule) have equal magnitudes.
  return events.map(e => ({
    cardName:   e.card_name ?? e.card_slug,
    setName:    e.set_name ?? '',
    cardSlug:   e.card_slug,
    cardUrl:    urlMap.get(e.card_slug),
    rule:       e.rule,
    severity:   e.severity,
    payload:    e.payload_json ?? {},
    id:         e.id,
    detectedAt: e.detected_at,
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
