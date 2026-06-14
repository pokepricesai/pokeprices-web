-- 2026-06-14 — social_content_posts: remove anonymous write capability (Block 1A)
-- ============================================================================
-- BEFORE
-- ------
-- Migration `2026-05-11b-social-content-rls-fix.sql` added:
--
--   CREATE POLICY social_content_posts_update_all
--     ON public.social_content_posts FOR UPDATE USING (true) WITH CHECK (true);
--   CREATE POLICY social_content_posts_delete_all
--     ON public.social_content_posts FOR DELETE USING (true);
--
-- These policies allowed ANY anon-key client (i.e. any browser) to update
-- or delete any row. The /admin/content-studio UI relied on a client-side
-- password check (NEXT_PUBLIC_ADMIN_PASSWORD) which is itself shipped in
-- the browser bundle.
--
-- AFTER
-- -----
-- Anonymous and authenticated end users can no longer update or delete
-- rows. Writes happen only via the service-role client, used by:
--   * Edge function `content-studio-generate` (existing) — inserts new
--     posts after generation.
--   * New Next.js route `/api/admin/content-studio/posts` (Block 1A) —
--     handles PATCH (status) and DELETE for the admin UI. The route
--     verifies the caller is signed in via Supabase Auth AND that the
--     caller's email is in the server-only ADMIN_ALLOWED_EMAILS env var
--     before invoking the service-role client.
--
-- Public SELECT is preserved because /api/content-studio/render reads
-- post rows to render PNGs and currently uses the anon key. Nothing in
-- the rows is user-sensitive.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- DO NOT roll this migration back by restoring the open USING (true)
-- policies. They are insecure. If a hot-fix rollback is required while
-- the new server route is unavailable, prefer reverting the application
-- code change (`src/app/admin/content-studio/ContentStudioClient.tsx`)
-- and performing one-off mutations via the Supabase SQL editor under the
-- service role.
--
-- If you nonetheless must restore the previous behaviour temporarily,
-- run the SQL below in a private session and revert as soon as possible:
--
--   -- WARNING: restores public-write access to social_content_posts.
--   -- Anyone with the anon key (i.e. any visitor) can mutate or delete
--   -- any row. Only run with a documented time-bound exception.
--   --
--   -- CREATE POLICY "social_content_posts_update_all"
--   --   ON public.social_content_posts FOR UPDATE
--   --   USING (true) WITH CHECK (true);
--   -- CREATE POLICY "social_content_posts_delete_all"
--   --   ON public.social_content_posts FOR DELETE
--   --   USING (true);
-- ============================================================================

DROP POLICY IF EXISTS "social_content_posts_update_all" ON public.social_content_posts;
DROP POLICY IF EXISTS "social_content_posts_delete_all" ON public.social_content_posts;

-- Public SELECT remains. Confirm it is still present; do not recreate it
-- here because that would silently mask the case where it had already
-- been removed by an operator.
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'social_content_posts'
      AND policyname = 'social_content_posts_select_all'
  ) THEN
    RAISE NOTICE '[social_content_posts] NOTE: public SELECT policy not present. /api/content-studio/render requires it. Re-apply migration 2026-05-11-social-content-posts.sql if rendering fails.';
  END IF;
END
$check$;
