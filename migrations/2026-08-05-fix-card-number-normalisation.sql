-- migrations/2026-08-05-fix-card-number-normalisation.sql
--
-- Block 5A-W-51B.1 — production fix for a silent card-number
-- normalisation bug that mis-matches ~15.7% of the entire cards
-- catalogue (10,184 / 64,813 rows scanned in prod at commit time).
--
-- ── Bug ────────────────────────────────────────────────
--
-- migrations/2026-05-14b-scan-match-v2.sql installed
-- _normalize_card_number() with the regex
--   regexp_replace(..., '0+([0-9])', '\1', 'g')
-- The docstring said "strip leading zeros from each numeric run", but
-- the pattern has no boundary anchor, so it strips ANY zero-then-digit
-- substring anywhere:
--
--   "102"       -> "12"        (should stay "102")
--   "100"       -> "10"        (should stay "100")
--   "102/100"   -> "12/10"     collides with "12/100" -> "12/10"
--   "200/100"   -> "20/10"     collides with any /20 card
--   "SWSH-001"  -> "swsh-1"    (correct — leading zero)
--   "030/086"   -> "30/86"     (correct — leading zeros both sides)
--   "TG12/TG30" -> "tg12/tg30" (correct — no leading zeros)
--
-- Empirical proof (probed live via scan_card_match on 2026-08-05):
--   Scanning "20/10" returns every card stored as N/100 as `full`
--   match_quality at 0.98 confidence — because both normalise to "20/10".
--
-- ── Fix ────────────────────────────────────────────────
--
-- Anchor the zero-run to the start of a numeric component: the string
-- start OR immediately after a non-digit (typically "/"). This
-- preserves internal zeros ("102") while still stripping leading zeros
-- ("012", "030", "SWSH-001").
--
-- Regex: `(^|[^0-9])0+([0-9])`
--   \1 = capture of start-anchor / non-digit char (preserved)
--   \2 = capture of digit AFTER the zero run (preserved)
--   replacement: \1\2  (the zero run itself is dropped)
--
-- ── Scope of this migration ────────────────────────────
--
-- * Replaces _normalize_card_number(text) only.
-- * REINDEXes the two expression indexes that use it, so the planner
--   ranks against the corrected values (Postgres re-evaluates the
--   IMMUTABLE function on the fly, so this is a safety belt against
--   any cached plan; not strictly required for correctness).
-- * Does NOT touch scan_card_match — the 51B body with p_language
--   and denominator_conflict remains exactly as it is in prod.
-- * Does NOT touch any table row. No cards.card_number_display or
--   set_metadata.total_cards is updated by this file. The separate
--   dry-run under migrations/dry-run/ handles the JP denominator
--   corrections after their reference values are cross-verified.
--
-- ── Preflight + postflight ─────────────────────────────
--
-- The preflight DO block asserts that the buggy regex is still live so
-- we fail loudly if someone else has already replaced the function.
-- The postflight block verifies every required example from the block
-- spec and fails the transaction if any is wrong.
--
-- ── Deployment order ───────────────────────────────────
--
-- 1. Apply this migration in the Supabase SQL Editor. It is fully
--    backward-compatible: the function signature is unchanged, all
--    call sites (scan_card_match, expression indexes) keep working,
--    and no data is rewritten.
-- 2. Rerun the scan_card_match smoke probe from the block spec —
--    102/100 must no longer collide with 12/100.
-- 3. The JP denominator data correction (Battle Partners /130 → /100)
--    is a SEPARATE migration under migrations/dry-run/ that requires
--    its own review. Do not apply it as part of this block.
--
-- Reversible via the rollback block at the bottom.

BEGIN;

-- ── Preflight: confirm the buggy regex is still live ─────
DO $$
DECLARE
  bug_check text;
BEGIN
  SELECT _normalize_card_number('102') INTO bug_check;
  IF bug_check <> '12' THEN
    RAISE EXCEPTION 'Preflight failed: _normalize_card_number(''102'') returned %; expected the buggy value ''12''. Someone may have already fixed this. Rollback this migration.', bug_check;
  END IF;
END $$;

-- ── The fix ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _normalize_card_number(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN s IS NULL OR trim(s) = '' THEN NULL
    ELSE regexp_replace(
      lower(regexp_replace(s, '\s+', '', 'g')),
      '(^|[^0-9])0+([0-9])', '\1\2', 'g'
    )
  END;
$$;

-- Grants: CREATE OR REPLACE FUNCTION preserves the existing grants on
-- _normalize_card_number, so no explicit GRANT is required. If the
-- function had no grants pre-51B.1 (it's a helper used from within
-- scan_card_match which itself is granted to anon/authenticated/
-- service_role), it still has none. That is the desired state — the
-- helper is called internally by the granted RPC, not directly by
-- clients.

-- ── Rebuild dependent expression indexes ────────────────
-- Two indexes reference _normalize_card_number in their expression.
-- Postgres re-evaluates the IMMUTABLE function on the fly, so this
-- REINDEX is not strictly required for correctness. It is included as
-- a safety belt against any cached execution plan and to make the
-- rollout observable in pg_stat_user_indexes.
REINDEX INDEX idx_cards_norm_card_number;
REINDEX INDEX idx_cards_norm_card_number_display;

-- ── Postflight: every required example from the block spec ─
DO $$
DECLARE
  v text;
BEGIN
  -- Leading zeros stripped
  SELECT _normalize_card_number('001')       INTO v; IF v <> '1'         THEN RAISE EXCEPTION 'FAIL: 001 -> %', v; END IF;
  SELECT _normalize_card_number('012')       INTO v; IF v <> '12'        THEN RAISE EXCEPTION 'FAIL: 012 -> %', v; END IF;
  SELECT _normalize_card_number('030/086')   INTO v; IF v <> '30/86'     THEN RAISE EXCEPTION 'FAIL: 030/086 -> %', v; END IF;
  SELECT _normalize_card_number('SWSH-001')  INTO v; IF v <> 'swsh-1'    THEN RAISE EXCEPTION 'FAIL: SWSH-001 -> %', v; END IF;
  -- Internal zeros preserved
  SELECT _normalize_card_number('102')       INTO v; IF v <> '102'       THEN RAISE EXCEPTION 'FAIL: 102 -> %', v; END IF;
  SELECT _normalize_card_number('100')       INTO v; IF v <> '100'       THEN RAISE EXCEPTION 'FAIL: 100 -> %', v; END IF;
  SELECT _normalize_card_number('102/100')   INTO v; IF v <> '102/100'   THEN RAISE EXCEPTION 'FAIL: 102/100 -> %', v; END IF;
  SELECT _normalize_card_number('12/100')    INTO v; IF v <> '12/100'    THEN RAISE EXCEPTION 'FAIL: 12/100 -> %', v; END IF;
  SELECT _normalize_card_number('200/100')   INTO v; IF v <> '200/100'   THEN RAISE EXCEPTION 'FAIL: 200/100 -> %', v; END IF;
  SELECT _normalize_card_number('20/10')     INTO v; IF v <> '20/10'     THEN RAISE EXCEPTION 'FAIL: 20/10 -> %', v; END IF;
  SELECT _normalize_card_number('TG12/TG30') INTO v; IF v <> 'tg12/tg30' THEN RAISE EXCEPTION 'FAIL: TG12/TG30 -> %', v; END IF;
  -- Distinctness (pairs must NOT collide)
  IF _normalize_card_number('102')     = _normalize_card_number('12')      THEN RAISE EXCEPTION 'FAIL: 102 collides with 12'; END IF;
  IF _normalize_card_number('102/100') = _normalize_card_number('12/100')  THEN RAISE EXCEPTION 'FAIL: 102/100 collides with 12/100'; END IF;
  IF _normalize_card_number('200/100') = _normalize_card_number('20/10')   THEN RAISE EXCEPTION 'FAIL: 200/100 collides with 20/10'; END IF;
END $$;

COMMIT;

-- ── Block-spec smoke queries (informational — paste after apply) ──
--
--   SELECT _normalize_card_number('102')     AS should_be_102;
--   SELECT _normalize_card_number('12')      AS should_be_12;
--   SELECT _normalize_card_number('102/100') AS should_be_102_100;
--   SELECT _normalize_card_number('12/100')  AS should_be_12_100;
--
--   -- Must return FALSE:
--   SELECT _normalize_card_number('102/100') = _normalize_card_number('12/100');
--
--   -- Battle Partners scan — Articuno stored as 102/130 should appear
--   -- as a `numerator` match with denominator_conflict=true (until the
--   -- separate BP data correction is applied and it becomes `full`).
--   -- Cards stored as 12/100 must NOT appear.
--   SELECT card_slug, card_name, set_name, match_quality, confidence,
--          language, language_match, denominator_conflict, card_number_display
--     FROM scan_card_match('102/100', NULL, NULL, NULL, FALSE, 'jp')
--    LIMIT 20;

-- ── Rollback ────────────────────────────────────────────
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION _normalize_card_number(s text)
-- RETURNS text LANGUAGE sql IMMUTABLE AS $$
--   SELECT CASE
--     WHEN s IS NULL OR trim(s) = '' THEN NULL
--     ELSE regexp_replace(
--       lower(regexp_replace(s, '\s+', '', 'g')),
--       '0+([0-9])', '\1', 'g'
--     )
--   END;
-- $$;
-- REINDEX INDEX idx_cards_norm_card_number;
-- REINDEX INDEX idx_cards_norm_card_number_display;
-- COMMIT;
