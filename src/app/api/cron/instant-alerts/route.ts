// src/app/api/cron/instant-alerts/route.ts
// Block 5A-W-18 — Vercel-Cron-invoked instant-alert evaluator + delivery.
//
// Pipeline (sequential, both write-mode):
//   1. evaluateAlerts(supa, { dryRun: false, limitUsers: <env cap> })
//        — scans candidate users' watchlist + portfolio, evaluates the
//          enabled rules against their thresholds, inserts new
//          alert_events for triggers that pass the per-(card, rule)
//          cooldown. Respects user_alert_preferences (enabled,
//          instant_alerts_enabled, scope_watchlist/portfolio, per-rule
//          toggles, thresholds, minHoursBetweenAlerts).
//   2. deliverAlerts(supa, { dryRun: false, maxUsers: <env cap>,
//          maxCardsPerEmail: 10, getUserEmail })
//        — groups undelivered alert_events per user, sends ONE digest
//          per recipient (subject to the per-user delivery cooldown
//          ALERT_DELIVERY_USER_COOLDOWN_HOURS), then marks ONLY the
//          events that fit in a successfully-sent digest as delivered.
//
// Double gate:
//   1. CRON_SECRET bearer via isCronAuthOk (also accepts legacy
//      ONBOARDING_CRON_SECRET — see src/lib/email/cronAuth.ts).
//   2. ALERT_INSTANT_ALERTS_CRON_ENABLED='true' (literal).
//
// Either gate failing returns 401 (auth) or 503 (flag). No body is
// read — Vercel Cron sends a plain header request with no body, so
// all knobs come from env:
//   * ALERT_INSTANT_EVALUATOR_CRON_MAX_USERS   default 100, hard 500
//   * ALERT_INSTANT_DELIVERY_CRON_MAX_USERS    default 25,  hard 100
//   * ALERT_DELIVERY_USER_COOLDOWN_HOURS       default 24
//
// SAFETY
//   * Never accepts an arbitrary recipient — delivery engine routes
//     to each candidate user's own auth.users.email via
//     makeAuthEmailLookup.
//   * Response never echoes user_id or email; recipients are masked.
//   * No sample data ever — evaluator + delivery both read real DB
//     state only.
//   * alert_events.delivered_at is mutated ONLY by deliverAlerts and
//     ONLY for events that fit in a successfully-sent digest.
//   * Hard caps enforced inside the flag helpers (evaluator 500,
//     delivery 100) — env overrides cannot raise above them.

import 'server-only'
import { NextResponse } from 'next/server'
import { isCronAuthOk } from '@/lib/email/cronAuth'
import {
  isAlertInstantAlertsCronEnabled,
  getAlertInstantEvaluatorCronMaxUsers,
  getAlertInstantDeliveryCronMaxUsers,
} from '@/lib/alerts/flags'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { evaluateAlerts, type EvaluationResult } from '@/lib/alerts/evaluator'
import { deliverAlerts, makeAuthEmailLookup, type DeliveryResult } from '@/lib/alerts/delivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DELIVERY_MAX_CARDS_PER_EMAIL = 10

async function handle(req: Request) {
  // Auth FIRST so an unauthenticated probe sees only an opaque 401 /
  // 503 with no detail about whether the flag is on.
  const auth = isCronAuthOk(req)
  if (!auth.ok) {
    const status = auth.reason === 'missing_secret' ? 503 : 401
    return NextResponse.json({ error: 'unauthorised' }, { status })
  }
  if (!isAlertInstantAlertsCronEnabled()) {
    return NextResponse.json({ error: 'instant alerts cron disabled' }, { status: 503 })
  }

  const evaluatorMaxUsers = getAlertInstantEvaluatorCronMaxUsers()
  const deliveryMaxUsers  = getAlertInstantDeliveryCronMaxUsers()

  try {
    const supa = getSupabaseServiceClient()

    let evaluation: EvaluationResult
    try {
      evaluation = await evaluateAlerts(supa, {
        dryRun:     false,
        limitUsers: evaluatorMaxUsers,
      })
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'unknown'
      // Evaluator failure → no point running delivery; return a
      // partial result so the operator can see where it broke.
      return NextResponse.json(
        { stage: 'evaluator_failed', error: 'evaluator failed', detail },
        { status: 500 },
      )
    }

    let delivery: DeliveryResult
    try {
      delivery = await deliverAlerts(supa, {
        dryRun:           false,
        maxUsers:         deliveryMaxUsers,
        maxCardsPerEmail: DELIVERY_MAX_CARDS_PER_EMAIL,
        getUserEmail:     makeAuthEmailLookup(supa),
      })
    } catch (e) {
      const detail = e instanceof Error ? e.message : 'unknown'
      return NextResponse.json(
        {
          stage: 'delivery_failed',
          error: 'delivery failed',
          detail,
          // Surface the evaluator portion so the operator still has
          // visibility into the write-side work that did complete.
          evaluation: redactEvaluation(evaluation),
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      stage:      'ok',
      evaluation: redactEvaluation(evaluation),
      delivery,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: 'instant alerts cron failed', detail: msg }, { status: 500 })
  }
}

/** Drop the proposedEvents sample from the response — the evaluator
 *  returns rich per-event payloads useful in admin UIs, but the cron
 *  result is operator-readable JSON in logs and we don't want raw
 *  user-scoped fields leaking there. The counters + diagnostics
 *  remain so an operator can see what happened. */
function redactEvaluation(r: EvaluationResult): Omit<EvaluationResult, 'proposedEvents'> & { proposedEventCount: number } {
  const { proposedEvents, ...rest } = r
  return {
    ...rest,
    proposedEventCount: proposedEvents.length,
  }
}

// Vercel Cron invokes GET; POST is offered so an operator can replay
// the cron locally with curl + bearer.
export async function GET(req: Request)  { return handle(req) }
export async function POST(req: Request) { return handle(req) }
