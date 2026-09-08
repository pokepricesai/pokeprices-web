-- 2026-09-06-eic-b2-editorial-projects.sql
--
-- EIC Block 2 — create the single table that backs Editorial HQ.
--
-- Design notes (see Block 2 report for the full rationale):
--   * Single table, per the block instructions. No separate
--     ideas / calendar / workflow tables.
--   * bigserial id — friendly integer URLs for an internal tool;
--     insights_id stays UUID because the referenced column is UUID.
--   * status and article_type are TEXT with app-level enums so we
--     can iterate on the vocabulary without another migration.
--   * "archived" is a status value, not a separate archived_at
--     timestamp — avoids two sources of truth.
--   * RLS enabled with NO policies. All access is via
--     /api/admin/editorial/* using the service-role client, matching
--     the posture we adopted for public.insights in Block 0B.
--   * insights_id FK with ON DELETE SET NULL so deleting an article
--     does not cascade-delete its editorial retrospective.
--   * No trigger for updated_at — the PATCH handler will set it
--     explicitly on every write. Simpler and testable.

BEGIN;

CREATE TABLE IF NOT EXISTS public.editorial_projects (
  id                bigserial PRIMARY KEY,
  title             text        NOT NULL,
  angle             text,
  article_type      text        NOT NULL DEFAULT 'evergreen',
  status            text        NOT NULL DEFAULT 'idea',
  priority          smallint    NOT NULL DEFAULT 3,
  target_publish_at date,
  notes             text,
  insights_id       uuid REFERENCES public.insights(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editorial_projects_status_idx
  ON public.editorial_projects (status);
CREATE INDEX IF NOT EXISTS editorial_projects_target_publish_idx
  ON public.editorial_projects (target_publish_at);
CREATE INDEX IF NOT EXISTS editorial_projects_insights_id_idx
  ON public.editorial_projects (insights_id);

ALTER TABLE public.editorial_projects ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies. Service role bypasses RLS.

COMMIT;
