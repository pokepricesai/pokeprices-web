-- migrations/2026-06-17-recent-sales-stage-1.sql
-- Block 4B-W-1 — canonical provider identity + recent-sales database
-- foundation. STAGE 1 ONLY: dormant scaffolding; no UI, no ingestion.
--
-- ADDITIVE ONLY:
--   * Does NOT alter or read from the scraper-owned `cards` table.
--   * Does NOT alter `daily_prices`, `card_trends`, `card_volume`,
--     `psa_population`, watchlist, alerts, portfolio, or any existing
--     RPC.
--   * Inserts ZERO rows into `recent_sales` or
--     `recent_sales_card_allow_list`.
--   * Backfills `provider_card_links` with one row per English card
--     whose `card_slug` is a valid numeric PriceCharting product id.
--
-- IDEMPOTENT: every CREATE uses IF NOT EXISTS / DO NOTHING.
--
-- Note on FKs to `cards`:
--   The `cards` table is owned by the sister scraper repository and is
--   not defined in this repo's migrations. Its de facto primary key is
--   `card_slug TEXT` (bare numeric). PostgreSQL requires a UNIQUE/PK
--   constraint on the referenced column to declare an FK. Since we do
--   not own that table's constraint set, the bridge stores
--   `card_slug TEXT NULL` as a SOFT REFERENCE — no FK constraint.
--   Application code re-resolves the link on read. This matches the
--   existing repo's pattern: every migration that touches a card by
--   slug uses a logical join, not a hard FK (see
--   2026-04-29-add-illustrators.sql).
--
-- Apply manually in the Supabase SQL Editor.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. provider_card_links — canonical provider → internal card bridge
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_card_links (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provider taxonomy (strict-allow initially; future migration
  -- extends the CHECK when a second provider arrives).
  provider          TEXT NOT NULL CHECK (provider IN ('pricecharting')),

  -- The provider's own card identifier. For PriceCharting this is the
  -- BARE numeric product id (e.g. "959616"), NOT the pc-prefixed form.
  -- Documented convention (do not violate): one identity per card per
  -- language. We never store both "pc-959616" and "959616" as
  -- separate rows.
  provider_card_id  TEXT NOT NULL CHECK (provider_card_id ~ '^[A-Za-z0-9_-]+$'),

  -- Soft reference to the scraper-owned `cards` table. Matches
  -- cards.card_slug (TEXT, bare numeric). NOT a real FK — see header.
  card_slug         TEXT NULL,

  -- Initial language scope: English-only. Japanese is a future
  -- workstream; the CHECK is extended at that point.
  language          TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en')),

  match_method      TEXT NOT NULL DEFAULT 'automatic' CHECK (match_method IN (
                      'automatic', 'manual', 'admin_override', 'heuristic'
                    )),
  confidence        NUMERIC(4,3) NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),

  -- Soft activate / deactivate without deleting. Quarantined bridges
  -- can be set is_active = FALSE while the admin investigates.
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,

  notes_internal    TEXT,  -- service-role/admin only; never surfaced
                           -- to the application's public read paths

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider, provider_card_id, language)
);

CREATE INDEX IF NOT EXISTS idx_provider_card_links_card_slug
  ON public.provider_card_links(card_slug)
  WHERE card_slug IS NOT NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_provider_card_links_lookup
  ON public.provider_card_links(provider, provider_card_id, language)
  WHERE is_active = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- 2. market_import_runs — one row per scraper/admin ingestion run
-- ─────────────────────────────────────────────────────────────────────
-- Modelled on email_onboarding_runs (Block 3D). No PII, no secrets,
-- no raw HTML — only run-level counts and parser metadata.
CREATE TABLE IF NOT EXISTS public.market_import_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider            TEXT NOT NULL CHECK (provider IN ('pricecharting')),
  source              TEXT NOT NULL CHECK (source IN (
                        'scraper_nightly','admin_manual','backfill','pilot'
                      )),
  status              TEXT NOT NULL DEFAULT 'running' CHECK (status IN (
                        'running','success','partial','failed'
                      )),

  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,

  pages_processed     INT NOT NULL DEFAULT 0 CHECK (pages_processed     >= 0),
  rows_ok             INT NOT NULL DEFAULT 0 CHECK (rows_ok             >= 0),
  rows_quarantined    INT NOT NULL DEFAULT 0 CHECK (rows_quarantined    >= 0),
  rows_rejected       INT NOT NULL DEFAULT 0 CHECK (rows_rejected       >= 0),
  rows_duplicate      INT NOT NULL DEFAULT 0 CHECK (rows_duplicate      >= 0),

  duration_ms         INT CHECK (duration_ms IS NULL OR duration_ms >= 0),

  parser_version      TEXT,
  layout_signature    TEXT,   -- scraper-side signature of the page layout
  notes               TEXT,   -- operator-safe diagnostic; never a secret

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_import_runs_started_at
  ON public.market_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_import_runs_status_started
  ON public.market_import_runs(status, started_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3. recent_sales — observed marketplace sales parsed by the scraper
-- ─────────────────────────────────────────────────────────────────────
-- IDENTITY RULES (see docs/recent-sales-architecture.md §"Identity"):
--
--   * provider_sale_key  → AUTHORITATIVE DEDUP KEY. UNIQUE.
--   * raw_hash           → content hash; NOT unique. Used for
--                          correction lookup.
--   * marketplace_item_id → eBay/etc. item id when present.
--                          NOT globally unique — the same listing can
--                          appear under a different observed_section
--                          after provider reclassification.
--
-- parse_status is the parser's verdict; review_status is the
-- application/admin lifecycle. They are intentionally orthogonal.
--
-- parse_confidence uses the parser's 0–100 INTEGER scale (NOT 0–1).
CREATE TABLE IF NOT EXISTS public.recent_sales (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  provider_sale_key      TEXT NOT NULL UNIQUE,
  provider               TEXT NOT NULL CHECK (provider IN ('pricecharting')),
  provider_card_id       TEXT NOT NULL,
  provider_card_link_id  UUID NULL REFERENCES public.provider_card_links(id) ON DELETE SET NULL,
  -- Soft reference to scraper-owned cards. Nullable when the bridge
  -- has not yet resolved the card. internal_card_slug is the slug as
  -- the parser observed it (always set).
  card_slug              TEXT NULL,
  internal_card_slug     TEXT NOT NULL,

  -- Observed sale
  pricecharting_url      TEXT NOT NULL,
  observed_section       TEXT NOT NULL,                    -- canonical parser section value;
                                                            -- 19 mappings are preserved as-is
  sale_date              DATE NOT NULL,
  marketplace_source     TEXT NOT NULL,                    -- 'ebay' | 'heritage' | …
  marketplace_country    TEXT NULL,                        -- ISO-2 when reliable
  listing_title          TEXT NOT NULL,
  sale_price_cents       INT  NOT NULL CHECK (sale_price_cents > 0),
  original_price_cents   INT  NULL CHECK (original_price_cents IS NULL OR original_price_cents > 0),
  display_currency       TEXT NOT NULL DEFAULT 'USD',
  source_currency        TEXT NULL,
  grading_company        TEXT NULL CHECK (grading_company IS NULL OR grading_company IN (
                           'PSA','CGC','BGS','SGC','TAG','ACE'
                         )),
  grade                  TEXT NULL,
  raw_or_graded          TEXT NULL CHECK (raw_or_graded IS NULL OR raw_or_graded IN (
                           'raw','graded'
                         )),
  condition_text         TEXT NULL,
  condition_bucket       TEXT NULL CHECK (condition_bucket IS NULL OR condition_bucket IN (
                           'mint','near_mint','lightly_played','played','poor','unknown'
                         )),
  listing_url            TEXT NULL,
  marketplace_item_id    TEXT NULL,                        -- INTENTIONALLY NOT UNIQUE
  best_offer_status      TEXT NULL CHECK (best_offer_status IS NULL OR best_offer_status IN (
                           'none','accepted','unknown'
                         )),
  language               TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en')),
  first_edition_status   TEXT NULL CHECK (first_edition_status IS NULL OR first_edition_status IN (
                           'first_edition','unlimited','shadowless','unknown'
                         )),
  variant_text           TEXT NULL,

  -- Parser
  raw_hash               TEXT NOT NULL,                    -- INTENTIONALLY NOT UNIQUE
  parser_version         TEXT NOT NULL,
  parse_confidence       INT  NOT NULL CHECK (parse_confidence BETWEEN 0 AND 100),
  parse_status           TEXT NOT NULL CHECK (parse_status IN (
                           'ok','quarantined','rejected'
                         )),
  rejection_reason       TEXT NULL,
  anomaly_flags          JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw_metadata           JSONB NULL,                       -- application convention:
                                                            --   ONLY populated for
                                                            --   quarantined/rejected/debug
  source_attribution     TEXT NOT NULL DEFAULT 'PriceCharting',
  import_run_id          UUID NULL REFERENCES public.market_import_runs(id) ON DELETE SET NULL,

  -- Lifecycle (independent of parse_status)
  review_status          TEXT NOT NULL DEFAULT 'active' CHECK (review_status IN (
                           'active','superseded','corrected','dismissed'
                         )),
  superseded_by_id       UUID NULL REFERENCES public.recent_sales(id) ON DELETE SET NULL,

  first_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Public hot-path predicate index: "give me the most-recent N clean
-- active sales for a card-section". Used by future
-- rms_recent_sales() RPC (built in a later block).
CREATE INDEX IF NOT EXISTS idx_recent_sales_card_section_date
  ON public.recent_sales(card_slug, observed_section, sale_date DESC)
  WHERE parse_status = 'ok' AND review_status = 'active' AND card_slug IS NOT NULL;

-- Fallback hot-path index keyed on the provider identifiers — used
-- when the application has the provider_card_id in hand but the
-- bridge has not yet resolved the card.
CREATE INDEX IF NOT EXISTS idx_recent_sales_provider_section_date
  ON public.recent_sales(provider, provider_card_id, observed_section, sale_date DESC)
  WHERE parse_status = 'ok' AND review_status = 'active';

-- Admin queue index: "show me everything quarantined from this run".
CREATE INDEX IF NOT EXISTS idx_recent_sales_status_review_run
  ON public.recent_sales(parse_status, review_status, import_run_id);

-- Marketplace breakdown index.
CREATE INDEX IF NOT EXISTS idx_recent_sales_marketplace_date
  ON public.recent_sales(marketplace_source, sale_date DESC);

-- Sitemap-freshness feed.
CREATE INDEX IF NOT EXISTS idx_recent_sales_last_seen
  ON public.recent_sales(last_seen_at DESC);

-- Optional partial index for marketplace_item_id lookups (only when
-- present and the row is clean+active).
CREATE INDEX IF NOT EXISTS idx_recent_sales_item_id
  ON public.recent_sales(marketplace_item_id)
  WHERE marketplace_item_id IS NOT NULL
    AND parse_status = 'ok'
    AND review_status = 'active';

-- Optional index for correction lookup by raw_hash.
CREATE INDEX IF NOT EXISTS idx_recent_sales_raw_hash
  ON public.recent_sales(raw_hash);

-- ─────────────────────────────────────────────────────────────────────
-- 4. recent_sales_card_allow_list — pilot card scope
-- ─────────────────────────────────────────────────────────────────────
-- Empty initially. Stage 2 (next block) seeds the 100 pilot cards.
-- Stage 5 flips the operator-visible env flag to lift the allow-list.
CREATE TABLE IF NOT EXISTS public.recent_sales_card_allow_list (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider          TEXT NOT NULL CHECK (provider IN ('pricecharting')),
  provider_card_id  TEXT NOT NULL CHECK (provider_card_id ~ '^[A-Za-z0-9_-]+$'),
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  reason            TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider, provider_card_id)
);

CREATE INDEX IF NOT EXISTS idx_recent_sales_allow_lookup
  ON public.recent_sales_card_allow_list(provider, provider_card_id)
  WHERE enabled = TRUE;

-- ─────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────
-- All four tables are service-role only at this stage. No end-user
-- read policies. The public application's future read path goes
-- through controlled RPCs / server routes, NOT a direct table select.
ALTER TABLE public.provider_card_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_import_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recent_sales                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recent_sales_card_allow_list ENABLE ROW LEVEL SECURITY;

-- Drop any prior copies so re-apply stays idempotent. We do NOT create
-- any user-facing policy here — that arrives in a later block when
-- the RPCs do.
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS provider_card_links_no_public  ON public.provider_card_links';
  EXECUTE 'DROP POLICY IF EXISTS market_import_runs_no_public   ON public.market_import_runs';
  EXECUTE 'DROP POLICY IF EXISTS recent_sales_no_public         ON public.recent_sales';
  EXECUTE 'DROP POLICY IF EXISTS recent_sales_allow_no_public   ON public.recent_sales_card_allow_list';
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Backfill: provider_card_links from existing English cards
-- ─────────────────────────────────────────────────────────────────────
-- One row per cards row whose card_slug is a valid numeric
-- PriceCharting product id. provider_card_id stores the BARE numeric
-- form (no "pc-" prefix). pc_url is used as supporting evidence only
-- — when present, it must point at PriceCharting; when absent the
-- backfill still proceeds and notes the source.
--
-- Conflict resolution: ON CONFLICT DO NOTHING. We never overwrite a
-- prior bridge row. Admins re-resolve in a future review UI.
--
-- This INSERT is the ONLY data write in this migration. recent_sales,
-- market_import_runs, and recent_sales_card_allow_list stay empty.
INSERT INTO public.provider_card_links (
  provider, provider_card_id, card_slug, language, match_method,
  confidence, is_active, notes_internal
)
SELECT
  'pricecharting',
  c.card_slug,                    -- bare numeric → canonical provider_card_id
  c.card_slug,                    -- soft reference to cards.card_slug
  'en',
  'automatic',
  CASE
    WHEN c.pc_url IS NOT NULL
      AND c.pc_url ~ ('/' || c.card_slug || '($|/|\?)')  -- pc_url validates the id
      THEN 1.000
    WHEN c.pc_url IS NULL
      THEN 0.900    -- backfill OK but no provider evidence
    ELSE 0.700      -- pc_url present but does not contain the slug
  END,
  TRUE,
  CASE
    WHEN c.pc_url IS NULL
      THEN 'backfill: no pc_url available; provider_card_id derived from cards.card_slug'
    ELSE NULL
  END
FROM public.cards c
WHERE c.card_slug ~ '^\d+$'        -- only numeric PriceCharting product ids
ON CONFLICT (provider, provider_card_id, language) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Post-conditions
-- ─────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_tables INT;
  v_rls    INT;
  v_recent INT;
  v_allow  INT;
  v_runs   INT;
BEGIN
  SELECT COUNT(*) INTO v_tables
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'provider_card_links','market_import_runs',
      'recent_sales','recent_sales_card_allow_list'
    );
  IF v_tables <> 4 THEN
    RAISE EXCEPTION 'recent-sales stage 1: expected 4 tables, found %', v_tables;
  END IF;

  SELECT COUNT(*) INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'provider_card_links','market_import_runs',
      'recent_sales','recent_sales_card_allow_list'
    )
    AND c.relrowsecurity;
  IF v_rls <> 4 THEN
    RAISE EXCEPTION 'recent-sales stage 1: expected RLS on 4 tables, got %', v_rls;
  END IF;

  -- Stage 1 must leave these tables empty.
  SELECT COUNT(*) INTO v_recent FROM public.recent_sales;
  IF v_recent <> 0 THEN
    RAISE EXCEPTION 'recent-sales stage 1: recent_sales must be empty after migration (found %)', v_recent;
  END IF;
  SELECT COUNT(*) INTO v_allow FROM public.recent_sales_card_allow_list;
  IF v_allow <> 0 THEN
    RAISE EXCEPTION 'recent-sales stage 1: allow_list must be empty after migration (found %)', v_allow;
  END IF;
  SELECT COUNT(*) INTO v_runs FROM public.market_import_runs;
  IF v_runs <> 0 THEN
    RAISE EXCEPTION 'recent-sales stage 1: market_import_runs must be empty (found %)', v_runs;
  END IF;
END $$;

COMMIT;
