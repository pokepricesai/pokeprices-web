// src/lib/alerts/weeklyDigestDelivery.ts
// Block 5A-W-17 — shared engine that drives weekly digest delivery for
// both the admin batch route and the Vercel cron route.
//
// SAFETY INVARIANTS (enforced server-side, not by the UI):
//   * dryRun defaults to TRUE. Only the literal boolean `false`
//     triggers a real send. Routes/cron caller cannot bypass this
//     by passing a string, number, or undefined.
//   * No sample data ever reaches a real user — this engine reads
//     buildWeeklyDigestForUser only; it never invokes
//     buildSampleWeeklyDigestData().
//   * Users without user_alert_preferences.enabled=true OR
//     weekly_digest_enabled=true are skipped even if portfolio /
//     watchlist data exists.
//   * Users with no content (no portfolio items, no watchlist items,
//     no alert highlights) are skipped — quiet weeks don't email.
//   * Hard cap HARD_MAX_USERS clamps any caller-supplied limit.
//   * Per-recipient cooldown counts ONLY baseline-eligible prior
//     sends (Block 5A-W-16I) — test sends never count toward the
//     cooldown OR the since-last baseline.
//   * Day-of-week filter: cron source skips users whose
//     weekly_digest_day_of_week doesn't match today (UTC ISO weekday
//     1=Mon … 7=Sun). Admin source ignores day-of-week so an operator
//     can preview / send any day.
//   * No alert_events.delivered_at is touched. The instant-alerts
//     surface owns that table; the weekly digest is read-only against
//     alert_events.
//   * On successful real send, baseline metadata is written into
//     email_delivery_log.metadata_json via sendEmail's metadata pass-
//     through — see baselineEligible:true contract documented in
//     src/lib/alerts/weeklyDigest.ts → loadLastWeeklySnapshot.
//   * Recipient emails are masked in the returned summary so the
//     admin UI never has to render full addresses.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import type { SendEmailInput, SendResult } from '@/lib/email/types'
import { rowToPreferences, type UserAlertPreferences } from './preferences'
import {
  buildWeeklyDigestForUser,
  type WeeklyDigestData,
} from './weeklyDigest'
import { buildWeeklyDigestEmail } from './weeklyDigestEmail'
import { maskEmail } from './delivery'
import { getAlertWeeklyDigestCooldownDays } from './flags'

// ─────────────────────────────────────────────────────────────────────
// Hard caps
// ─────────────────────────────────────────────────────────────────────
const HARD_MAX_USERS    = 100
const DEFAULT_MAX_USERS = 25
// Pool multiplier — we load more user_alert_preferences rows than the
// per-invocation cap so we can filter eligibility / cooldown / wrong-
// day candidates and still fill the budget with eligible users.
const POOL_MULTIPLIER   = 4
const POOL_HARD_MAX     = 1000

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type WeeklyDeliverySource = 'admin' | 'cron'

export type WeeklyDeliveryOutcome =
  | 'sent'                    // send mode, sendEmail returned 'sent'
  | 'would_send'              // dry-run mode, would have been sent
  | 'suppressed'              // sendEmail: terminal or non-terminal suppression
  | 'unsubscribed'            // sendEmail: unsubscribed
  | 'preference_disabled'     // sendEmail: per-category preference off
  | 'provider_error'          // sendEmail: Resend SDK error
  | 'invalid_recipient'       // sendEmail: email failed normalisation
  | 'configuration_error'     // sendEmail: missing key, etc.
  | 'duplicate'               // sendEmail: idempotency conflict
  | 'prefs_disabled'          // user_alert_preferences.enabled = false (or no row)
  | 'weekly_disabled'         // weekly_digest_enabled = false
  | 'sections_disabled'       // both weekly_overview_portfolio_enabled
                              // and weekly_overview_watchlist_enabled = false
  | 'no_content'              // user has nothing this week (no portfolio
                              // items, no watchlist items, no alert highlights)
  | 'no_email'                // could not resolve recipient address
  | 'invalid_email'           // resolved address failed email-shape check
  | 'cooldown'                // baseline-eligible send within cooldown window
  | 'wrong_weekly_day'        // cron source + day-of-week mismatch

export type WeeklyDeliveryUserResult = {
  recipientMasked:    string
  outcome:            WeeklyDeliveryOutcome
  /** ISO weekday (1=Mon … 7=Sun) the user configured for their digest. */
  weeklyDayOfWeek:    number | null
  portfolioItemCount: number
  watchlistItemCount: number
  alertHighlightCount: number
  emailId?:           string | null
  deliveryLogId?:     string | null
  reason?:            string | null
}

export type WeeklyDeliveryResult = {
  dryRun:             boolean
  source:             WeeklyDeliverySource
  asOf:               string
  /** ISO weekday derived from asOf (1=Mon … 7=Sun). Echoed for ops. */
  asOfDayOfWeek:      number
  /** Total users scanned (after pool dedupe, before per-user gates). */
  usersConsidered:    number
  /** Users that would be / were emailed (sent + would_send). */
  usersEmailed:       number
  /** Users skipped specifically because of the weekly cooldown. */
  usersInCooldown:    number
  /** Users skipped because day-of-week didn't match (cron source only). */
  usersWrongDay:      number
  /** All other skips (prefs/weekly disabled, no-content, no-email, …). */
  usersSkipped:       number
  /** Sends that failed (provider_error, invalid_recipient, configuration_error). */
  usersFailed:        number
  cooldownDays:       number
  perUser:            WeeklyDeliveryUserResult[]
}

export type WeeklyDeliveryOptions = {
  /** Default TRUE. Only literal boolean `false` triggers real sends. */
  dryRun?:       boolean
  /** Clamped to HARD_MAX_USERS. Defaults to DEFAULT_MAX_USERS. */
  maxUsers?:     number
  /** Override "now" for deterministic tests / day-of-week fixtures. */
  asOf?:         Date
  /** 'admin' ignores weekly_digest_day_of_week; 'cron' enforces it. */
  source:        WeeklyDeliverySource
  /** Email resolver. Route wires `makeAuthEmailLookup(supa)`; tests
   *  pass a Map-backed stub. Required at runtime — when missing the
   *  engine treats every user as having no email. */
  getUserEmail?: (userId: string) => Promise<string | null>
  /** Optional override for sendEmail. Tests pass a stub. */
  sendFn?:       (input: SendEmailInput) => Promise<SendResult>
  /** Cooldown days override (admin route may bump this for tests).
   *  Invalid values fall back to the env default. */
  cooldownDays?: number
}

const EMAIL_LOOSE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (exported for unit tests)
// ─────────────────────────────────────────────────────────────────────

/** ISO weekday 1..7 (Mon..Sun) from a Date, in UTC. */
export function isoWeekdayUtc(d: Date): number {
  const day = d.getUTCDay()  // 0..6, Sun..Sat
  return day === 0 ? 7 : day
}

function clampLimit(n: number | undefined, def: number, hardMax: number): number {
  if (n == null || !Number.isFinite(n)) return def
  const i = Math.floor(n)
  if (i <= 0) return def
  return Math.min(i, hardMax)
}

function resolveCooldownDays(caller: number | undefined): number {
  if (typeof caller === 'number' && Number.isFinite(caller) && caller > 0) return caller
  return getAlertWeeklyDigestCooldownDays()
}

function hasAnyContent(d: WeeklyDigestData): boolean {
  if (d.status !== 'ok') return false
  const pHas = (d.portfolio?.itemCount ?? 0) > 0
  const wHas = (d.watchlist?.itemCount ?? 0) > 0
  const aHas = d.alertSummary.cardBlocks.length > 0
  return pHas || wHas || aHas
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

export async function deliverWeeklyDigests(
  supa: SupabaseClient,
  opts: WeeklyDeliveryOptions,
): Promise<WeeklyDeliveryResult> {
  const dryRun       = opts.dryRun !== false
  const maxUsers     = clampLimit(opts.maxUsers, DEFAULT_MAX_USERS, HARD_MAX_USERS)
  const asOfDate     = opts.asOf ?? new Date()
  const asOfIso      = asOfDate.toISOString()
  const asOfDow      = isoWeekdayUtc(asOfDate)
  const source       = opts.source
  const getEmail     = opts.getUserEmail ?? (async () => null)
  const send         = opts.sendFn ?? sendEmail
  const cooldownDays = resolveCooldownDays(opts.cooldownDays)
  const cooldownCutoff = new Date(asOfDate.getTime() - cooldownDays * 24 * 60 * 60 * 1000)

  // 1. Pool — pull more candidate prefs rows than the cap so we can
  //    fill the budget even after eligibility / day / cooldown filters
  //    knock candidates out.
  const poolSize = Math.min(POOL_HARD_MAX, maxUsers * POOL_MULTIPLIER)
  const candidatePrefs = await loadCandidatePrefs(supa, poolSize)

  // 2. Eligible-baseline lookup — for every candidate, do we have a
  //    baseline-eligible weekly send inside the cooldown window?
  const candidateUserIds = candidatePrefs.map(c => c.userId)
  const lastBaselineByUser = await loadLastBaselineSentAt(supa, candidateUserIds, cooldownCutoff)

  const perUser: WeeklyDeliveryUserResult[] = []
  let emailedCount = 0

  for (const cand of candidatePrefs) {
    if (perUser.length >= maxUsers + 50) break   // soft total ceiling
    if (emailedCount >= maxUsers) break          // we've filled the email budget

    const prefs = cand.prefs
    const dow   = prefs.weeklyDigestDayOfWeek

    // ── Eligibility gates ─────────────────────────────────────────
    if (!prefs.enabled) {
      perUser.push(skip('prefs_disabled', dow))
      continue
    }
    if (!prefs.weeklyDigestEnabled) {
      perUser.push(skip('weekly_disabled', dow))
      continue
    }
    if (!prefs.weeklyOverviewPortfolioEnabled && !prefs.weeklyOverviewWatchlistEnabled) {
      perUser.push(skip('sections_disabled', dow))
      continue
    }

    // ── Day-of-week gate (cron only) ──────────────────────────────
    if (source === 'cron' && dow !== asOfDow) {
      perUser.push(skip('wrong_weekly_day', dow))
      continue
    }

    // ── Cooldown gate ─────────────────────────────────────────────
    const lastBaseline = lastBaselineByUser.get(cand.userId)
    if (lastBaseline && lastBaseline.getTime() > cooldownCutoff.getTime()) {
      const daysAgo = (asOfDate.getTime() - lastBaseline.getTime()) / (24 * 60 * 60 * 1000)
      perUser.push({
        ...skip('cooldown', dow),
        reason: `last weekly ${daysAgo.toFixed(1)}d ago, cooldown ${cooldownDays}d`,
      })
      continue
    }

    // ── Build the digest ─────────────────────────────────────────
    let data: WeeklyDigestData
    try {
      data = await buildWeeklyDigestForUser(supa, cand.userId, { asOf: asOfDate })
    } catch (e) {
      perUser.push({
        ...skip('provider_error', dow),
        reason: e instanceof Error ? e.message : 'build_failed',
      })
      continue
    }

    const portfolioItemCount = data.portfolio?.itemCount ?? 0
    const watchlistItemCount = data.watchlist?.itemCount ?? 0
    const alertHighlightCount = data.alertSummary.cardBlocks.length

    if (!hasAnyContent(data)) {
      perUser.push({
        recipientMasked:     '***',
        outcome:             'no_content',
        weeklyDayOfWeek:     dow,
        portfolioItemCount,
        watchlistItemCount,
        alertHighlightCount,
      })
      continue
    }

    // ── Email resolution ─────────────────────────────────────────
    const email = await getEmail(cand.userId)
    if (!email) {
      perUser.push({
        recipientMasked:     '***',
        outcome:             'no_email',
        weeklyDayOfWeek:     dow,
        portfolioItemCount,
        watchlistItemCount,
        alertHighlightCount,
      })
      continue
    }
    if (!EMAIL_LOOSE_RE.test(email.trim())) {
      perUser.push({
        recipientMasked:     '***',
        outcome:             'invalid_email',
        weeklyDayOfWeek:     dow,
        portfolioItemCount,
        watchlistItemCount,
        alertHighlightCount,
      })
      continue
    }
    const masked = maskEmail(email)

    // ── Dry-run ─────────────────────────────────────────────────
    if (dryRun) {
      perUser.push({
        recipientMasked:     masked,
        outcome:             'would_send',
        weeklyDayOfWeek:     dow,
        portfolioItemCount,
        watchlistItemCount,
        alertHighlightCount,
      })
      emailedCount++
      continue
    }

    // ── Real send path ──────────────────────────────────────────
    // sample=false and test=false — REAL digest going to a real user.
    const rendered = buildWeeklyDigestEmail(data, { sample: false, test: false })

    let result: SendResult
    try {
      result = await send({
        toEmail:        email,
        category:       'weekly_report',
        templateKey:    'weekly-digest',
        subject:        rendered.subject,
        html:           rendered.html,
        text:           rendered.text,
        idempotencyKey: `weekly-digest-${source}-${cand.userId}-${asOfDate.toISOString().slice(0, 10)}`,
        metadata: {
          source:                   `weekly_digest_${source}`,
          digestType:               'weekly',
          deliverySource:           source,
          generatedAt:              asOfIso,
          // Block 5A-W-16I baseline contract — this is the ONE place
          // baselineEligible:true is written. The reader at
          // weeklyDigest.ts → loadLastWeeklySnapshot picks up only
          // rows that match all three (baselineEligible:true,
          // test:false, sample:false).
          baselineEligible:         true,
          test:                     false,
          sample:                   false,
          status:                   data.status,
          portfolioTotalMinorUnits: data.portfolio?.currentTotalCents ?? null,
          currency:                 data.currency,
          portfolioItemCount,
          portfolioScope:           data.diagnostics.portfolioScope,
          watchlistItemCount,
          alertHighlightCount,
        },
      })
    } catch (e) {
      perUser.push({
        recipientMasked:     masked,
        outcome:             'provider_error',
        weeklyDayOfWeek:     dow,
        portfolioItemCount,
        watchlistItemCount,
        alertHighlightCount,
        reason:              e instanceof Error ? e.message : 'send_threw',
      })
      continue
    }

    perUser.push({
      recipientMasked:     masked,
      outcome:             result.outcome as WeeklyDeliveryOutcome,
      weeklyDayOfWeek:     dow,
      portfolioItemCount,
      watchlistItemCount,
      alertHighlightCount,
      emailId:             result.emailId ?? null,
      deliveryLogId:       result.deliveryLogId ?? null,
      reason:              result.reason ?? null,
    })
    if (result.outcome === 'sent') emailedCount++
  }

  return summarise(perUser, dryRun, source, asOfIso, asOfDow, candidatePrefs.length, cooldownDays)
}

function skip(outcome: WeeklyDeliveryOutcome, dow: number | null): WeeklyDeliveryUserResult {
  return {
    recipientMasked:     '***',
    outcome,
    weeklyDayOfWeek:     dow,
    portfolioItemCount:  0,
    watchlistItemCount:  0,
    alertHighlightCount: 0,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Summary (pure, exported for tests)
// ─────────────────────────────────────────────────────────────────────

const COUNTS_AS_EMAILED   = new Set<WeeklyDeliveryOutcome>(['sent', 'would_send'])
const COUNTS_AS_COOLDOWN  = new Set<WeeklyDeliveryOutcome>(['cooldown'])
const COUNTS_AS_WRONG_DAY = new Set<WeeklyDeliveryOutcome>(['wrong_weekly_day'])
const COUNTS_AS_FAILED    = new Set<WeeklyDeliveryOutcome>(['provider_error','invalid_recipient','configuration_error'])

export function summarise(
  perUser:         WeeklyDeliveryUserResult[],
  dryRun:          boolean,
  source:          WeeklyDeliverySource,
  asOf:            string,
  asOfDayOfWeek:   number,
  usersConsidered: number,
  cooldownDays:    number,
): WeeklyDeliveryResult {
  let usersEmailed     = 0
  let usersInCooldown  = 0
  let usersWrongDay    = 0
  let usersFailed      = 0
  let usersSkipped     = 0
  for (const r of perUser) {
    if (COUNTS_AS_EMAILED.has(r.outcome))        usersEmailed++
    else if (COUNTS_AS_COOLDOWN.has(r.outcome))  usersInCooldown++
    else if (COUNTS_AS_WRONG_DAY.has(r.outcome)) usersWrongDay++
    else if (COUNTS_AS_FAILED.has(r.outcome))    usersFailed++
    else                                          usersSkipped++
  }
  return {
    dryRun,
    source,
    asOf,
    asOfDayOfWeek,
    usersConsidered,
    usersEmailed,
    usersInCooldown,
    usersWrongDay,
    usersSkipped,
    usersFailed,
    cooldownDays,
    perUser,
  }
}

// ─────────────────────────────────────────────────────────────────────
// DB plumbing — keep it READ-ONLY except via sendEmail's own writes
// ─────────────────────────────────────────────────────────────────────

type Candidate = { userId: string; prefs: UserAlertPreferences }

async function loadCandidatePrefs(supa: SupabaseClient, limit: number): Promise<Candidate[]> {
  // Pull rows where the master switch AND weekly switch are on at
  // query time. We re-check both in JS too (defence against a future
  // schema column rename or a missing-column response collapsing to
  // null) — see eligibility gates above.
  const { data, error } = await supa
    .from('user_alert_preferences')
    .select('*')
    .eq('enabled', true)
    .eq('weekly_digest_enabled', true)
    .limit(limit)
  if (error || !Array.isArray(data)) return []
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of data as Array<Record<string, unknown>>) {
    const uid = r.user_id == null ? '' : String(r.user_id)
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    out.push({ userId: uid, prefs: rowToPreferences(r) })
  }
  return out
}

/** Block 5A-W-17 — most recent BASELINE-ELIGIBLE prior weekly send per
 *  user, scoped to inside the cooldown window. Mirrors the read
 *  contract in weeklyDigest.ts → loadLastWeeklySnapshot: only rows
 *  with status sent/delivered AND metadata baselineEligible=true count.
 *  Users with no eligible recent send are absent from the map. */
async function loadLastBaselineSentAt(
  supa:           SupabaseClient,
  userIds:        string[],
  cooldownCutoff: Date,
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (userIds.length === 0) return out
  const { data, error } = await supa
    .from('email_delivery_log')
    .select('user_id, sent_at, status, metadata_json')
    .in('user_id', userIds)
    .eq('category', 'weekly_report')
    .in('status', ['sent', 'delivered'])
    .gte('sent_at', cooldownCutoff.toISOString())
    .order('sent_at', { ascending: false })
  if (error || !Array.isArray(data)) return out
  for (const r of data as Array<Record<string, unknown>>) {
    const uid = r.user_id == null ? '' : String(r.user_id)
    if (!uid) continue
    if (out.has(uid)) continue   // first row per user wins (ordered DESC)
    const meta = (r.metadata_json && typeof r.metadata_json === 'object')
      ? r.metadata_json as Record<string, unknown>
      : {}
    if (meta.baselineEligible !== true) continue
    if (meta.test === true)             continue
    if (meta.sample === true)           continue
    const sentAt = r.sent_at == null ? null : String(r.sent_at)
    if (!sentAt) continue
    const d = new Date(sentAt)
    if (!Number.isNaN(d.getTime())) out.set(uid, d)
  }
  return out
}
