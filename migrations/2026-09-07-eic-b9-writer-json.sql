-- EIC Block 9 — AI Writer metadata storage.
--
-- One additive JSONB column per editorial project holding the
-- writer's structured plan (claim trace, block intents, generation
-- cost, fact-check result, checked studio hash).
--
-- The public Studio draft continues to live in
-- editorial_projects.studio_json. `writer_json` is separate so
-- hidden metadata never leaks into the published article body.

ALTER TABLE public.editorial_projects
  ADD COLUMN IF NOT EXISTS writer_json jsonb;

COMMENT ON COLUMN public.editorial_projects.writer_json IS
  'AI Writer metadata: claim trace, block intents, fact check result, checkedStudioHash, generation cost. Never rendered publicly.';
