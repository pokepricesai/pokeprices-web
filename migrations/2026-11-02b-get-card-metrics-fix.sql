-- 2026-11-02b-get-card-metrics-fix.sql
--
-- Remove dead OR branches from public.get_card_metrics(card_slug text).
-- Rollback: 2026-11-02a-get-card-metrics-rollback.sql.
--
-- SCOPE — the ONLY two edits applied against the rollback body:
--
--   (1) metrics_daily JOIN
--       - OR m.card_slug = 'pc-' || c.card_slug   (removed)
--
--   (2) WHERE clause
--       - OR m.card_slug = clean_slug             (removed)
--       - OR m.card_slug = 'pc-' || clean_slug    (removed)
--
-- Everything else is byte-identical to the rollback file: RETURNS
-- json, LANGUAGE plpgsql, DECLARE block, clean_slug CASE, SELECT
-- column list, LEFT JOIN card_volume (grade matching unchanged),
-- ORDER BY m.grade ASC NULLS LAST, LIMIT 10, COALESCE wrappers,
-- json_build_object / json_agg / row_to_json shape, trailing
-- RETURN.
--
-- INVARIANT JUSTIFYING THIS EDIT (verified live 2026-11-02):
--
--     metrics_daily rows WHERE card_slug LIKE 'pc-%':  0 / 2,535,551
--     card_volume   rows WHERE card_slug LIKE 'pc-%':  0 / 253,350
--     cards         rows WHERE card_slug LIKE 'pc-%':  0 / 65,040
--
-- Both removed disjuncts (the JOIN one and both WHERE ones involving
-- 'pc-' || …) can never match a row in current production data. The
-- `m.card_slug = clean_slug` branch in the WHERE is also redundant
-- once the JOIN is `m.card_slug = c.card_slug`, because any
-- surviving metrics_daily row then has the same card_slug as its
-- joined cards row — filtering `WHERE c.card_slug = clean_slug` is
-- equivalent to filtering `WHERE m.card_slug = clean_slug` after
-- the simplified JOIN.
--
-- EXPLAIN COST (operator-supplied, pre-measurement):
--   OLD startup cost: 402,345.53  (BitmapOr over metrics_daily)
--   NEW startup cost:         1.14  (indexed lookups)
-- Measured runtime speedup must be observed post-deploy; the
-- planner cost is not a timing guarantee.

CREATE OR REPLACE FUNCTION public.get_card_metrics(card_slug text)
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
                FROM cards c
                JOIN metrics_daily m
                    ON m.card_slug = c.card_slug
                LEFT JOIN card_volume cv
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

-- GRANTS AND OWNERSHIP
-- ─────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION preserves the existing owner and all
-- EXECUTE privileges on the function. The signature
-- (public.get_card_metrics(text)) is unchanged, so PostgREST's
-- schema cache treats this as the same callable RPC with the same
-- role access as before.
--
-- Do NOT add GRANT statements here. Adding grants that were not
-- previously present would silently widen access; adding grants that
-- were previously present is a no-op but noise. If grants are ever
-- re-asserted, they must be a byte-for-byte copy of the output of:
--
--   SELECT 'GRANT ' || privilege_type
--       || ' ON FUNCTION public.get_card_metrics(text) TO '
--       || quote_ident(grantee) || ';'
--     FROM information_schema.routine_privileges
--    WHERE routine_schema = 'public'
--      AND routine_name   = 'get_card_metrics'
--      AND privilege_type = 'EXECUTE';
--
-- The default behaviour of this file is: no GRANT statements at all.
