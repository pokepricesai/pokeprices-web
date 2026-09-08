-- EIC Block 10 — atomic publish/prepare/unpublish RPC.
--
-- One SECURITY DEFINER function that owns every mutation across
-- insights + editorial_projects for the EIC publication lifecycle.
-- Kept narrowly scoped: three actions, no generic workflow engine.
--
-- Actions (p_action):
--   'draft'       — upsert the insights row with status='draft';
--                   never touches published_at; links project.insights_id.
--   'published'   — upsert with status='published'; sets published_at
--                   on FIRST publication; preserves it on subsequent
--                   updates; nudges project.status='published'.
--   'unpublished' — flips a linked article back to status='draft';
--                   preserves published_at on the row for history;
--                   project.status='drafting'.
--
-- Slug uniqueness is enforced inside the function so a concurrent
-- publish cannot silently collide.

CREATE OR REPLACE FUNCTION public.eic_finalize_article(
  p_project_id bigint,
  p_action     text,
  p_payload    jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_insights_id uuid;
  v_prev_status text;
  v_prev_pub    timestamptz;
  v_slug        text;
  v_result      jsonb;
BEGIN
  IF p_action NOT IN ('draft', 'published', 'unpublished') THEN
    RAISE EXCEPTION 'invalid action: %', p_action USING ERRCODE = '22023';
  END IF;

  v_slug := COALESCE(p_payload->>'slug', '');
  IF v_slug = '' THEN RAISE EXCEPTION 'slug required' USING ERRCODE = '22004'; END IF;

  SELECT insights_id INTO v_insights_id
    FROM public.editorial_projects
   WHERE id = p_project_id
   FOR UPDATE;

  IF v_insights_id IS NULL AND p_action = 'unpublished' THEN
    RAISE EXCEPTION 'cannot unpublish: project has no linked insight' USING ERRCODE = '22023';
  END IF;

  -- Slug uniqueness (excluding the currently linked row).
  IF EXISTS (
    SELECT 1 FROM public.insights
     WHERE slug = v_slug
       AND (v_insights_id IS NULL OR id <> v_insights_id)
  ) THEN
    RAISE EXCEPTION 'slug already exists: %', v_slug USING ERRCODE = '23505';
  END IF;

  IF v_insights_id IS NULL THEN
    -- First-time insert. Use draft or published as requested.
    INSERT INTO public.insights (
      slug, headline, intro, theme, theme_label,
      meta_title, meta_description, hero_image_query,
      body_json, status, image_url, author, read_time_mins,
      seo_title, seo_description, card_refs, set_refs,
      published_at
    )
    VALUES (
      v_slug,
      p_payload->>'headline',
      p_payload->>'intro',
      NULLIF(p_payload->>'theme', ''),
      COALESCE(p_payload->>'theme_label', ''),
      COALESCE(p_payload->>'meta_title', ''),
      COALESCE(p_payload->>'meta_description', ''),
      COALESCE(p_payload->>'hero_image_query', ''),
      p_payload->'body_json',
      CASE WHEN p_action = 'published' THEN 'published' ELSE 'draft' END,
      NULLIF(p_payload->>'image_url', ''),
      NULLIF(p_payload->>'author', ''),
      NULLIF(p_payload->>'read_time_mins', '')::int,
      NULLIF(p_payload->>'seo_title', ''),
      NULLIF(p_payload->>'seo_description', ''),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'card_refs')), '{}'::text[]),
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'set_refs')),  '{}'::text[]),
      CASE WHEN p_action = 'published' THEN now() ELSE NULL END
    )
    RETURNING id INTO v_insights_id;
  ELSE
    -- Update the existing row.
    SELECT status, published_at INTO v_prev_status, v_prev_pub
      FROM public.insights
     WHERE id = v_insights_id
     FOR UPDATE;

    UPDATE public.insights SET
      slug             = v_slug,
      headline         = p_payload->>'headline',
      intro            = p_payload->>'intro',
      theme            = NULLIF(p_payload->>'theme', ''),
      theme_label      = COALESCE(p_payload->>'theme_label', theme_label),
      meta_title       = COALESCE(p_payload->>'meta_title', meta_title),
      meta_description = COALESCE(p_payload->>'meta_description', meta_description),
      hero_image_query = COALESCE(p_payload->>'hero_image_query', hero_image_query),
      body_json        = COALESCE(p_payload->'body_json', body_json),
      status           = CASE
                           WHEN p_action = 'published'   THEN 'published'
                           WHEN p_action = 'unpublished' THEN 'draft'
                           ELSE 'draft'
                         END,
      image_url        = NULLIF(p_payload->>'image_url', ''),
      author           = NULLIF(p_payload->>'author', ''),
      read_time_mins   = NULLIF(p_payload->>'read_time_mins', '')::int,
      seo_title        = NULLIF(p_payload->>'seo_title', ''),
      seo_description  = NULLIF(p_payload->>'seo_description', ''),
      card_refs        = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'card_refs')), card_refs),
      set_refs         = COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'set_refs')),  set_refs),
      published_at     = CASE
                           WHEN p_action = 'published' AND v_prev_pub IS NULL THEN now()
                           ELSE v_prev_pub
                         END
    WHERE id = v_insights_id;
  END IF;

  -- Project linkage + status transition.
  UPDATE public.editorial_projects
     SET insights_id = v_insights_id,
         status = CASE
                    WHEN p_action = 'published'   THEN 'published'
                    WHEN p_action = 'unpublished' THEN 'drafting'
                    ELSE status
                  END,
         updated_at = now()
   WHERE id = p_project_id;

  v_result := jsonb_build_object(
    'insights_id', v_insights_id,
    'slug',        v_slug,
    'action',      p_action
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.eic_finalize_article(bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eic_finalize_article(bigint, text, jsonb) TO service_role;
