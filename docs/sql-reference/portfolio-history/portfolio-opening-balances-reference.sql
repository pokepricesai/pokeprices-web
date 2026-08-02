-- Block 5A-W-50F / FIX1+FIX2+FIX3 — legacy holding backfill.
--
-- Creates one opening_balance event per existing portfolio_items row
-- that does not already have ANY initial event. Runs entirely inside
-- the database; no market-value join happens here (the valuation
-- engine forward-fills daily_prices at read time).
--
-- FIX2: idempotency guard checks BOTH opening_balance and
-- holding_added so post-trigger rows do not receive a duplicate
-- initial event. Legacy manual_value_cents is embedded in metadata.
--
-- FIX3:
--   * Every opening_balance carries holding_instance_id =
--     portfolio_items.id — the permanent ledger identity used by
--     reconstruction, purchase-date correction lookup, and duplicate
--     audits. NOT the portfolio_item_id column (which the FK cascade
--     will null out on future deletions).
--   * Idempotency guard now matches by holding_instance_id (not by
--     portfolio_item_id), so a legacy holding cannot receive two
--     opening events even if its portfolio_item_id becomes NULL.
--
-- Manual application: run this file once in the Supabase SQL Editor
-- AFTER 2026-08-02-portfolio-item-events.sql. Idempotent — safe to
-- re-run at any time.
--
-- Rollback (removes ONLY the rows this script inserted):
--   DELETE FROM portfolio_item_events
--     WHERE event_type = 'opening_balance'
--       AND metadata ->> 'source' = 'legacy_backfill';
--
-- Duplicate-audit query (FIX3 — grouped by holding_instance_id,
-- must return zero rows both before and after any backfill run):
--   SELECT holding_instance_id, COUNT(*)
--   FROM portfolio_item_events
--   WHERE event_type IN ('opening_balance', 'holding_added')
--   GROUP BY holding_instance_id
--   HAVING COUNT(*) > 1;

INSERT INTO portfolio_item_events (
  user_id,
  portfolio_id,
  portfolio_item_id,
  holding_instance_id,
  card_slug,
  set_name_snapshot,
  holding_type,
  event_type,
  quantity_delta,
  event_date,
  market_value_cents_at_event,
  sale_proceeds_cents,
  currency,
  is_estimated,
  metadata,
  created_at
)
SELECT
  p.user_id,
  pi.portfolio_id,
  pi.id                                            AS portfolio_item_id,
  pi.id                                            AS holding_instance_id,
  pi.card_slug,
  pi.set_name_snapshot,
  pi.holding_type,
  'opening_balance'                                AS event_type,
  GREATEST(COALESCE(pi.quantity, 1), 1)            AS quantity_delta,
  COALESCE(pi.purchase_date, pi.created_at::date)  AS event_date,
  NULL::bigint                                     AS market_value_cents_at_event,
  NULL::bigint                                     AS sale_proceeds_cents,
  COALESCE(pi.purchase_currency, 'USD')            AS currency,
  (pi.purchase_date IS NULL)                       AS is_estimated,
  jsonb_strip_nulls(jsonb_build_object(
    'source',                     'legacy_backfill',
    'block',                      '5A-W-50F-FIX3',
    'initial_manual_value_cents', pi.manual_value_cents
  ))                                               AS metadata,
  now()                                            AS created_at
FROM portfolio_items pi
JOIN portfolios p ON p.id = pi.portfolio_id
WHERE NOT EXISTS (
  SELECT 1
  FROM portfolio_item_events e
  WHERE e.holding_instance_id = pi.id
    AND e.event_type IN ('opening_balance', 'holding_added')
);

-- Quick verification query (uncomment to run):
--   SELECT
--     COUNT(*) FILTER (WHERE is_estimated)      AS estimated_openings,
--     COUNT(*) FILTER (WHERE NOT is_estimated)  AS exact_openings,
--     COUNT(*) FILTER (WHERE metadata ? 'initial_manual_value_cents')
--                                               AS with_legacy_manual_value
--   FROM portfolio_item_events
--   WHERE event_type = 'opening_balance'
--     AND metadata ->> 'source' = 'legacy_backfill';
