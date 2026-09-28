-- migrations/2026-09-28-seo-indexnow-01-queue.sql
-- ============================================================================
-- SEO / IndexNow · Stage 6A — persistent queue + submission audit + settings.
--
-- Replaces the fragile `.indexnow-snapshot.json` file-based dedupe with three
-- Postgres tables that let a Vercel cron drain change events reliably:
--
--   public.seo_indexnow_queue        — one row per URL awaiting submission
--   public.seo_indexnow_submissions  — one row per IndexNow HTTP batch
--   public.seo_indexnow_settings     — durable feature flags / kill switches
--
-- Design constraints
--   * DB is the only durable state (Vercel filesystem is read-only in prod).
--   * Same (url, content_hash) never enqueues twice while pending. Different
--     hash for the same URL replaces the pending row so we always submit the
--     latest content signature.
--   * Priority ordering (0 highest) so brand-new URLs cannot be starved by
--     routine price refreshes.
--   * Failed URLs get exponential-backoff via `next_attempt_at`; permanent
--     4xx failures move to `failed` and do not retry.
--   * First-run guard: `bulk_submission_enabled` in seo_indexnow_settings
--     starts FALSE. Historical backfill requires an explicit toggle so a
--     fresh deploy cannot accidentally re-run the Aug-2026 amplification.
--
-- Deployment
--   Luke runs this by hand in the Supabase SQL Editor (per repo convention);
--   plain `CREATE INDEX IF NOT EXISTS` — no CONCURRENTLY.
-- ============================================================================

BEGIN;

-- ── seo_indexnow_queue ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seo_indexnow_queue (
  id                  BIGSERIAL     PRIMARY KEY,
  url                 TEXT          NOT NULL,
  url_hash            TEXT          NOT NULL,
  content_hash        TEXT          NOT NULL,
  page_family         TEXT          NOT NULL,
  entity_id           TEXT,
  priority            SMALLINT      NOT NULL DEFAULT 2,
  reason              TEXT          NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'pending',
  first_queued_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_queued_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_submitted_at   TIMESTAMPTZ,
  claimed_at          TIMESTAMPTZ,
  claimed_by          TEXT,
  submission_attempts INTEGER       NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_http_status    INTEGER,
  last_error          TEXT,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT seo_indexnow_queue_status_chk
    CHECK (status IN ('pending', 'processing', 'submitted', 'retry', 'failed', 'superseded')),

  CONSTRAINT seo_indexnow_queue_priority_chk
    CHECK (priority >= 0 AND priority <= 9),

  CONSTRAINT seo_indexnow_queue_page_family_chk
    CHECK (page_family IN ('card','set','pokemon','insight','card_show','creator','vendor','static','other'))
);

-- At most one live row per URL. Once submitted/failed the row stays for audit
-- but a new change event will REPLACE it (see enqueue upsert semantics).
CREATE UNIQUE INDEX IF NOT EXISTS seo_indexnow_queue_url_uniq
  ON public.seo_indexnow_queue (url);

-- Worker claim scan — pick eligible rows ordered by priority then age.
CREATE INDEX IF NOT EXISTS seo_indexnow_queue_claim_idx
  ON public.seo_indexnow_queue (status, priority, next_attempt_at)
  WHERE status IN ('pending','retry');

-- Health checks — how deep is the queue by family / status?
CREATE INDEX IF NOT EXISTS seo_indexnow_queue_status_family_idx
  ON public.seo_indexnow_queue (status, page_family);

-- Duplicate/change detection at the entity level (nice-to-have for admin).
CREATE INDEX IF NOT EXISTS seo_indexnow_queue_entity_idx
  ON public.seo_indexnow_queue (page_family, entity_id)
  WHERE entity_id IS NOT NULL;

COMMENT ON TABLE public.seo_indexnow_queue IS
  'IndexNow submission queue. One row per URL; latest content_hash wins on re-queue. Worker cron in /api/cron/indexnow-worker drains this table.';
COMMENT ON COLUMN public.seo_indexnow_queue.priority IS
  '0=highest (new/deleted URL, canonical change, new article). 1=meaningful metadata change. 2=routine price refresh. 3-9 reserved.';
COMMENT ON COLUMN public.seo_indexnow_queue.reason IS
  'Short free-text tag: created | updated | deleted | canonical_change | price_change | metadata_change | manual | backfill_historical.';
COMMENT ON COLUMN public.seo_indexnow_queue.status IS
  'pending | processing | submitted | retry | failed | superseded. processing rows carry claimed_at + claimed_by so a hung worker can be reaped.';
COMMENT ON COLUMN public.seo_indexnow_queue.content_hash IS
  'Stable hash of the fields that materially change what Bing/Google would see. See src/lib/indexnow/hash.ts for the signature.';

-- ── seo_indexnow_submissions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seo_indexnow_submissions (
  submission_id       BIGSERIAL     PRIMARY KEY,
  run_id              UUID          NOT NULL,
  submitted_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  batch_size          INTEGER       NOT NULL,
  http_status         INTEGER,
  status_class        TEXT          NOT NULL,
  attempt_number      INTEGER       NOT NULL,
  duration_ms         INTEGER,
  error               TEXT,
  sample_urls         TEXT[]        NOT NULL DEFAULT '{}'::TEXT[],
  trigger             TEXT          NOT NULL,

  CONSTRAINT seo_indexnow_submissions_status_class_chk
    CHECK (status_class IN ('ok','accepted','bad-request','forbidden','unprocessable','rate-limited','server-error','network-error','unknown','skipped'))
);

CREATE INDEX IF NOT EXISTS seo_indexnow_submissions_submitted_idx
  ON public.seo_indexnow_submissions (submitted_at DESC);

CREATE INDEX IF NOT EXISTS seo_indexnow_submissions_run_idx
  ON public.seo_indexnow_submissions (run_id);

COMMENT ON TABLE public.seo_indexnow_submissions IS
  'Audit log: one row per IndexNow HTTP batch (success OR failure). run_id groups every batch a single worker invocation submitted. sample_urls stores up to 5 URLs for spot-checking without persisting the full 1000-URL payload.';

-- ── seo_indexnow_settings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seo_indexnow_settings (
  key                 TEXT          PRIMARY KEY,
  value               JSONB         NOT NULL,
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_by          TEXT
);

COMMENT ON TABLE public.seo_indexnow_settings IS
  'Durable feature flags for the IndexNow subsystem. Cheaper than a redeploy for kill switches / rate caps / historical-backfill unlocks.';

-- Seed the first-run safety flags. Explicit inserts so a fresh deployment
-- has a known-safe posture. On re-run these are no-ops.
INSERT INTO public.seo_indexnow_settings (key, value, updated_by) VALUES
  ('worker_enabled',                'true'::JSONB,   'migration-init'),
  ('bulk_submission_enabled',       'false'::JSONB,  'migration-init'),
  ('daily_submission_cap',          '5000'::JSONB,   'migration-init'),
  ('per_invocation_url_cap',        '500'::JSONB,    'migration-init'),
  ('per_invocation_time_budget_ms', '55000'::JSONB,  'migration-init')
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.seo_indexnow_settings.value IS
  'JSONB so future settings can hold structured values (per-family caps, cohort schedules, etc.) without a schema change.';

-- ── Post-condition assertion ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='seo_indexnow_queue') THEN
    RAISE EXCEPTION 'seo_indexnow_queue was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='seo_indexnow_submissions') THEN
    RAISE EXCEPTION 'seo_indexnow_submissions was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='seo_indexnow_settings') THEN
    RAISE EXCEPTION 'seo_indexnow_settings was not created';
  END IF;
  RAISE NOTICE 'seo_indexnow_queue + submissions + settings ready (Stage 6A).';
END $$;

COMMIT;
