-- v2-test.sql — restricted equivalence test for the proposed fix of
-- public.get_card_metrics(text).
--
-- CORE SAFEGUARDS (per 2026-11-02 operator directives)
-- ─────────────────────────────────────────────────────────────────
-- 1. The OLD production function is NEVER called from this script.
--    The ground truth is direct index queries against public.cards,
--    public.metrics_daily and public.card_volume. The NEW function
--    (installed as migration_test.get_card_metrics_v2) is compared
--    against those direct queries plus a cross-check between the
--    bare-numeric and pc-prefixed invocations, both of which must
--    yield the same clean_slug after the fix.
--
-- 2. Grade-tie nondeterminism in the function's LIMIT 10 ordering is
--    accounted for: equivalence between the two equivalent inputs
--    ('715593' vs 'pc-715593') is checked on a canonical grade
--    multiset — NOT on byte-identical JSON — because
--    ORDER BY m.grade ASC NULLS LAST produces an arbitrary ordering
--    within rows sharing the same grade, and LIMIT 10 may select a
--    different member of a tie group across repeated calls.
--
-- 3. Timing uses clock_timestamp() throughout. No psql meta-commands.
--
-- 4. The test lives entirely in schema migration_test, is granted
--    EXECUTE on migration_test.get_card_metrics_v2 to service_role
--    only (NOT anon/authenticated/PUBLIC), and the entire test runs
--    in a transaction that explicitly drops the function and schema
--    before COMMIT. Any RAISE EXCEPTION rolls the whole thing back.
--
-- 5. The test does NOT modify public.get_card_metrics or any other
--    production object. On COMMIT, migration_test does not persist.
--
-- 6. No GRANT statements are added to public.get_card_metrics. Grants
--    and ownership on the real function are preserved by whatever
--    deployment path the operator uses for the forward fix.
--
-- EXECUTION
-- ─────────────────────────────────────────────────────────────────
-- Supabase Studio → SQL Editor → "New query" → paste the entire file
-- below → Run. Expected outcomes:
--   PASS — single final NOTICE line summarising the five test cases
--          with their row counts and per-call durations, then
--          "all assertions passed", then transaction COMMITs having
--          dropped the migration_test schema.
--   FAIL — RAISE EXCEPTION fires with the failing assertion number,
--          transaction ROLLBACKs, no artefact remains.

BEGIN;

-- STEP 1 — isolated schema, no cross-role exposure.
CREATE SCHEMA migration_test;
REVOKE ALL ON SCHEMA migration_test FROM PUBLIC;
REVOKE ALL ON SCHEMA migration_test FROM anon, authenticated;
GRANT USAGE ON SCHEMA migration_test TO service_role;

-- STEP 2 — install v2: body is byte-identical to the proposed fix.
CREATE OR REPLACE FUNCTION migration_test.get_card_metrics_v2(card_slug text)
RETURNS json
LANGUAGE plpgsql
AS $function$
DECLARE
    result JSON;
    clean_slug TEXT;
BEGIN
    clean_slug := CASE
        WHEN card_slug LIKE 'pc-%' THEN substring(card_slug FROM 4)
        ELSE card_slug
    END;

    SELECT json_build_object('results',
        COALESCE(
            (SELECT json_agg(row_to_json(t)) FROM (
                SELECT
                    c.card_name,
                    c.set_name,
                    m.grade,
                    m.current_price,
                    m.ath_price,
                    m.ath_date,
                    m.drawdown_pct,
                    m.bottom_price,
                    m.bottom_date,
                    m.recovery_pct,
                    m.high_12m,
                    m.is_new_12m_high,
                    m.slope_30d,
                    m.slope_90d,
                    m.slope_365d,
                    m.volatility_30d,
                    m.volatility_90d,
                    m.pct_30d,
                    m.pct_90d,
                    m.pct_180d,
                    m.pct_365d,
                    cv.sales_30d,
                    m.data_points_total,
                    m.confidence
                FROM public.cards c
                JOIN public.metrics_daily m
                    ON m.card_slug = c.card_slug
                LEFT JOIN public.card_volume cv
                    ON cv.card_slug = c.card_slug
                WHERE c.card_slug = clean_slug
                ORDER BY m.grade ASC NULLS LAST
                LIMIT 10
            ) t),
            '[]'::json
        )
    ) INTO result;

    RETURN COALESCE(result, json_build_object('results', '[]'::json));
END;
$function$;

REVOKE ALL ON FUNCTION migration_test.get_card_metrics_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION migration_test.get_card_metrics_v2(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION migration_test.get_card_metrics_v2(text) TO service_role;

-- STEP 3 — derive ground-truth expectations from direct index queries.
--
-- Each row encodes the five test inputs. expected_card_slug is the
-- row in public.cards that card_slug resolves to AFTER the function's
-- CASE strip of the "pc-" prefix. expected_metrics_rows is the count
-- in public.metrics_daily for that resolved slug.
CREATE TEMP TABLE expected (
    label                    text PRIMARY KEY,
    input                    text NOT NULL,
    expected_card_slug       text,
    expected_card_name       text,
    expected_set_name        text,
    expected_metrics_rows    integer,
    expected_results_len     integer    -- LEAST(expected_metrics_rows, 10)
) ON COMMIT DROP;

INSERT INTO expected(label, input, expected_card_slug) VALUES
    ('num_busy',          '715593',                           '715593'),
    ('num_busy_pc',       'pc-715593',                        '715593'),
    ('kebab_url_slug',    'charizard-1st-edition-4',          NULL),
    ('num_zero_metrics',  '14451085',                         '14451085'),
    ('nonexistent',       'this-card-does-not-exist-12345',   NULL);

-- Backfill cards fields from a direct index lookup where the expected
-- slug is known. Rows with NULL expected_card_slug keep NULL —
-- they're the "no match" cases.
UPDATE expected e
   SET expected_card_name = c.card_name,
       expected_set_name  = c.set_name
  FROM public.cards c
 WHERE c.card_slug = e.expected_card_slug;

-- Backfill metrics_daily counts from a direct index lookup. NULL slug
-- stays with 0 rows.
UPDATE expected e
   SET expected_metrics_rows = COALESCE(
       (SELECT COUNT(*) FROM public.metrics_daily m WHERE m.card_slug = e.expected_card_slug),
       0
   );

UPDATE expected
   SET expected_results_len = LEAST(COALESCE(expected_metrics_rows, 0), 10);

-- STEP 4 — invoke v2 on all five inputs with per-call timing.
CREATE TEMP TABLE v2_output (
    label        text PRIMARY KEY,
    input        text,
    payload      json,
    results_len  integer,
    duration_ms  double precision
) ON COMMIT DROP;

DO $$
DECLARE
    r record;
    t0 timestamptz;
    t1 timestamptz;
    pay json;
BEGIN
    FOR r IN SELECT label, input FROM expected ORDER BY label LOOP
        t0 := clock_timestamp();
        pay := migration_test.get_card_metrics_v2(r.input);
        t1 := clock_timestamp();
        INSERT INTO v2_output(label, input, payload, results_len, duration_ms)
        VALUES (
            r.label, r.input, pay,
            COALESCE(json_array_length(pay->'results'), 0),
            EXTRACT(EPOCH FROM (t1 - t0)) * 1000
        );
    END LOOP;
END $$;

-- STEP 5 — assertions.
-- Any RAISE EXCEPTION aborts the transaction. No artefact persists.

-- 5a. Shape: every payload is a JSON object with a 'results' key
-- whose value is a JSON array.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT label, payload FROM v2_output LOOP
        IF json_typeof(r.payload) <> 'object' THEN
            RAISE EXCEPTION '5a FAIL: payload for % is not a JSON object: %', r.label, r.payload;
        END IF;
        IF NOT (r.payload ? 'results') THEN
            RAISE EXCEPTION '5a FAIL: payload for % missing "results" key: %', r.label, r.payload;
        END IF;
        IF json_typeof(r.payload->'results') <> 'array' THEN
            RAISE EXCEPTION '5a FAIL: "results" for % is not a JSON array: %', r.label, r.payload->'results';
        END IF;
    END LOOP;
END $$;

-- 5b. Row counts match the ground-truth-derived expected_results_len.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT e.label, e.expected_results_len, v.results_len
          FROM expected e
          JOIN v2_output v ON v.label = e.label
    LOOP
        IF r.results_len <> r.expected_results_len THEN
            RAISE EXCEPTION '5b FAIL: % expected results_len=%, got %',
                r.label, r.expected_results_len, r.results_len;
        END IF;
    END LOOP;
END $$;

-- 5c. Content: for num_busy, the first row must carry the expected
-- card identity and the full 24-field column shape. The function's
-- WHERE clause filters by c.card_slug, so all 10 rows share the same
-- cards row — we only need to spot-check one row.
DO $$
DECLARE
    v_pay       json;
    first_row   json;
    exp_name    text;
    exp_set     text;
    required_cols text[] := ARRAY[
        'card_name','set_name','grade','current_price','ath_price','ath_date',
        'drawdown_pct','bottom_price','bottom_date','recovery_pct','high_12m',
        'is_new_12m_high','slope_30d','slope_90d','slope_365d','volatility_30d',
        'volatility_90d','pct_30d','pct_90d','pct_180d','pct_365d','sales_30d',
        'data_points_total','confidence'
    ];
    col text;
BEGIN
    SELECT payload INTO v_pay FROM v2_output WHERE label = 'num_busy';
    SELECT expected_card_name, expected_set_name
      INTO exp_name, exp_set
      FROM expected WHERE label = 'num_busy';

    first_row := v_pay->'results'->0;
    IF first_row IS NULL THEN
        RAISE EXCEPTION '5c FAIL: num_busy first row is null';
    END IF;

    -- Every one of the 24 fields must be present as a JSON key.
    FOREACH col IN ARRAY required_cols LOOP
        IF NOT (first_row ? col) THEN
            RAISE EXCEPTION '5c FAIL: num_busy first row missing field %', col;
        END IF;
    END LOOP;

    -- card_name and set_name must match the direct-index ground truth.
    IF first_row->>'card_name' IS NULL THEN
        RAISE EXCEPTION '5c FAIL: num_busy first row card_name is null';
    END IF;
    IF first_row->>'card_name' <> exp_name THEN
        RAISE EXCEPTION '5c FAIL: num_busy first row card_name "%" does not match direct-query expected "%"',
            first_row->>'card_name', exp_name;
    END IF;
    IF first_row->>'set_name' <> exp_set THEN
        RAISE EXCEPTION '5c FAIL: num_busy first row set_name "%" does not match direct-query expected "%"',
            first_row->>'set_name', exp_set;
    END IF;
END $$;

-- 5d. Grade-tie-safe equivalence between num_busy and num_busy_pc.
-- Both inputs collapse to clean_slug='715593' after the function's
-- CASE strip. They MUST return the same multiset of grades (NULL
-- values compare equal). We canonicalise by sorting the grade list
-- rather than by comparing full JSON — ORDER BY m.grade ASC NULLS
-- LAST does not break ties within equal grades, so individual row
-- content among tied grades may differ harmlessly.
--
-- metrics_daily.grade is TEXT (e.g. 'cgc95', 'psa10'), not numeric,
-- so we aggregate and compare as text[].
DO $$
DECLARE
    g_busy      text[];
    g_busy_pc   text[];
BEGIN
    SELECT array_agg(elem->>'grade' ORDER BY (elem->>'grade') ASC NULLS LAST)
    INTO g_busy
    FROM v2_output v, json_array_elements(v.payload->'results') elem
    WHERE v.label = 'num_busy';

    SELECT array_agg(elem->>'grade' ORDER BY (elem->>'grade') ASC NULLS LAST)
    INTO g_busy_pc
    FROM v2_output v, json_array_elements(v.payload->'results') elem
    WHERE v.label = 'num_busy_pc';

    IF g_busy IS DISTINCT FROM g_busy_pc THEN
        RAISE EXCEPTION '5d FAIL: num_busy and num_busy_pc produce different grade multisets. busy=%, busy_pc=%',
            g_busy, g_busy_pc;
    END IF;
END $$;

-- 5e. All returned grades for num_busy are consistent with the
-- lowest-N grades in public.metrics_daily WHERE card_slug='715593'
-- under text ordering ASC NULLS LAST, where the natural LIMIT 10
-- window may include tie-group spill-over (metrics_daily has
-- multiple rows per card-grade pair, one per as_of date).
--
-- Specifically: the maximum grade in v2's result must be <= the
-- grade at offset 9 (0-indexed) in metrics_daily sorted ASC NULLS
-- LAST. Any larger grade means the function picked rows outside the
-- LIMIT 10 natural window.
DO $$
DECLARE
    v_max_grade        text;
    db_boundary_grade  text;
BEGIN
    SELECT max(elem->>'grade')
    INTO v_max_grade
    FROM v2_output v, json_array_elements(v.payload->'results') elem
    WHERE v.label = 'num_busy';

    SELECT grade
      INTO db_boundary_grade
      FROM public.metrics_daily
     WHERE card_slug = '715593'
     ORDER BY grade ASC NULLS LAST
     OFFSET 9 LIMIT 1;

    IF v_max_grade IS NOT NULL AND db_boundary_grade IS NOT NULL
       AND v_max_grade > db_boundary_grade THEN
        RAISE EXCEPTION '5e FAIL: num_busy max grade % exceeds the 10th-lowest grade in metrics_daily (%). Function is picking rows outside the expected window.',
            v_max_grade, db_boundary_grade;
    END IF;
END $$;

-- 5f. Zero-cases return an empty results array (not NULL, not
-- missing). Covers kebab_url_slug, num_zero_metrics, nonexistent.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT label, payload, results_len
               FROM v2_output
              WHERE label IN ('kebab_url_slug','num_zero_metrics','nonexistent')
    LOOP
        IF r.results_len <> 0 THEN
            RAISE EXCEPTION '5f FAIL: % expected empty results array, got %', r.label, r.results_len;
        END IF;
        -- Must be an array, not null — downstream consumers rely on
        -- the shape not changing when zero rows are found.
        IF json_typeof(r.payload->'results') <> 'array' THEN
            RAISE EXCEPTION '5f FAIL: % results type is %, expected array', r.label, json_typeof(r.payload->'results');
        END IF;
    END LOOP;
END $$;

-- 5g. Performance: every call must come in under 1000 ms. This is a
-- loose ceiling — the EXPLAIN cost dropped from 402,345.53 to 1.14,
-- so single-digit ms is expected; 1000 ms is the "something is still
-- wrong" boundary. All calls happen in a hot connection inside this
-- transaction.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT label, duration_ms FROM v2_output LOOP
        IF r.duration_ms > 1000 THEN
            RAISE EXCEPTION '5g FAIL: % duration %.1f ms exceeded 1000ms ceiling',
                r.label, r.duration_ms;
        END IF;
    END LOOP;
END $$;

-- STEP 6 — observable report (NOTICE lines; visible in the SQL
-- Editor Results pane under Messages).
DO $$
DECLARE r record;
BEGIN
    RAISE NOTICE '────────────────────────────────────────────────────────';
    RAISE NOTICE 'migration_test.get_card_metrics_v2 — results';
    RAISE NOTICE '────────────────────────────────────────────────────────';
    FOR r IN
        SELECT v.label, v.input, v.results_len, v.duration_ms,
               e.expected_results_len, e.expected_card_slug, e.expected_card_name
          FROM v2_output v
          JOIN expected e ON v.label = e.label
         ORDER BY v.label
    LOOP
        RAISE NOTICE '% | input=% | got=% expected=% | %.2f ms | expCardSlug=% expCardName=%',
            rpad(r.label, 18), rpad(r.input, 34), r.results_len,
            r.expected_results_len, r.duration_ms,
            COALESCE(r.expected_card_slug, '<none>'),
            COALESCE(r.expected_card_name, '<none>');
    END LOOP;
    RAISE NOTICE '────────────────────────────────────────────────────────';
    RAISE NOTICE 'All assertions passed.';
END $$;

-- STEP 7 — explicit cleanup before commit. If any assertion failed
-- above, this is never reached and the transaction ROLLBACKs,
-- erasing the schema anyway.
DROP FUNCTION migration_test.get_card_metrics_v2(text);
DROP SCHEMA migration_test CASCADE;

COMMIT;
