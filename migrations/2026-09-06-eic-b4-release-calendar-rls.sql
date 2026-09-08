-- 2026-09-06-eic-b4-release-calendar-rls.sql
--
-- EIC Block 4 Part 0 — enable RLS on public.release_calendar so the
-- anon key can no longer read or mutate the editorial release feed.
--
-- Pre-inspection (see Block 4 report):
--   * No public browser code references release_calendar.
--   * No Supabase Edge Function references release_calendar.
--   * No script under scripts/ references release_calendar.
--   * No view / trigger / RLS policy references release_calendar.
--   * One DB function (strip_pokemon_prefix) references it as a text
--     helper — irrelevant to RLS.
--   * All admin CRUD goes through /api/admin/editorial/release-calendar/*
--     which use the service-role client (bypasses RLS).
--
-- After this migration:
--   * Anon:          cannot SELECT / INSERT / UPDATE / DELETE.
--   * Authenticated: same (no policies grant access).
--   * Service role:  full access (Postgres built-in; unchanged).
--
-- No policies are added because no public read path exists today.
-- If a future public feature needs a read, add a narrow policy at
-- that time. Same posture as public.insights (post Block 0B) and
-- public.editorial_projects (Block 2).

BEGIN;

ALTER TABLE public.release_calendar ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Verification (run separately after applying):
--   SELECT relrowsecurity FROM pg_class
--   WHERE oid = 'public.release_calendar'::regclass;
--   -- Expected: true
--
--   SELECT count(*) FROM pg_policies
--   WHERE schemaname='public' AND tablename='release_calendar';
--   -- Expected: 0
