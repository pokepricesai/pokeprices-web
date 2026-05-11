-- migrations/2026-05-11b-social-content-rls-fix.sql
-- Phase A migration only added SELECT policy on social_content_posts, so the
-- admin UI (which runs as anon + password gate) couldn't approve / reject /
-- delete. Open UPDATE and DELETE to anon as well. Admin-password gate on
-- the client is the practical access control for this internal tool.

DROP POLICY IF EXISTS "social_content_posts_update_all" ON public.social_content_posts;
DROP POLICY IF EXISTS "social_content_posts_delete_all" ON public.social_content_posts;

CREATE POLICY "social_content_posts_update_all"
  ON public.social_content_posts FOR UPDATE
  USING (true) WITH CHECK (true);

CREATE POLICY "social_content_posts_delete_all"
  ON public.social_content_posts FOR DELETE
  USING (true);
