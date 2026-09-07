-- EIC Block 7 — Article Studio draft storage
--
-- One JSONB column per editorial project holding the current Studio
-- draft. The draft contains a headline, intro, SEO fields, a hero
-- image, article settings, and a TipTap document tree in a stable
-- shape. There is no revision history yet; a single draft is
-- overwritten in place by autosave.
--
-- The existing `insights.body_json` schema is deliberately NOT
-- touched. Studio publishing (later block) will convert this draft
-- into the existing insights body block model.

ALTER TABLE public.editorial_projects
  ADD COLUMN IF NOT EXISTS studio_json jsonb;

COMMENT ON COLUMN public.editorial_projects.studio_json IS
  'Article Studio draft (TipTap doc + settings). One current draft per project. Converted to insights body_json at publish time.';
