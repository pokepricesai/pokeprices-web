-- EIC Block 6 — Editorial Research & Evidence Engine
--
-- One row per editorial_project, holding:
--   * a deterministic evidence pack (JSONB snapshot of the exact
--     data used to support the article; frozen at build time)
--   * an AI Research Analyst interpretation of that evidence (JSONB)
--   * an explicit human approval gate (approved_at + approved_by)
--
-- Design choices:
--   * A single table with JSONB columns rather than five relational
--     tables (research_runs / evidence_items / facts / sources). The
--     evidence pack is versioned by snapshot, not sliced across
--     rows; storing it as one JSONB keeps it atomic and easy to
--     reason about. Later blocks can introduce views if needed.
--   * UNIQUE (project_id): exactly one current research pack per
--     project. Rebuilds replace the pack in place; historical
--     versions can be added in a future block if we need them.
--   * RLS enabled with no policies → default deny → only the
--     service_role client (never the anon key) can read or write.
--     All access goes through admin-authed server routes.

CREATE TABLE IF NOT EXISTS public.editorial_research (
  id             bigserial PRIMARY KEY,
  project_id     bigint      NOT NULL REFERENCES public.editorial_projects(id) ON DELETE CASCADE,
  status         text        NOT NULL DEFAULT 'not_started'
                             CHECK (status IN ('not_started','gathering','review_required','blocked','approved')),
  evidence_json  jsonb,
  analyst_json   jsonb,
  approved_at    timestamptz,
  approved_by    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT editorial_research_one_per_project UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS editorial_research_project_id_idx
  ON public.editorial_research (project_id);

CREATE INDEX IF NOT EXISTS editorial_research_status_idx
  ON public.editorial_research (status);

-- RLS: default deny. Service role bypasses RLS; anon/authenticated
-- clients get zero rows. Admin routes must use the service-role
-- client to read or write this table.
ALTER TABLE public.editorial_research ENABLE ROW LEVEL SECURITY;

-- updated_at trigger — cheap, deterministic, matches the pattern
-- editorial_projects uses.
CREATE OR REPLACE FUNCTION public.tg_editorial_research_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS editorial_research_touch_updated_at ON public.editorial_research;
CREATE TRIGGER editorial_research_touch_updated_at
  BEFORE UPDATE ON public.editorial_research
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_editorial_research_touch_updated_at();
