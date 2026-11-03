-- rollback.sql — public.get_card_metrics(text) rollback artefact
--
-- Exact production definition of public.get_card_metrics(text) as of
-- 2026-11-02, captured verbatim from the Supabase catalog. This is
-- the atomic rollback for the forward fix at:
--
--   pokeprices-web/migrations/2026-11-02b-get-card-metrics-fix.sql
--
-- Deliberately stored under docs/rollbacks/ and NOT under migrations/
-- so that no present or future automated migration runner can pick it
-- up by accident. (pokeprices-web/migrations/ is manual-apply today;
-- this location is a defensive insurance policy against that changing.)
--
-- ROLLBACK PROCEDURE
-- ─────────────────────────────────────────────────────────────────
-- If the fix regresses post-deploy, open this file, copy the single
-- CREATE OR REPLACE FUNCTION statement below, paste into Supabase
-- Studio SQL Editor, Run. The one statement restores the original
-- body atomically — no downtime, no table lock, no index change.
--
-- GRANTS AND OWNERSHIP
-- ─────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION preserves the existing owner and all
-- EXECUTE privileges. The signature public.get_card_metrics(text) is
-- unchanged, so this rollback restores the identical callable RPC
-- surface — same owner, same role grants — as whatever is currently
-- deployed in production. No GRANT statements are included here, and
-- intentionally none should be added, to avoid silently widening or
-- narrowing access as a side-effect of a rollback.

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
                    OR m.card_slug = 'pc-' || c.card_slug
                LEFT JOIN card_volume cv
                    ON cv.card_slug = c.card_slug
                WHERE c.card_slug = clean_slug
                   OR m.card_slug = clean_slug
                   OR m.card_slug = 'pc-' || clean_slug
                ORDER BY m.grade ASC NULLS LAST
                LIMIT 10
            ) t),
            '[]'::json
        )
    ) INTO result;

    RETURN COALESCE(result, json_build_object('results', '[]'::json));
END;
$function$;
