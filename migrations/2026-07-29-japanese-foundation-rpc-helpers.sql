-- migrations/2026-07-29-japanese-foundation-rpc-helpers.sql
--
-- Block 5A-W-48B — companion migration for the two RPCs whose bodies
-- are NOT versioned in this repo:
--
--   * public.search_global(query text)
--   * public.get_set_list_v2()
--
-- These were originally applied by hand in the Supabase SQL Editor
-- and their source is only available in pg_proc, not in git. Rather
-- than risk a subtle ranking regression by reconstructing them from
-- their observed return shape, this migration takes a lower-risk
-- path:
--
--   * DO NOT touch search_global or get_set_list_v2 at all.
--   * Add TWO tiny SECURITY DEFINER helpers the web client can call
--     to enrich results with language on the client side.
--   * The client (`src/lib/cardLanguage.ts`) already ships a robust
--     "Japanese <set title>" prefix fallback so JP display works
--     TODAY even without these helpers. These helpers are the
--     "canonical" upgrade — they make language authoritative rather
--     than derived, and they let a set legitimately containing the
--     word "Japanese" in its English name coexist safely with
--     Japanese printings in the future.
--
-- Safe to run twice: every step is CREATE OR REPLACE.
-- Depends on: 2026-07-29-japanese-foundation.sql (which adds
-- set_metadata.language and cards.language).

BEGIN;

-- ── 1. get_set_languages() ───────────────────────────────────────
--
-- Bulk-fetch: return { set_name, language } for every set. Client
-- calls this once at browse-page mount, joins to the get_set_list_v2
-- results by set_name, and uses `language` when present (falling
-- back to the prefix convention when a set_metadata row is missing).
--
-- Grantable to anon so unauthenticated visitors can also get the
-- correct language on the browse page.

CREATE OR REPLACE FUNCTION public.get_set_languages()
RETURNS TABLE (set_name TEXT, language TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT set_name, COALESCE(language, 'en')::TEXT AS language
    FROM public.set_metadata
   ORDER BY set_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_set_languages() TO anon, authenticated, service_role;

-- ── 2. get_card_language_by_url_slug(text, text) ─────────────────
--
-- Single-card lookup used by the scanner and by any surface that
-- receives a card without an accompanying set_metadata row already
-- loaded. Cheap because it hits the primary key path on cards.

CREATE OR REPLACE FUNCTION public.get_card_language_by_url_slug(
  p_set_name TEXT, p_card_url_slug TEXT
)
RETURNS TEXT
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(language, 'en')::TEXT
    FROM public.cards
   WHERE set_name = p_set_name AND card_url_slug = p_card_url_slug
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_card_language_by_url_slug(TEXT, TEXT) TO anon, authenticated, service_role;

COMMIT;

-- ── Optional (not applied here): extend search_global + get_set_list_v2 ──
--
-- If Luke later wants search_global and get_set_list_v2 to return
-- language natively rather than the client enriching results via
-- get_set_languages(), the change is small in both cases:
--
-- === search_global — extension ===
-- Add `language TEXT` to the RETURNS TABLE and to the projection of
-- every branch that emits a card row. Cards read cards.language;
-- sets read set_metadata.language; pokemon rows can hard-code 'en'
-- (species pages aggregate across languages).
--
--   -- Diff (approximate):
--   RETURNS TABLE (
--     …existing columns unchanged…,
--     language TEXT  -- NEW: 'en' or 'jp'
--   )
--   -- In every branch that emits a card row:
--   COALESCE(c.language, 'en') AS language
--   -- In every branch that emits a set row:
--   COALESCE(m.language, 'en') AS language
--   -- In every branch that emits a pokemon row:
--   'en'::TEXT AS language
--
-- === get_set_list_v2 — extension ===
-- Same pattern: add `language TEXT` to the RETURNS TABLE, and select
-- COALESCE(m.language, 'en') from set_metadata in the join.
--
-- Do not apply either extension until Luke has verified the current
-- production body of each RPC matches his expected relevance
-- ranking. The reconstructions cannot be safely written from this
-- repo alone because PostgREST does not expose pg_proc for
-- introspection.
