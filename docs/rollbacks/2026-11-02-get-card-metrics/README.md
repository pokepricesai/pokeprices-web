# get_card_metrics(text) — performance fix, 2026-11-02

Three artefacts live together as the full package for the proposed fix of `public.get_card_metrics(text)` on Supabase project `egidpsrkqvymvioidatc`:

| File | Role | Location |
|---|---|---|
| `rollback.sql` | Original production function body, verbatim. One-statement atomic restore via Supabase SQL Editor. | this directory |
| `v2-test.sql` | Restricted equivalence test. Installs `migration_test.get_card_metrics_v2` (service_role only), validates against direct-index ground truth, drops schema before commit. Transaction aborts on any assertion failure. | this directory |
| `_proposed_2026-11-02b-get-card-metrics-fix.sql` | Forward migration. Renamed to `2026-11-02b-get-card-metrics-fix.sql` at commit time. | `pokeprices-web/migrations/` |

The rollback and test are deliberately NOT in `pokeprices-web/migrations/`. That directory is manual-apply today (verified: no `vercel.json` / `vercel.ts` / `supabase/config.toml` / `supabase/migrations/` / `.github/workflows` / `package.json` migrate script); storing executable rollback and test SQL outside it is a defensive hedge against that changing.

---

## What the fix is

Remove three dead-code OR branches from the function body. These are the only edits against the rollback:

```diff
 FROM cards c
 JOIN metrics_daily m
     ON m.card_slug = c.card_slug
-    OR m.card_slug = 'pc-' || c.card_slug
 LEFT JOIN card_volume cv
     ON cv.card_slug = c.card_slug
 WHERE c.card_slug = clean_slug
-   OR m.card_slug = clean_slug
-   OR m.card_slug = 'pc-' || clean_slug
 ORDER BY m.grade ASC NULLS LAST
 LIMIT 10
```

Three lines removed. Zero added. No reorder, no whitespace change elsewhere.

Everything else is byte-identical to the rollback: `RETURNS json`, `LANGUAGE plpgsql`, `DECLARE` block, `clean_slug` CASE, all 24 fields in the SELECT list (`card_name` through `confidence`), `LEFT JOIN card_volume` (grade matching unchanged), `ORDER BY m.grade ASC NULLS LAST`, `LIMIT 10`, `json_build_object('results', ...)`, `COALESCE(..., '[]'::json)`, trailing `RETURN COALESCE(result, json_build_object('results', '[]'::json))`.

### Why the removed branches are dead

Verified live against production 2026-11-02:

```
metrics_daily rows WHERE card_slug LIKE 'pc-%'  :  0 / 2,535,551
card_volume   rows WHERE card_slug LIKE 'pc-%'  :  0 / 253,350
cards         rows WHERE card_slug LIKE 'pc-%'  :  0 / 65,040
```

Both removed JOIN/WHERE disjuncts can never match a row. The `m.card_slug = clean_slug` WHERE disjunct is also redundant once the JOIN is tightened: any surviving `metrics_daily` row then has the same `card_slug` as its joined `cards` row, so filtering on either column is equivalent.

### Why it matters

EXPLAIN cost drops from 402,345.53 to 1.14. The OR-join is a known Postgres antipattern — the planner cannot use index-nested-loop and falls back to BitmapOr over the whole `metrics_daily` table (2.5M rows). The runtime effect was SQLSTATE 57014 timeouts observed in Supabase logs.

---

## Grants and ownership

`CREATE OR REPLACE FUNCTION` preserves the existing owner and all EXECUTE privileges. The signature `public.get_card_metrics(text)` is unchanged, so PostgREST treats this as the same callable RPC. **No GRANT statements are included** in either `rollback.sql` or the forward fix, and none should be added. Including GRANT statements risks silently widening or narrowing access as a side-effect.

---

## Execution sequence

### Step 1 — operator reviews the three files

- `rollback.sql` here.
- `v2-test.sql` here.
- `_proposed_2026-11-02b-get-card-metrics-fix.sql` in `pokeprices-web/migrations/`.

### Step 2 — operator runs the v2 test in Supabase SQL Editor

Supabase Studio → SQL Editor → New query → paste the full contents of `v2-test.sql` → Run.

- On PASS: `Messages` tab contains a final table-style report (one line per test case with expected vs got + duration_ms) then `All assertions passed.`. The transaction COMMITs cleanly. Nothing is left behind — the `migration_test` schema was dropped before the commit.
- On FAIL: a `RAISE EXCEPTION` fires with an assertion identifier (e.g. `5b FAIL: ...`). The transaction ROLLBACKs. The `migration_test` schema does not exist afterwards.

### Step 3 — operator reports test outcome back here

Paste the `Messages` tab contents into chat. Do NOT proceed to the production replacement without that handoff.

### Step 4 — on test pass AND explicit approval, apply the fix

Supabase Studio → SQL Editor → New query → paste the full contents of `_proposed_2026-11-02b-get-card-metrics-fix.sql` (the entire `CREATE OR REPLACE FUNCTION ... $function$;` block, no GRANT lines) → Run.

### Step 5 — immediate verification against production

Supabase SQL Editor, same session:

```sql
-- Measure one invocation; expect well under 1000 ms (planner cost suggests single-digit ms).
DO $$
DECLARE
    t0 timestamptz := clock_timestamp();
    r  json;
BEGIN
    r := public.get_card_metrics('715593');
    RAISE NOTICE 'duration_ms=%.3f, rows=%',
        EXTRACT(EPOCH FROM (clock_timestamp() - t0)) * 1000,
        COALESCE(json_array_length(r->'results'), 0);
END $$;
```

The NOTICE line is the measurement — Supabase SQL Editor does NOT support psql's `\timing on` meta-command.

### Step 6 — rename and commit the forward migration

```bash
cd pokeprices-web
mv migrations/_proposed_2026-11-02b-get-card-metrics-fix.sql \
   migrations/2026-11-02b-get-card-metrics-fix.sql
git add migrations/2026-11-02b-get-card-metrics-fix.sql
git commit -m "fix(db,perf): remove dead OR branches from get_card_metrics"
git push
```

The forward migration file is the only artefact committed to `pokeprices-web/migrations/`. The rollback and the test stay under `docs/rollbacks/2026-11-02-get-card-metrics/` and are also version-controlled, but outside the migrations tree.

### Step 7 — monitoring windows

Monitor each of these for 24h post-apply, polling at T+15m, T+1h, T+6h, T+24h.

**Signal A — RPC latency (direct measurement).** Supabase SQL Editor, same `clock_timestamp()` pattern as Step 5. Run against the busy slug (`715593`), the pc-prefix (`pc-715593`), and a cold slug of your choosing. Expect under 100ms once warm.

**Signal B — API route response quality.** Vercel Dashboard → `pokeprices-web` → Observability → Requests → filter path = `/api/card/[cardSlug]/extras`. Compare 48h window before vs after. Watch for:
- Status 200 vs 500 ratio.
- Response header `Cache-Control` distribution: `s-maxage=86400` (healthy) vs `s-maxage=3600` (one of the five chunks errored).
- p50 and p95 of the route handler duration.

**Signal C — SQLSTATE 57014 timeout count.** Supabase Studio → Logs → Postgres Logs. Apply the filter:
```
severity = ERROR  AND  sql_state_code = '57014'
```
Do NOT filter by `event_message ILIKE '%get_card_metrics%'` — log messages may be truncated or encoded differently from the function name. Count ALL `57014` errors per hour; expect a sharp fall if the hypothesis is right.

**Signal D — shared-infra connection pool health.** Supabase Studio → Reports → Database → Connections. 48h before vs after. If pool queue depth and `numbackends` normalise, the migration also relieved pressure for the four sibling sites (MTG, YGO, OP, Lorcana) sharing the same project. Flat means other causes dominate.

---

## What this fix does NOT do

- It does NOT translate URL-slug (`charizard-1st-edition-4`) → `cards.card_slug` (`715593`). The API route `/api/card/[cardSlug]/extras` passes the kebab URL slug verbatim to the function; the function only resolves bare numeric or `pc-`-prefixed numeric. All production card pages that use the kebab URL pattern receive `{"results":[]}` with HTTP 200 and render fallback copy for the metrics tiles. This defect is **recorded, not fixed in this migration** — out of scope. A follow-up ticket should add a `JOIN cards c2 ON c2.card_url_slug = clean_slug OR c2.card_slug = clean_slug` type change.
- It does NOT change any index.
- It does NOT change the API route or client code.
- It does NOT change `card_volume` grade matching, historical metric selection, affiliate functionality, or any other network function.
- It does NOT resolve the open Google visibility collapse. That stays on its own P0 track.
