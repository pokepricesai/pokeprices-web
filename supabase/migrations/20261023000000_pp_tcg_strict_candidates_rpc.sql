-- PP-TCG — scalable DB-side strict candidate selector.
--
-- Replaces the application-side fetch-and-filter path. Previously the
-- canary scanner fetched (limit + fixed_headroom) rows, then applied
-- active-set + enrolled-set exclusions in JS. As the active count
-- grows, that fixed headroom becomes insufficient and selection stalls.
--
-- This RPC pushes EVERY filter into Postgres:
--   * every strict-eligibility gate (identity, review, printing, image,
--     market prices, asymmetric graded)
--   * the new risk-class rule: catalogue_corroborated OR
--     (pricing_restriction AND effective_eligibility=market_only)
--   * NOT IN pokemon_tcg_pilot_cohort WHERE prices_enabled=true
--     (exclude currently active cards)
--   * NOT IN pp_tcg_migration_run_item (exclude anything already
--     enrolled in any run)
--   * ORDER BY gsc_rank NULLS LAST, pp_card_slug
--   * LIMIT p_limit (exact N returned)
--
-- Zero application-side filtering. Zero fixed-headroom overfetch.
-- Resumable: run after run, newly eligible cards appear as upstream
-- catalogue state changes without any further migration-side work.

set local search_path = public, extensions;

create or replace function public.pp_tcg_strict_candidates(
  p_limit    int,
  p_language text default null
) returns table (
  pp_card_slug           text,
  pp_card_name           text,
  pp_set_name            text,
  pp_language            text,
  outcome                text,
  risk_class             text,
  confidence             text,
  review_status          text,
  printing_active_status text,
  has_image              boolean,
  has_market_prices      boolean,
  has_graded_prices      boolean,
  effective_eligibility  text,
  gsc_rank               int
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    v.pp_card_slug, v.pp_card_name, v.pp_set_name, v.pp_language,
    v.outcome, v.risk_class, v.confidence, v.review_status,
    v.printing_active_status, v.has_image, v.has_market_prices,
    v.has_graded_prices, v.effective_eligibility, v.gsc_rank
  from public.v_pp_tcg_card_reconciliation v
  where v.outcome                 = 'approved_active'
    and v.confidence              = 'verified'
    and v.review_status           = 'approved'
    and v.printing_active_status  = 'active'
    and v.has_image               = true
    and v.has_market_prices       = true
    and v.effective_eligibility   in ('bulk_safe','market_only')
    -- Risk class rule: catalogue_corroborated accepted for both tiers;
    -- pricing_restriction accepted only when effective_eligibility=market_only.
    and (
      v.risk_class = 'catalogue_corroborated'
      or (v.risk_class = 'pricing_restriction' and v.effective_eligibility = 'market_only')
    )
    -- Asymmetric graded gate (independently guarded by the risk-class rule above,
    -- but kept explicit to prevent regressions on catalogue_corroborated rows).
    and (v.effective_eligibility = 'market_only' or v.has_graded_prices = true)
    -- Language scope
    and (p_language is null or p_language = 'any' or v.pp_language = p_language)
    -- Exclude currently-active cohort rows
    and not exists (
      select 1 from public.pokemon_tcg_pilot_cohort c
       where c.pp_card_slug = v.pp_card_slug and c.prices_enabled = true
    )
    -- Exclude anything already enrolled in any run (any status).
    and not exists (
      select 1 from public.pp_tcg_migration_run_item ri
       where ri.pp_card_slug = v.pp_card_slug
    )
  order by v.gsc_rank nulls last, v.pp_card_slug
  limit greatest(coalesce(p_limit, 0), 0);
$$;

revoke all on function public.pp_tcg_strict_candidates(int, text) from public;
grant execute on function public.pp_tcg_strict_candidates(int, text) to service_role;

comment on function public.pp_tcg_strict_candidates(int, text) is
  'Scalable strict-eligible candidate selector for PP-TCG migration. '
  'Pushes all strict filters, risk-class rule (incl. pricing_restriction + market_only), '
  'active/enrolled exclusions, GSC ordering and LIMIT into a single Postgres query. '
  'Replaces the former application-side fetch-and-filter path, which stalled as the '
  'active cohort grew.';
