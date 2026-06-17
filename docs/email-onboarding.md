# Email onboarding (Block 3B)

Three-email sequence that runs once per newly verified PokePrices user
and then stops. Restrained by design — no marketing newsletter, no
paid-plan pitch, no eBay affiliate links. Sits on top of the Block 3A
central send service and inherits every preference + suppression rule
defined there.

## Sequence timing

| Step | Default delay after enrolment | Subject (default) |
|---|---|---|
| `welcome`    | 10 minutes | "Welcome to PokePrices" |
| `activation` | 2 days     | branch-dependent (A/B/C/D — see below) |
| `discovery`  | 7 days     | "A few PokePrices features you may have missed" |

All three delays are operator-tunable via env vars
(`ONBOARDING_WELCOME_DELAY_MS`, `ONBOARDING_ACTIVATION_DELAY_MS`,
`ONBOARDING_DISCOVERY_DELAY_MS`). The defaults are the production
defaults; tighter values are recommended for a single-account rollout
test only.

## Enrolment conditions

Triggered from `src/app/auth/callback/route.ts` after
`exchangeCodeForSession` succeeds. Implemented in
`src/lib/email/onboarding.ts:tryEnrolOnboarding`. **All seven checks
must pass:**

1. `EMAIL_ONBOARDING_ENABLED === 'true'`.
2. `ONBOARDING_ELIGIBLE_AFTER` parses to a valid ISO timestamp.
   **Missing or invalid fails closed** — no enrolment.
3. Verified email present (`auth.users.email_confirmed_at IS NOT NULL`).
4. `auth.users.created_at >= ONBOARDING_ELIGIBLE_AFTER`. **This is the
   primary safeguard against silently enrolling existing users.** PK
   collision alone is not enough — an existing user with no
   onboarding row would otherwise be swept in on their next login.
5. Usable contact (`email_contacts` row upserted successfully).
6. No active **global** terminal suppression (`hard_bounce`,
   `complaint`, `invalid_address`, `admin_suppression`,
   `provider_rejection`) on the contact.
7. No existing `email_onboarding_state` row for the user (PK collision
   returns `already_enrolled`, second-layer idempotency).

The auth callback **also** skips the recovery flow (`?type=recovery`).

Failure is best-effort — the auth callback never blocks the redirect;
failures are logged as `[auth/callback] onboarding enrolment skipped:
<outcome>`. Possible outcomes include `feature_disabled`,
`cutoff_missing`, `cutoff_invalid`, `user_predates_cutoff`,
`email_unverified`, `no_email`, `globally_suppressed`,
`already_enrolled`, `contact_upsert_failed`, `insert_failed`.

**No migration-time backfill.** Existing users are not retroactively
enrolled.

## Safe rollout procedure

Vercel inlines server env vars at **build time + dyno start**. A
change to any of `EMAIL_ONBOARDING_ENABLED`, `ONBOARDING_ELIGIBLE_AFTER`
or the delay overrides only takes effect after a fresh deployment.

Recommended order:

1. Deploy with `EMAIL_ONBOARDING_ENABLED` unset (or `false`).
2. Set `ONBOARDING_ELIGIBLE_AFTER` on Vercel to the planned rollout
   moment as an ISO-8601 timestamp (UTC) — e.g. `2026-06-17T12:00:00Z`.
3. Redeploy so the new variable lands in the server bundle. The
   processor + enrolment helper still no-op because the flag is off.
4. Set `EMAIL_ONBOARDING_ENABLED=true` on Vercel.
5. Redeploy a second time so the flag is honoured at runtime.

Alternative: both values can be set before a single deployment, **but
the cutoff must be the deployment timestamp or later** — otherwise an
existing user who logs in within the same window can be enrolled.

## Cancellation rules

The sequence stops when any of these is true:

| Trigger | Effect | `cancellation_reason` |
|---|---|---|
| All three emails sent successfully | `status='completed'` | (none) |
| User toggles "Getting started tips" off | `status='cancelled'` | `manual_opt_out` |
| `preference_disabled` from send service | `status='cancelled'` | `preference_disabled` |
| Terminal global suppression (hard_bounce / complaint / invalid_address / admin_suppression / provider_rejection) hits during a step | `status='cancelled'` | the suppression reason |
| Provider error after `MAX_RETRIES=5` | `status='cancelled'` | `retry_exhausted` |
| Provider error before max | `retry_count++` + due-at pushed back with exponential backoff | (none, status remains `active`) |
| Account deleted | row cascades via `auth.users` ON DELETE CASCADE | (irrelevant) |

The sequence does **not** cancel solely because the user becomes
highly active — Email 2 adapts via the activation branch instead.

## Template purpose

| Template key | Category | Tone |
|---|---|---|
| `onboarding_welcome` | `onboarding` | Welcome + product tour + primary CTA "Explore your dashboard" + secondary "Find a card". No urgency. No paid-plan mention. No affiliate links. |
| `onboarding_activation` | `onboarding` | Branch-dependent activation prompt (see below). Aggregate counts only — never card names, prices or notes. |
| `onboarding_discovery` | `onboarding` | Feature roundup + roadmap link + reply-to invitation. Final email of the sequence. |

All three render through `src/emails/render.ts`, share `BaseLayout`,
and carry a plain-text fallback alongside the HTML.

## Activation branching

`src/lib/email/onboardingActivation.ts:pickActivationBranch` reads
three aggregate counts (`watchlist`, `portfolio_items` via
`portfolios`, `card_show_stars`) and returns:

| Branch | Condition | Email 2 message |
|---|---|---|
| `A` | no portfolio AND no watchlist | "Start with one card" — primary CTA to /browse. |
| `B` | watchlist > 0 AND portfolio == 0 | "You have a watchlist — add the ones you own." — primary CTA to /dashboard/portfolio. |
| `C` | portfolio > 0 AND watchlist == 0 | "Add the cards you are eyeing." — primary CTA to /dashboard/watchlist. |
| `D` | both > 0 | "You are set up — try the deeper tools." — primary CTA to /ai-assistant. |

Privacy: aggregate counts only. No card names, prices, holding values,
purchase notes or grading detail are read or rendered.

## Preference behaviour

- Setting: **Getting started tips** in `/dashboard/settings`.
- Default when no consent row exists: render as ON (the enrolment
  helper auto-grants the consent at signup; users who land in
  settings before the welcome email arrives see the same effective
  state).
- Toggling **off** writes a revoke row to `email_consents`
  (`category='onboarding'`, `source='settings_toggle'`) AND flips
  `email_onboarding_state.status` to `cancelled` with
  `cancellation_reason='manual_opt_out'` — but **only** when the
  current status is `pending|active|paused`. A `completed` sequence
  is left alone.
- Toggling **back on** writes a grant row. It does **not** restart a
  `completed` sequence — re-enrolment is an operator-only action.
- The route backing the toggle is `POST /api/onboarding/preference`,
  which requires the user's own Supabase bearer token. Writes always
  go through the service-role client.

## Idempotency

- `email_onboarding_state` PK on `user_id` makes enrolment idempotent.
- The processor's send call carries a deterministic key:
  - `onboarding:<user_id>:welcome`
  - `onboarding:<user_id>:activation`
  - `onboarding:<user_id>:discovery`
- The `email_delivery_log.idempotency_key UNIQUE` constraint collapses
  two concurrent processors into a single Resend send.
- A `duplicate` outcome from the send service is treated as `sent` —
  the step is marked done.

## Atomic claim (Block 3B correction)

The processor never relies on a JS `select → update` pattern alone.
Each row carries three claim columns:

```
processing_step       TEXT  CHECK ∈ (welcome | activation | discovery | NULL)
processing_token      UUID
processing_started_at TIMESTAMPTZ
```

Implementation in `src/lib/email/onboarding.ts:tryClaim`:

1. **Fresh-claim UPDATE** sets `(step, token, NOW())` on the row, but
   only when `status='active'` AND `processing_token IS NULL`. Postgres
   row-level locks serialise concurrent processors; only one returns a
   row from `RETURNING`.
2. If step 1 returns nothing, **stale-recovery UPDATE** uses the same
   pattern but matches rows where
   `processing_started_at < NOW() - ONBOARDING_CLAIM_STALE_SECONDS`
   (default 300s). A crashed worker's row is taken over by a later
   processor after the timeout.

Every outcome — sent, duplicate, suppressed, cancelled, retried,
paused, render-failure — explicitly clears the claim (`processing_*
= NULL`). The sent / retried / completed UPDATEs fold the claim clear
into the same patch (one write per row); cancel / pause helpers
follow with a dedicated `clearClaim(userId)` call.

The deterministic `onboarding:<uid>:<step>` send-service idempotency
key is the **second** safety layer. Even if a worker crashes after a
successful Resend send but before the claim clear, the next run hits
the email_delivery_log UNIQUE constraint and the send service returns
`duplicate`, which is treated as `sent` and advances the step.

`ONBOARDING_CLAIM_STALE_SECONDS` defaults to 300 (5 minutes). Lower
risks a slow but live processor losing its claim; higher delays
crash recovery.

## Processor protection

- Route: `POST /api/internal/process-onboarding-emails`.
- Auth: `Authorization: Bearer ${ONBOARDING_CRON_SECRET}`. Length-aware
  constant-time comparison. Missing or wrong secret → 401.
- Feature flag: when `EMAIL_ONBOARDING_ENABLED !== 'true'` the route
  returns `{ processed: 0, disabled: true }` without doing any work.
- Batch limit: caller-supplied `limit` clamped to 25.
- Response schema:
  ```ts
  { processed, sent, skipped, retried, cancelled, failed, disabled }
  ```
  No email addresses, no user IDs.

## Scheduling (Block 3D)

### Vercel Cron

The repository ships a single Vercel Cron entry in `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/internal/process-onboarding-emails", "schedule": "*/10 * * * *" }
  ]
}
```

- Vercel invokes the path via **HTTP GET**. The route accepts both
  GET (cron) and POST (operator) and dispatches to the same internal
  `runProcessor()` function.
- The schedule is interpreted in **UTC**. PokePrices delays are
  measured in minutes / hours / days so a 10-minute cadence is fine
  regardless of local time.
- **Plan limitations:** on Vercel Hobby the cron runs are limited
  (current quota: ~2/day, daily-only) — production scheduling at
  10-minute cadence requires the Pro plan.
- **Timing precision:** Vercel guarantees "approximately on schedule"
  delivery. Drift up to ~60 seconds is normal; this is well inside
  the onboarding step delays.
- Vercel may **deliver a cron invocation more than once** and may
  **overlap concurrent invocations**. The processor stays safe under
  both — see "Concurrency safety" below.

### Authentication: `CRON_SECRET`

Vercel automatically attaches the project's `CRON_SECRET` as
`Authorization: Bearer <CRON_SECRET>` on every cron invocation. The
route accepts:

1. **`CRON_SECRET`** — authoritative (Block 3D).
2. **`ONBOARDING_CRON_SECRET`** — accepted for one release as a
   migration fallback (Block 3B). Remove after a successful cron
   invocation has been observed in `email_onboarding_runs`.

Both secrets are compared in constant time. The route never logs or
echoes either value. Manual POST callers use the same header shape
with whichever secret is in play.

Fail-closed behaviour:

- **Both missing** → 503 `unauthorised`. Operators see the misconfig
  immediately in `vercel logs`.
- **Wrong secret / missing header** → 401 `unauthorised`. Vercel Cron
  treats 401 as a transient failure and retries on the next schedule.

### Manual admin run

`POST /api/admin/run-onboarding-processor` runs the same internal
function with `source: 'manual'`. Protected by `requireAdmin`
(Block 1A); admins do not need `CRON_SECRET` in the browser. Mounted
in `/admin/content-studio` under the **Onboarding automation status**
panel via the "Run now" button.

The hard batch cap inside `runProcessor` is the safety net — admins
cannot amplify a misconfiguration from the browser.

### Run log: `email_onboarding_runs`

Every invocation of the processor — cron, manual, or disabled — writes
one row to `email_onboarding_runs`. Status is one of:

| Status | Meaning |
|---|---|
| `running` | Row was inserted; batch in flight. Transitional only. |
| `success` | Batch completed; `failed_count = 0` AND `retried_count = 0`. |
| `partial` | Batch completed; `failed_count > 0` OR `retried_count > 0`. |
| `failed`  | The processor (or its wrapper) threw before producing a summary. |
| `disabled`| Feature flag off; no DB claims, no sends. |

Each row carries the counts (processed / sent / skipped / retried /
cancelled / failed), `duration_ms`, optional `error_code`, and the
`source` (`cron` or `manual`). No PII. Service-role only.

### Status snapshot: `/api/admin/onboarding-status`

Admin-only GET that returns:

- `enabled` — current feature flag state.
- `lastRun` — most recent run (any status), startedAt + status + source + durationMs.
- `lastSuccessfulRun` — most recent `success` run.
- `lastSummary` — counts from the most recent run.
- `state.active / dueNow / paused / cancelled / completed / staleClaims`.

Surfaced by the Content Studio status panel in cards. The same data
is the basis of the operator monitoring thresholds below.

### Monitoring thresholds (operator-defined alerts — not auto-wired)

| Trigger | Action |
|---|---|
| No `success` run for 30+ minutes while `enabled = true` | Treat as outage. Check Vercel function logs + `email_onboarding_runs.status='failed'`. |
| Any row with `status = 'failed'` | Inspect `error_code`. Likely a Resend, Supabase or env-var issue. |
| Sudden `retried_count` spike | Resend is degraded or `Resend.emails.send` is throwing. Pause the cron if needed. |
| `cancelled_count` spike | Suppression flood — check `email_webhook_events`. |
| Complaint or hard-bounce spike in `email_webhook_events` | Treat as standard Block 3A complaint runbook. |

No paid monitoring provider is added — operators read Vercel function
logs + this table directly.

### Concurrency safety (Block 3B atomic claim, restated)

- The processor's atomic per-row claim (`processing_step`,
  `processing_token`, `processing_started_at` on
  `email_onboarding_state`) means **overlapping cron invocations
  cannot double-send a step** — only one processor wins the
  per-row UPDATE.
- The deterministic send key `onboarding:<uid>:<step>` is the second
  safety layer at `email_delivery_log.idempotency_key UNIQUE`. Even
  if a worker crashed after Resend sent but before clearing the
  claim, the next run's send returns `duplicate` and the step is
  marked sent without a second Resend call.
- **Duplicate cron delivery** is therefore safe. The second delivery
  finds the row already sent and writes a `success` (or `partial`)
  run row with zero `sent_count`.

### Secret migration procedure

1. Generate a fresh `CRON_SECRET` of ≥ 32 random characters. Do NOT
   reuse the test value used during Block 3B manual testing.
2. Add it to Vercel **Production** environment.
3. Deploy this code (`Block 3D`). Both `CRON_SECRET` and
   `ONBOARDING_CRON_SECRET` are now accepted.
4. Wait for one cron firing — confirm `email_onboarding_runs` shows
   a new `cron`-source row with `status = 'success'` (or `disabled`
   if the feature flag is still off).
5. Remove `ONBOARDING_CRON_SECRET` from Vercel Production.
6. Redeploy. The route now accepts only `CRON_SECRET`.

If the second deployment fails for any reason, restore
`ONBOARDING_CRON_SECRET` and redeploy — the compatibility window in
this release means the cron stays operational.

### Disabling procedure

- Soft pause: set `EMAIL_ONBOARDING_ENABLED` to empty (or `false`) on
  Vercel and redeploy. Cron continues to fire; every invocation
  writes a `disabled` run row and returns `{ disabled: true }`. No
  DB claims, no sends.
- Hard stop: remove the `crons` entry from `vercel.json` and
  redeploy. Vercel stops invoking the cron entirely.

## Recommended scheduler

**Recommended for PokePrices today: Vercel Cron (now wired in `vercel.json`).**

| Option | Why |
|---|---|
| **Vercel Cron** (recommended) | Already in the same deployment, secret available via env, no extra infra. |
| Supabase pg_cron | Possible but adds a network hop back to the Next.js route and complicates secret rotation. |
| External cron-job.org / EasyCron | Works; loses observability inside Vercel. |

Suggested cadence: **every 10 minutes** during the rollout, **every
15 minutes** at steady state. Step delays are measured in minutes /
hours / days so anything sub-hourly is fine.

To activate (operator action only — not done in this block):

1. Add to `vercel.json`:
   ```json
   {
     "crons": [
       { "path": "/api/internal/process-onboarding-emails", "schedule": "*/10 * * * *" }
     ]
   }
   ```
   Vercel Cron sends a POST. The route validates the bearer secret.
2. Set `ONBOARDING_CRON_SECRET` on Vercel.
3. Configure the Vercel Cron Authorization header (Vercel Cron sends
   a `vercel-cron` UA; you can pair it with a header secret via the
   Vercel UI).
4. Redeploy.

**Monitoring**: tail the `[onboarding:batch]` JSON log line. A run
with `sent + retried + cancelled === 0` while `processed > 0` is a
bug. A run with `failed > 0` warrants an admin look at the
`email_delivery_log`.

**Failure alerting**: deferred to operator preference; recommend
forwarding Vercel function logs into the existing operator dashboard.

**Expected batch size**: with default delays + a steady signup rate
of N/day, the welcome step contributes ≈ N rows per day spread across
24 hours; activation contributes N rows two days later; discovery
seven days later. Steady-state batch size at /10-min cadence is
small (typically < 5).

## Admin previews / testing

- `GET /api/admin/email-preview?template=onboarding_welcome` →
  HTML preview. Add `&branch=A|B|C|D` for `onboarding_activation`.
- `POST /api/admin/email-send-test` body
  `{ "template": "onboarding_welcome", "branch": "A" }` → sends to
  `EMAIL_TEST_RECIPIENT` (locked). Subject prefixed `[TEST] `.
- Admin sends **never** advance `email_onboarding_state`. They flow
  through `sendEmail()` with `adminBypass` — preference + non-terminal
  suppressions are bypassed, but terminal suppressions still block
  (Block 3A correction pass).

## Analytics

The events are **typed** in `src/lib/analytics.ts` so future client
dispatches stay shape-safe, but very few of them are actually fired to
GA4 today. Operational visibility is intentionally biased toward
server logs + the delivery log.

| Event | Where it fires today | Form |
|---|---|---|
| `onboarding_enrolled` | server only, enrolment helper | `console.info('[onboarding:event] onboarding_enrolled', …)` operational log. No GA4 client call exists. |
| `onboarding_email_sent` | server only, processor | `console.info('[onboarding:event] onboarding_email_attempt', …)` per send attempt. No GA4 client call exists. |
| `onboarding_email_skipped` | typed but not dispatched today | reserved for a future client surface. |
| `onboarding_completed` | server only, processor | `console.info('[onboarding:event] onboarding_completed', …)`. No GA4 client call exists. |
| `onboarding_cancelled` | **client + server** | Settings toggle fires `trackEvent('onboarding_cancelled', { reason: 'manual_opt_out', source_component: 'settings_toggle' })` on opt-out, reaching GA4. Processor + helper also emit a server log. |

Server-side `[onboarding:event]` lines are operational diagnostics —
they appear in Vercel function logs, not in GA4. Do not conflate the
two.

GA4 forbidden-key filtering still applies to the client call: `email`,
`user_id`, `token`, `password`, etc. are dropped before reaching
gtag. Allowed parameter names for `onboarding_cancelled`: `reason`,
`source_component`.

**No server-side GA4 Measurement Protocol is added in this block.**
If we ever need server-side GA4 events, that gets a dedicated block.

**No custom click redirects** are added in this block either. Resend's
`email.clicked` provider event remains visible operationally via
`email_webhook_events` but is not reconciled into product analytics.

## Rollout plan

1. **Operator readiness**
   - Apply `migrations/2026-06-16-email-onboarding-state.sql` manually.
   - Confirm Block 3A infrastructure healthy (delivery log moves
     from `sent` to `delivered` for recent admin tests).
2. **Single disposable account**
   - Sign up `EMAIL_TEST_RECIPIENT` as a real user (verifying email).
   - Set `EMAIL_ONBOARDING_ENABLED=true` on a **Preview** Vercel
     deployment first. Tighten delays to ~30 seconds via the env
     overrides for the duration of the test.
   - Manually call the processor route once; confirm welcome arrives.
   - Reset delays; let activation + discovery fire on their normal
     schedule (or shortened).
3. **Tiny controlled cohort** (≤ 10 new signups)
   - Enable on **production** for 24-48 hours with normal delays.
   - Watch `email_delivery_log.status` flow + complaint webhook.
4. **All new verified users**
   - Leave `EMAIL_ONBOARDING_ENABLED=true` on production.

## How to test with a single disposable account

1. Set on Vercel Preview:
   ```
   EMAIL_ONBOARDING_ENABLED=true
   ONBOARDING_CRON_SECRET=<temp>
   ONBOARDING_WELCOME_DELAY_MS=30000
   ONBOARDING_ACTIVATION_DELAY_MS=60000
   ONBOARDING_DISCOVERY_DELAY_MS=120000
   EMAIL_TEST_RECIPIENT=<your inbox>
   EMAIL_ALLOW_PREVIEW_SEND=false   # keep Preview locked
   ```
2. Redeploy Preview.
3. Sign up + verify the email on the Preview URL.
4. Hit:
   ```
   POST https://<preview-url>/api/internal/process-onboarding-emails
   Authorization: Bearer <temp>
   ```
5. Read `email_onboarding_state` row + `email_delivery_log` rows in
   the Supabase dashboard. Confirm three sends and `status='completed'`.

## How to stop the sequence globally

Set `EMAIL_ONBOARDING_ENABLED=false` (or unset) on production. The
processor returns `disabled: true` and no new sends happen. Existing
enrolled users stay in their current state; if you re-enable later,
due rows resume from where they left off.

For a hard global stop (rare):

```sql
UPDATE public.email_onboarding_state
SET status = 'cancelled',
    cancelled_at = NOW(),
    cancellation_reason = 'global_disable'
WHERE status IN ('pending', 'active', 'paused');
```

## Relationship to paid tiers and weekly reports

- This block is **not** marketing. The `onboarding` category is
  separately suppressible from `marketing_newsletter`.
- No paid-plan pitch language in any of the three templates. If paid
  plans ship later, a new dedicated category (e.g. `paid_plan_offer`)
  should be created — do NOT widen `onboarding` to carry promo
  content.
- Weekly reports (`weekly_report` category, Block 1B today) are
  unrelated. Onboarding emails will never replace or trigger the
  weekly report flow.

## Environment variables (quick reference)

Vercel server env changes only take effect after a fresh deployment.
Setting these in the Vercel dashboard without redeploying does NOT
flip the live behaviour.

| Name | Purpose |
|---|---|
| `EMAIL_ONBOARDING_ENABLED` | Master feature flag. Must be `"true"` to enable. |
| `ONBOARDING_ELIGIBLE_AFTER` | **Required for enrolment.** ISO-8601 timestamp; only users created at or after this moment are eligible. Missing or invalid fails closed (no enrolment). |
| `ONBOARDING_CRON_SECRET` | Bearer secret for the internal processor route. |
| `ONBOARDING_CLAIM_STALE_SECONDS` | Seconds before an in-flight claim can be stolen by a later processor. Default 300. |
| `ONBOARDING_WELCOME_DELAY_MS` | Optional override of the 10-minute welcome delay. |
| `ONBOARDING_ACTIVATION_DELAY_MS` | Optional override of the 2-day activation delay. |
| `ONBOARDING_DISCOVERY_DELAY_MS` | Optional override of the 7-day discovery delay. |

## Rollback

1. Set `EMAIL_ONBOARDING_ENABLED=false`. New enrolments stop; processor
   becomes a no-op.
2. Optional: cancel in-flight rows with the SQL above.
3. Revert the application code via `git revert`.
4. The migration is additive — leave the table in place, or drop:
   ```sql
   DROP TABLE IF EXISTS public.email_onboarding_state;
   ```
