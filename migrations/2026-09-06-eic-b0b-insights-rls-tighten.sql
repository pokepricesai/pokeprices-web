-- 2026-09-06-eic-b0b-insights-rls-tighten.sql
--
-- EIC Block 0B — tighten RLS on public.insights so the anon key can
-- no longer create, update, delete or read draft articles.
--
-- Rationale
-- ---------
-- Admin writes are now routed through /api/admin/insights/* which use
-- the service-role client and bypass RLS (service_role is exempt from
-- RLS as a Postgres built-in on Supabase). The browser no longer
-- performs any privileged insights mutation and no longer needs the
-- permissive policy to succeed.
--
-- Inspected state before this migration (via pg_policies):
--
--   Policy "Allow all operations on insights"
--     PERMISSIVE, cmd=ALL, roles={public}, qual=true, with_check=true
--   Policy "Public can read published insights"
--     PERMISSIVE, cmd=SELECT, roles={public}, qual=(status='published')
--
-- Because "Allow all operations" is unrestricted, any client bearing
-- the anon key can INSERT/UPDATE/DELETE any row and SELECT draft rows.
-- That is the surface we are removing.
--
-- After this migration:
--
--   * Anon:          cannot INSERT/UPDATE/DELETE; cannot SELECT drafts.
--                    Can SELECT rows where status='published' only.
--   * Authenticated: same as anon unless separately allow-listed.
--   * Service role:  full access (Postgres built-in; unchanged).
--
-- Compatibility check performed before writing this migration:
--   * Every browser-facing read query already filters
--     `.eq('status', 'published')` — belt-and-braces.
--   * All privileged writes (list-all, insert, update, delete) now
--     go through server routes that use getSupabaseServiceClient().
--   * There are no triggers on public.insights.
--   * There were 0 draft rows at the time of writing, so this change
--     has no immediate visibility side effect on end users.
--
-- Storage RLS on the creator-images bucket is intentionally NOT
-- changed in this migration. The bucket is shared with the
-- public-facing creators/submit form, which depends on the current
-- anon INSERT policy. Tightening it belongs in a dedicated block
-- that also refactors creators/submit onto the same signed-upload
-- URL pattern the admin editor now uses.

BEGIN;

-- Guard: if the reader policy has been renamed or removed since
-- inspection, refuse to proceed — dropping the permissive policy
-- alone would then leave the table effectively unreadable to anon,
-- which would break /insights, /insights/[slug], the homepage
-- latest-3 and the sitemap. Better to fail loudly than silently
-- break production reads.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'insights'
      AND policyname = 'Public can read published insights'
  ) THEN
    RAISE EXCEPTION 'Expected policy "Public can read published insights" to exist on public.insights before tightening. Aborting.';
  END IF;
END $$;

DROP POLICY IF EXISTS "Allow all operations on insights" ON public.insights;

COMMIT;

-- Verification query (run separately after applying):
--
--   SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--   WHERE schemaname='public' AND tablename='insights';
--
-- Expected result: exactly one row —
--   "Public can read published insights" | SELECT | {public} | (status = 'published'::text) | NULL
