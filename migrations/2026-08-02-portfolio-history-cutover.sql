-- Block 5A-W-50F / FIX1..FIX5 — PORTFOLIO HISTORY CUTOVER.
--
-- ══════════════════════════════════════════════════════════════
-- This is the ONE production migration for the portfolio history
-- feature. Do NOT run any other file from the SQL-reference set
-- directly against production; those exist only for humans to read.
-- ══════════════════════════════════════════════════════════════
--
-- Runs the entire ledger installation + legacy backfill + integrity
-- verification inside ONE transaction. Either the whole cutover
-- succeeds atomically or nothing is committed. There is no window
-- in which the trigger is live but pre-existing holdings have not
-- been backfilled — that would let a legacy holding be deleted
-- before it ever received an opening_balance event, losing history
-- forever.
--
-- Idempotent — safe to re-run. Every DDL / DO block uses IF EXISTS /
-- IF NOT EXISTS guards. Backfill dedupes by holding_instance_id.
--
-- Pre-commit rollback: close the tab / ROLLBACK — nothing persisted.
--
-- Post-commit rollback (destructive):
--   DROP TRIGGER  IF EXISTS trg_portfolio_items_events ON portfolio_items;
--   DROP FUNCTION IF EXISTS record_portfolio_item_event();
--   DROP TABLE    IF EXISTS portfolio_item_events;
--
-- ── PRE-FLIGHT (paste separately, read-only) ───────────────────
--
-- Run these three queries BEFORE the cutover:
--
--   SELECT COUNT(*) AS current_holdings          FROM portfolio_items;
--   SELECT COUNT(*) AS future_purchase_dates     FROM portfolio_items WHERE purchase_date > CURRENT_DATE;
--   SELECT COUNT(*) AS portfolios_without_owner  FROM portfolios      WHERE user_id IS NULL;
--
-- Expected:
--   * future_purchase_dates    = 0
--   * portfolios_without_owner = 0
--   * current_holdings         = any non-negative count — record it
--                                for the post-cutover reconciliation.
--
-- If either invariant is violated, fix the underlying data BEFORE
-- running this file. The cutover will RAISE and roll back otherwise.
--
-- ── POST-CUTOVER RECONCILIATION (paste separately) ─────────────
--
-- After the cutover COMMITs, run these to confirm:
--
--   SELECT COUNT(*) AS current_holdings FROM portfolio_items;
--
--   SELECT COUNT(*) AS current_holdings_with_one_initial_event
--   FROM portfolio_items pi
--   WHERE (
--     SELECT COUNT(*) FROM portfolio_item_events e
--     WHERE e.holding_instance_id = pi.id
--       AND e.event_type IN ('opening_balance', 'holding_added')
--   ) = 1;
--
--   SELECT event_type, COUNT(*)
--   FROM portfolio_item_events
--   GROUP BY event_type
--   ORDER BY event_type;
--
-- The two counts must MATCH. The distribution should show
-- opening_balance ≈ current_holdings, plus any live activity.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. TABLE
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portfolio_item_events (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         uuid NOT NULL,
  portfolio_id                    uuid NOT NULL,
  portfolio_item_id               uuid,
  holding_instance_id             uuid NOT NULL,
  card_slug                       text NOT NULL,
  set_name_snapshot               text,
  holding_type                    text NOT NULL,
  event_type                      text NOT NULL,
  quantity_delta                  integer NOT NULL,
  event_date                      date NOT NULL,
  market_value_cents_at_event     bigint,
  sale_proceeds_cents             bigint,
  currency                        text NOT NULL DEFAULT 'USD',
  is_estimated                    boolean NOT NULL DEFAULT false,
  metadata                        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_item_events_event_type_check CHECK (event_type IN (
    'holding_added',
    'quantity_added',
    'quantity_removed',
    'holding_sold',
    'holding_removed',
    'manual_value_changed',
    'opening_balance',
    'correction'
  ))
);

-- Idempotent add for event_order + holding_instance_id when the table
-- already exists without them (partially-installed dev environments).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_item_events' AND column_name = 'event_order'
  ) THEN
    ALTER TABLE portfolio_item_events
      ADD COLUMN event_order bigint GENERATED ALWAYS AS IDENTITY;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_item_events' AND column_name = 'holding_instance_id'
  ) THEN
    ALTER TABLE portfolio_item_events ADD COLUMN holding_instance_id uuid;
    UPDATE portfolio_item_events
       SET holding_instance_id = portfolio_item_id
     WHERE holding_instance_id IS NULL AND portfolio_item_id IS NOT NULL;
    IF EXISTS (
      SELECT 1 FROM portfolio_item_events WHERE holding_instance_id IS NULL
    ) THEN
      RAISE EXCEPTION 'portfolio_item_events has rows with no holding_instance_id and no portfolio_item_id — investigate before continuing.';
    END IF;
    ALTER TABLE portfolio_item_events ALTER COLUMN holding_instance_id SET NOT NULL;
  END IF;
END $$;

-- Foreign keys.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pie_portfolio_id_fk') THEN
    ALTER TABLE portfolio_item_events
      ADD CONSTRAINT pie_portfolio_id_fk
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pie_portfolio_item_id_fk') THEN
    ALTER TABLE portfolio_item_events
      ADD CONSTRAINT pie_portfolio_item_id_fk
      FOREIGN KEY (portfolio_item_id) REFERENCES portfolio_items(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes.
CREATE INDEX IF NOT EXISTS idx_pie_user_date_order
  ON portfolio_item_events (user_id, event_date, event_order);
CREATE INDEX IF NOT EXISTS idx_pie_portfolio_date_order
  ON portfolio_item_events (portfolio_id, event_date, event_order);
CREATE INDEX IF NOT EXISTS idx_pie_item
  ON portfolio_item_events (portfolio_item_id);
CREATE INDEX IF NOT EXISTS idx_pie_card_identity
  ON portfolio_item_events (card_slug, set_name_snapshot, holding_type, event_date);
CREATE INDEX IF NOT EXISTS idx_pie_portfolio_holding_date_order
  ON portfolio_item_events (portfolio_id, holding_instance_id, event_date, event_order);

-- ══════════════════════════════════════════════════════════════
-- 2. RLS
-- ══════════════════════════════════════════════════════════════

ALTER TABLE portfolio_item_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pie_owner_select ON portfolio_item_events;
CREATE POLICY pie_owner_select
  ON portfolio_item_events
  FOR SELECT
  USING (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies. The trigger runs
-- SECURITY DEFINER as postgres and bypasses RLS.

-- ══════════════════════════════════════════════════════════════
-- 3. TRIGGER FUNCTION
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_portfolio_item_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id           uuid;
  v_qty_delta         int;
  v_event_type        text;
  v_event_date        date;
  v_is_estimated      boolean;
  v_metadata          jsonb;
  v_earliest_activity date;
BEGIN
  -- ── Ownership derivation + verification ──────────
  -- FIX5 — DELETE fully separates the cascade path from the ordinary
  -- holding-deletion path. If the portfolios row is gone by the time
  -- AFTER DELETE fires, this is a portfolio cascade (or an admin
  -- deletion of the parent); RETURN OLD without inserting a new
  -- event. Every event tied to this portfolio is already being wiped
  -- by portfolio_item_events.portfolio_id ON DELETE CASCADE. Trying
  -- to insert a fresh event would violate that FK.
  IF TG_OP = 'DELETE' THEN
    SELECT user_id INTO v_user_id FROM portfolios WHERE id = OLD.portfolio_id;
    IF v_user_id IS NULL THEN
      -- Portfolio-level cascade / admin deletion — skip event insert.
      RETURN OLD;
    END IF;
    IF OLD.user_id IS NOT NULL AND OLD.user_id <> v_user_id THEN
      RAISE EXCEPTION 'record_portfolio_item_event: OLD.user_id (%) does not match portfolio owner (%)', OLD.user_id, v_user_id;
    END IF;
  ELSE
    SELECT user_id INTO v_user_id FROM portfolios WHERE id = NEW.portfolio_id;
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'record_portfolio_item_event: portfolio ownership not resolvable for portfolio %', NEW.portfolio_id;
    END IF;
    IF NEW.user_id IS NOT NULL AND NEW.user_id <> v_user_id THEN
      RAISE EXCEPTION 'record_portfolio_item_event: NEW.user_id (%) does not match portfolio owner (%)', NEW.user_id, v_user_id;
    END IF;
  END IF;

  -- ── INSERT ────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    -- FIX5 — reject future purchase dates on INSERT too. Same rule
    -- as UPDATE. NULL and CURRENT_DATE remain allowed.
    IF NEW.purchase_date IS NOT NULL AND NEW.purchase_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'The purchase date cannot be in the future.';
    END IF;

    IF NEW.purchase_date IS NOT NULL THEN
      v_event_date := NEW.purchase_date;
    ELSE
      v_event_date := CURRENT_DATE;
    END IF;
    v_is_estimated := false;

    v_metadata := jsonb_build_object('source', 'trigger', 'trg_op', TG_OP);
    IF NEW.manual_value_cents IS NOT NULL THEN
      v_metadata := v_metadata || jsonb_build_object(
        'initial_manual_value_cents', NEW.manual_value_cents
      );
    END IF;

    INSERT INTO portfolio_item_events (
      user_id, portfolio_id, portfolio_item_id, holding_instance_id,
      card_slug, set_name_snapshot, holding_type,
      event_type, quantity_delta, event_date,
      currency, is_estimated, metadata
    ) VALUES (
      v_user_id, NEW.portfolio_id, NEW.id, NEW.id,
      NEW.card_slug, NEW.set_name_snapshot, NEW.holding_type,
      'holding_added', GREATEST(COALESCE(NEW.quantity, 1), 1), v_event_date,
      COALESCE(NEW.purchase_currency, 'USD'), v_is_estimated,
      v_metadata
    );
    RETURN NEW;
  END IF;

  -- ── UPDATE ────────────────────────────────
  IF TG_OP = 'UPDATE' THEN
    IF NEW.purchase_date IS DISTINCT FROM OLD.purchase_date THEN
      IF NEW.purchase_date IS NULL AND OLD.purchase_date IS NOT NULL THEN
        RAISE EXCEPTION 'The purchase date cannot be cleared. Change it to the correct date instead.';
      END IF;
      IF NEW.purchase_date IS NOT NULL AND NEW.purchase_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'The purchase date cannot be in the future.';
      END IF;
      IF NEW.purchase_date IS NOT NULL THEN
        SELECT MIN(event_date) INTO v_earliest_activity
          FROM portfolio_item_events
         WHERE holding_instance_id = NEW.id
           AND (
             event_type IN (
               'quantity_added', 'quantity_removed',
               'manual_value_changed', 'holding_sold', 'holding_removed'
             )
             OR (
               event_type = 'correction'
               AND (metadata->>'correction_kind') IS DISTINCT FROM 'purchase_date'
             )
           );
        IF v_earliest_activity IS NOT NULL AND NEW.purchase_date > v_earliest_activity THEN
          RAISE EXCEPTION 'The purchase date cannot be later than activity already recorded for this holding.';
        END IF;
      END IF;

      INSERT INTO portfolio_item_events (
        user_id, portfolio_id, portfolio_item_id, holding_instance_id,
        card_slug, set_name_snapshot, holding_type,
        event_type, quantity_delta, event_date,
        currency, is_estimated, metadata
      ) VALUES (
        v_user_id, NEW.portfolio_id, NEW.id, NEW.id,
        NEW.card_slug, NEW.set_name_snapshot, NEW.holding_type,
        'correction', 0, CURRENT_DATE,
        COALESCE(NEW.purchase_currency, 'USD'), false,
        jsonb_build_object(
          'source', 'trigger', 'trg_op', TG_OP,
          'correction_kind', 'purchase_date',
          'purchase_date_before', OLD.purchase_date,
          'purchase_date_after',  NEW.purchase_date
        )
      );
    END IF;

    IF NEW.holding_type IS DISTINCT FROM OLD.holding_type THEN
      INSERT INTO portfolio_item_events (
        user_id, portfolio_id, portfolio_item_id, holding_instance_id,
        card_slug, set_name_snapshot, holding_type,
        event_type, quantity_delta, event_date,
        currency, is_estimated, metadata
      ) VALUES (
        v_user_id, NEW.portfolio_id, NEW.id, NEW.id,
        NEW.card_slug, NEW.set_name_snapshot, NEW.holding_type,
        'correction', 0, CURRENT_DATE,
        COALESCE(NEW.purchase_currency, 'USD'), false,
        jsonb_build_object(
          'source', 'trigger', 'trg_op', TG_OP,
          'correction_kind', 'holding_type',
          'holding_type_before', OLD.holding_type,
          'holding_type_after',  NEW.holding_type,
          'quantity_at_change',  COALESCE(NEW.quantity, OLD.quantity, 0)
        )
      );
    END IF;

    IF NEW.manual_value_cents IS DISTINCT FROM OLD.manual_value_cents THEN
      INSERT INTO portfolio_item_events (
        user_id, portfolio_id, portfolio_item_id, holding_instance_id,
        card_slug, set_name_snapshot, holding_type,
        event_type, quantity_delta, event_date,
        currency, is_estimated, metadata
      ) VALUES (
        v_user_id, NEW.portfolio_id, NEW.id, NEW.id,
        NEW.card_slug, NEW.set_name_snapshot, NEW.holding_type,
        'manual_value_changed', 0, CURRENT_DATE,
        COALESCE(NEW.purchase_currency, 'USD'), false,
        jsonb_build_object(
          'source', 'trigger', 'trg_op', TG_OP,
          'manual_value_cents_before', OLD.manual_value_cents,
          'manual_value_cents_after',  NEW.manual_value_cents
        )
      );
    END IF;

    IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      v_qty_delta := COALESCE(NEW.quantity, 0) - COALESCE(OLD.quantity, 0);
      IF v_qty_delta > 0 THEN v_event_type := 'quantity_added';
      ELSE                    v_event_type := 'quantity_removed';
      END IF;
      INSERT INTO portfolio_item_events (
        user_id, portfolio_id, portfolio_item_id, holding_instance_id,
        card_slug, set_name_snapshot, holding_type,
        event_type, quantity_delta, event_date,
        currency, is_estimated, metadata
      ) VALUES (
        v_user_id, NEW.portfolio_id, NEW.id, NEW.id,
        NEW.card_slug, NEW.set_name_snapshot, NEW.holding_type,
        v_event_type, v_qty_delta, CURRENT_DATE,
        COALESCE(NEW.purchase_currency, 'USD'), false,
        jsonb_build_object(
          'source', 'trigger', 'trg_op', TG_OP,
          'quantity_before', OLD.quantity,
          'quantity_after',  NEW.quantity
        )
      );
    END IF;
    RETURN NEW;
  END IF;

  -- ── DELETE (ordinary holding deletion) ─────
  -- Reached only when the portfolios row still exists (portfolio
  -- cascade returned early above). portfolio_item_id is EXPLICITLY
  -- NULL — the parent portfolio_items row is already gone by AFTER
  -- DELETE time and a fresh INSERT with portfolio_item_id = OLD.id
  -- would violate the FK. Snapshot fields carry identity for
  -- reconstruction.
  IF TG_OP = 'DELETE' THEN
    INSERT INTO portfolio_item_events (
      user_id, portfolio_id, portfolio_item_id, holding_instance_id,
      card_slug, set_name_snapshot, holding_type,
      event_type, quantity_delta, event_date,
      currency, is_estimated, metadata
    ) VALUES (
      v_user_id, OLD.portfolio_id, NULL, OLD.id,
      OLD.card_slug, OLD.set_name_snapshot, OLD.holding_type,
      'holding_removed', -COALESCE(OLD.quantity, 0), CURRENT_DATE,
      COALESCE(OLD.purchase_currency, 'USD'), false,
      jsonb_build_object(
        'source', 'trigger', 'trg_op', TG_OP,
        'quantity_at_delete', OLD.quantity,
        'portfolio_item_id_at_delete', OLD.id
      )
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_portfolio_items_events ON portfolio_items;
CREATE TRIGGER trg_portfolio_items_events
  AFTER INSERT OR UPDATE OR DELETE
  ON portfolio_items
  FOR EACH ROW
  EXECUTE FUNCTION record_portfolio_item_event();

REVOKE EXECUTE ON FUNCTION record_portfolio_item_event() FROM PUBLIC;

-- ══════════════════════════════════════════════════════════════
-- 4. LEGACY BACKFILL — in the SAME transaction as trigger install.
-- ══════════════════════════════════════════════════════════════

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
    'block',                      '5A-W-50F-FIX5',
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

-- ══════════════════════════════════════════════════════════════
-- 5. INTEGRITY CHECKS — RAISE (roll back) on any failure.
-- ══════════════════════════════════════════════════════════════

-- 5a. No event has NULL holding_instance_id.
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM portfolio_item_events WHERE holding_instance_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'cutover: % events have NULL holding_instance_id', v_n;
  END IF;
END $$;

-- 5b. No initial-event duplicates per holding_instance_id.
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM (
    SELECT holding_instance_id
      FROM portfolio_item_events
     WHERE event_type IN ('opening_balance', 'holding_added')
     GROUP BY holding_instance_id
     HAVING COUNT(*) > 1
  ) t;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'cutover: % holding_instance_ids have more than one initial event', v_n;
  END IF;
END $$;

-- 5c. Every CURRENT portfolio_items row has one initial event.
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n
    FROM portfolio_items pi
   WHERE NOT EXISTS (
     SELECT 1 FROM portfolio_item_events e
      WHERE e.holding_instance_id = pi.id
        AND e.event_type IN ('opening_balance', 'holding_added')
   );
  IF v_n > 0 THEN
    RAISE EXCEPTION 'cutover: % current portfolio_items have no initial event', v_n;
  END IF;
END $$;

-- 5d. Every event's user_id matches its portfolio's owner.
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n
    FROM portfolio_item_events e
    JOIN portfolios p ON p.id = e.portfolio_id
   WHERE e.user_id <> p.user_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'cutover: % events have user_id that does not match their portfolio owner', v_n;
  END IF;
END $$;

-- 5e. No event has NULL event_date.
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM portfolio_item_events WHERE event_date IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'cutover: % events have NULL event_date', v_n;
  END IF;
END $$;

-- 5f. Trigger exists and is enabled.
DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT tgenabled <> 'D'
    INTO v_ok
    FROM pg_trigger
   WHERE tgname = 'trg_portfolio_items_events';
  IF v_ok IS NULL OR v_ok = false THEN
    RAISE EXCEPTION 'cutover: trg_portfolio_items_events trigger is not installed or is disabled';
  END IF;
END $$;

-- 5g. FIX5 — no CURRENT portfolio_items row has a future purchase_date.
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM portfolio_items WHERE purchase_date > CURRENT_DATE;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'cutover: % portfolio_items rows have purchase_date in the future — fix the data before running this migration', v_n;
  END IF;
END $$;

-- 5h. FIX5 — no portfolio_item_events row has a future event_date.
DO $$
DECLARE v_n int;
BEGIN
  SELECT COUNT(*) INTO v_n FROM portfolio_item_events WHERE event_date > CURRENT_DATE;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'cutover: % portfolio_item_events rows have event_date in the future — investigate before continuing', v_n;
  END IF;
END $$;

COMMIT;
