-- Block 5A-W-50F / FIX1+FIX2+FIX3+FIX4 — portfolio_item_events + trigger
--
-- Append-only ledger of portfolio activity. Powers the historical
-- portfolio-value graph. portfolio_items remains the source of truth
-- for CURRENT state; this table records what changed and when.
--
-- FIX1 change: event writes are trigger-driven, not client-driven.
-- FIX2 changes:
--   * event_order (IDENTITY) guarantees deterministic same-transaction
--     ordering (created_at is transaction-stable so it ties);
--   * INSERT with a manual value embeds initial_manual_value_cents in
--     the holding_added metadata instead of emitting a separate
--     manual_value_changed event (no false adjustment on day 0);
--   * multi-field UPDATE emits events in the fixed sequence:
--       1. purchase_date correction
--       2. holding_type correction
--       3. manual_value_changed
--       4. quantity_added / quantity_removed
--     so quantity moves are valued against the FINAL type + manual;
--   * trigger raises when a client NEW.user_id conflicts with the
--     portfolios.user_id derived from portfolio_id.
-- FIX3 changes:
--   * holding_instance_id (uuid NOT NULL) is the PERMANENT ledger
--     identity for a holding's event chain. Snapshot of the ORIGINAL
--     portfolio_items.id; survives deletion. All reconstruction and
--     matching uses this instead of portfolio_item_id (which is
--     cleared by the FK ON DELETE SET NULL cascade).
--   * portfolio_item_id remains as a convenience FK for live rows
--     only, documented as such.
--   * purchase_date UPDATE is validated: the trigger raises when the
--     new date is in the future OR when the new date would place the
--     initial event AFTER any value-relevant subsequent event for
--     this holding_instance_id. The portfolio_items UPDATE is
--     rejected atomically (no event is created).
-- FIX4 changes:
--   * DELETE branch derives the owner from OLD.user_id when the
--     portfolios row is no longer resolvable (cascade case). This
--     ensures a portfolio deletion cannot deadlock on the ownership
--     lookup even though it currently is not exposed by the app.
--   * DELETE event inserts portfolio_item_id explicitly as NULL. The
--     nullable FK cannot reference OLD.id after the parent row is
--     gone; only pre-existing events had their column set NULL by
--     the ON DELETE SET NULL cascade.
--   * purchase_date cannot be cleared (non-null -> NULL) once
--     recorded. The trigger raises with a clear message; the
--     portfolio_items UPDATE is rejected atomically.
--
-- Manual application: run this entire file once in the Supabase SQL
-- Editor. Idempotent — safe to re-run.
--
-- Rollback:
--   DROP TRIGGER  IF EXISTS trg_portfolio_items_events ON portfolio_items;
--   DROP FUNCTION IF EXISTS record_portfolio_item_event();
--   DROP TABLE    IF EXISTS portfolio_item_events;
--   (event_order and holding_instance_id columns are dropped as part
--    of the table.)

-- ── Table ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolio_item_events (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                         uuid NOT NULL,
  portfolio_id                    uuid NOT NULL,
  portfolio_item_id               uuid,
  -- FIX3 — permanent ledger identity. Survives deletion; ALWAYS
  -- reflects the id of the portfolio_items row that generated the
  -- FIRST event in this chain. NOT a foreign key.
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

-- FIX2 — event_order IDENTITY. Unique + monotonic across all rows.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_item_events'
      AND column_name = 'event_order'
  ) THEN
    ALTER TABLE portfolio_item_events
      ADD COLUMN event_order bigint GENERATED ALWAYS AS IDENTITY;
  END IF;
END $$;

-- FIX3 — idempotent add of holding_instance_id for partially-created
-- dev tables. Populates from portfolio_item_id where possible, then
-- validates that no rows remain unresolved before enforcing NOT NULL.
-- If any rows cannot be resolved (holding was deleted BEFORE FIX3),
-- the migration raises rather than silently accepting orphans.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'portfolio_item_events'
      AND column_name = 'holding_instance_id'
  ) THEN
    ALTER TABLE portfolio_item_events
      ADD COLUMN holding_instance_id uuid;

    UPDATE portfolio_item_events
       SET holding_instance_id = portfolio_item_id
     WHERE holding_instance_id IS NULL
       AND portfolio_item_id   IS NOT NULL;

    IF EXISTS (
      SELECT 1 FROM portfolio_item_events WHERE holding_instance_id IS NULL
    ) THEN
      RAISE EXCEPTION 'portfolio_item_events has rows with no holding_instance_id and no portfolio_item_id — likely orphaned events from a pre-FIX3 deletion. Investigate before enforcing NOT NULL.';
    END IF;

    ALTER TABLE portfolio_item_events
      ALTER COLUMN holding_instance_id SET NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pie_portfolio_id_fk'
  ) THEN
    ALTER TABLE portfolio_item_events
      ADD CONSTRAINT pie_portfolio_id_fk
      FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pie_portfolio_item_id_fk'
  ) THEN
    -- portfolio_item_id remains as a convenience FK for LIVE rows
    -- only. After deletion the FK cascade sets it NULL. Reconstruction
    -- code MUST use holding_instance_id, not this column, for the
    -- event-chain identity.
    ALTER TABLE portfolio_item_events
      ADD CONSTRAINT pie_portfolio_item_id_fk
      FOREIGN KEY (portfolio_item_id) REFERENCES portfolio_items(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pie_user_date_order
  ON portfolio_item_events (user_id, event_date, event_order);

CREATE INDEX IF NOT EXISTS idx_pie_portfolio_date_order
  ON portfolio_item_events (portfolio_id, event_date, event_order);

CREATE INDEX IF NOT EXISTS idx_pie_item
  ON portfolio_item_events (portfolio_item_id);

CREATE INDEX IF NOT EXISTS idx_pie_card_identity
  ON portfolio_item_events (card_slug, set_name_snapshot, holding_type, event_date);

-- FIX3 — primary index for reconstruction reads.
CREATE INDEX IF NOT EXISTS idx_pie_portfolio_holding_date_order
  ON portfolio_item_events (portfolio_id, holding_instance_id, event_date, event_order);

-- ── RLS ─────────────────────────────────────────────────

ALTER TABLE portfolio_item_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pie_owner_select ON portfolio_item_events;
CREATE POLICY pie_owner_select
  ON portfolio_item_events
  FOR SELECT
  USING (user_id = auth.uid());

-- Explicitly do NOT create INSERT / UPDATE / DELETE policies. The
-- trigger runs SECURITY DEFINER as postgres and bypasses RLS.

-- ── Trigger function ───────────────────────────────────

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
  -- FIX4 — DELETE case is cascade-safe. When a portfolio is deleted,
  -- its portfolio_items rows are cascade-deleted; by the time this
  -- trigger fires the portfolios row may no longer be queryable.
  -- Fall back to OLD.user_id in that case so the cascade completes.
  IF TG_OP = 'DELETE' THEN
    SELECT user_id INTO v_user_id FROM portfolios WHERE id = OLD.portfolio_id;
    IF v_user_id IS NULL THEN
      v_user_id := OLD.user_id;
    END IF;
  ELSE
    SELECT user_id INTO v_user_id FROM portfolios WHERE id = NEW.portfolio_id;
  END IF;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'record_portfolio_item_event: portfolio ownership not resolvable for portfolio %', COALESCE(NEW.portfolio_id, OLD.portfolio_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.user_id IS NOT NULL AND NEW.user_id <> v_user_id THEN
    RAISE EXCEPTION 'record_portfolio_item_event: NEW.user_id (%) does not match portfolio owner (%)', NEW.user_id, v_user_id;
  END IF;
  -- DELETE-time mismatch is only checked when BOTH values are
  -- present. During a portfolios cascade v_user_id is derived from
  -- OLD.user_id so it always matches; the check is a no-op there.
  IF TG_OP = 'DELETE' AND OLD.user_id IS NOT NULL AND OLD.user_id <> v_user_id THEN
    RAISE EXCEPTION 'record_portfolio_item_event: OLD.user_id (%) does not match portfolio owner (%)', OLD.user_id, v_user_id;
  END IF;

  -- ── INSERT ────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    IF NEW.purchase_date IS NOT NULL THEN
      v_event_date   := NEW.purchase_date;
      v_is_estimated := false;
    ELSE
      v_event_date   := CURRENT_DATE;
      v_is_estimated := false;
    END IF;

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
  --
  -- Deterministic multi-field ordering:
  --   1. purchase_date correction  (validated first — the whole
  --      UPDATE is rejected if the new date is invalid)
  --   2. holding_type correction   (valuation source change)
  --   3. manual_value_changed      (per-unit valuation change)
  --   4. quantity_added / quantity_removed
  IF TG_OP = 'UPDATE' THEN
    -- (1) purchase_date correction — FIX3 adds validation.
    IF NEW.purchase_date IS DISTINCT FROM OLD.purchase_date THEN
      -- FIX4 — non-null -> NULL is rejected. Clearing a recorded date
      -- would produce a NULL event_date and corrupt the timeline. If
      -- the user wants to fix a wrong date they must set it to the
      -- correct date, not clear it.
      IF NEW.purchase_date IS NULL AND OLD.purchase_date IS NOT NULL THEN
        RAISE EXCEPTION 'The purchase date cannot be cleared. Change it to the correct date instead.';
      END IF;

      IF NEW.purchase_date IS NOT NULL AND NEW.purchase_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'The purchase date cannot be in the future.';
      END IF;

      IF NEW.purchase_date IS NOT NULL THEN
        -- Earliest value-relevant subsequent event for THIS holding.
        -- We look up by holding_instance_id (== NEW.id for post-
        -- trigger holdings; == the original id for backfilled openings).
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

    -- (2) Holding-type correction. FIX3 — no key transfer needed at
    -- reconstruction; the state map is keyed by holding_instance_id
    -- so the correction just updates the holding_type in place.
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

    -- (3) Manual value change → adjustment event.
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

    -- (4) Quantity change LAST so it's valued at the final type + manual.
    IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      v_qty_delta := COALESCE(NEW.quantity, 0) - COALESCE(OLD.quantity, 0);
      IF v_qty_delta > 0 THEN
        v_event_type := 'quantity_added';
      ELSE
        v_event_type := 'quantity_removed';
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

  -- ── DELETE ────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    -- FIX3 — holding_instance_id = OLD.id so the delete event and
    -- every earlier event for this holding still resolve to a single
    -- identity even after portfolio_item_id is set NULL by the FK
    -- cascade on live-row references.
    -- FIX4 — portfolio_item_id is EXPLICITLY NULL in this new event.
    -- We CANNOT set it to OLD.id because the parent portfolios_items
    -- row has already been deleted by the time this AFTER DELETE
    -- trigger fires, so a fresh insert with portfolio_item_id =
    -- OLD.id would violate the FK. The ON DELETE SET NULL cascade
    -- only rewrites events that already existed at the moment of the
    -- parent delete; it does not silently accept new violating
    -- inserts. Snapshot fields (card_slug, set_name_snapshot,
    -- holding_type, quantity via metadata) carry the identity for
    -- reconstruction.
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

-- ── Trigger ─────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_portfolio_items_events ON portfolio_items;
CREATE TRIGGER trg_portfolio_items_events
  AFTER INSERT OR UPDATE OR DELETE
  ON portfolio_items
  FOR EACH ROW
  EXECUTE FUNCTION record_portfolio_item_event();

REVOKE EXECUTE ON FUNCTION record_portfolio_item_event() FROM PUBLIC;
