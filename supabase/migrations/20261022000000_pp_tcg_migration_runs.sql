-- PP-TCG automated full-catalogue migration — persistence layer.
--
-- Two tables + one atomic claim function. Idempotent on re-run. Safe
-- to apply before any run is created. Does NOT create any run, does
-- NOT mutate any cohort row.
--
-- Scope:
--   - pp_tcg_migration_run         — one row per migration run.
--   - pp_tcg_migration_run_item    — one row per enrolled card.
--   - pp_tcg_migration_claim_batch — atomic SKIP-LOCKED claim RPC.
--
-- RLS:
--   - Enabled, admin-only (public.network_is_admin()). Service-role
--     bypasses RLS; both the cron handler and admin dashboard use the
--     service-role client.
--
-- Safety notes:
--   - No cohort rows are touched by this migration. 24 provider-active
--     cards + 4 thin-data disabled cards + staged expansion rows remain
--     exactly as they are.
--   - No run is created. All runs default to status='draft'.
--   - The claim RPC uses FOR UPDATE SKIP LOCKED so concurrent cron ticks
--     never collide on the same item. Expired leases are reclaimed as
--     the crash-recovery path.

begin;

-- ───────────────────────────────────────────────────────────────────────
-- 1. Runs table
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.pp_tcg_migration_run (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  status        text not null default 'draft'
                check (status in ('draft','ready','running','paused','completed','stopped')),
  started_at    timestamptz,
  stopped_at    timestamptz,
  pause_reason  text,
  config        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pp_tcg_migration_run_status_idx
  on public.pp_tcg_migration_run (status) where status in ('running','paused','ready');

-- ───────────────────────────────────────────────────────────────────────
-- 2. Run-items table (one row per enrolled card)
-- ───────────────────────────────────────────────────────────────────────
create table if not exists public.pp_tcg_migration_run_item (
  id                     uuid primary key default gen_random_uuid(),
  run_id                 uuid not null references public.pp_tcg_migration_run(id) on delete cascade,
  pp_card_slug           text not null,
  gsc_rank               int,
  effective_eligibility  text not null check (effective_eligibility in ('bulk_safe','market_only')),
  priority_tier          text not null,
  priority_rank          int  not null,
  status                 text not null default 'pending'
                         check (status in ('pending','claimed','activated','verified','failed','skipped','rolled_back')),
  attempts               int  not null default 0,
  claim_count            int  not null default 0,
  worker_id              text,
  lease_expires_at       timestamptz,
  claimed_at             timestamptz,
  activated_at           timestamptz,
  verified_at            timestamptz,
  rolled_back_at         timestamptz,
  last_error             text,
  verification_evidence  jsonb,
  updated_at             timestamptz not null default now(),
  unique (run_id, pp_card_slug)
);

create index if not exists pp_tcg_migration_run_item_claim_idx
  on public.pp_tcg_migration_run_item (run_id, status, priority_tier, priority_rank, gsc_rank)
  where status in ('pending','claimed');

create index if not exists pp_tcg_migration_run_item_lease_idx
  on public.pp_tcg_migration_run_item (lease_expires_at)
  where status = 'claimed';

create index if not exists pp_tcg_migration_run_item_terminal_idx
  on public.pp_tcg_migration_run_item (run_id, status, verified_at desc)
  where status in ('verified','failed','rolled_back');

-- ───────────────────────────────────────────────────────────────────────
-- 3. Atomic claim RPC
--    - FOR UPDATE SKIP LOCKED: two concurrent cron invocations never
--      pick the same item.
--    - Re-claims items with expired leases (crash recovery).
--    - Returns full rows for the caller to process.
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.pp_tcg_migration_claim_batch(
  p_run_id              uuid,
  p_batch_size          int,
  p_worker_id           text,
  p_lease_duration_sec  int
)
returns setof public.pp_tcg_migration_run_item
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_batch_size is null or p_batch_size <= 0 then
    return;
  end if;

  return query
  with picked as (
    select id
    from public.pp_tcg_migration_run_item
    where run_id = p_run_id
      and (
        status = 'pending'
        or (status = 'claimed' and lease_expires_at < now())
      )
    order by priority_tier, priority_rank, gsc_rank nulls last, id
    limit p_batch_size
    for update skip locked
  )
  update public.pp_tcg_migration_run_item r
     set status            = 'claimed',
         worker_id         = p_worker_id,
         lease_expires_at  = now() + make_interval(secs => greatest(p_lease_duration_sec, 60)),
         claim_count       = r.claim_count + 1,
         attempts          = r.attempts + 1,
         claimed_at        = coalesce(r.claimed_at, now()),
         updated_at        = now()
    from picked
   where r.id = picked.id
   returning r.*;
end;
$$;

revoke all on function public.pp_tcg_migration_claim_batch(uuid,int,text,int) from public;
grant execute on function public.pp_tcg_migration_claim_batch(uuid,int,text,int) to service_role;

-- ───────────────────────────────────────────────────────────────────────
-- 4. RLS — admin-only read; service-role bypasses RLS entirely.
-- ───────────────────────────────────────────────────────────────────────
alter table public.pp_tcg_migration_run       enable row level security;
alter table public.pp_tcg_migration_run_item  enable row level security;

drop policy if exists pp_tcg_migration_run_admin_r      on public.pp_tcg_migration_run;
drop policy if exists pp_tcg_migration_run_item_admin_r on public.pp_tcg_migration_run_item;

create policy pp_tcg_migration_run_admin_r
  on public.pp_tcg_migration_run
  for select
  using (public.network_is_admin());

create policy pp_tcg_migration_run_item_admin_r
  on public.pp_tcg_migration_run_item
  for select
  using (public.network_is_admin());

-- No INSERT/UPDATE/DELETE policies defined — only service-role (the
-- cron handler + admin server actions) can mutate.

-- ───────────────────────────────────────────────────────────────────────
-- 5. updated_at trigger — keeps the column honest even on partial updates.
-- ───────────────────────────────────────────────────────────────────────
create or replace function public.pp_tcg_migration_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pp_tcg_migration_run_touch      on public.pp_tcg_migration_run;
drop trigger if exists trg_pp_tcg_migration_run_item_touch on public.pp_tcg_migration_run_item;

create trigger trg_pp_tcg_migration_run_touch
  before update on public.pp_tcg_migration_run
  for each row execute function public.pp_tcg_migration_touch_updated_at();

create trigger trg_pp_tcg_migration_run_item_touch
  before update on public.pp_tcg_migration_run_item
  for each row execute function public.pp_tcg_migration_touch_updated_at();

commit;

-- ───────────────────────────────────────────────────────────────────────
-- Verification queries (run manually after applying this migration):
-- ───────────────────────────────────────────────────────────────────────
-- select count(*) from pp_tcg_migration_run;                             -- expect 0
-- select count(*) from pp_tcg_migration_run_item;                        -- expect 0
-- select proname from pg_proc where proname = 'pp_tcg_migration_claim_batch';
-- select tablename from pg_tables where tablename like 'pp_tcg_migration%';
