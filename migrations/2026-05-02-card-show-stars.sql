-- 2026-05-02 — Card Show stars (per-user favourites)
-- ===================================================
-- Lets logged-in users star upcoming card shows so they appear on the
-- /dashboard/card-shows planner.
--
-- show_id is the static CardShow.id from src/data/cardShows.ts (a string
-- like "us-collect-a-con-dallas-2026-10"). It's a TEXT key, not a foreign
-- key, because the events live in a static .ts file rather than a table.
-- Loose coupling is fine: when a show drops out of the list the star
-- becomes a dangling row that the dashboard simply ignores.

CREATE TABLE IF NOT EXISTS card_show_stars (
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  show_id    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, show_id)
);

CREATE INDEX IF NOT EXISTS idx_card_show_stars_user_created
  ON card_show_stars (user_id, created_at DESC);

ALTER TABLE card_show_stars ENABLE ROW LEVEL SECURITY;

-- Users can only see their own stars
DROP POLICY IF EXISTS "card_show_stars_select_own" ON card_show_stars;
CREATE POLICY "card_show_stars_select_own"
  ON card_show_stars
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can only insert stars for themselves
DROP POLICY IF EXISTS "card_show_stars_insert_own" ON card_show_stars;
CREATE POLICY "card_show_stars_insert_own"
  ON card_show_stars
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own stars
DROP POLICY IF EXISTS "card_show_stars_delete_own" ON card_show_stars;
CREATE POLICY "card_show_stars_delete_own"
  ON card_show_stars
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
