-- Dashboard tools: Watchlist + Smart Alerts + Email digest infrastructure
-- Run this in Supabase SQL editor.

-- ── 1. WATCHLIST ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_slug       TEXT NOT NULL,
  card_name       TEXT NOT NULL,
  set_name        TEXT NOT NULL,
  card_url_slug   TEXT,
  image_url       TEXT,
  card_number     TEXT,
  notes           TEXT,
  raw_at_add      BIGINT,
  psa10_at_add    BIGINT,
  added_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, card_slug)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS watchlist_owner_select ON watchlist;
DROP POLICY IF EXISTS watchlist_owner_modify ON watchlist;

CREATE POLICY watchlist_owner_select ON watchlist
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY watchlist_owner_modify ON watchlist
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── 2. SMART ALERTS ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_slug       TEXT NOT NULL,
  card_name       TEXT NOT NULL,
  set_name        TEXT NOT NULL,
  card_url_slug   TEXT,
  image_url       TEXT,
  grade           TEXT NOT NULL CHECK (grade IN ('raw','psa9','psa10')),
  alert_type      TEXT NOT NULL CHECK (alert_type IN ('price_below','price_above')),
  threshold_cents BIGINT NOT NULL CHECK (threshold_cents > 0),
  is_active       BOOLEAN DEFAULT TRUE,
  triggered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_user ON user_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_alerts_active ON user_alerts(is_active) WHERE is_active;

ALTER TABLE user_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_alerts_owner_select ON user_alerts;
DROP POLICY IF EXISTS user_alerts_owner_modify ON user_alerts;

CREATE POLICY user_alerts_owner_select ON user_alerts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY user_alerts_owner_modify ON user_alerts
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── 3. EMAIL PREFERENCES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_email_preferences (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weekly_digest_enabled BOOLEAN DEFAULT TRUE,
  alert_emails_enabled  BOOLEAN DEFAULT TRUE,
  alert_cadence        TEXT    DEFAULT 'daily' CHECK (alert_cadence IN ('instant','daily')),
  unsubscribe_token    TEXT    NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  last_digest_sent_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_prefs_unsub_token ON user_email_preferences(unsubscribe_token);

ALTER TABLE user_email_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_prefs_owner_select ON user_email_preferences;
DROP POLICY IF EXISTS email_prefs_owner_modify ON user_email_preferences;

CREATE POLICY email_prefs_owner_select ON user_email_preferences
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY email_prefs_owner_modify ON user_email_preferences
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());


-- ── 4. PENDING EMAILS QUEUE (service-role only) ──────────────────────────────

CREATE TABLE IF NOT EXISTS pending_emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type    TEXT NOT NULL CHECK (email_type IN ('alert_digest','weekly_digest','alert_instant')),
  payload_json  JSONB NOT NULL,
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  sent_at       TIMESTAMPTZ,
  attempts      INT DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_emails_unsent
  ON pending_emails(scheduled_for) WHERE sent_at IS NULL;

ALTER TABLE pending_emails ENABLE ROW LEVEL SECURITY;
-- No user-facing policies — service role only.


-- ── 5. RPC: get_watchlist_with_prices ────────────────────────────────────────
-- Returns watchlist rows joined with current prices and percent moves.

DROP FUNCTION IF EXISTS get_watchlist_with_prices(UUID);

-- Note: pct_7d / pct_30d are not native columns on card_trends in this DB.
-- Returning NULL placeholders for now; client computes psa10_premium and
-- "since added" change from the raw_at_add / psa10_at_add snapshot columns.
CREATE OR REPLACE FUNCTION get_watchlist_with_prices(p_user_id UUID)
RETURNS TABLE (
  id             UUID,
  card_slug      TEXT,
  card_name      TEXT,
  set_name       TEXT,
  card_url_slug  TEXT,
  image_url      TEXT,
  card_number    TEXT,
  notes          TEXT,
  added_at       TIMESTAMPTZ,
  raw_at_add     BIGINT,
  psa10_at_add   BIGINT,
  current_raw    BIGINT,
  current_psa9   BIGINT,
  current_psa10  BIGINT,
  pct_7d         NUMERIC,
  pct_30d        NUMERIC,
  psa10_premium  NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    w.id,
    w.card_slug,
    w.card_name,
    w.set_name,
    w.card_url_slug,
    w.image_url,
    w.card_number,
    w.notes,
    w.added_at,
    w.raw_at_add,
    w.psa10_at_add,
    ct.current_raw,
    ct.current_psa9,
    ct.current_psa10,
    NULL::NUMERIC AS pct_7d,
    NULL::NUMERIC AS pct_30d,
    CASE
      WHEN ct.current_raw IS NOT NULL AND ct.current_raw > 0 AND ct.current_psa10 IS NOT NULL
      THEN (ct.current_psa10::NUMERIC / ct.current_raw::NUMERIC)
      ELSE NULL
    END AS psa10_premium
  FROM watchlist w
  LEFT JOIN card_trends ct
    ON ct.card_name = w.card_name AND ct.set_name = w.set_name
  WHERE w.user_id = p_user_id
  ORDER BY w.added_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_watchlist_with_prices(UUID) TO authenticated;


-- ── 6. RPC: get_alerts_with_prices ───────────────────────────────────────────

DROP FUNCTION IF EXISTS get_alerts_with_prices(UUID);

CREATE OR REPLACE FUNCTION get_alerts_with_prices(p_user_id UUID)
RETURNS TABLE (
  id              UUID,
  card_slug       TEXT,
  card_name       TEXT,
  set_name        TEXT,
  card_url_slug   TEXT,
  image_url       TEXT,
  grade           TEXT,
  alert_type      TEXT,
  threshold_cents BIGINT,
  is_active       BOOLEAN,
  triggered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ,
  current_cents   BIGINT,
  distance_pct    NUMERIC
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT
    a.id,
    a.card_slug,
    a.card_name,
    a.set_name,
    a.card_url_slug,
    a.image_url,
    a.grade,
    a.alert_type,
    a.threshold_cents,
    a.is_active,
    a.triggered_at,
    a.created_at,
    CASE a.grade
      WHEN 'raw'   THEN ct.current_raw
      WHEN 'psa9'  THEN ct.current_psa9
      WHEN 'psa10' THEN ct.current_psa10
    END AS current_cents,
    CASE
      WHEN a.threshold_cents > 0 AND (
        CASE a.grade
          WHEN 'raw'   THEN ct.current_raw
          WHEN 'psa9'  THEN ct.current_psa9
          WHEN 'psa10' THEN ct.current_psa10
        END
      ) IS NOT NULL
      THEN (
        ((CASE a.grade
            WHEN 'raw'   THEN ct.current_raw
            WHEN 'psa9'  THEN ct.current_psa9
            WHEN 'psa10' THEN ct.current_psa10
          END)::NUMERIC - a.threshold_cents::NUMERIC) / a.threshold_cents::NUMERIC * 100
      )
      ELSE NULL
    END AS distance_pct
  FROM user_alerts a
  LEFT JOIN card_trends ct
    ON ct.card_name = a.card_name AND ct.set_name = a.set_name
  WHERE a.user_id = p_user_id
  ORDER BY a.is_active DESC, a.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_alerts_with_prices(UUID) TO authenticated;


-- ── 7. Auto-create email preferences on first dashboard visit ────────────────

CREATE OR REPLACE FUNCTION ensure_email_preferences()
RETURNS user_email_preferences
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  prefs user_email_preferences;
BEGIN
  INSERT INTO user_email_preferences (user_id)
  VALUES (auth.uid())
  ON CONFLICT (user_id) DO UPDATE SET updated_at = user_email_preferences.updated_at
  RETURNING * INTO prefs;
  RETURN prefs;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_email_preferences() TO authenticated;
