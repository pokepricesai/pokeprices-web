-- migrations/2026-06-23-affiliate-events.sql
-- Block 4B-W-10A — server-side storage for affiliate impression/click events.
--
-- WHY
--   Until now, every affiliate_link_view / affiliate_click event has gone
--   only to Google Analytics 4 via gtag (see src/lib/analytics.ts). That
--   makes click-through monitoring impossible without leaving the admin
--   surface. This migration adds a small append-only table fed by a
--   dedicated POST endpoint (src/app/api/affiliate/event/route.ts), with
--   the admin inspection panel reading aggregate counts from it.
--
-- ADDITIVE ONLY
--   * No alter / drop / truncate on any existing object.
--   * No backfill, no data migration; the table starts empty.
--   * No new RPC.
--
-- PRIVACY
--   The endpoint deliberately captures NO PII:
--     * no IP address  (the route does not read x-forwarded-for / cf-*)
--     * no User-Agent  (the route does not read user-agent)
--     * no Referer     (would leak full URL with query params)
--     * no email       (no auth lookup performed)
--     * no user_id     (analytics scope is anonymous by design)
--   Optional `session_id` is accepted only when supplied by the client.
--   The column is bounded to 64 chars; the central engine does not
--   populate it today, but the field is here so a future block can
--   introduce a rotating anonymous session token without another
--   migration.
--
-- HOW TO APPLY
--   The CREATE INDEX statements use CONCURRENTLY so the table is
--   immediately usable. Paste into the Supabase SQL Editor and run
--   each statement individually (do NOT wrap in BEGIN/COMMIT —
--   CONCURRENTLY cannot run in a transaction block).

CREATE TABLE IF NOT EXISTS public.affiliate_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event_type        TEXT NOT NULL CHECK (event_type IN ('view', 'click')),
  placement         TEXT NOT NULL CHECK (
                      length(placement) BETWEEN 1 AND 80
                      AND placement ~ '^[A-Za-z0-9_:.-]+$'
                    ),

  page_type         TEXT NULL CHECK (page_type        IS NULL OR length(page_type)        <=  40),
  source_component  TEXT NULL CHECK (source_component IS NULL OR length(source_component) <=  80),
  card_slug         TEXT NULL CHECK (card_slug        IS NULL OR length(card_slug)        <=  80),
  set_slug          TEXT NULL CHECK (set_slug         IS NULL OR length(set_slug)         <= 200),
  intent            TEXT NULL CHECK (intent           IS NULL OR length(intent)           <=  40),
  marketplace       TEXT NULL CHECK (marketplace      IS NULL OR length(marketplace)      <=   8),

  -- Anonymous, opaque, client-supplied. NOT a user_id and never linked
  -- to one. Bounded so we never accidentally store a stack trace.
  session_id        TEXT NULL CHECK (session_id       IS NULL OR length(session_id)       <=  64),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin queries: counts by (event_type, time window) and per placement.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_affiliate_events_created
  ON public.affiliate_events (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_affiliate_events_type_created
  ON public.affiliate_events (event_type, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_affiliate_events_placement_created
  ON public.affiliate_events (placement, created_at DESC);

-- RLS: turn it on; do NOT create any public policy. Inserts and reads
-- happen via the server-side service role only — the public endpoint
-- writes via the service-role client, and the admin panel reads via
-- the same. PostgREST anon role gets denied by default.
ALTER TABLE public.affiliate_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS affiliate_events_no_public ON public.affiliate_events';
END $$;
