# IndexNow — architecture and operations

Stage 6A (2026-09-28). Owner: Luke.

This doc describes the persistent DB-backed IndexNow subsystem introduced
after the 2026-09-28 audit. Every URL that gets submitted to Bing (and
every other participating engine that consumes `api.indexnow.org`) flows
through this pipeline. Nothing else does.

---

## Why we changed it

The previous implementation was:

- **Manual only.** `npm run indexnow:changed --file urls.tsv` had no
  scheduled trigger and no automatic input-file generator.
- **File-based state.** `.indexnow-snapshot.json` was tracked in git and
  had to be manually committed after every run. On a stateless serverless
  platform like Vercel this cannot survive between invocations, so in
  practice the file stayed empty (`{}`) forever.
- **Only one auto trigger** — the editorial-publish path fired a direct
  HTTP request per newly-published article (12 articles total).

Bing WMT ended up with sitemap discovery of ~64k URLs but only ~40k
indexed. IndexNow could have been shortcutting sitemap-discovery lag for
the ~65k catalogue since May 2026 but never was.

---

## Architecture

```
   Postgres AFTER trigger on daily_prices / cards / insights / …
                     │  (writes 1 row per source, entity, day)
                     ▼
              seo_change_events
                     │
                     │  every 5 min
                     ▼
     /api/cron/indexnow-harvest       ── joins to source table,
                     │                    computes content_hash,
                     │                    coalesces aggregate URLs
                     ▼
                enqueueUrl()  →  seo_indexnow_queue (pending)
                                       │
                                       │  every 15 min
                                       ▼
                     /api/cron/indexnow-worker
                                       │
                                       │ claimBatch → POST api.indexnow.org
                                       │
              ┌────────────────────────┼───────────────────────┐
              ▼                        ▼                       ▼
      200/202 (accepted)      429 / 5xx / netfail       400 / 403 / 422
      completeBatch           failBatch(retry)          failBatch(fail)
      hash-CAS + submitted    backoff schedule          status='failed'
                              re-eligible next tick     no more retries
```

### Database

Four tables, split across two migrations:

`migrations/2026-09-28-seo-indexnow-01-queue.sql`:

- **`seo_indexnow_queue`** — one row per URL awaiting or recently-submitted
  submission. UNIQUE on `url`; latest content_hash wins on re-queue.
  Status enum: `pending | processing | submitted | retry | failed | superseded`.
  Priority 0 (highest, e.g. new URL) … 2 (routine price change).
  `next_attempt_at` schedules the next retry.
- **`seo_indexnow_submissions`** — one row per IndexNow HTTP batch
  (success OR failure). `run_id` groups every batch a single worker
  invocation submitted. `sample_urls` stores up to 5 URLs from the batch
  for spot-checking without persisting the full 1000-URL payload.
- **`seo_indexnow_settings`** — key/value flags.

`migrations/2026-09-28-seo-indexnow-02-change-events.sql`:

- **`seo_change_events`** — producer stream. One row per (source, entity_key,
  UTC day), populated by `AFTER` triggers on daily_prices, cards, insights,
  set_metadata, pokemon_species, creators, vendors. `processed_at` marks
  rows the harvester has drained.

Settings (seeded by migration 02 — first-deploy safe):

  - `worker_enabled = false`  ← flip to true after post-deploy verification
  - `bulk_submission_enabled = false`
  - `daily_submission_cap = 15000`
  - `per_invocation_url_cap = 750`
  - `per_invocation_time_budget_ms = 55000`
  - `harvester_enabled = true`
  - `harvester_events_per_run = 2000`
  - `harvester_enqueue_aggregates = true`

### Code

- `src/lib/indexnow/hash.ts` — deterministic content hashing per family.
- `src/lib/indexnow/queue.ts` — `enqueueUrl`, `enqueueBatch`, `claimBatch`,
  `completeBatch` (hash-CAS), `failBatch` (hash-CAS), `recordSubmission`,
  `loadSettings`, `submittedInLast24h`.
- `src/lib/indexnow/harvester.ts` — reads `seo_change_events`, joins
  source rows, coalesces aggregate URLs, calls `enqueueUrl()`.
- `src/lib/indexnow/worker.ts` — pure worker loop. Callers pass an
  optional `fetchImpl` so tests can mock the network. Passes
  `(id, content_hash)` pairs to complete/fail so the CAS applies.
- `src/lib/indexnow/submitter.mjs` — unchanged pure-logic module (URL
  validation, batching, HTTP status classification, payload builder,
  key-redaction). Reused by the worker and the historical CLI.
- `src/app/api/cron/indexnow-harvest/route.ts` — 5-min producer cron.
- `src/app/api/cron/indexnow-worker/route.ts` — 15-min drain cron.
- `src/app/api/admin/seo/indexnow-health/route.ts` — observability.
- Migration 02 owns the `seo_change_events` table and 7 producer triggers.

---

## Triggers — how URLs get into the queue

### Automatic (production wiring)

- **Card price changes** — the `daily_prices` scraper writes ~60k rows/day.
  A Postgres `AFTER INSERT OR UPDATE OF` trigger dedupes those into one
  event per card per UTC day in `seo_change_events`. The 5-min harvester
  cron reads events, joins cards+latest daily_prices, computes a
  10¢-bucketed content hash and calls `enqueueUrl()`. Unchanged buckets
  are a queue no-op via `enqueueUrl`'s hash dedupe. Typical rate: median
  ~9,000 URLs/day, p95 ~9,200 URLs/day (see Volume analysis section).
- **Card metadata changes** — `cards` table trigger fires on `INSERT`,
  `DELETE`, or `UPDATE` of user-visible cols (`card_url_slug`,
  `card_name`, `set_name`, `card_number`, `card_number_display`,
  `set_printed_total`, `image_url`, `is_sealed`, `primary_pokemon_slug`,
  `language`). Created cards enqueue at priority 0; deletes at priority 0
  with `reason='deleted'`.
- **Aggregate pages** — every harvester batch collects the unique set
  names and Pokémon slugs touched by the card events and enqueues one
  URL per aggregate at priority 2. 500 cards in the same set → one
  `/set/{name}` enqueue, not 500.
- **Editorial publish** (`src/lib/editorial/publishing/revalidate.ts`)
  enqueues the article URL at priority 0 via the same `enqueueUrl()` call
  as everything else. Hash includes headline + intro + meta + body_json.
- **Sets, Pokémon species, creators, vendors** — each has its own
  `AFTER` trigger on the same producer table. Small volumes; each event
  is joined and enqueued individually with a family-specific hash.

### Manual

Any admin script or ad-hoc process can call:

```ts
import { enqueueUrl } from '@/lib/indexnow/queue'
await enqueueUrl({
  url:         'https://www.pokeprices.io/insights/whatever',
  contentHash: '…40-char sha1…',
  pageFamily:  'insight',
  entityId:    'whatever',
  priority:    0,
  reason:      'manual',
})
```

Non-canonical URLs (bare host, http://, query strings, `/admin/*`, etc.)
are rejected before the DB is touched.

---

## Priorities

| Priority | Meaning | Example reasons |
|---:|---|---|
| 0 | Urgent discovery event | `created`, `deleted`, `canonical_change` |
| 1 | Meaningful content change | `metadata_change`, significant `price_change` |
| 2 | Routine refresh | daily price bucket flip |

The worker claim always orders by `priority ASC`, then `next_attempt_at
ASC`, then `id ASC`. Priority-0 URLs cannot be starved by a large
priority-2 backlog.

---

## Cron

`vercel.json` schedules two IndexNow-related crons:

```json
{ "path": "/api/cron/indexnow-harvest", "schedule": "*/5 * * * *"  },
{ "path": "/api/cron/indexnow-worker",  "schedule": "*/15 * * * *" }
```

- The harvester ties change events into queue rows.
- The worker drains the queue and calls IndexNow.

Each invocation:

1. Loads `seo_indexnow_settings`. If `worker_enabled=false`, returns
   `skipped/worker_disabled` immediately.
2. Reads `submittedInLast24h()`. If ≥ `daily_submission_cap`, returns
   `skipped/daily_cap_reached`.
3. `claimBatch(min(per_invocation_url_cap, remaining_daily_cap))` — the
   claim query filters `status IN (pending, retry) AND next_attempt_at <=
   now()`, orders by (priority, next_attempt_at, id) and locks the
   selected rows via a status-gated UPDATE.
4. Batches the claimed rows into groups of `MAX_BATCH_SIZE=1000` and
   POSTs each batch to `https://api.indexnow.org/indexnow`.
5. Records one `seo_indexnow_submissions` row per batch, then
   `completeBatch` / `failBatch` for the corresponding queue rows.
6. Stops early when the per-invocation time budget (55 s by default) is
   within 500 ms of `maxDuration=60`. Rows that were claimed but not
   sent are returned to `retry` immediately.

### Volume analysis (Stage 6A · 2026-09-28)

Sampled from 14 days of production `daily_prices` rows + a 500-card
bucket-crossing comparison between two consecutive scrape days:

| Metric | Value |
|---|---:|
| daily_prices rows/day — median | 58,592 |
| daily_prices rows/day — p95    | 61,218 |
| daily_prices rows/day — max    | 62,231 |
| % of cards that cross a 10¢ bucket day-to-day | 15% |
| **Estimated material card enqueues/day — median** | **~8,800** |
| Estimated material card enqueues/day — p95 | ~9,200 |
| Aggregate set URLs/day | ≤ 288 (all sets) |
| Aggregate Pokémon URLs/day | ≤ 1,025 (all species) |
| Editorial + directory events/day | < 5 |
| **Total unique IndexNow-eligible URLs/day — p95** | **~10,300** |

Chosen capacity:

| Setting | Value | Rationale |
|---|---:|---|
| Worker cron cadence | 15 min | 96 invocations/day |
| Per-invocation URL cap | 750 | Worker sends up to 750 URLs per tick |
| **Raw drain rate** | **3,000 URLs / hour** | 750 × 4 ticks per hour |
| Daily safety cap | 15,000 | Slightly above measured p95 (10,300) |
| Batch size | 1,000 | IndexNow protocol limit |
| Time budget/invocation | 55 s | Under `maxDuration=60` |

**Backlog drain time** (before the daily cap is reached):
- 10,300-URL p95 spike arriving simultaneously → `10,300 / 3,000 ≈ 3.4 hours`.
- 5,000-URL spike → `5,000 / 3,000 ≈ 1.7 hours`.
- 15,000-URL spike (equal to cap) → cap prevents anything past 15k that day; the remaining ~2h of drain occurs the following day when the 24-hour window rolls.

Drain rate STILL exceeds p95 enqueue rate (~430/hr = 10,300/24) by ~7×, so
the queue converges under normal operation. The health endpoint's
`throughput.growth_warning` flag flips true if
`net_growth_per_hour > 0.5 AND pending > 4 × per_invocation_url_cap` sustained.

After 7 days of real telemetry we can reassess `daily_submission_cap` and
`per_invocation_url_cap` based on observed volume — both are live-tunable
via `UPDATE seo_indexnow_settings ...` with no code change or redeploy.

---

## Price-history hash policy

The card page renders both a **current-price panel** (server-rendered
into the HTML `<title>`, description, structured data, and above-the-fold
copy) and a **price-history chart** (client-rendered from a separate
fetch — the raw daily rows never appear in the crawled HTML).

The content hash (`src/lib/indexnow/hash.ts::hashCardSignature`) therefore:

- INCLUDES bucketed `headline`, `PSA10`, `PSA9`, `raw` prices — anything
  that ends up in the server-rendered title/description/H1.
- INCLUDES card metadata that Bing sees in HTML: name, set, number,
  card_number_display, image URL, slug.
- EXCLUDES the price-history array. Bing does not see it in the crawled
  HTML, so appending "yesterday's £5.02" data point to the chart when
  today's data point is £5.03 does not change what Bing would re-index.
- EXCLUDES internal timestamps (`updated_at`, `ingested_at`, `scraped_at`).

Consequence: a daily re-scrape that produces prices within the same 10¢
buckets — the common case for illiquid cards — is a queue no-op. Only
cards whose visible prices cross a bucket are notified. Sampled at 15 %
of scraped cards per day (Stage 6A audit); that is the ~9k/day baseline.

If we later add a server-rendered "N-day % change" or a materially
different price-history summary to the HTML, the hash surface should be
expanded to cover it. Until then, expanding the hash to include the raw
observation array would turn every 60k-row daily scrape into 60k IndexNow
submissions and burn Bing's crawl budget on identical content.

---

## Trigger cost

Every trigger is `AFTER INSERT OR UPDATE OF <specific cols>` — the write
is committed first and the trigger runs on the same connection. Each
trigger body performs exactly one `INSERT ... ON CONFLICT DO NOTHING`
into `seo_change_events`, which lands as an index seek against the
`(event_source, entity_key, event_kind, observed_day)` UNIQUE index. No
SELECTs inside the trigger body. No cross-table joins.

Expected cost per trigger fire: <1 ms. Expected trigger fires per day:
≤ 62,231 (one per `daily_prices` write on a peak scrape day). Total
daily overhead: <1 minute of DB CPU distributed across the scrape
window — a fraction of a percent of the DB's capacity. The scraper's
`INSERT` throughput is not measurably affected in tests against a
Supabase-equivalent Postgres 15 workload.

---

## Retry / failure classification

Delegated to `src/lib/indexnow/submitter.mjs::classifyStatus`:

| HTTP | classifyStatus | worker action |
|---|---|---|
| 200 | `ok` | `completeBatch` |
| 202 | `accepted` | `completeBatch` |
| 400 | `bad-request` | `failBatch(permanent=true)` → status `failed` |
| 403 | `forbidden` | `failBatch(permanent=true)` → status `failed` |
| 422 | `unprocessable` | `failBatch(permanent=true)` → status `failed` |
| 429 | `rate-limited` | `failBatch(permanent=false)` → status `retry`, exp. backoff |
| 5xx | `server-error` | `failBatch(permanent=false)` |
| net err | `network-error` | `failBatch(permanent=false)` |

Backoff schedule (`src/lib/indexnow/queue.ts::backoffFor`):

`1 min → 5 min → 15 min → 1 h → 3 h → 3 h`

After 6 failed attempts the row is moved to `failed` even for retryable
errors. Rows in `failed` state never retry automatically — they are
inspected in the admin health endpoint.

---

## First-run safety

Deploying migrations 01 + 02 into production does **not** enqueue any of
the existing ~65 000 URLs. That's intentional — the previous historical
~21 000 IndexNow blast (Aug 2026) was ineffective and cost us Bing
crawl-budget. The queue is empty on deploy.

Guardrails:

1. **`worker_enabled = false`** by default. The queue may build up from
   real change events, but nothing goes over the wire until an operator
   flips this flag manually via
   `UPDATE seo_indexnow_settings SET value='true'::jsonb WHERE key='worker_enabled';`.
2. `bulk_submission_enabled = false`. Any future historical-backfill
   script MUST check this flag and require an explicit override.
3. `daily_submission_cap = 15000` bounds a runaway enqueue.
4. `per_invocation_url_cap = 750` bounds a single tick.
5. Neither the harvester nor the worker scans the sitemap or
   `seo_pages`. Both only touch URLs already surfaced by a real change
   event.

The harvester CAN run with the worker disabled — that lets us verify
event capture + hash computation before submission goes live. The queue
grows harmlessly and drains as soon as `worker_enabled` flips.

A historical backfill script, if ever needed, should:

- accept a `--i-know-this-is-historical` flag,
- read `bulk_submission_enabled` — refuse to run if false,
- enqueue at priority 2 with `reason='backfill_historical'`,
- limit itself to the URLs Bing has told us it does NOT yet know about
  (via a WMT DNI export processed by `scripts/seo/analyse-bing-dni.mjs`).

Stage 6A does **not** ship such a script.

---

## Delete / redirect handling

If a URL disappears (page removed, canonical changed), enqueue it at
priority 0 with `reason='deleted'` or `reason='canonical_change'`. The
submitter validates that the URL is canonical; if the old URL was
already non-canonical (e.g. because we've since changed the slug), the
enqueue call is rejected — you'd instead enqueue the *new* canonical
URL. Bing treats a 404/410 discovered on re-crawl as removal.

---

## Observability

Admin endpoint `GET /api/admin/seo/indexnow-health` (Bearer-token auth
via `requireAdmin`) returns:

- Queue depth totals + by-status + by-family
- Oldest pending row (id, url, priority, age in hours)
- URLs submitted in the last 24 h
- Batch summary for the last 24 h and last 7 d
- Bing ingest last-run + is_stale/is_failing flags
- Google ingest last-run

Every submission — success OR failure — writes one
`seo_indexnow_submissions` row, so nothing is silently swallowed.

---

## Troubleshooting

- **No URLs submitted.** Check
  `SELECT * FROM seo_indexnow_settings WHERE key='worker_enabled'`.
  If `false`, an operator has kill-switched it.
- **Queue depth growing but nothing sent.** Look at
  `seo_indexnow_submissions` for the last 24 h. If empty, the cron
  probably isn't authenticating — check `CRON_SECRET` in Vercel env.
- **Rows stuck in `processing`.** A worker crashed mid-batch. In practice
  the next tick's claim ignores them (only `pending`/`retry` are
  eligible). If you want to force them back to `retry`, run:
  `UPDATE seo_indexnow_queue SET status='retry', next_attempt_at=NOW()
  WHERE status='processing' AND claimed_at < NOW() - INTERVAL '10 minutes';`
- **URL keeps failing 400.** Check `last_error` on the row. Most 400
  causes are non-canonical URLs slipping past the pre-flight — file a
  bug in the queue caller.
- **Bing ingest stale.** `is_stale=true` in the health endpoint means
  the last `seo-bing-daily` run was > 48 h ago. Usually caused by the
  BigQuery `pokeprices-seo` project IAM permission. See §"Bing BQ" in
  the audit report.

---

## Testing

Unit tests:

- `src/lib/indexnow/__tests__/hash.test.ts` — hash stability + bucket
  logic (14 tests).
- `src/lib/indexnow/__tests__/queue.test.ts` — enqueue/claim/complete/fail
  with in-memory fake Supabase + **5 race-condition tests** covering
  enqueue-during-processing, hash-CAS on completeBatch/failBatch, two
  workers claiming, and worker-timeout recovery (15 tests total).
- `src/lib/indexnow/__tests__/worker.test.ts` — full worker control-flow,
  fetch mocked, queue mocked (8 tests).
- `src/lib/indexnow/__tests__/harvester.test.ts` — **producer-path tests**:
  card price event → correct URL + hash + priority, aggregate dedupe for
  20 cards in same set, insight enqueue at priority 0, event
  processed_at marking, no-op empty stream (7 tests).
- `src/lib/indexnow/__tests__/submitter{,-hygiene}.test.ts` — the
  original 64+26 tests locking the pure-logic contract; still pass.
- `src/__tests__/middleware.test.ts` — bare→www 301 + /intel gate
  (7 tests).

Run with `npm run test:run` (or `npm run test` for watch mode).
