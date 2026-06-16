# Email infrastructure (Block 3A)

Production foundation for transactional, service and marketing email.
**Block 3A ships the plumbing. It does NOT activate any new campaign
or scheduler.** The existing Block 1B alert / weekly digest path is
untouched.

## Architecture at a glance

```
                ┌─────────────────────────────────────────────────┐
  caller ─────► │ src/lib/email/send.ts        (idempotent)        │
                │   1. normalise + Preview safety                  │
                │   2. upsert contact      ─────►  email_contacts   │
                │   3. check preference   ─────►  email_consents    │
                │                                  user_email_…    │
                │   4. check suppression  ─────►  email_suppressions│
                │   5. reserve log row    ─────►  email_delivery_log│
                │   6. Resend API call    ─────►  central client    │
                │   7. record outcome      ─────►  email_delivery_log│
                └─────────────────────────────────────────────────┘
                                       ▲
                                       │
                                       │ provider events
                                       │
                ┌─────────────────────────────────────────────────┐
  Resend ─────► │ /api/webhooks/resend                            │
                │   verify signature (svix)                       │
                │   dedup on provider_event_id                    │
                │   store raw event   ─────► email_webhook_events │
                │   reconcile         ─────► email_delivery_log   │
                │   apply suppression ─────► email_suppressions   │
                └─────────────────────────────────────────────────┘
```

Other touch points (deliberately not touched in 3A):

- `supabase/functions/send-pending-emails` and `enqueue-weekly-digest`
  continue to run the existing alert + weekly-digest path against
  `pending_emails` and `user_email_preferences`. A future block ports
  them to the central send service.
- `src/app/api/unsubscribe` is unchanged. A future block adds
  per-category unsubscribe links via `email_consents`.

## Email categories (source of truth: `src/lib/email/categories.ts`)

| Key                    | Use                                                                 | Default opt-in for new contacts |
|------------------------|----------------------------------------------------------------------|----------------------------------|
| `transactional`        | Account-critical: password reset, sign-in link, security notice.     | Always opted in.                 |
| `service_product`      | Service notices: receipt for an action the user took.                | Opted in.                        |
| `watchlist_alert`      | Triggered alerts on the user's watchlist.                            | Bridge: `user_email_preferences.alert_emails_enabled` (Block 1B). |
| `weekly_report`        | Weekly digest of watchlist + alerts.                                 | Bridge: `user_email_preferences.weekly_digest_enabled` (Block 1B). |
| `card_show_reminder`   | Reminders for upcoming UK/US card shows the user opted in to.        | Opted **out** unless an explicit consent row exists. |
| `marketing_newsletter` | Marketing / newsletter / product launches.                           | Opted **out** unless an explicit consent row exists. |
| `onboarding`           | Onboarding sequence for new accounts.                                | Opted **out** unless an explicit consent row exists. |

## Source-of-truth tables (after Block 3A)

| Concern                 | Authoritative table                                   |
|-------------------------|--------------------------------------------------------|
| Canonical contact       | `email_contacts` (email-keyed, `user_id` optional)    |
| Existing user toggles   | `user_email_preferences` (Block 1B) — bridged for watchlist_alert + weekly_report |
| New category prefs      | `email_consents` (append-only)                        |
| Suppression             | `email_suppressions`                                  |
| Send attempts           | `email_delivery_log`                                  |
| Provider events         | `email_webhook_events`                                |
| Live alert/digest queue | `pending_emails` (Block 1B) — unchanged in this block |

## Suppression precedence (single source of truth)

Suppression reasons are categorised as **terminal** or **non-terminal**.
The runtime rule lives in `src/lib/email/suppressions.ts:suppressionBlocks`.

### Terminal reasons (block EVERY category, including `transactional`)

- `hard_bounce`
- `complaint`
- `invalid_address`
- `admin_suppression`
- `provider_rejection` (only ever written when the failure is classified as a permanent recipient rejection — see below)

These five reasons are listed in `TERMINAL_SUPPRESSION_REASONS` and
they resist `adminBypass`. Even the admin/test routes cannot send to a
contact carrying one of them. This is deliberate: the operator must
notice when the locked test recipient is in a terminal state.

### Non-terminal reasons

- `manual_unsubscribe` — when applied **globally** blocks
  `marketing_newsletter` only. Per-category rows block only their
  declared category. Transactional / service email still reaches the
  recipient.
- `soft_bounce_threshold` — blocks every non-transactional category.

### Webhook → suppression mapping

| Event                    | Classification                                                | Suppression effect                          |
|--------------------------|---------------------------------------------------------------|---------------------------------------------|
| `email.bounced`          | `classifyBounce(data.bounce.type, data.bounce.subType)`       |                                             |
|   `→ hard`               |                                                               | Global `hard_bounce` suppression.           |
|   `→ soft`               |                                                               | No suppression. Status only.                |
|   `→ unknown`            |                                                               | No suppression (fail-safe).                 |
| `email.complained`       | always treated as permanent                                   | Global `complaint` suppression.             |
| `email.failed`           | `classifyFailedReason(data.failed.reason)`                    | Always updates the delivery log status.     |
|   `→ permanent_recipient`|                                                               | Global `provider_rejection` suppression.    |
|   `→ temporary`          | (timeout, quota, throttle, deferred, TLS, 4xx, etc.)          | No suppression.                             |
|   `→ unknown`            |                                                               | No suppression (fail-safe).                 |
| `email.delivery_delayed` |                                                               | No suppression. Status only.                |
| `email.sent` / `delivered` |                                                             | No suppression. Status updates only.        |
| `email.opened` / `clicked` |                                                             | Stored only when enabled; no policy.        |

### Exact payload fields used for classification

- **Bounce**: `data.bounce.type` (literal "Hard", "Permanent", "Soft",
  "Transient", "DnsFailure", "ContentRejected", …) and
  `data.bounce.subType` (e.g. "NoEmail", "MailboxDoesNotExist",
  "General", "RecipientReject"). Matched case-insensitively against
  documented regexes in `src/lib/email/providerEvents.ts`.
- **Failed**: `data.failed.reason` (human-readable string). Matched
  against permanent-recipient indicators (mailbox does not exist,
  recipient rejected, no such user, SMTP 5.1.x / 5.0.x codes,
  permanent, account disabled) and temporary indicators (timeout,
  quota, rate limit, throttle, deferred, TLS, connection, domain,
  configuration, service, capacity, 4xx codes).

Unknown classifications never suppress — temporary blips, configuration
hiccups and Resend vocabulary changes do not cost the contact their
deliverability.

### Notes

- Auth emails sent through **Supabase Auth SMTP** do not flow through
  the central send service and are NOT affected by these suppressions.
  They are governed by the Supabase Auth dashboard.
- The `provider_rejection` reason is reserved for permanent recipient
  rejections only. The runtime never writes it for transient failures.

## Resend webhook setup (operator action)

1. In the Resend dashboard go to **Webhooks → Add endpoint**.
2. URL: `https://www.pokeprices.io/api/webhooks/resend`.
3. Subscribe to: `email.sent`, `email.delivered`, `email.delivery_delayed`,
   `email.bounced`, `email.complained`, `email.failed`. `email.opened`
   and `email.clicked` are optional.
4. Copy the **Signing secret** and paste it into Vercel as
   `RESEND_WEBHOOK_SECRET` (server-only).
5. Trigger a "Send test" from the dashboard and verify a row appears
   in `email_webhook_events`.

## Required environment variables

| Name                       | Scope        | Required?      | Purpose                                              |
|----------------------------|--------------|----------------|------------------------------------------------------|
| `RESEND_API_KEY`           | server-only  | yes for sends  | Central Resend client.                               |
| `RESEND_WEBHOOK_SECRET`    | server-only  | yes for webhook| Svix signing secret. Missing → webhook returns 503. |
| `EMAIL_TEST_RECIPIENT`     | server-only  | optional       | Locked recipient for admin smoke tests AND for Preview/dev. |
| `EMAIL_ALLOW_PREVIEW_SEND` | server-only  | optional       | When `"true"`, the central service is allowed to send to non-locked recipients on Preview/dev. |
| `EMAIL_FROM_ADDRESS`       | server-only  | optional       | Default `PokePrices <hello@pokeprices.io>`.          |
| `EMAIL_REPLY_TO`           | server-only  | optional       | Default `hello@pokeprices.io`.                       |
| `VERCEL_ENV`               | server-only  | auto           | Provided by Vercel. Drives Preview safety.           |

## Sender identity

`hello@pokeprices.io` is the verified Resend sender today. The legacy
edge-function helper `supabase/functions/_shared/email.ts` still
falls back to `noreply@pokeprices.io`; this is **flagged for follow-up**
— do not switch it without coordinating a DNS verification.

## Preview / non-production safeguards

| Environment   | Behaviour                                                                  |
|---------------|-----------------------------------------------------------------------------|
| `production`  | Normal sending, preferences + suppression enforced.                         |
| `preview`     | Only `EMAIL_TEST_RECIPIENT` may receive mail, unless `EMAIL_ALLOW_PREVIEW_SEND=true`. |
| `development` | Same as preview.                                                            |
| `unknown`     | Same as preview (fail-safe default).                                        |

A Preview deployment can **never** email production users with the
default configuration.

## Unsubscribe behaviour

- `/api/unsubscribe` accepts the existing 48-char-hex
  `user_email_preferences.unsubscribe_token` token via `?token=…`.
  Existing links already in inboxes continue to work — the URL shape
  is unchanged.
- On a token match the route:
  1. Updates `user_email_preferences.alert_emails_enabled = false` and
     `weekly_digest_enabled = false` (legacy backward compatibility).
  2. Upserts an `email_contacts` row for the user.
  3. Appends `revoked` consents in `email_consents` for
     `marketing_newsletter`, `weekly_report` and `watchlist_alert`.
  4. Applies a per-category `manual_unsubscribe` suppression on
     `marketing_newsletter`. **Not global** — the user opted out of
     marketing, not of transactional / service messages.
- The response page is the SAME for valid and invalid tokens. We do
  not reveal whether the token (or any address) matched.
- Repeated requests are idempotent — the unique index on
  `email_suppressions` makes the suppression INSERT a no-op the
  second time, and `email_consents` simply records a second revoke
  event that operators can read as confirmation of the click.
- Marketing sends from the central service add `List-Unsubscribe` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers per
  RFC 8058. The URL points at this route.
- Transactional / auth sends do **not** carry unsubscribe headers.
- Supabase Auth emails (password reset, sign-in, confirmation) are
  **outside** this route — they are sent by Supabase Auth SMTP and
  unsubscribed only by deleting the account.

## Queue processing (status)

- `pending_emails` continues to be drained by `send-pending-emails`
  (Deno edge function). The function is unchanged in this block.
- The central send service is the path forward for new email
  features. A compatibility adapter will migrate `pending_emails`
  rows into the central service in a future block. Until then:
  - existing alerts and weekly digests still flow through Block 1B,
  - new application emails (onboarding, marketing, card-show) must use
    `src/lib/email/send.ts`.

## adminBypass — exact boundaries

The `adminBypass` flag on `sendEmail()` is the only sanctioned
mechanism for the protected admin smoke tests to deliver mail. Its
boundaries are non-negotiable:

| Concern                                                | Bypassed by adminBypass? |
|--------------------------------------------------------|---------------------------|
| User category preference                               | **Yes**                  |
| `manual_unsubscribe` suppression (marketing-context)   | **Yes**                  |
| `soft_bounce_threshold` suppression                    | **Yes**                  |
| Preview/dev recipient lock — when send is to `EMAIL_TEST_RECIPIENT` | **Yes**       |
| Invalid recipient (un-parseable address)               | **No**                   |
| `hard_bounce`                                          | **No** — operator must see |
| `complaint`                                            | **No** — operator must see |
| `invalid_address`                                      | **No**                   |
| `admin_suppression`                                    | **No**                   |
| `provider_rejection`                                   | **No**                   |
| Preview/dev recipient lock — for any other address     | **No**                   |

The two routes that set `adminBypass`:
- `/api/admin/test-resend` (locks to `EMAIL_TEST_RECIPIENT`,
  `recipientLocked: true`)
- `/api/admin/email-send-test` (same lock, same flag)

No general application send may use `adminBypass`. The flag's name is
deliberately specific (`adminBypass`, `recipientLocked: true`) so a
future code review of `git grep adminBypass` lists every call site.

## Idempotency

- Every call to `sendEmail()` carries an `idempotency_key` (UNIQUE on
  `email_delivery_log.idempotency_key`).
- Two concurrent calls with the same key collapse into one delivery
  log row; the second returns `outcome: 'duplicate'` and never calls
  Resend.
- The admin test routes use a key shaped like
  `admin-test-resend:<iso>:<uuid>`; production code should use a
  stable key derived from the business context (e.g. `weekly:<user_id>:<week>`).

## Retry policy

- The central send service does NOT retry inside the call. Callers
  decide whether a `provider_error` outcome should be re-attempted.
- The legacy `send-pending-emails` queue retries up to 5 times via
  `pending_emails.attempts` (Block 1B). Retries pick up the SAME row
  and therefore deduplicate naturally against the existing queue.
- Future queue refactor will use exponential backoff with jitter,
  bounded attempts, and an explicit "permanent failure" terminal
  state.

## Scheduler status

External and unchanged. The repo does NOT define a Vercel Cron or
`pg_cron` job that calls any email function. Confirm cadence with the
operator before assuming the queue is being drained.

## DNS / SPF / DKIM / DMARC operator checklist

`pokeprices.io` is already verified in Resend. When operating:

- **SPF** — Resend's `_dmarc` and SPF records must remain valid. Use
  Resend's "verify domain" page after any DNS change.
- **DKIM** — two CNAME records under `resend._domainkey.pokeprices.io`.
  Verify both keys remain green.
- **DMARC** — a `_dmarc.pokeprices.io` policy at minimum `p=none` is
  recommended for monitoring. Promote to `p=quarantine` only after a
  week of clean reports.
- **MX** — incoming mail still routes to the operator's mailbox host
  (not Resend); make sure adding sender records does not displace MX.
- **`hello@pokeprices.io` mailbox** — Reply-To target. Keep it staffed
  if any send invites a reply.

## Incident response

| Signal                                                | First action                                                                                  |
|-------------------------------------------------------|------------------------------------------------------------------------------------------------|
| Sudden complaint spike                                | Pause whatever campaign just shipped. Lift no suppressions. Inspect `email_delivery_log` for the offending `template_key` + `campaign_key`. |
| Hard-bounce spike (≥ 5% of last 24h sends)            | Pause new sends. Confirm the list source. Check `email_webhook_events` for the bounce subtypes. Resend recipients are blocked automatically by global suppressions. |
| Mail not arriving at any recipient                    | 1. Confirm `RESEND_API_KEY` and webhook secret are present on Vercel. 2. POST `/api/admin/test-resend` from the admin UI. 3. Check Resend status page. |
| Webhook events missing                                | Inspect the Resend dashboard delivery log; check `RESEND_WEBHOOK_SECRET` matches; tail `email_webhook_events.signature_verified`. |
| One contact is suppressed and asks to be re-instated  | Verify legitimate request, then update `email_suppressions.lifted_at = NOW()` for the relevant rows. Optional: record `notes_internal`. |
| Auth email not arriving                               | Auth email still flows through Supabase Auth SMTP, not this service. Check the Supabase Auth dashboard logs first. |

## Data retention guidance

- `email_webhook_events.payload_normalized` — keep 90 days for
  reconciliation, then purge raw payloads. Status fields persist on
  `email_delivery_log`.
- `email_delivery_log` — retain 12 months for billing + dispute
  defence, then anonymise (drop `recipient_email_hash`, keep
  aggregates).
- `email_suppressions` — retain indefinitely while `lifted_at IS NULL`.
  Lifted rows can be purged after 12 months.
- `email_consents` — retain for the lifetime of the contact + 24
  months after account deletion (proves prior consent in disputes).
- No raw email body is stored anywhere by default. Never widen this.

## Future onboarding sequence dependency

A future onboarding sequence MUST:

1. Insert a `granted` row into `email_consents` with
   `category = 'onboarding'` when the user opts in (signup flow).
2. Use `sendEmail({ category: 'onboarding', templateKey: 'onboarding_…', idempotencyKey: … })`.
3. Carry the per-contact unsubscribe header.
4. Never call the Resend SDK directly.

If any of those four steps is skipped, the campaign will be globally
suppressed for hard-bounced contacts but will NOT respect category
preferences — the test suite will fail in CI.

## Rollback procedure

The migration is additive. To roll back Block 3A:

1. Disable any feature flag that routes new sends through the central
   service (none exist today — Block 3A does not enable any campaign).
2. Set `RESEND_WEBHOOK_SECRET=""` in Vercel — the webhook endpoint
   returns 503 and Resend will retry without polluting state.
3. Drop the new tables, in reverse FK order:
   ```sql
   DROP TABLE IF EXISTS public.email_webhook_events;
   DROP TABLE IF EXISTS public.email_delivery_log;
   DROP TABLE IF EXISTS public.email_suppressions;
   DROP TABLE IF EXISTS public.email_consents;
   DROP TABLE IF EXISTS public.email_contacts;
   ```
4. Revert the application code via `git revert`.

The existing Block 1B email flow is untouched and continues to operate.
