-- migrations/2026-08-05-fix-jp-printed-denominators-second-batch.sql
--
-- Block 5A-W-51D.1 — hardened second batch of Japanese printed-
-- denominator corrections. Every assertion is per-set, sourced from
-- reports/jp-second-batch-preflight.json (Block 5A-W-51D.1 inventory).
--
-- Active scope: 35 APPLY_SAFE Japanese sets, exactly 5,351 non-sealed
-- numbered card rows (measured live 2026-08-05; supersedes the
-- "5,833" figure in an earlier 51D report which was a computational
-- error), zero sealed rows touched, zero NULL/blank card numbers,
-- zero NULL is_sealed, zero unexpected current denominators, zero
-- multi-denominator sets.
--
-- Held from update: 13 HOLD_AGGREGATE_OR_SPLIT sets (Black Bolt +
-- White Flare — paired-release aggregates — plus 11 vintage-catalogue
-- aggregates listed in the postflight cross-checks below).

BEGIN;

-- ── Expectations table ────────────────────────────────
-- One row per active set. old_denom is the value every non-sealed
-- numbered card in the set is currently stored under. new_denom is
-- the sourced Bulbapedia printed base. expected_ns_num_count is the
-- 51D.1 inventory count (measured 2026-08-05).

CREATE TEMP TABLE _jp51d1_expectations (
  set_name                text PRIMARY KEY,
  old_denom               text NOT NULL,
  new_denom               text NOT NULL,
  expected_ns_num_count   integer NOT NULL
);

INSERT INTO _jp51d1_expectations (set_name, old_denom, new_denom, expected_ns_num_count) VALUES
  ('Japanese Abyss Eye',                    '118', '81',  118),
  ('Japanese Glory of Team Rocket',         '132', '98',  132),
  ('Japanese Nihil Zero',                   '117', '80',  117),
  ('Japanese Inferno X',                    '116', '80',  116),
  ('Japanese Wild Force',                   '100', '71',  100),
  ('Japanese Crimson Haze',                 '71',  '66',  96),
  ('Japanese Mega Brave',                   '92',  '63',  92),
  ('Japanese Mega Dream ex',                '250', '193', 487),
  ('Japanese Mega Symphonia',               '92',  '63',  92),
  ('Japanese Night Wanderer',               '66',  '64',  95),
  ('Japanese Stellar Miracle',              '100', '102', 135),
  ('Japanese Super Electric Breaker',       '71',  '106', 139),
  ('Japanese Paradise Dragona',             '63',  '64',  94),
  ('Japanese VSTAR Universe',               '262', '172', 351),
  ('Japanese Battle Region',                '70',  '67',  135),
  ('Japanese Paradigm Trigger',             '100', '98',  126),
  ('Japanese Remix Bout',                   '70',  '64',  80),
  ('Japanese Super-Burst Impact',           '94',  '95',  111),
  ('Japanese Awakening Psychic King',       '51',  '78',  176),
  ('Japanese GX Battle Boost',              '125', '114', 126),
  ('Japanese Bandit Ring',                  '84',  '81',  194),
  ('Japanese Wild Blaze',                   '90',  '80',  179),
  ('Japanese EX Battle Boost',              '99',  '93',  224),
  ('Japanese Rising Fist',                  '88',  '96',  210),
  ('Japanese Megalo Cannon',                '86',  '76',  172),
  ('Japanese Plasma Gale',                  '79',  '70',  158),
  ('Japanese Cold Flare',                   '65',  '59',  130),
  ('Japanese Red Flash',                    '65',  '59',  129),
  ('Japanese Rocket Gang Strikes Back',     '85',  '84',  167),
  ('Japanese Ninja Spinner',                '120', '83',  120),
  ('Japanese Wind from the Sea',            '90',  '87',  180),
  ('Japanese Reviving Legends',             '81',  '80',  187),
  ('Japanese Split Earth',                  '91',  '88',  182),
  ('Japanese Mysterious Mountains',         '91',  '88',  183),
  ('Japanese 2002 McDonald''s',             '18',  '30',  18);

-- ── Snapshot: every targeted row's id + card_number pre-write ────
-- Used by the postflight to prove no numerator was altered and no
-- row identity was lost.

CREATE TEMP TABLE _jp51d1_pre_snapshot AS
  SELECT c.id, c.set_name, c.card_number, c.set_printed_total, c.card_number_display
    FROM cards c
    JOIN _jp51d1_expectations e ON c.set_name = e.set_name
   WHERE c.language = 'jp'
     AND c.is_sealed = false
     AND NULLIF(trim(c.card_number), '') IS NOT NULL;

-- Sealed snapshot: prove no sealed row is touched by the migration.
CREATE TEMP TABLE _jp51d1_pre_sealed AS
  SELECT c.id, c.set_name, c.set_printed_total, c.card_number_display, c.card_number
    FROM cards c
    JOIN _jp51d1_expectations e ON c.set_name = e.set_name
   WHERE c.is_sealed = true;

-- Held-set snapshot: prove the 13 HOLD_AGGREGATE_OR_SPLIT sets stay
-- unchanged by this migration.
CREATE TEMP TABLE _jp51d1_pre_held AS
  SELECT c.id, c.set_name, c.set_printed_total, c.card_number_display, c.card_number
    FROM cards c
   WHERE c.language = 'jp'
     AND c.set_name IN (
       'Japanese White Flare', 'Japanese Black Bolt',
       'Japanese Holon Phantom', 'Japanese Challenge from the Darkness',
       'Japanese Crossing the Ruins', 'Japanese Darkness, and to Light',
       'Japanese Secret of the Lakes', 'Japanese Awakening Legends',
       'Japanese Leaders'' Stadium', 'Japanese Gold, Silver, New World',
       'Japanese Mystery of the Fossils', 'Japanese Rocket Gang',
       'Japanese Expansion Pack'
     );

-- Cross-check snapshot: rows that MUST retain specific values
-- (already-correct sets + English SV 151).
CREATE TEMP TABLE _jp51d1_pre_crosscheck AS
  SELECT c.id, c.set_name, c.language, c.set_printed_total
    FROM cards c
   WHERE (c.language = 'jp' AND c.set_name IN (
           'Japanese Battle Partners',
           'Japanese Terastal Festival',
           'Japanese Ruler of the Black Flame',
           'Japanese Tag All Stars'))
      OR (c.language = 'en' AND c.set_name = 'Scarlet & Violet 151');

-- ── Preflight: 11 assertions per set + combined total ────────────

DO $$
DECLARE
  e             record;
  actual_count  integer;
  actual_denoms text[];
  sealed_null_count integer;
  cn_null_count integer;
  cn_empty_count integer;
  combined_total integer;
BEGIN
  FOR e IN SELECT * FROM _jp51d1_expectations LOOP
    -- 1. Set exists AND language = jp AND non-sealed numbered row count matches
    -- 2. Exactly one distinct current denominator on the targeted rows
    SELECT COUNT(*), ARRAY_AGG(DISTINCT set_printed_total ORDER BY set_printed_total)
      INTO actual_count, actual_denoms
      FROM cards
     WHERE set_name = e.set_name
       AND language = 'jp'
       AND is_sealed = false
       AND NULLIF(trim(card_number), '') IS NOT NULL;

    IF actual_count = 0 THEN
      RAISE EXCEPTION 'Preflight FAILED for %: zero non-sealed numbered rows — set may not exist in cards under this exact set_name', e.set_name;
    END IF;

    IF actual_count <> e.expected_ns_num_count THEN
      RAISE EXCEPTION 'Preflight FAILED for %: expected % non-sealed numbered rows, got %', e.set_name, e.expected_ns_num_count, actual_count;
    END IF;

    IF actual_denoms IS DISTINCT FROM ARRAY[e.old_denom]::text[] THEN
      RAISE EXCEPTION 'Preflight FAILED for %: expected single current denom [%], got %', e.set_name, e.old_denom, actual_denoms;
    END IF;

    -- 3. Target denominator differs from current
    IF e.new_denom = e.old_denom THEN
      RAISE EXCEPTION 'Preflight FAILED for %: target denom % equals current denom — no correction needed', e.set_name, e.new_denom;
    END IF;

    -- 4. No row in the set has is_sealed IS NULL
    SELECT COUNT(*) INTO sealed_null_count FROM cards
     WHERE set_name = e.set_name AND language = 'jp' AND is_sealed IS NULL;
    IF sealed_null_count > 0 THEN
      RAISE EXCEPTION 'Preflight FAILED for %: found % rows with is_sealed IS NULL', e.set_name, sealed_null_count;
    END IF;

    -- 5. No non-sealed row has card_number IS NULL
    SELECT COUNT(*) INTO cn_null_count FROM cards
     WHERE set_name = e.set_name AND language = 'jp'
       AND is_sealed = false AND card_number IS NULL;
    IF cn_null_count > 0 THEN
      RAISE EXCEPTION 'Preflight FAILED for %: found % non-sealed rows with card_number IS NULL', e.set_name, cn_null_count;
    END IF;

    -- 6. No non-sealed row has trim(card_number) = ''
    SELECT COUNT(*) INTO cn_empty_count FROM cards
     WHERE set_name = e.set_name AND language = 'jp'
       AND is_sealed = false AND card_number IS NOT NULL AND trim(card_number) = '';
    IF cn_empty_count > 0 THEN
      RAISE EXCEPTION 'Preflight FAILED for %: found % non-sealed rows with trim(card_number) = empty string', e.set_name, cn_empty_count;
    END IF;
  END LOOP;

  -- 7. Combined targeted-row count equals the 51D.1 inventory total
  SELECT COUNT(*) INTO combined_total
    FROM cards c JOIN _jp51d1_expectations e ON c.set_name = e.set_name
   WHERE c.language = 'jp' AND c.is_sealed = false
     AND NULLIF(trim(c.card_number), '') IS NOT NULL;
  IF combined_total <> 5351 THEN
    RAISE EXCEPTION 'Preflight FAILED: combined non-sealed numbered row count across 35 active sets expected 5351, got %', combined_total;
  END IF;

  -- 8. Snapshot integrity: pre_snapshot must equal the combined total
  DECLARE
    snap_total integer;
  BEGIN
    SELECT COUNT(*) INTO snap_total FROM _jp51d1_pre_snapshot;
    IF snap_total <> 5351 THEN
      RAISE EXCEPTION 'Preflight FAILED: pre_snapshot row count expected 5351, got %', snap_total;
    END IF;
  END;

  -- 9. Held sets must not be in the expectations table (defence in depth)
  DECLARE
    conflict_count integer;
  BEGIN
    SELECT COUNT(*) INTO conflict_count FROM _jp51d1_expectations e
     WHERE e.set_name IN (
       SELECT DISTINCT set_name FROM _jp51d1_pre_held
     );
    IF conflict_count > 0 THEN
      RAISE EXCEPTION 'Preflight FAILED: expectations table shares % row(s) with held-set snapshot — active/held conflict', conflict_count;
    END IF;
  END;
END $$;

-- ── UPDATE statements (35) ────────────────────────────
-- Every UPDATE uses the same predicate:
--   set_name = '<exact>'
--   AND language = 'jp'
--   AND is_sealed = false
--   AND NULLIF(trim(card_number), '') IS NOT NULL
-- card_number is preserved (never in SET); only set_printed_total
-- and card_number_display change.
--
-- card_number_display = trim(card_number) || '/' || '<new_denom>'
-- (trim ensures whitespace in the source doesn't leak into the
-- displayed string, matching the preflight predicate.)

UPDATE cards SET set_printed_total = '81',  card_number_display = trim(card_number) || '/' || '81'  WHERE set_name = 'Japanese Abyss Eye'                  AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '98',  card_number_display = trim(card_number) || '/' || '98'  WHERE set_name = 'Japanese Glory of Team Rocket'       AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '80',  card_number_display = trim(card_number) || '/' || '80'  WHERE set_name = 'Japanese Nihil Zero'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '80',  card_number_display = trim(card_number) || '/' || '80'  WHERE set_name = 'Japanese Inferno X'                  AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '71',  card_number_display = trim(card_number) || '/' || '71'  WHERE set_name = 'Japanese Wild Force'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '66',  card_number_display = trim(card_number) || '/' || '66'  WHERE set_name = 'Japanese Crimson Haze'               AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '63',  card_number_display = trim(card_number) || '/' || '63'  WHERE set_name = 'Japanese Mega Brave'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '193', card_number_display = trim(card_number) || '/' || '193' WHERE set_name = 'Japanese Mega Dream ex'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '63',  card_number_display = trim(card_number) || '/' || '63'  WHERE set_name = 'Japanese Mega Symphonia'             AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '64',  card_number_display = trim(card_number) || '/' || '64'  WHERE set_name = 'Japanese Night Wanderer'             AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '102', card_number_display = trim(card_number) || '/' || '102' WHERE set_name = 'Japanese Stellar Miracle'            AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '106', card_number_display = trim(card_number) || '/' || '106' WHERE set_name = 'Japanese Super Electric Breaker'     AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '64',  card_number_display = trim(card_number) || '/' || '64'  WHERE set_name = 'Japanese Paradise Dragona'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '172', card_number_display = trim(card_number) || '/' || '172' WHERE set_name = 'Japanese VSTAR Universe'             AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '67',  card_number_display = trim(card_number) || '/' || '67'  WHERE set_name = 'Japanese Battle Region'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '98',  card_number_display = trim(card_number) || '/' || '98'  WHERE set_name = 'Japanese Paradigm Trigger'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '64',  card_number_display = trim(card_number) || '/' || '64'  WHERE set_name = 'Japanese Remix Bout'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '95',  card_number_display = trim(card_number) || '/' || '95'  WHERE set_name = 'Japanese Super-Burst Impact'         AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '78',  card_number_display = trim(card_number) || '/' || '78'  WHERE set_name = 'Japanese Awakening Psychic King'     AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '114', card_number_display = trim(card_number) || '/' || '114' WHERE set_name = 'Japanese GX Battle Boost'            AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '81',  card_number_display = trim(card_number) || '/' || '81'  WHERE set_name = 'Japanese Bandit Ring'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '80',  card_number_display = trim(card_number) || '/' || '80'  WHERE set_name = 'Japanese Wild Blaze'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '93',  card_number_display = trim(card_number) || '/' || '93'  WHERE set_name = 'Japanese EX Battle Boost'            AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '96',  card_number_display = trim(card_number) || '/' || '96'  WHERE set_name = 'Japanese Rising Fist'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '76',  card_number_display = trim(card_number) || '/' || '76'  WHERE set_name = 'Japanese Megalo Cannon'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '70',  card_number_display = trim(card_number) || '/' || '70'  WHERE set_name = 'Japanese Plasma Gale'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '59',  card_number_display = trim(card_number) || '/' || '59'  WHERE set_name = 'Japanese Cold Flare'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '59',  card_number_display = trim(card_number) || '/' || '59'  WHERE set_name = 'Japanese Red Flash'                  AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '84',  card_number_display = trim(card_number) || '/' || '84'  WHERE set_name = 'Japanese Rocket Gang Strikes Back'   AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '83',  card_number_display = trim(card_number) || '/' || '83'  WHERE set_name = 'Japanese Ninja Spinner'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '87',  card_number_display = trim(card_number) || '/' || '87'  WHERE set_name = 'Japanese Wind from the Sea'          AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '80',  card_number_display = trim(card_number) || '/' || '80'  WHERE set_name = 'Japanese Reviving Legends'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '88',  card_number_display = trim(card_number) || '/' || '88'  WHERE set_name = 'Japanese Split Earth'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '88',  card_number_display = trim(card_number) || '/' || '88'  WHERE set_name = 'Japanese Mysterious Mountains'       AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
UPDATE cards SET set_printed_total = '30',  card_number_display = trim(card_number) || '/' || '30'  WHERE set_name = 'Japanese 2002 McDonald''s'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;

-- ── Postflight: per-set + combined + cross-checks ────────────────

DO $$
DECLARE
  e             record;
  actual_count  integer;
  actual_denoms text[];
  bad_display_count integer;
  numerator_changes integer;
  identity_changes integer;
  combined_total integer;
  sealed_changes integer;
  held_changes integer;
  crosscheck_count integer;
BEGIN
  FOR e IN SELECT * FROM _jp51d1_expectations LOOP
    -- 1. Targeted row count unchanged
    SELECT COUNT(*), ARRAY_AGG(DISTINCT set_printed_total ORDER BY set_printed_total)
      INTO actual_count, actual_denoms
      FROM cards
     WHERE set_name = e.set_name
       AND language = 'jp'
       AND is_sealed = false
       AND NULLIF(trim(card_number), '') IS NOT NULL;

    IF actual_count <> e.expected_ns_num_count THEN
      RAISE EXCEPTION 'Postflight FAILED for %: row count changed from % to %', e.set_name, e.expected_ns_num_count, actual_count;
    END IF;

    -- 2. All targeted rows have the new denominator, and only that denominator
    IF actual_denoms IS DISTINCT FROM ARRAY[e.new_denom]::text[] THEN
      RAISE EXCEPTION 'Postflight FAILED for %: expected single new denom [%], got %', e.set_name, e.new_denom, actual_denoms;
    END IF;

    -- 3. Every card_number_display equals trim(card_number) || '/' || new_denom
    SELECT COUNT(*) INTO bad_display_count FROM cards
     WHERE set_name = e.set_name
       AND language = 'jp'
       AND is_sealed = false
       AND NULLIF(trim(card_number), '') IS NOT NULL
       AND card_number_display IS DISTINCT FROM (trim(card_number) || '/' || e.new_denom);
    IF bad_display_count > 0 THEN
      RAISE EXCEPTION 'Postflight FAILED for %: % rows have unexpected card_number_display', e.set_name, bad_display_count;
    END IF;
  END LOOP;

  -- 4. No numerator changed and no row identity lost
  SELECT COUNT(*) INTO numerator_changes
    FROM cards c JOIN _jp51d1_pre_snapshot s ON c.id = s.id
   WHERE c.card_number IS DISTINCT FROM s.card_number;
  IF numerator_changes > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: % rows had card_number altered by the migration', numerator_changes;
  END IF;

  SELECT COUNT(*) INTO identity_changes FROM _jp51d1_pre_snapshot s
   WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.id = s.id);
  IF identity_changes > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: % rows disappeared between snapshot and postflight', identity_changes;
  END IF;

  -- 5. Combined corrected total is exactly 5351
  SELECT COUNT(*) INTO combined_total
    FROM cards c JOIN _jp51d1_expectations e ON c.set_name = e.set_name
   WHERE c.language = 'jp' AND c.is_sealed = false
     AND NULLIF(trim(c.card_number), '') IS NOT NULL;
  IF combined_total <> 5351 THEN
    RAISE EXCEPTION 'Postflight FAILED: combined corrected row count expected 5351, got %', combined_total;
  END IF;

  -- 6. Zero sealed rows in the 35 active sets were altered
  SELECT COUNT(*) INTO sealed_changes
    FROM cards c JOIN _jp51d1_pre_sealed s ON c.id = s.id
   WHERE c.set_printed_total   IS DISTINCT FROM s.set_printed_total
      OR c.card_number_display IS DISTINCT FROM s.card_number_display
      OR c.card_number         IS DISTINCT FROM s.card_number;
  IF sealed_changes > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: % sealed rows in the 35 active sets were altered by the migration', sealed_changes;
  END IF;

  -- 7. Zero held-set rows were altered
  SELECT COUNT(*) INTO held_changes
    FROM cards c JOIN _jp51d1_pre_held s ON c.id = s.id
   WHERE c.set_printed_total   IS DISTINCT FROM s.set_printed_total
      OR c.card_number_display IS DISTINCT FROM s.card_number_display
      OR c.card_number         IS DISTINCT FROM s.card_number;
  IF held_changes > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: % held-set rows (Black Bolt / White Flare / vintage aggregates) were altered', held_changes;
  END IF;

  -- 8. Cross-check sets retain exact expected denominators
  SELECT COUNT(*) INTO crosscheck_count FROM cards
   WHERE set_name = 'Japanese Battle Partners' AND language = 'jp'
     AND is_sealed = false AND set_printed_total <> '100';
  IF crosscheck_count > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: Battle Partners no longer /100 (% rows differ)', crosscheck_count;
  END IF;

  SELECT COUNT(*) INTO crosscheck_count FROM cards
   WHERE set_name = 'Japanese Terastal Festival' AND language = 'jp'
     AND is_sealed = false AND set_printed_total <> '187';
  IF crosscheck_count > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: Terastal Festival no longer /187 (% rows differ)', crosscheck_count;
  END IF;

  SELECT COUNT(*) INTO crosscheck_count FROM cards
   WHERE set_name = 'Japanese Ruler of the Black Flame' AND language = 'jp'
     AND is_sealed = false AND set_printed_total <> '108';
  IF crosscheck_count > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: Ruler of the Black Flame no longer /108 (% rows differ)', crosscheck_count;
  END IF;

  SELECT COUNT(*) INTO crosscheck_count FROM cards
   WHERE set_name = 'Japanese Tag All Stars' AND language = 'jp'
     AND is_sealed = false AND set_printed_total <> '173';
  IF crosscheck_count > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: Tag All Stars no longer /173 (% rows differ)', crosscheck_count;
  END IF;

  SELECT COUNT(*) INTO crosscheck_count FROM cards
   WHERE set_name = 'Scarlet & Violet 151' AND language = 'en'
     AND is_sealed = false AND set_printed_total <> '165';
  IF crosscheck_count > 0 THEN
    RAISE EXCEPTION 'Postflight FAILED: English SV 151 no longer /165 (% rows differ)', crosscheck_count;
  END IF;
END $$;

DROP TABLE _jp51d1_expectations;
DROP TABLE _jp51d1_pre_snapshot;
DROP TABLE _jp51d1_pre_sealed;
DROP TABLE _jp51d1_pre_held;
DROP TABLE _jp51d1_pre_crosscheck;

COMMIT;

-- ── Rollback (paste separately if reverting) ─────────────────────
--
-- BEGIN;
-- UPDATE cards SET set_printed_total = '118', card_number_display = trim(card_number) || '/' || '118' WHERE set_name = 'Japanese Abyss Eye'                  AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '132', card_number_display = trim(card_number) || '/' || '132' WHERE set_name = 'Japanese Glory of Team Rocket'       AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '117', card_number_display = trim(card_number) || '/' || '117' WHERE set_name = 'Japanese Nihil Zero'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '116', card_number_display = trim(card_number) || '/' || '116' WHERE set_name = 'Japanese Inferno X'                  AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '100', card_number_display = trim(card_number) || '/' || '100' WHERE set_name = 'Japanese Wild Force'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '71',  card_number_display = trim(card_number) || '/' || '71'  WHERE set_name = 'Japanese Crimson Haze'               AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '92',  card_number_display = trim(card_number) || '/' || '92'  WHERE set_name = 'Japanese Mega Brave'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '250', card_number_display = trim(card_number) || '/' || '250' WHERE set_name = 'Japanese Mega Dream ex'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '92',  card_number_display = trim(card_number) || '/' || '92'  WHERE set_name = 'Japanese Mega Symphonia'             AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '66',  card_number_display = trim(card_number) || '/' || '66'  WHERE set_name = 'Japanese Night Wanderer'             AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '100', card_number_display = trim(card_number) || '/' || '100' WHERE set_name = 'Japanese Stellar Miracle'            AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '71',  card_number_display = trim(card_number) || '/' || '71'  WHERE set_name = 'Japanese Super Electric Breaker'     AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '63',  card_number_display = trim(card_number) || '/' || '63'  WHERE set_name = 'Japanese Paradise Dragona'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '262', card_number_display = trim(card_number) || '/' || '262' WHERE set_name = 'Japanese VSTAR Universe'             AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '70',  card_number_display = trim(card_number) || '/' || '70'  WHERE set_name = 'Japanese Battle Region'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '100', card_number_display = trim(card_number) || '/' || '100' WHERE set_name = 'Japanese Paradigm Trigger'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '70',  card_number_display = trim(card_number) || '/' || '70'  WHERE set_name = 'Japanese Remix Bout'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '94',  card_number_display = trim(card_number) || '/' || '94'  WHERE set_name = 'Japanese Super-Burst Impact'         AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '51',  card_number_display = trim(card_number) || '/' || '51'  WHERE set_name = 'Japanese Awakening Psychic King'     AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '125', card_number_display = trim(card_number) || '/' || '125' WHERE set_name = 'Japanese GX Battle Boost'            AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '84',  card_number_display = trim(card_number) || '/' || '84'  WHERE set_name = 'Japanese Bandit Ring'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '90',  card_number_display = trim(card_number) || '/' || '90'  WHERE set_name = 'Japanese Wild Blaze'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '99',  card_number_display = trim(card_number) || '/' || '99'  WHERE set_name = 'Japanese EX Battle Boost'            AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '88',  card_number_display = trim(card_number) || '/' || '88'  WHERE set_name = 'Japanese Rising Fist'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '86',  card_number_display = trim(card_number) || '/' || '86'  WHERE set_name = 'Japanese Megalo Cannon'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '79',  card_number_display = trim(card_number) || '/' || '79'  WHERE set_name = 'Japanese Plasma Gale'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '65',  card_number_display = trim(card_number) || '/' || '65'  WHERE set_name = 'Japanese Cold Flare'                 AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '65',  card_number_display = trim(card_number) || '/' || '65'  WHERE set_name = 'Japanese Red Flash'                  AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '85',  card_number_display = trim(card_number) || '/' || '85'  WHERE set_name = 'Japanese Rocket Gang Strikes Back'   AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '120', card_number_display = trim(card_number) || '/' || '120' WHERE set_name = 'Japanese Ninja Spinner'              AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '90',  card_number_display = trim(card_number) || '/' || '90'  WHERE set_name = 'Japanese Wind from the Sea'          AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '81',  card_number_display = trim(card_number) || '/' || '81'  WHERE set_name = 'Japanese Reviving Legends'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '91',  card_number_display = trim(card_number) || '/' || '91'  WHERE set_name = 'Japanese Split Earth'                AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '91',  card_number_display = trim(card_number) || '/' || '91'  WHERE set_name = 'Japanese Mysterious Mountains'       AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- UPDATE cards SET set_printed_total = '18',  card_number_display = trim(card_number) || '/' || '18'  WHERE set_name = 'Japanese 2002 McDonald''s'           AND language = 'jp' AND is_sealed = false AND NULLIF(trim(card_number), '') IS NOT NULL;
-- COMMIT;
