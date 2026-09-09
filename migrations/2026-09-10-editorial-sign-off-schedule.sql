-- migrations/2026-09-10-editorial-sign-off-schedule.sql
--
-- Simplified-HQ scheduling: adds sign-off + auto-publish fields to
-- editorial_projects.
--
--   * signed_off_at       — when the admin explicitly signed off the
--                           current article draft. Cleared automatically
--                           whenever material CMS content changes.
--   * signed_off_by       — the admin email that signed off. Purely
--                           audit; nullable.
--   * scheduled_publish_at — target UTC timestamp for the automatic
--                           publisher cron. NULL means not scheduled.
--                           Retained across sign-off clears so an edit
--                           does not silently forget the scheduling
--                           intent.
--
-- The existing target_publish_at column is left alone. It was an
-- editorial planning date, not an automated publication timestamp,
-- and reusing it here would confuse the two semantics.
--
-- Run in the Supabase SQL Editor. Idempotent.

BEGIN;

ALTER TABLE public.editorial_projects
  ADD COLUMN IF NOT EXISTS signed_off_at        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS signed_off_by        TEXT        NULL,
  ADD COLUMN IF NOT EXISTS scheduled_publish_at TIMESTAMPTZ NULL;

-- Cron work list. The publisher scans for signed-off + scheduled +
-- unpublished projects whose scheduled_publish_at has passed. Small
-- index on the timestamp keeps that scan cheap even as the projects
-- table grows.
CREATE INDEX IF NOT EXISTS editorial_projects_scheduled_publish_at_idx
  ON public.editorial_projects (scheduled_publish_at)
  WHERE scheduled_publish_at IS NOT NULL;

COMMIT;
