# IndexNow Implementation Trace — PokePrices

Date: 2026-09-28. All references are file:line.

## 1. Endpoint & key

- **Endpoint** (single, by design): `https://api.indexnow.org/indexnow`
  - `scripts/submit-indexnow.js:63`
  - Deliberately NOT dual-posting to `www.bing.com/indexnow` after the Aug 2026 amplification incident (`docs/background-jobs.md:83–96`).
- **Key**: `a8f92c1d7e4b49d2b7c5e913f4aa8179` (32 hex chars).
  - Env override: `INDEXNOW_KEY`. Hardcoded fallback in:
    - `scripts/submit-indexnow.js:61`
    - `src/lib/editorial/publishing/revalidate.ts:15`
  - Public key file: `public/a8f92c1d7e4b49d2b7c5e913f4aa8179.txt` — live probe returns **HTTP 200**, body `a8f92c1d7e4b49d2b7c5e913f4aa8179` (verified 2026-09-28 09:07).
  - `keyLocation` supplied in every payload: `https://www.pokeprices.io/{key}.txt` (`scripts/submit-indexnow.js:62`).

## 2. Pure logic module — `src/lib/indexnow/submitter.mjs`

Exports: `validateUrl`, `dedupe`, `collectValidUrls`, `batchUrls`, `diffSnapshots`, `composeSnapshotFromAccepted`, `classifyStatus`, `shouldRetry`, `safeLogBody`, `buildPayload`, plus constants (`CANONICAL_HOST`, `MAX_BATCH_SIZE=1000`, `MAX_ATTEMPTS=4`, `RETRY_DELAY_SCHEDULE_MS=[1000,4000,15000]`).

Rejection rules (`submitter.mjs:32-45, 65-101`):

- Wrong host, non-https, has query string, has fragment, not parsable
- Rejected path prefixes: `/admin`, `/intel`, `/api`, `/scan-test`, `/dashboard`, `/_next`
- Rejected path segments: `/login`, `/signup`, `/logout`

Snapshot semantics (`composeSnapshotFromAccepted`, `submitter.mjs:182-191`):
- URL unchanged since prior snapshot → keep prior hash
- URL changed AND submission returned 200/202 → record new hash
- URL changed but submission failed → **keep prior hash** so next run retries
- Brand-new URL, submission failed → **omit** so next run retries
- URL missing from current input → drop unless `--include-deletions`

Retry classification (`classifyStatus` + `shouldRetry`, lines 202-222):
- 200 → `ok`, 202 → `accepted` → success, no retry
- 400/403/422 → client error, **never retry**
- 429 → `rate-limited`, retry
- 5xx → `server-error`, retry
- 0 → `network-error`, retry
- Cap: 3 retries (`MAX_ATTEMPTS=4`)

Tests: `src/lib/indexnow/__tests__/submitter.test.ts` (64 tests) + `submitter-hygiene.test.ts` (26 regression tests locking the Aug-2026 fixes). CLI wrapper argument-parsing and disk I/O are not directly tested.

## 3. CLI wrapper — `scripts/submit-indexnow.js`

Modes:

- Default: submit URLs from CLI args and/or `--file <path>` (one URL per line, optional `\t<hash>` suffix).
- `--dry-run`: validate + dedupe + batch, print report, no network call.
- `--changed-only --snapshot <path>` (RECOMMENDED per `docs/background-jobs.md:83`): compare current URL+hash rows against snapshot; only submit changed/new; **write snapshot only after batch, containing only URLs that returned 200/202** (`scripts/submit-indexnow.js:284-303`).

Batching: `MAX_BATCH_SIZE = 1000`. Batches processed sequentially; failed batches recorded and cause `process.exit(1)` at end but do not halt subsequent batches.

Backoff: sleeps 1s, 4s, 15s between attempts inside a batch.

## 4. Automatic invocation surface

**No cron and no GitHub Action currently invokes bulk IndexNow submission.**

- `.github/workflows/` — directory does not exist.
- `vercel.json` crons (`vercel.json:3-28`):
  | Path | Schedule | Touches IndexNow? |
  |---|---|---|
  | `/api/internal/process-onboarding-emails` | */10 | no |
  | `/api/cron/weekly-digests` | 0 9 | no |
  | `/api/cron/instant-alerts` | 0 10 | no |
  | `/api/cron/publish-scheduled` | */10 | **yes (single URL per newly-published article)** |
  | `/api/cron/seo-daily` | 0 6 | no (Google GSC BQ ingest only) |
  | `/api/cron/seo-bing-daily` | 0 7 | no (Bing WMT BQ ingest only; currently failing) |

- The only automatic IndexNow trigger is:
  `runPublicationAction('publish')` → `runPostPublish({ slug, wasFirstPublish })` (`src/lib/editorial/publishing/actions.ts:225`, `src/lib/editorial/publishing/revalidate.ts:44-49`), fired when the scheduled publisher promotes an insight article. Only 12 insights exist in production; only the first publish triggers the submission; unpublish/update do not.

## 5. URL-list generation for bulk submissions

**Nothing in the repo generates the `urls-and-hashes.tsv` input file `--changed-only --file` expects.**

- No script emits per-URL content hashes from the sitemap or DB.
- The only .tsv artefacts found are historical experiment cohorts under `seo/experiments/` (`2026-07-22-w46c-cohort-*.tsv`, `2026-07-23-*`) — those are one-off dry-runs, not a routine.
- Their generators (`scripts/seo/build-w46c-cohort.mjs`, `scripts/seo/build-w46e-lite-fix1-indexnow.mjs`, `scripts/seo/build-card-shows-indexnow.mjs`) are documented as deprecated and require `--i-know-this-is-historical` to run (`docs/background-jobs.md:90`).

**Implication**: even a well-intentioned operator running `npm run indexnow:changed -- --file urls-and-hashes.tsv` would first need to hand-build the file for the ~64k live URLs.

## 6. Snapshot state

- `.indexnow-snapshot.json` (repo root) — tracked in git (`git log` shows single commit `f7770a7` on 2026-09-11).
- Current contents: **`{}`** (empty object; verified 2026-09-28).
- Historically: the file did not exist before 2026-09-11. Any submissions prior to that date left no dedup/idempotency record.
- Consequence: because the snapshot is empty, the next `npm run indexnow:changed` run would treat every input URL as new and submit all of them — the safety of the "changed-only" mode currently offers no historical dedupe protection.

## 7. Historical artefacts

- Root-level `bing-*.json` files (probe/run diagnostics from 2026-09-21) are **Bing Webmaster Tools API responses and BigQuery ingest logs, not IndexNow submission records**. See `FULL_AUDIT.md` §H.
- `bing-run1.json` / `bing-run2.json` show the Stage 5B Bing BigQuery ingest failing with `bigquery.datasets.create` permission denied — no Bing WMT metrics have flowed to the SEO warehouse since then.

## 8. Overall verdict on the pipeline

- URL validation ✅ correct.
- Dedup / batching ✅ correct.
- Retry classification ✅ correct (post-Aug-2026 fix).
- Key file publicly reachable ✅.
- **Trigger stage ❌**: no cron submits card / set / pokemon URLs; no generator produces the bulk input file; snapshot is empty. In practice IndexNow currently ships nothing except a handful of insight-publish notifications.
