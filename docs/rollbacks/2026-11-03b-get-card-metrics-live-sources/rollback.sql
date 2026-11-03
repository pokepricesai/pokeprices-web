-- rollback.sql — public.get_card_metrics(text) rollback artefact for
-- the 2026-11-03b live-sources correctness fix.
--
-- This is byte-equivalent to migrations/2026-11-02b-get-card-metrics-fix.sql
-- (the 2026-11-02 OR-strip performance fix), which is the current
-- production definition.
--
-- Stored under docs/rollbacks/ not migrations/ so no automated runner
-- (if ever introduced to pokeprices-web/migrations/) can pick it up.
--
-- ROLLBACK — paste this entire file into Supabase Studio SQL Editor,
-- Run. One statement, atomic, no table lock, no index change.
-- CREATE OR REPLACE preserves owner + grants.

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
