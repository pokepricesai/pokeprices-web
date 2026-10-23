-- PP-TCG — materialised candidate snapshot (fixes RPC statement timeout).
--
-- Root cause of the timeout.
--   `v_pp_tcg_card_reconciliation` is a 7-table view with three EXISTS
--   subqueries (prices_market / prices_graded / prices_history) and a
--   CASE-based `outcome` computed in the SELECT list. Postgres cannot
--   push the outcome / risk_class predicates past the view, so even a
--   LIMIT 5 query materialises the view for ~60k candidate rows. The
--   per-request RPC therefore hits the Supabase statement_timeout.
--
-- Fix shape.
--   * Build a persisted MATERIALIZED VIEW containing ONLY strict-eligible
--     rows (both `catalogue_corroborated` and `pricing_restriction` +
--     market_only cases), populated by direct catalogue-table joins so
--     the expensive reconciliation view is never read during population.
--   * Index it on (gsc_rank nulls last, pp_card_slug) for O(log N) ordered
--     retrieval and on pp_card_slug (unique) for CONCURRENT refresh.
--   * Replace `pp_tcg_strict_candidates` with a version that reads the
--     snapshot and NOT EXISTS-filters against the live cohort + run_items.
--     Selection becomes an index-ordered scan + two anti-joins → fast
--     regardless of catalogue size.
--   * A refresh function with its own extended statement_timeout handles
--     the (occasionally slow) one-time populate and future refreshes.
--
-- Invariants preserved.
--   * Identity gates: review_status=approved, confidence=verified,
--     printing_active_status=active, image + market_prices present.
--   * Risk class rule: catalogue_corroborated accepted for both tiers;
--     pricing_restriction accepted ONLY when effective_eligibility=market_only.
--   * Asymmetric graded gate: bulk_safe requires has_graded_prices=true;
--     market_only passes freely (adapter suppresses graded surface).
--   * Per-candidate strictRecheckOne at enrol-time against the live view
--     remains in place; the snapshot is a SELECTION hint, not a safety
--     substitute. If a card falls out of eligibility between snapshot
--     and enrol, the recheck catches it and skips.
--
-- Scales to 36 941 cards. Selection cost is independent of total catalogue size.

set local search_path = public, extensions;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Materialised view — strict-eligible candidate pool.
--
-- Built from the authoritative underlying tables, bypassing the
-- expensive reconciliation view. Inlines the effective-eligibility
-- rank logic from v_pokemon_tcg_effective_eligibility.
-- ─────────────────────────────────────────────────────────────────────
drop materialized view if exists public.pp_tcg_strict_candidate_snapshot;

create materialized view public.pp_tcg_strict_candidate_snapshot as
with base as (
  select
    c.card_slug                              as pp_card_slug,
    c.card_name                              as pp_card_name,
    c.set_name                               as pp_set_name,
    c.language                               as pp_language,
    q.risk_class,
    case
      when q.recommended_pricing_eligibility is null
        then m.pricing_eligibility
      when public.pokemon_tcg_eligibility_rank(q.recommended_pricing_eligibility)
         > public.pokemon_tcg_eligibility_rank(m.pricing_eligibility)
        then q.recommended_pricing_eligibility
      else m.pricing_eligibility
    end                                       as effective_eligibility,
    m.commercial_rank                         as gsc_rank,
    m.tcg_card_id,
    m.tcg_printing_key
  from public.cards c
  inner join public.pokemon_tcg_mappings m
    on m.pp_card_slug = c.card_slug
   and m.provider = 'tcggraph'
  inner join public.pokemon_tcg_mapping_qa q
    on q.mapping_id = m.id
  inner join public.pokemon_tcg_provider_cards pc
    on pc.provider = 'tcggraph'
   and pc.tcg_card_id = m.tcg_card_id
   and pc.tcg_printing_key = m.tcg_printing_key
  where c.is_sealed is not true
    and m.review_status  = 'approved'
    and m.confidence     = 'verified'
    and pc.provider_status = 'active'
    and pc.image_normal is not null
    and q.risk_class in ('catalogue_corroborated', 'pricing_restriction')
)
select
  b.pp_card_slug,
  b.pp_card_name,
  b.pp_set_name,
  b.pp_language,
  b.risk_class,
  b.effective_eligibility,
  b.gsc_rank,
  exists(
    select 1
      from public.pokemon_tcg_prices_graded pg
     where pg.tcg_card_id = b.tcg_card_id
       and pg.provider = 'tcggraph'
  )                                           as has_graded_prices,
  now()                                       as snapshot_at
from base b
where b.effective_eligibility in ('bulk_safe','market_only')
  -- Risk-class rule
  and (
    b.risk_class = 'catalogue_corroborated'
    or (b.risk_class = 'pricing_restriction' and b.effective_eligibility = 'market_only')
  )
  -- Must have exact-printing market price
  and exists(
    select 1 from public.pokemon_tcg_prices_market pm
     where pm.tcg_card_id = b.tcg_card_id
       and pm.tcg_printing_key = b.tcg_printing_key
       and pm.provider = 'tcggraph'
  )
  -- Asymmetric graded gate
  and (
    b.effective_eligibility = 'market_only'
    or exists(
      select 1 from public.pokemon_tcg_prices_graded pg
       where pg.tcg_card_id = b.tcg_card_id
         and pg.provider = 'tcggraph'
    )
  )
with no data;  -- populate separately via refresh fn (10-min timeout)

-- Indexes
create unique index pp_tcg_strict_candidate_snapshot_slug_idx
  on public.pp_tcg_strict_candidate_snapshot (pp_card_slug);

create index pp_tcg_strict_candidate_snapshot_gsc_idx
  on public.pp_tcg_strict_candidate_snapshot (gsc_rank nulls last, pp_card_slug);

create index pp_tcg_strict_candidate_snapshot_lang_idx
  on public.pp_tcg_strict_candidate_snapshot (pp_language);

comment on materialized view public.pp_tcg_strict_candidate_snapshot is
  'PP-TCG strict-eligible candidate pool. Populated by '
  'pp_tcg_strict_candidate_snapshot_refresh(). Replaces the per-request '
  'scan of v_pp_tcg_card_reconciliation that was statement-timing out.';

grant select on public.pp_tcg_strict_candidate_snapshot to service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Refresh function — raises statement_timeout and refreshes the
--    materialised view. Can be invoked once (initial populate) or on
--    cron.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.pp_tcg_strict_candidate_snapshot_refresh(
  p_concurrent boolean default false
)
returns table (rows_in_snapshot bigint, refreshed_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '600s'
as $$
declare
  v_count bigint;
begin
  if p_concurrent then
    -- CONCURRENTLY requires at least one unique index + previously populated data.
    refresh materialized view concurrently public.pp_tcg_strict_candidate_snapshot;
  else
    refresh materialized view public.pp_tcg_strict_candidate_snapshot;
  end if;
  select count(*) into v_count from public.pp_tcg_strict_candidate_snapshot;
  return query select v_count, now();
end;
$$;

revoke all on function public.pp_tcg_strict_candidate_snapshot_refresh(boolean) from public;
grant execute on function public.pp_tcg_strict_candidate_snapshot_refresh(boolean) to service_role;

comment on function public.pp_tcg_strict_candidate_snapshot_refresh(boolean) is
  'Refresh the pp_tcg_strict_candidate_snapshot materialized view. '
  'statement_timeout=600s. Pass p_concurrent=true for subsequent '
  'refreshes to avoid blocking readers (requires view to be populated).';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Replace the selection RPC — now a trivial index-ordered read.
--
-- Signature preserved — enrollRun's call site (sb.rpc('pp_tcg_strict_candidates'))
-- does not change. The old (slow) definition is replaced in-place.
-- ─────────────────────────────────────────────────────────────────────
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
    s.pp_card_slug,
    s.pp_card_name,
    s.pp_set_name,
    s.pp_language,
    'approved_active'::text         as outcome,
    s.risk_class,
    'verified'::text                as confidence,
    'approved'::text                as review_status,
    'active'::text                  as printing_active_status,
    true                            as has_image,
    true                            as has_market_prices,
    s.has_graded_prices,
    s.effective_eligibility,
    s.gsc_rank
  from public.pp_tcg_strict_candidate_snapshot s
  where (p_language is null or p_language = 'any' or s.pp_language = p_language)
    -- Exclude currently-active cohort rows
    and not exists (
      select 1 from public.pokemon_tcg_pilot_cohort c
       where c.pp_card_slug = s.pp_card_slug
         and c.prices_enabled = true
    )
    -- Exclude anything already enrolled in any run
    and not exists (
      select 1 from public.pp_tcg_migration_run_item ri
       where ri.pp_card_slug = s.pp_card_slug
    )
  order by s.gsc_rank nulls last, s.pp_card_slug
  limit greatest(coalesce(p_limit, 0), 0);
$$;

revoke all on function public.pp_tcg_strict_candidates(int, text) from public;
grant execute on function public.pp_tcg_strict_candidates(int, text) to service_role;

comment on function public.pp_tcg_strict_candidates(int, text) is
  'PP-TCG strict-eligible candidate selector. Reads the pre-computed '
  'pp_tcg_strict_candidate_snapshot and excludes active + enrolled slugs. '
  'Scales independently of catalogue size — index-ordered scan on the '
  'snapshot, two anti-joins. Target: < 100 ms for p_limit <= 100 even '
  'at full 36k-card snapshot size.';

-- Reload PostgREST schema so the new function signature is picked up
-- without a manual cache flush.
notify pgrst, 'reload schema';
