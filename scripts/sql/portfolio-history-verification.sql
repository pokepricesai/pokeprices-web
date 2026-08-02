-- Block 5A-W-50F / FIX4 — end-to-end verification of the ledger,
-- trigger and every validation rule. Runs entirely inside a
-- ROLLBACK — nothing is committed. Paste into the Supabase SQL
-- Editor after 2026-08-02-portfolio-history-cutover.sql has been
-- committed.
--
-- Substitute :pid and :uid with a REAL portfolio_id + user_id owned
-- by your account (the same identifiers used by the /dashboard/
-- portfolio page). Everything inserted here is discarded by the
-- final ROLLBACK.

BEGIN;

-- Wrap the whole thing in a DO block so RAISE inside intermediate
-- steps still lets us diagnose which check failed.

DO $$
DECLARE
  v_pid                  uuid := '<15beabab-09fe-4252-95da-092ac869e645>'::uuid;   -- substitute
  v_uid                  uuid := '<5bce9072-aab4-43b7-a4e4-1c5e594e7098>'::uuid;   -- substitute
  v_item_id              uuid;
  v_events               int;
  v_removed              int;
  v_null_pi              int;
  v_raise                boolean;
  -- FIX5-FINAL — variables for the deterministic later-than-activity
  -- verification section. Do not fold these into the loose vars above;
  -- keeping them named makes the section self-describing.
  v_holding_instance_id  uuid;
  v_backdated_rows       integer;
  v_earliest_activity    date;
  v_rejected             boolean := false;
  v_events_before        integer;
  v_events_after         integer;
  v_purchase_date_before date;
BEGIN
  -- 1. Insert a holding.
  INSERT INTO portfolio_items (
    portfolio_id, user_id, card_slug, card_name_snapshot,
    set_name_snapshot, holding_type, quantity, purchase_date
  ) VALUES (
    v_pid, v_uid, 'fix4-verify', 'Verify Card',
    'Verify Set', 'raw', 1, '2026-06-01'
  ) RETURNING id INTO v_item_id;

  -- 2. Confirm one holding_added event.
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id AND event_type = 'holding_added';
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'expected 1 holding_added event, got %', v_events;
  END IF;

  -- 3. Update quantity.
  UPDATE portfolio_items SET quantity = 3 WHERE id = v_item_id;
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id AND event_type = 'quantity_added';
  IF v_events <> 1 THEN RAISE EXCEPTION 'expected 1 quantity_added event, got %', v_events; END IF;

  -- 4. Update manual value.
  UPDATE portfolio_items SET manual_value_cents = 5000 WHERE id = v_item_id;
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id AND event_type = 'manual_value_changed';
  IF v_events <> 1 THEN RAISE EXCEPTION 'expected 1 manual_value_changed event, got %', v_events; END IF;

  -- 5. Update holding type.
  UPDATE portfolio_items SET holding_type = 'psa10' WHERE id = v_item_id;
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id
     AND event_type = 'correction'
     AND (metadata->>'correction_kind') = 'holding_type';
  IF v_events <> 1 THEN RAISE EXCEPTION 'expected 1 holding_type correction event, got %', v_events; END IF;

  -- 6. Valid purchase-date correction (earlier).
  UPDATE portfolio_items SET purchase_date = '2026-04-01' WHERE id = v_item_id;
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id
     AND event_type = 'correction'
     AND (metadata->>'correction_kind') = 'purchase_date'
     AND (metadata->>'purchase_date_after')::date = '2026-04-01';
  IF v_events <> 1 THEN RAISE EXCEPTION 'expected 1 valid purchase_date correction, got %', v_events; END IF;

  -- 6b + 7. FIX5-FINAL — deterministic later-than-activity verification.
  --
  -- Same-day purchase dates are valid. This test deliberately places
  -- activity on CURRENT_DATE - 2 and attempts CURRENT_DATE - 1,
  -- producing a deterministic later-than-activity violation without
  -- using a future date.
  --
  -- The direct UPDATE below on portfolio_item_events is a service-role
  -- write (no client INSERT/UPDATE/DELETE RLS policy exists; the SQL
  -- Editor bypasses RLS). The whole DO block rolls back, so the
  -- backdate never persists.

  -- Resolve the permanent ledger identity from the ledger itself
  -- (not from v_item_id). The lookup keys on portfolio_item_id, which
  -- is a DIFFERENT column from holding_instance_id, so a match proves
  -- both point at the same row.
  SELECT holding_instance_id
    INTO STRICT v_holding_instance_id
    FROM portfolio_item_events
   WHERE portfolio_item_id = v_item_id
     AND event_type = 'holding_added'
   ORDER BY event_order
   LIMIT 1;

  IF v_holding_instance_id <> v_item_id THEN
    RAISE EXCEPTION
      'verification setup failed: holding_instance_id % does not match portfolio item id %',
      v_holding_instance_id,
      v_item_id;
  END IF;

  -- Backdate exactly one quantity_added event by two days.
  UPDATE portfolio_item_events
     SET event_date = CURRENT_DATE - 2
   WHERE holding_instance_id = v_holding_instance_id
     AND event_type = 'quantity_added';

  GET DIAGNOSTICS v_backdated_rows = ROW_COUNT;

  IF v_backdated_rows <> 1 THEN
    RAISE EXCEPTION
      'verification setup failed: expected to backdate exactly one quantity_added event, updated %',
      v_backdated_rows;
  END IF;

  -- Read back the earliest value-relevant activity date using the
  -- SAME predicate as the production trigger. This is what the
  -- trigger will compare NEW.purchase_date against.
  SELECT MIN(event_date)
    INTO v_earliest_activity
    FROM portfolio_item_events
   WHERE holding_instance_id = v_holding_instance_id
     AND (
       event_type IN (
         'quantity_added',
         'quantity_removed',
         'manual_value_changed',
         'holding_sold',
         'holding_removed'
       )
       OR (
         event_type = 'correction'
         AND (metadata->>'correction_kind') IS DISTINCT FROM 'purchase_date'
       )
     );

  IF v_earliest_activity IS DISTINCT FROM CURRENT_DATE - 2 THEN
    RAISE EXCEPTION
      'verification setup failed: expected earliest activity %, found %',
      CURRENT_DATE - 2,
      v_earliest_activity;
  END IF;

  -- Capture the state BEFORE the rejected mutation so we can prove
  -- the atomic rollback afterwards.
  SELECT purchase_date
    INTO v_purchase_date_before
    FROM portfolio_items
   WHERE id = v_item_id;

  SELECT COUNT(*)
    INTO v_events_before
    FROM portfolio_item_events
   WHERE holding_instance_id = v_holding_instance_id;

  v_rejected := false;

  -- Perform the invalid update. CURRENT_DATE - 1 is unambiguously
  -- later than the CURRENT_DATE - 2 activity, and is not in the
  -- future. No sentinel RAISE inside the EXCEPTION block — we set
  -- v_rejected instead so a silent success is caught by the
  -- assertion below rather than shadowed by a self-raise.
  BEGIN
    UPDATE portfolio_items
       SET purchase_date = CURRENT_DATE - 1
     WHERE id = v_item_id;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'The purchase date cannot be later than activity already recorded for this holding.' THEN
        v_rejected := true;
      ELSE
        RAISE EXCEPTION
          'wrong raise message from later-date reject: %',
          SQLERRM;
      END IF;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION
      'later-purchase-date verification failed: trigger allowed purchase date % despite earliest activity %',
      CURRENT_DATE - 1,
      v_earliest_activity;
  END IF;

  -- Verify the rejected UPDATE changed nothing.
  IF (
    SELECT purchase_date
    FROM portfolio_items
    WHERE id = v_item_id
  ) IS DISTINCT FROM v_purchase_date_before THEN
    RAISE EXCEPTION
      'later-purchase-date verification failed: rejected update changed portfolio_items.purchase_date';
  END IF;

  SELECT COUNT(*)
    INTO v_events_after
    FROM portfolio_item_events
   WHERE holding_instance_id = v_holding_instance_id;

  IF v_events_after <> v_events_before THEN
    RAISE EXCEPTION
      'later-purchase-date verification failed: rejected update changed event count from % to %',
      v_events_before,
      v_events_after;
  END IF;

  -- 8. Attempt to clear the purchase date.
  BEGIN
    UPDATE portfolio_items SET purchase_date = NULL WHERE id = v_item_id;
    RAISE EXCEPTION 'expected the clear-purchase-date UPDATE to be rejected but it succeeded';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM NOT LIKE '%purchase date cannot be cleared%' THEN
        RAISE EXCEPTION 'wrong raise message from clear-date reject: %', SQLERRM;
      END IF;
  END;

  -- 9. Confirm neither invalid update created a new event OR changed
  --    the row (both should be atomic rollbacks).
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id
     AND event_type = 'correction'
     AND (metadata->>'correction_kind') = 'purchase_date';
  IF v_events <> 1 THEN
    RAISE EXCEPTION 'invalid updates should not create additional purchase_date corrections; got % total', v_events;
  END IF;

  -- 10. Delete the holding.
  DELETE FROM portfolio_items WHERE id = v_item_id;

  -- 11. Confirm DELETE succeeded (no rows remain).
  SELECT COUNT(*) INTO v_events FROM portfolio_items WHERE id = v_item_id;
  IF v_events <> 0 THEN
    RAISE EXCEPTION 'DELETE did not remove the holding';
  END IF;

  -- 12. Query the full chain by holding_instance_id.
  --     Should return 6 events: holding_added + quantity_added +
  --     manual_value_changed + correction(holding_type) +
  --     correction(purchase_date) + holding_removed.
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id;
  IF v_events <> 6 THEN
    RAISE EXCEPTION 'expected 6 total events in the chain, got %', v_events;
  END IF;

  -- 13a. holding_removed has portfolio_item_id NULL.
  SELECT COUNT(*) INTO v_null_pi
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id
     AND event_type = 'holding_removed'
     AND portfolio_item_id IS NULL;
  IF v_null_pi <> 1 THEN
    RAISE EXCEPTION 'expected holding_removed to have portfolio_item_id = NULL';
  END IF;

  -- 13b. All events retain holding_instance_id.
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id AND holding_instance_id IS NOT NULL;
  IF v_events <> 6 THEN
    RAISE EXCEPTION 'expected all 6 events to retain holding_instance_id';
  END IF;

  -- 13c. Every EARLIER event has portfolio_item_id NULL (set by the
  --      FK cascade on delete). Only the delete-event was explicitly
  --      inserted with NULL; the earlier events had their FK set NULL.
  SELECT COUNT(*) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id
     AND event_type <> 'holding_removed'
     AND portfolio_item_id IS NULL;
  IF v_events <> 5 THEN
    RAISE EXCEPTION 'expected 5 pre-delete events with portfolio_item_id NULL from the cascade, got %', v_events;
  END IF;

  -- 13d. Event ordering is deterministic — event_order is monotonically
  --      increasing across the whole chain.
  SELECT COUNT(*) INTO v_events FROM (
    SELECT event_order,
           lag(event_order) OVER (ORDER BY event_order) AS prev
      FROM portfolio_item_events
     WHERE holding_instance_id = v_item_id
  ) t WHERE prev IS NOT NULL AND event_order <= prev;
  IF v_events <> 0 THEN
    RAISE EXCEPTION 'event_order sequence is not strictly increasing (% out-of-order pairs)', v_events;
  END IF;

  -- 13e. Final reconstruction: total quantity delta sums to zero.
  SELECT SUM(quantity_delta) INTO v_events
    FROM portfolio_item_events
   WHERE holding_instance_id = v_item_id;
  IF v_events <> 0 THEN
    RAISE EXCEPTION 'net quantity did not settle to zero; got %', v_events;
  END IF;

  RAISE NOTICE 'FIX4 verification passed for holding_instance_id = %', v_item_id;
END $$;

ROLLBACK;
