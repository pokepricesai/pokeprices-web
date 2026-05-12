-- migrations/2026-05-12b-cast-daily-vote-fix.sql
-- Fix the ambiguous-column error in cast_daily_vote. The previous version
-- had RETURNS TABLE columns named option_a_votes / option_b_votes that
-- collided with the underlying table column names — PL/pgSQL bails out
-- with "column reference is ambiguous" on the UPDATE.
--
-- Two fixes applied together for belt-and-braces:
--   1. Rename the RETURNS TABLE columns to a_votes / b_votes.
--   2. Use a table alias inside the UPDATE so column references are
--      explicitly the table's columns.
-- The RPC's JSON response keys change from option_a_votes → a_votes etc.,
-- so the client also unpacks the new names.
--
-- Postgres won't let CREATE OR REPLACE change a function's return type, so
-- we drop first.

DROP FUNCTION IF EXISTS public.cast_daily_vote(date, int, text);

CREATE OR REPLACE FUNCTION public.cast_daily_vote(
  p_date       date,
  p_matchup_id int,
  p_choice     text
)
RETURNS TABLE (a_votes int, b_votes int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO public.daily_vote_tallies (vote_date, matchup_id)
  VALUES (p_date, p_matchup_id)
  ON CONFLICT (vote_date, matchup_id) DO NOTHING;

  IF p_choice = 'a' THEN
    UPDATE public.daily_vote_tallies AS t
       SET option_a_votes = t.option_a_votes + 1
     WHERE t.vote_date = p_date AND t.matchup_id = p_matchup_id;
  ELSIF p_choice = 'b' THEN
    UPDATE public.daily_vote_tallies AS t
       SET option_b_votes = t.option_b_votes + 1
     WHERE t.vote_date = p_date AND t.matchup_id = p_matchup_id;
  ELSE
    RAISE EXCEPTION 'p_choice must be a or b';
  END IF;

  RETURN QUERY
    SELECT t.option_a_votes, t.option_b_votes
      FROM public.daily_vote_tallies t
     WHERE t.vote_date = p_date AND t.matchup_id = p_matchup_id;
END $$;

GRANT EXECUTE ON FUNCTION public.cast_daily_vote(date, int, text) TO anon, authenticated;
