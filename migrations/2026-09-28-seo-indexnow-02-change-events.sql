-- migrations/2026-09-28-seo-indexnow-02-change-events.sql
-- ============================================================================
-- SEO / IndexNow · Stage 6A · migration 02 of 02.
--
-- The 01 migration created the queue tables. This one wires the QUEUE
-- PRODUCERS — the DB-side triggers that let the harvester cron find
-- everything that has changed since it last ran, without any expensive
-- 65 000-row full-site diff.
--
-- Tables added
--   public.seo_change_events   — one row per (source, entity, day) event
--
-- Triggers added (all `AFTER` — never block writes)
--   * daily_prices    → any INSERT or price-column UPDATE (60k+ rows/day)
--   * cards           → INSERT | DELETE | UPDATE of user-visible cols
--   * insights        → INSERT | UPDATE (any of publish/status/body/meta)
--   * set_metadata    → INSERT | UPDATE
--   * pokemon_species → INSERT | UPDATE of user-visible cols
--   * creators        → INSERT | UPDATE
--   * vendors         → INSERT | UPDATE
--
-- Dedup contract
--   `seo_change_events` has UNIQUE(event_source, entity_key, observed_day).
--   Every trigger uses INSERT ... ON CONFLICT DO NOTHING, so re-scrapes
--   inside the same UTC day collapse to a single event. The harvester
--   drains that day's events regardless of how many trigger fires
--   produced them.
--
-- Settings tweak
--   Also flips `worker_enabled=false` and raises the caps to the values
--   justified by the 2026-09-28 volume analysis (see docs/seo/indexnow.md).
--   Historical backfill stays `bulk_submission_enabled=false`.
--
-- Deployment
--   Luke runs this in the Supabase SQL Editor after 01 has applied.
--   All statements are IF NOT EXISTS / ON CONFLICT / OR REPLACE so it is
--   safe to re-run.
-- ============================================================================

BEGIN;

-- ── seo_change_events ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.seo_change_events (
  id             BIGSERIAL     PRIMARY KEY,
  event_source   TEXT          NOT NULL,
  entity_key     TEXT          NOT NULL,
  event_kind     TEXT          NOT NULL,
  observed_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  observed_day   DATE          NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::DATE,
  detail         JSONB,
  processed_at   TIMESTAMPTZ,

  CONSTRAINT seo_change_events_source_chk
    CHECK (event_source IN ('daily_prices','cards','insights','set_metadata','pokemon_species','creators','vendors')),

  CONSTRAINT seo_change_events_kind_chk
    CHECK (event_kind IN ('created','updated','deleted'))
);

-- Dedup: one row per (source, entity, kind, day). Multiple trigger fires
-- within the same day for the same (entity, kind) become no-ops via
-- ON CONFLICT DO NOTHING. Different kinds (e.g. a slug-change producing
-- both a 'deleted' event for the OLD URL AND an 'updated' event for the
-- current row) coexist so no side of the notification is lost.
CREATE UNIQUE INDEX IF NOT EXISTS seo_change_events_dedup_uniq
  ON public.seo_change_events (event_source, entity_key, event_kind, observed_day);

-- Harvester claim scan: newest-unprocessed first.
CREATE INDEX IF NOT EXISTS seo_change_events_unprocessed_idx
  ON public.seo_change_events (processed_at NULLS FIRST, observed_at)
  WHERE processed_at IS NULL;

-- Retention cleanup scan: old-processed-first.
-- Predicate is a plain non-partial index because Postgres cannot use a
-- partial index whose WHERE clause references NOW(). This index still
-- lets the cleanup DELETE ... WHERE processed_at < ... LIMIT N seek
-- efficiently.
CREATE INDEX IF NOT EXISTS seo_change_events_processed_at_idx
  ON public.seo_change_events (processed_at)
  WHERE processed_at IS NOT NULL;

COMMENT ON TABLE public.seo_change_events IS
  'Producer stream feeding the IndexNow harvester. Populated by AFTER triggers on cards / daily_prices / insights / set_metadata / pokemon_species / creators / vendors. Deduped to one row per (source, entity_key, event_kind, UTC day). Processed events are cleaned up by the harvester after 30 days.';
COMMENT ON COLUMN public.seo_change_events.entity_key IS
  'Opaque key. For daily_prices/cards: card_slug (without ''pc-'' prefix). For insights: current slug. For sets: current set_name. For pokemon: species name (lowercased). For creators/vendors: current slug.';
COMMENT ON COLUMN public.seo_change_events.event_kind IS
  'created | updated | deleted. deleted is used for both hard-delete (row removed) AND canonical-URL retirement (slug or set_name change): in both cases the OLD URL info lives in `detail`. See seo_write_change_event().';
COMMENT ON COLUMN public.seo_change_events.detail IS
  'Optional JSONB payload. Populated on `deleted` and canonical-change events with { url?, set_name?, card_url_slug?, slug?, reason? } so the harvester can enqueue the OLD URL without a join against a source table that has since dropped the row.';

-- ── Generic writer function ───────────────────────────────────────────────
-- Every trigger calls this via a wrapper. Keeps the actual INSERT logic in
-- one place; wrappers just supply source + entity_key + kind + optional
-- detail.

CREATE OR REPLACE FUNCTION public.seo_write_change_event(
  p_source     TEXT,
  p_entity_key TEXT,
  p_kind       TEXT,
  p_detail     JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_entity_key IS NULL OR p_entity_key = '' THEN
    RETURN;   -- nothing meaningful to enqueue
  END IF;

  -- Fast path: single INSERT ... ON CONFLICT DO NOTHING. When detail is
  -- provided AND the row already exists, we do NOT overwrite the earlier
  -- detail (which usually carries the FIRST observed old-URL of the day —
  -- the one Bing most needs to know about). This is deliberate.
  INSERT INTO public.seo_change_events (event_source, entity_key, event_kind, detail)
  VALUES (p_source, p_entity_key, p_kind, p_detail)
  ON CONFLICT (event_source, entity_key, event_kind, observed_day) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION public.seo_write_change_event IS
  'Idempotent within a UTC day for a given (source, entity, kind). Never raises. First-observed detail wins on conflict.';

-- ── daily_prices trigger ──────────────────────────────────────────────────
-- Strips the ''pc-'' prefix so the harvester''s join against cards is
-- straightforward.
CREATE OR REPLACE FUNCTION public.seo_trg_daily_prices_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_slug TEXT;
BEGIN
  v_slug := CASE
    WHEN NEW.card_slug LIKE 'pc-%' THEN SUBSTR(NEW.card_slug, 4)
    ELSE NEW.card_slug
  END;
  PERFORM public.seo_write_change_event(
    'daily_prices', v_slug,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_prices_seo_change ON public.daily_prices;
CREATE TRIGGER trg_daily_prices_seo_change
AFTER INSERT OR UPDATE OF raw_usd, psa10_usd, psa9_usd, psa8_usd, psa7_usd,
                          cgc10_usd, cgc95_usd, bgs10_usd, bgs95_usd,
                          tag10_usd, ace10_usd, sgc10_usd, bgs10black_usd, cgc10pristine_usd,
                          tcgplayer_usd, cardmarket_eur
  ON public.daily_prices
  FOR EACH ROW EXECUTE FUNCTION public.seo_trg_daily_prices_change();

-- ── cards trigger ─────────────────────────────────────────────────────────
-- Handles four scenarios explicitly:
--   * INSERT                 → 'created' event, no detail
--   * DELETE                 → 'deleted' event with OLD (set_name, card_url_slug) in detail
--                              so the harvester can enqueue the OLD canonical URL even after
--                              the source row is gone.
--   * UPDATE with slug/set change → TWO events: 'deleted' event carrying the
--                              OLD URL fields (canonical-change flag set), plus 'updated'
--                              event for the NEW row.
--   * UPDATE with no slug/set change → 'updated' event.
CREATE OR REPLACE FUNCTION public.seo_trg_cards_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.seo_write_change_event(
      'cards', OLD.card_slug, 'deleted',
      jsonb_build_object(
        'set_name',      OLD.set_name,
        'card_url_slug', OLD.card_url_slug,
        'reason',        'row_deleted'
      )
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.seo_write_change_event('cards', NEW.card_slug, 'created');
    RETURN NEW;
  END IF;

  -- UPDATE — check for a canonical URL change first.
  IF NEW.card_url_slug IS DISTINCT FROM OLD.card_url_slug
     OR NEW.set_name  IS DISTINCT FROM OLD.set_name THEN
    PERFORM public.seo_write_change_event(
      'cards', OLD.card_slug, 'deleted',
      jsonb_build_object(
        'set_name',      OLD.set_name,
        'card_url_slug', OLD.card_url_slug,
        'reason',        'canonical_change'
      )
    );
  END IF;
  PERFORM public.seo_write_change_event('cards', NEW.card_slug, 'updated');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cards_seo_change ON public.cards;
CREATE TRIGGER trg_cards_seo_change
AFTER INSERT OR DELETE OR UPDATE OF card_url_slug, card_name, set_name,
                                     card_number, card_number_display,
                                     set_printed_total, image_url, is_sealed,
                                     primary_pokemon_slug, language
  ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.seo_trg_cards_change();

-- ── insights trigger ──────────────────────────────────────────────────────
-- Only fires when a published article's user-visible content changes.
-- Handles slug renames (rare — insights.slug is human-picked and stable,
-- but the RPC allows it) by writing a 'deleted' event carrying the OLD slug.
CREATE OR REPLACE FUNCTION public.seo_trg_insights_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.seo_write_change_event(
      'insights', OLD.slug, 'deleted',
      jsonb_build_object('slug', OLD.slug, 'reason', 'row_deleted')
    );
    RETURN OLD;
  END IF;

  -- We only care about currently-published articles (or transitions into it).
  IF NEW.status IS DISTINCT FROM 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    RETURN NEW;
  END IF;

  -- Slug rename on a published article.
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    PERFORM public.seo_write_change_event(
      'insights', OLD.slug, 'deleted',
      jsonb_build_object('slug', OLD.slug, 'reason', 'canonical_change')
    );
  END IF;

  PERFORM public.seo_write_change_event(
    'insights', NEW.slug,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insights_seo_change ON public.insights;
CREATE TRIGGER trg_insights_seo_change
AFTER INSERT OR DELETE OR UPDATE OF slug, headline, intro, meta_title,
                                     meta_description, body_json, status, published_at
  ON public.insights
  FOR EACH ROW EXECUTE FUNCTION public.seo_trg_insights_change();

-- ── set_metadata trigger ──────────────────────────────────────────────────
-- The set page URL is /set/{set_name}. A rename is treated as a
-- canonical change: the OLD URL is enqueued as 'deleted' so Bing re-crawls
-- (and finds 404) while the NEW URL is enqueued as 'updated'.
CREATE OR REPLACE FUNCTION public.seo_trg_set_metadata_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.seo_write_change_event(
      'set_metadata', OLD.set_name, 'deleted',
      jsonb_build_object('set_name', OLD.set_name, 'reason', 'row_deleted')
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.set_name IS DISTINCT FROM OLD.set_name THEN
    PERFORM public.seo_write_change_event(
      'set_metadata', OLD.set_name, 'deleted',
      jsonb_build_object('set_name', OLD.set_name, 'reason', 'canonical_change')
    );
  END IF;

  PERFORM public.seo_write_change_event(
    'set_metadata', NEW.set_name,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_metadata_seo_change ON public.set_metadata;
CREATE TRIGGER trg_set_metadata_seo_change
AFTER INSERT OR DELETE OR UPDATE OF set_name, total_cards, release_year, language
  ON public.set_metadata
  FOR EACH ROW EXECUTE FUNCTION public.seo_trg_set_metadata_change();

-- ── pokemon_species trigger ───────────────────────────────────────────────
-- Pokémon page URL slug is derived from name (see pokemonUrlSlug in
-- src/lib/indexnow/harvester.ts). A name change → new slug, so we treat it
-- as a canonical change with the OLD name in detail.
CREATE OR REPLACE FUNCTION public.seo_trg_pokemon_species_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.seo_write_change_event(
      'pokemon_species', LOWER(OLD.name), 'deleted',
      jsonb_build_object('name', OLD.name, 'reason', 'row_deleted')
    );
    RETURN OLD;
  END IF;

  -- Pages with total_cards = 0 are noindex'd by the site; no point
  -- notifying Bing/IndexNow about them.
  IF COALESCE(NEW.total_cards, 0) = 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND LOWER(NEW.name) IS DISTINCT FROM LOWER(OLD.name) THEN
    PERFORM public.seo_write_change_event(
      'pokemon_species', LOWER(OLD.name), 'deleted',
      jsonb_build_object('name', OLD.name, 'reason', 'canonical_change')
    );
  END IF;

  PERFORM public.seo_write_change_event(
    'pokemon_species', LOWER(NEW.name),
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pokemon_species_seo_change ON public.pokemon_species;
CREATE TRIGGER trg_pokemon_species_seo_change
AFTER INSERT OR DELETE OR UPDATE OF name, total_cards, total_market_value_cents,
                                     highest_card_price_cents, most_recent_set, description
  ON public.pokemon_species
  FOR EACH ROW EXECUTE FUNCTION public.seo_trg_pokemon_species_change();

-- ── creators trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_trg_creators_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.seo_write_change_event(
      'creators', OLD.slug, 'deleted',
      jsonb_build_object('slug', OLD.slug, 'reason', 'row_deleted')
    );
    RETURN OLD;
  END IF;
  IF NEW.status IS DISTINCT FROM 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    PERFORM public.seo_write_change_event(
      'creators', OLD.slug, 'deleted',
      jsonb_build_object('slug', OLD.slug, 'reason', 'canonical_change')
    );
  END IF;
  PERFORM public.seo_write_change_event(
    'creators', NEW.slug,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_creators_seo_change ON public.creators;
CREATE TRIGGER trg_creators_seo_change
AFTER INSERT OR DELETE OR UPDATE OF slug, name, description, image_url, country, status
  ON public.creators
  FOR EACH ROW EXECUTE FUNCTION public.seo_trg_creators_change();

-- ── vendors trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seo_trg_vendors_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.seo_write_change_event(
      'vendors', OLD.slug, 'deleted',
      jsonb_build_object('slug', OLD.slug, 'reason', 'row_deleted')
    );
    RETURN OLD;
  END IF;
  -- Only track active vendors (inactive ones aren't in sitemap-directories).
  IF COALESCE(NEW.active, FALSE) IS NOT TRUE
     AND (TG_OP = 'INSERT' OR COALESCE(OLD.active, FALSE) IS NOT TRUE) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    PERFORM public.seo_write_change_event(
      'vendors', OLD.slug, 'deleted',
      jsonb_build_object('slug', OLD.slug, 'reason', 'canonical_change')
    );
  END IF;
  PERFORM public.seo_write_change_event(
    'vendors', NEW.slug,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendors_seo_change ON public.vendors;
CREATE TRIGGER trg_vendors_seo_change
AFTER INSERT OR DELETE OR UPDATE OF slug, name, description, image_url, country, active
  ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.seo_trg_vendors_change();

-- ── Settings: first-deploy safe posture + evidence-based caps ─────────────
-- Owner-facing rollout procedure:
--   1. apply this migration            (worker_enabled = false → still safe)
--   2. deploy Vercel                   (harvester cron begins queueing)
--   3. verify /api/admin/seo/indexnow-health shows the queue growing
--   4. flip worker_enabled → true via a manual UPDATE in Supabase
--
-- Caps (from the 2026-09-28 volume analysis):
--   - median daily_prices rows / day     ~ 59,000
--   - cards with a 10c price bucket shift ~ 15% of those = ~ 9,000
--   - unique aggregate URLs affected      ~ 300 sets + 1,000 pokemon
--   - editorial + directory events        ~ 5 / day
--   - p95 unique URLs enqueued per day    ~ 10,300
--   - chosen daily_submission_cap = 15,000  (comfortable p95 headroom)
--   - chosen per_invocation_url_cap = 750   (drain rate matches p95 twice over)
--   - per_invocation_time_budget_ms = 55000 (stays under maxDuration=60)

INSERT INTO public.seo_indexnow_settings (key, value, updated_by) VALUES
  ('worker_enabled',                'false'::JSONB,  'migration-02-safe-default'),
  ('bulk_submission_enabled',       'false'::JSONB,  'migration-02'),
  ('daily_submission_cap',          '15000'::JSONB,  'migration-02'),
  ('per_invocation_url_cap',        '750'::JSONB,    'migration-02'),
  ('per_invocation_time_budget_ms', '55000'::JSONB,  'migration-02'),
  ('harvester_enabled',             'true'::JSONB,   'migration-02'),
  ('harvester_events_per_run',      '2000'::JSONB,   'migration-02'),
  ('harvester_enqueue_aggregates',  'true'::JSONB,   'migration-02')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by;

-- ── Retention helper — called by the harvester at the end of each run ──
--
-- Bounded, index-driven DELETE. Only touches rows where processed_at IS NOT
-- NULL AND processed_at < NOW() - INTERVAL '30 days'. Never deletes
-- unprocessed events. Batch limit protects the cron from long-running
-- transactions if a large backlog ever accumulates.
CREATE OR REPLACE FUNCTION public.seo_change_events_cleanup(
  p_older_than_days INT DEFAULT 30,
  p_batch_limit     INT DEFAULT 5000
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_deleted INT;
BEGIN
  IF p_older_than_days < 7 THEN
    -- Defensive: reject any silly value that would eat troubleshooting history.
    RAISE EXCEPTION 'seo_change_events_cleanup: p_older_than_days must be >= 7 (got %)', p_older_than_days;
  END IF;
  WITH victims AS (
    SELECT id
      FROM public.seo_change_events
     WHERE processed_at IS NOT NULL
       AND processed_at < NOW() - (p_older_than_days || ' days')::INTERVAL
     ORDER BY processed_at
     LIMIT p_batch_limit
  )
  DELETE FROM public.seo_change_events
   WHERE id IN (SELECT id FROM victims);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.seo_change_events_cleanup IS
  'Bounded cleanup of processed change events. Never touches unprocessed rows. Called from /api/cron/indexnow-harvest at the end of each successful run.';

-- ── Post-condition assertion ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='public' AND table_name='seo_change_events') THEN
    RAISE EXCEPTION 'seo_change_events was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_daily_prices_seo_change') THEN
    RAISE EXCEPTION 'trg_daily_prices_seo_change was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_cards_seo_change') THEN
    RAISE EXCEPTION 'trg_cards_seo_change was not created';
  END IF;
  RAISE NOTICE 'seo_change_events + 7 producer triggers ready (Stage 6A · migration 02). Worker is DISABLED by default; flip via UPDATE seo_indexnow_settings SET value=''true'' WHERE key=''worker_enabled''.';
END $$;

COMMIT;
