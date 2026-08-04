-- migrations/2026-08-05-fix-jp-printed-denominators.sql
--
-- Block 5A-W-51C — Japanese printed-denominator data correction for
-- the two sets CONFIRMED_MISMATCHed against the Bulbapedia reference
-- in reports/jp-printed-denominator-audit.md:
--
--   Japanese Battle Partners     stored /130 → printed base /100
--   Japanese Terastal Festival   stored /128 → printed base /187
--
-- Reuses the exact English schema conventions (no new column):
--
--   set_metadata.total_cards   — catalogue / row count. LEFT UNCHANGED.
--                                For English SV 151 this is 411
--                                (includes reverses); for the two JP
--                                sets it stays at 130 / 128 until a
--                                separate audit corrects the catalogue
--                                counts.
--   cards.set_printed_total    — printed denominator.  UPDATED.
--   cards.card_number_display  — composed as card_number || '/' || printed_total.
--                                REGENERATED for the affected rows.
--
-- Numerators are preserved exactly. Secret-rare rows whose numerator
-- exceeds the printed denominator (Battle Partners 101–132 over /100,
-- Terastal Festival 188–237 over /187) are LEGITIMATE and are the
-- entire reason the underlying data was wrong: they inflated the
-- catalogue count that was then misused as the denominator.
--
-- Scoping: every UPDATE is filtered by `set_name = '...'` AND
-- `language = 'jp'` AND `card_number IS NOT NULL`. English rows
-- cannot be affected. Sealed products (which have card_number = NULL)
-- are left alone.
--
-- Preflight + postflight DO blocks fail the transaction if reality
-- has drifted since the audit was generated.

BEGIN;

-- ── Preflight: assert both sets are in the expected wrong state ──
DO $$
DECLARE
  bp_stored_denoms text[];
  tf_stored_denoms text[];
  bp_row_count int;
  tf_row_count int;
BEGIN
  SELECT ARRAY_AGG(DISTINCT set_printed_total ORDER BY set_printed_total), COUNT(*) INTO bp_stored_denoms, bp_row_count
    FROM cards WHERE set_name = 'Japanese Battle Partners' AND language = 'jp' AND card_number IS NOT NULL;
  IF bp_stored_denoms IS DISTINCT FROM ARRAY['130']::text[] THEN
    RAISE EXCEPTION 'Preflight failed for Battle Partners: expected single stored denom [130], got %', bp_stored_denoms;
  END IF;
  IF bp_row_count < 100 OR bp_row_count > 140 THEN
    RAISE EXCEPTION 'Preflight failed for Battle Partners: expected 100..140 card rows with a number, got %', bp_row_count;
  END IF;

  SELECT ARRAY_AGG(DISTINCT set_printed_total ORDER BY set_printed_total), COUNT(*) INTO tf_stored_denoms, tf_row_count
    FROM cards WHERE set_name = 'Japanese Terastal Festival' AND language = 'jp' AND card_number IS NOT NULL;
  IF tf_stored_denoms IS DISTINCT FROM ARRAY['128']::text[] THEN
    RAISE EXCEPTION 'Preflight failed for Terastal Festival: expected single stored denom [128], got %', tf_stored_denoms;
  END IF;
  IF tf_row_count < 200 OR tf_row_count > 500 THEN
    RAISE EXCEPTION 'Preflight failed for Terastal Festival: expected 200..500 card rows with a number, got %', tf_row_count;
  END IF;
END $$;

-- ── Japanese Battle Partners → /100 ──────────────────────
UPDATE cards
   SET set_printed_total = '100',
       card_number_display = card_number || '/100'
 WHERE set_name = 'Japanese Battle Partners'
   AND language = 'jp'
   AND card_number IS NOT NULL;

-- ── Japanese Terastal Festival → /187 ────────────────────
UPDATE cards
   SET set_printed_total = '187',
       card_number_display = card_number || '/187'
 WHERE set_name = 'Japanese Terastal Festival'
   AND language = 'jp'
   AND card_number IS NOT NULL;

-- ── Postflight: verify the target rows now show the printed base ──
DO $$
DECLARE
  bp_denom text;
  tf_denom text;
  reshiram_display text;
BEGIN
  SELECT DISTINCT set_printed_total INTO bp_denom FROM cards
    WHERE set_name = 'Japanese Battle Partners' AND language = 'jp' AND card_number IS NOT NULL;
  IF bp_denom <> '100' THEN
    RAISE EXCEPTION 'Postflight failed: Battle Partners set_printed_total is % after update, expected 100', bp_denom;
  END IF;

  SELECT DISTINCT set_printed_total INTO tf_denom FROM cards
    WHERE set_name = 'Japanese Terastal Festival' AND language = 'jp' AND card_number IS NOT NULL;
  IF tf_denom <> '187' THEN
    RAISE EXCEPTION 'Postflight failed: Terastal Festival set_printed_total is % after update, expected 187', tf_denom;
  END IF;

  -- The scan that motivated this block: N's Reshiram #109 must now
  -- display as "109/100" everywhere.
  SELECT card_number_display INTO reshiram_display FROM cards
    WHERE set_name = 'Japanese Battle Partners' AND card_name = 'N''s Reshiram #109' AND language = 'jp';
  IF reshiram_display <> '109/100' THEN
    RAISE EXCEPTION 'Postflight failed: N''s Reshiram displays as % after update, expected 109/100', reshiram_display;
  END IF;
END $$;

-- ── English cross-check: no English row was touched ─────
-- Purely informational — the UPDATEs above are language-scoped.
--   SELECT COUNT(*) FROM cards WHERE language = 'en' AND set_printed_total = '100' AND updated_at > now() - interval '1 minute';
--   (should be zero for any updated_at column if one existed)

COMMIT;

-- ── Verification queries (paste after apply) ────────────
--
--   -- N's Reshiram: must show 109/100
--   SELECT card_name, card_number, card_number_display, set_printed_total
--     FROM cards WHERE set_name = 'Japanese Battle Partners' AND card_number = '109';
--
--   -- Battle Partners #102 (Articuno): must show 102/100
--   SELECT card_name, card_number, card_number_display, set_printed_total
--     FROM cards WHERE set_name = 'Japanese Battle Partners' AND card_number = '102';
--
--   -- Battle Partners secret #132: must still show 132/100 (numerator > denominator OK)
--   SELECT card_name, card_number, card_number_display, set_printed_total
--     FROM cards WHERE set_name = 'Japanese Battle Partners' AND card_number = '132';
--
--   -- Scan probe: 109/100 for JP should now return N's Reshiram at `full` 0.98
--   -- (no denominator_conflict, because stored + scanned agree).
--   SELECT card_slug, card_name, set_name, match_quality, confidence, denominator_conflict
--     FROM scan_card_match('109/100', NULL, NULL, NULL, FALSE, 'jp') LIMIT 5;
--
--   -- Ruler of the Black Flame stayed /108 (CONFIRMED_MATCH, untouched):
--   SELECT DISTINCT set_printed_total FROM cards
--     WHERE set_name = 'Japanese Ruler of the Black Flame' AND language = 'jp';
--
--   -- English SV 151 stayed /165 (untouched):
--   SELECT DISTINCT set_printed_total FROM cards
--     WHERE set_name = 'Scarlet & Violet 151' AND language = 'en';

-- ── Rollback (paste separately if reverting) ────────────
--
-- BEGIN;
-- UPDATE cards
--    SET set_printed_total = '130',
--        card_number_display = card_number || '/130'
--  WHERE set_name = 'Japanese Battle Partners'
--    AND language = 'jp'
--    AND card_number IS NOT NULL;
-- UPDATE cards
--    SET set_printed_total = '128',
--        card_number_display = card_number || '/128'
--  WHERE set_name = 'Japanese Terastal Festival'
--    AND language = 'jp'
--    AND card_number IS NOT NULL;
-- COMMIT;
