-- migrations/2026-05-11-social-content-posts.sql
-- Content Studio table. Each row is one generated social post (Twitter +
-- Instagram). data_payload holds the picked cards/Pokémon/etc. so the
-- PNG renderer can rebuild the visual without re-running selection.
-- generated_options captures the user-controlled options (price tier,
-- visual style, time window etc.) for re-generation.

CREATE TABLE IF NOT EXISTS public.social_content_posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type      text NOT NULL,
  title              text,
  hook               text,
  data_payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  twitter_copy       text,
  instagram_caption  text,
  image_url          text,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'approved', 'rejected', 'used')),
  generated_options  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_content_posts_status_idx
  ON public.social_content_posts (status);

CREATE INDEX IF NOT EXISTS social_content_posts_template_type_idx
  ON public.social_content_posts (template_type);

CREATE INDEX IF NOT EXISTS social_content_posts_created_at_idx
  ON public.social_content_posts (created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS social_content_posts_updated_at ON public.social_content_posts;
CREATE TRIGGER social_content_posts_updated_at
  BEFORE UPDATE ON public.social_content_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: SELECT is public so the /api/content-studio/render route can read
-- a post id without needing a service-role key in the edge bundle. INSERT,
-- UPDATE, DELETE are unguarded (no policies) so only service-role can
-- write — admin actions go through the edge function or the service-role
-- supabase client.
ALTER TABLE public.social_content_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_content_posts_select_all" ON public.social_content_posts;
CREATE POLICY "social_content_posts_select_all"
  ON public.social_content_posts FOR SELECT USING (true);
