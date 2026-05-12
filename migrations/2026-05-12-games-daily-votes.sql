-- migrations/2026-05-12-games-daily-votes.sql
-- Tally table + RPC for Daily Pick voting on /games.
-- One row per (date, matchup_id) pair. cast_daily_vote() upserts the row
-- and returns the latest counts so the client can render the result bar
-- immediately without a separate fetch.

CREATE TABLE IF NOT EXISTS public.daily_vote_tallies (
  vote_date       date NOT NULL,
  matchup_id      int  NOT NULL,
  option_a_votes  int  NOT NULL DEFAULT 0,
  option_b_votes  int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vote_date, matchup_id)
);

-- updated_at trigger reuses the helper from earlier migrations
DROP TRIGGER IF EXISTS daily_vote_tallies_updated_at ON public.daily_vote_tallies;
CREATE TRIGGER daily_vote_tallies_updated_at
  BEFORE UPDATE ON public.daily_vote_tallies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.daily_vote_tallies ENABLE ROW LEVEL SECURITY;

-- Anyone can read the tallies (we display them on the games page).
DROP POLICY IF EXISTS "daily_vote_tallies_select" ON public.daily_vote_tallies;
CREATE POLICY "daily_vote_tallies_select"
  ON public.daily_vote_tallies FOR SELECT USING (true);

-- All writes go through the RPC below, which uses SECURITY DEFINER.
-- No direct INSERT / UPDATE / DELETE policies needed.

CREATE OR REPLACE FUNCTION public.cast_daily_vote(
  p_date       date,
  p_matchup_id int,
  p_choice     text  -- 'a' or 'b'
)
RETURNS TABLE (option_a_votes int, option_b_votes int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.daily_vote_tallies (vote_date, matchup_id)
  VALUES (p_date, p_matchup_id)
  ON CONFLICT (vote_date, matchup_id) DO NOTHING;

  IF p_choice = 'a' THEN
    UPDATE public.daily_vote_tallies
       SET option_a_votes = option_a_votes + 1
     WHERE vote_date = p_date AND matchup_id = p_matchup_id;
  ELSIF p_choice = 'b' THEN
    UPDATE public.daily_vote_tallies
       SET option_b_votes = option_b_votes + 1
     WHERE vote_date = p_date AND matchup_id = p_matchup_id;
  ELSE
    RAISE EXCEPTION 'p_choice must be a or b';
  END IF;

  RETURN QUERY
    SELECT t.option_a_votes, t.option_b_votes
      FROM public.daily_vote_tallies t
     WHERE t.vote_date = p_date AND t.matchup_id = p_matchup_id;
END $$;

GRANT EXECUTE ON FUNCTION public.cast_daily_vote(date, int, text) TO anon, authenticated;
