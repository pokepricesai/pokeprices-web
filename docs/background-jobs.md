# Background jobs

Inventory of every background process the codebase relies on, captured
2026-06-15. Where the scheduler / owner cannot be confirmed from the
repository, the entry is flagged. **Human confirmation required** means
the operator must verify who pulls the trigger before this entry can
be relied upon.

## smart-endpoint  (AI assistant)

| Field | Value |
|---|---|
| Source | `supabase/functions/smart-endpoint/index.ts` (canonical, tracked in Block 1C) |
| Trigger | HTTP POST from `/ai-assistant` and inline chat surfaces |
| Required secret | `SUPABASE_SERVICE_ROLE_KEY`, `CLAUDE_API_KEY` |
| Expected frequency | Per user message, anonymous-allowed |
| Idempotency | Each call is independent; chat history is client-only |
| Retry | 3 attempts with 1s/2s backoff on Claude API errors |
| Current scheduler | n/a (request-driven) |
| Notes | The legacy untracked copy at the repo root (`pokeprices-chat-edge-function.ts`) is no longer authoritative. It is intentionally left untracked through this correction pass and should be removed only after the tracked source under `supabase/functions/smart-endpoint/index.ts` has been successfully deployed (`supabase functions deploy smart-endpoint`) and smoke-tested against production. Until that point, treat the root file as legacy reference only — do not edit it. |

## content-studio-generate

| Field | Value |
|---|---|
| Source | `supabase/functions/content-studio-generate/index.ts` |
| Trigger | HTTP POST from `/admin/content-studio` "Generate" button |
| Required secret | `SUPABASE_SERVICE_ROLE_KEY`, `CLAUDE_API_KEY`, `OPENAI_API_KEY` (optional, only for `ai_image`), `GOOGLE_VISION_API_KEY` (optional, only for some templates) |
| Expected frequency | Manual; bursty around content-batch days |
| Idempotency | None — every call inserts a fresh `social_content_posts` row |
| Retry | None (client surfaces the error) |
| Current scheduler | Manual click in the admin UI |
| Notes | Follow-up: add an idempotency key to deduplicate accidental double-clicks. |

## evaluate-alerts

| Field | Value |
|---|---|
| Source | `supabase/functions/evaluate-alerts/index.ts` |
| Trigger | HTTP POST; bearer authenticated by `Authorization: Bearer <SERVICE_ROLE_KEY or ALERTS_TRIGGER_SECRET>` |
| Required secret | `SUPABASE_SERVICE_ROLE_KEY`, `ALERTS_TRIGGER_SECRET` (optional alternate path) |
| Expected frequency | Once per nightly price refresh |
| Idempotency | Per-alert: skips alerts whose `triggered_at` is already set |
| Retry | None inside the function; caller is expected to retry on 5xx |
| Current scheduler | **Human confirmation required.** The audit observed that this is called from the sister `pokeprices` Python scraper repo after its nightly run, but the scheduler definition is not in this repository. |

## enqueue-weekly-digest

| Field | Value |
|---|---|
| Source | `supabase/functions/enqueue-weekly-digest/index.ts` |
| Trigger | HTTP POST; bearer authenticated by service-role key |
| Required secret | `SUPABASE_SERVICE_ROLE_KEY` |
| Expected frequency | Once per week |
| Idempotency | Reads `user_email_preferences.weekly_digest_enabled` + `last_digest_sent_at`; does not double-queue |
| Retry | None inside; caller retries on 5xx |
| Current scheduler | **Human confirmation required.** No scheduler definition exists in this repository. Likely an external cron service or GitHub Actions in the scraper repo. |

## send-pending-emails

| Field | Value |
|---|---|
| Source | `supabase/functions/send-pending-emails/index.ts` |
| Trigger | HTTP POST; bearer authenticated by service-role key |
| Required secret | `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` |
| Expected frequency | Every 5–15 minutes per the source comment |
| Idempotency | Per-row: `attempts < 5` guard prevents infinite retries; `sent_at IS NULL` filter prevents resends |
| Retry | Up to 5 attempts per email, no backoff or jitter |
| Current scheduler | **Human confirmation required.** No scheduler definition exists in this repository. |

## scan-card

| Field | Value |
|---|---|
| Source | `supabase/functions/scan-card/index.ts` |
| Trigger | HTTP POST from `/scan-test` and the dashboard scanner UI |
| Required secret | `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_VISION_API_KEY`, `CLAUDE_API_KEY` |
| Expected frequency | Per user scan |
| Idempotency | Logs every scan to `scan_logs`; quota of 100/month per user/device |
| Retry | None inside |
| Current scheduler | n/a (request-driven) |

## IndexNow submission

| Field | Value |
|---|---|
| Source | `scripts/submit-indexnow.js` (run via `npm run indexnow`) |
| Trigger | Manual `npm run indexnow` |
| Required secret | None visible; uses a static key at `public/<key>.txt` (already deployed) |
| Expected frequency | Ad-hoc after large content changes |
| Idempotency | Safe to re-run |
| Retry | n/a |
| Current scheduler | Manual |

## Open ownership questions

The migrations and edge function bodies are tracked in the repository,
but **none of the three cron-driven triggers** (`evaluate-alerts`,
`enqueue-weekly-digest`, `send-pending-emails`) has a schedule defined
here. They are presumed to run from one of:

- The sister `pokeprices` Python scraper repository's GitHub Actions
  workflows.
- A third-party cron service (cron-job.org, EasyCron, similar).
- Supabase's own scheduled functions, set up via the dashboard.

Before relying on any of them in a new feature, confirm:

1. Which trigger source actually runs them in production.
2. Whether the secret used by the trigger source is rotated alongside
   `SUPABASE_SERVICE_ROLE_KEY`.
3. Where the success / failure of each run is observable.

A follow-up to centralise scheduler definitions (Vercel Cron or a
single GitHub Actions workflow in this repo) is recommended but out of
Block 1C scope.
