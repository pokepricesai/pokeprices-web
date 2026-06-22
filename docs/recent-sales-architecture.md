# Recent sales — architecture

Block 4B-W-1 lays the dormant database + typed-code foundation for
PokePrices' "Recent Market Evidence" feature. **No UI, no ingestion,
no public RPCs are activated in this block.** All four new tables are
created empty (with one exception, the bridge backfill), every
feature flag is off, and every existing card-page query keeps its
current shape.

This document explains:

- which repository owns which piece of the pipeline,
- the parser contract (already shipped in the scraper repo as
  `recent_sales_parser@v1`),
- the canonical PokePrices provider-identity convention,
- the table schemas,
- the future stages built on top.

---

## Repositories

| Repo | Responsibility |
|---|---|
| **`pokeprices`** (scraper repo) | Owns the `cards`, `daily_prices`, `card_trends`, `card_volume`, `psa_population` tables. Owns the recent-sales parser (`recent_sales_parser@v1` — 66 tests, 1,113 clean / 10 quarantined / 0 rejected across real fixtures). Owns nightly ingestion runs. |
| **`pokeprices-web`** (this repo) | Owns the customer-facing site, RPCs that read scraper-owned tables, admin tools, and — from Block 4B-W-1 — the **recent-sales schema** (`provider_card_links`, `market_import_runs`, `recent_sales`, `recent_sales_card_allow_list`). |

The recent-sales schema lives in this repo because:

- the customer-facing read paths live here,
- the admin review surface lives here,
- the migrations directory already follows the `YYYY-MM-DD-…` cadence,
- the scraper writes into the schema via a service-role connection,
  not by owning its DDL.

---

## Parser contract (`recent_sales_parser@v1`)

The scraper-side parser extracts, per PriceCharting card page:

| Field | Notes |
|---|---|
| `sale_date` | DATE |
| `marketplace_source` | `ebay` / `heritage` / `goldin` / `tcgplayer` / other |
| `marketplace_country` | ISO-2 when reliable; otherwise NULL |
| `listing_title` | TEXT |
| `sale_price_cents` | INT, must be > 0 |
| `original_price_cents` | INT, Best Offer ask when present |
| `marketplace_item_id` | eBay item id when present — **NOT globally unique** |
| `listing_url` | TEXT |
| `observed_section` | canonical section from one of 19 PriceCharting mappings |
| `grading_company` | one of PSA / CGC / BGS / SGC / TAG / ACE, or NULL |
| `grade` | textual grade |
| `best_offer_status` | none / accepted / unknown |
| `parse_confidence` | INTEGER on the 0–100 scale (not 0-1) |
| `parse_status` | `ok` / `quarantined` / `rejected` |
| `raw_hash` | content hash of the source row — used for **correction lookup**, **NOT** uniqueness |
| `parser_version` | `recent_sales_parser@v1` |
| `anomaly_flags` | JSONB array of flags |
| `raw_metadata` | JSONB; only attached to quarantined / rejected / debug rows |

Japanese pages use a different layout and are a separate future
workstream (`recent_sales_parser_jp@v?` — not yet built).

---

## Identity

### Three identity rules

These are non-negotiable:

| Rule | Why |
|---|---|
| **`provider_sale_key` is the authoritative dedup key.** UNIQUE. | A single PriceCharting-tracked sale appears exactly once in `recent_sales`. The parser composes this key deterministically from sale_date + marketplace + price + listing fingerprint. |
| **`raw_hash` is NOT unique.** | A correction (admin edits a quarantined row → it gets a new `provider_sale_key`) keeps the original row's `raw_hash` for traceability. The same parser may also emit the same `raw_hash` for two different `provider_sale_key`s when the marketplace re-lists. |
| **`marketplace_item_id` is NOT globally unique.** | The same eBay listing can re-appear under a different `observed_section` after provider reclassification, with a fresh `sale_date`. A UNIQUE constraint here would lose data. |

### Bridge: `provider_card_links`

`cards` is owned by the scraper repo. Its de facto primary key is
`card_slug TEXT` (bare numeric). This repo's migrations cannot declare
a hard FK to `cards.card_slug` without knowing the scraper-side
constraint shape, so the bridge stores `card_slug TEXT NULL` as a
**soft reference** (no FK constraint). Application code re-resolves
the link on read.

### Canonical provider identity convention

- For PriceCharting: `provider_card_id` stores the **bare numeric**
  product id (e.g. `"959616"`), **never** the `pc-` prefixed form.
- This is the documented convention used by both the bridge and
  `recent_sales`.
- We do not store both `"pc-959616"` and `"959616"` as separate
  identities. The Stage-1 backfill enforces this.

### pc-prefix call sites (deferred refactor block)

The scraper-owned `daily_prices.card_slug` carries a `pc-` prefix.
Across the web app there are 28 inline conversions in 14 files.
**Block 4B-W-1 does not refactor any of them.** The shared helper
`src/lib/cardSlug.ts` is **only** used by newly added recent-sales
code; existing call sites are left untouched until a dedicated
refactor block. Documented for that future block:

```
src/app/admin/content-studio/ContentStudioClient.tsx          (1)
src/app/dashboard/grading/GradingCalculatorClient.tsx         (4)
src/app/dashboard/portfolio/PortfolioDashboard.tsx            (5)
src/app/dashboard/quick-price/QuickPriceClient.tsx            (2)
src/app/dashboard/sets/SetTrackerClient.tsx                   (1)
src/app/dashboard/watchlist/WatchlistClient.tsx               (3)
src/app/dealer/DealerPageClient.tsx                           (3)
src/app/insights/[slug]/InsightsArticleClient.tsx             (2)
src/app/pokemon/[slug]/page.tsx                               (1)
src/app/scan-test/ScanTestClient.tsx                          (1)
src/app/set/[slug]/SetPageClient.tsx                          (1)
src/app/set/[slug]/card/[cardSlug]/CardPageClient.tsx         (1)
src/components/CardQuickActions.tsx                           (2)
src/lib/contentStudio.ts                                      (comment only)
```

Each refactor must preserve current behaviour byte-for-byte — the
helper exists so the conversion stops drifting, not to change what
the conversion does.

---

## Table schemas

See `migrations/2026-06-17-recent-sales-stage-1.sql` for the
authoritative DDL. Summarised:

### `provider_card_links`

- `id UUID PK`
- `provider TEXT CHECK ∈ ('pricecharting')`
- `provider_card_id TEXT CHECK ~ '^[A-Za-z0-9_-]+$'`
- `card_slug TEXT NULL` — soft reference to `cards.card_slug`
- `language TEXT DEFAULT 'en' CHECK ∈ ('en')`
- `match_method TEXT CHECK ∈ ('automatic','manual','admin_override','heuristic')`
- `confidence NUMERIC(4,3) CHECK 0..1`
- `is_active BOOLEAN DEFAULT TRUE`
- `notes_internal TEXT` — service-role / admin only
- `UNIQUE (provider, provider_card_id, language)`

### `market_import_runs`

Modelled on `email_onboarding_runs` (Block 3D). One row per
scraper / admin invocation. Carries operator-safe counters
(`pages_processed`, `rows_ok`, `rows_quarantined`, `rows_rejected`,
`rows_duplicate`), `duration_ms`, `status` (`running/success/partial/failed`),
`source` (`scraper_nightly/admin_manual/backfill/pilot`),
`parser_version`, `layout_signature`, `notes`. **No PII, no secrets,
no raw HTML.**

### `recent_sales`

Full column list in the migration. The crucial CHECK constraints:

- `provider_sale_key TEXT NOT NULL UNIQUE`
- `parse_status` ∈ `('ok','quarantined','rejected')`
- `review_status` ∈ `('active','superseded','corrected','dismissed')`
  — independent of `parse_status`
- `parse_confidence INT BETWEEN 0 AND 100`
- `sale_price_cents > 0`
- `original_price_cents IS NULL OR > 0`
- `observed_section TEXT` — preserves the parser's canonical value;
  the 19 section mappings are not collapsed into a short enum
- `language TEXT DEFAULT 'en' CHECK ∈ ('en')`
- `import_run_id UUID REFERENCES market_import_runs(id) ON DELETE SET NULL`
- `superseded_by_id UUID REFERENCES recent_sales(id) ON DELETE SET NULL`
- `anomaly_flags JSONB DEFAULT '[]'`
- `raw_metadata JSONB NULL` — application convention: populated only for
  quarantined / rejected / debug rows

### `recent_sales_card_allow_list`

Pilot scope. `(provider, provider_card_id) UNIQUE`. Empty initially —
Stage 2 seeds the technical-pilot cards (currently 58 — see "Pilot allow-list" section below).

---

## parse_status vs review_status

`parse_status` is the **parser's verdict** at ingestion time:

- `ok` — the row is structurally valid.
- `quarantined` — the row needs human review (e.g. price is suspicious,
  marketplace_country was unreliable, listing_title contains "lot of").
- `rejected` — the row is structurally invalid.

`review_status` is the **application / admin lifecycle**:

- `active` — visible to the public read path.
- `superseded` — a corrected version exists; `superseded_by_id` points
  at it.
- `corrected` — the row has been edited by an admin.
- `dismissed` — the admin removed it from the public read path without
  superseding.

The two are intentionally orthogonal. Public RPCs (built in a later
block) always filter on `parse_status = 'ok' AND review_status =
'active'`.

---

## Indexes

All on `recent_sales` unless noted:

| Index | Predicate | Purpose |
|---|---|---|
| pk on `id` | — | identity |
| UNIQUE on `provider_sale_key` | — | dedup |
| `(card_slug, observed_section, sale_date DESC)` | `parse_status='ok' AND review_status='active' AND card_slug IS NOT NULL` | hot read path |
| `(provider, provider_card_id, observed_section, sale_date DESC)` | same | hot read path when bridge unresolved |
| `(parse_status, review_status, import_run_id)` | — | admin queue |
| `(marketplace_source, sale_date DESC)` | — | marketplace breakdown |
| `(last_seen_at DESC)` | — | sitemap-freshness feed |
| `(marketplace_item_id)` | `marketplace_item_id IS NOT NULL AND parse_status='ok' AND review_status='active'` | item-id lookups |
| `(raw_hash)` | — | correction lookup |

Plus on `provider_card_links`: partial index on `(card_slug)` and a
hot lookup on `(provider, provider_card_id, language)`.

Plus on `market_import_runs`: `(started_at DESC)` and `(status,
started_at DESC)` — same shape as `email_onboarding_runs`.

---

## RLS

All four tables have **RLS enabled with no user-facing policies**.
Reads + writes go through the service-role client only. When future
blocks build public RPCs, they will be `SECURITY DEFINER` and apply
the `parse_status='ok' AND review_status='active'` predicate inside
the function body, never as a row-level policy.

---

## Pilot allow-list (`recent_sales_card_allow_list`)

Stage 2 seeds the **technical pilot** into the allow-list — currently
**58 cards** (the count returned by the most recent selector run; see
the "Technical pilot — sizing" subsection below). The scraper
will only write `recent_sales` rows for `(provider, provider_card_id)`
present in this table (and where `enabled = TRUE`) until
`RECENT_SALES_FULL_CATALOGUE='true'` is set in Stage 5.

### Block 4B-W-2A — pilot cohort

Block 4B-W-2A introduces three artefacts:

| Artefact | Purpose |
|---|---|
| `scripts/select-recent-sales-pilot.sql`     | Canonical, deterministic SELECT picking up to 100 candidates across 7 categories. Read-only. The most recent run returned 58 real mapped cards; that 58 is the accepted technical-pilot cohort. |
| `data/recent-sales-pilot-100.json`          | Reviewable JSON manifest. File path retained for stability; `_meta.intended_count` is **58**. Committed as a **scaffold** with real curated card names but synthetic 10-digit placeholder `provider_card_id` values (prefix `9999999`); operator pastes real rows and runs the regenerator before applying the seed migration. |
| `migrations/2026-06-17-recent-sales-pilot-100.sql` | Idempotent seed migration with a `DO $$` post-condition that fails closed if any selected id is unmapped, low-confidence, duplicated, or if the count is not exactly **58**. |

### Technical pilot — sizing

The pilot is sized to **prove the engineering plumbing**, not to be
statistically complete. Its acceptance criteria all concern:

- scraper wiring (selector → parser → Supabase),
- parser execution against a fixed, reviewable cohort,
- service-role inserts into `recent_sales`,
- `provider_sale_key` deduplication across nights,
- correct sparse-card behaviour (zero rows is success),
- correct sealed-product handling (sealed sections, no singles),
- `market_import_runs` accounting (counts reconcile).

Because that is the goal, we accept **58 rows** as the cohort even
though the per-category quotas in the v3 selector intended 100. The
selector's `LIMIT 100` is a cap, not a floor.

### Cohort composition

The pilot uses **minimum coverage + quality top-up**, not fixed
quotas. Each minimum-coverage category must hit at least the floor
below; the remainder fills from a global quality-ranked pool.

| Category                | Min floor (58-card pilot) | Rationale |
|---|---:|---|
| `sealed`                | 10 | Sealed products only (`cards.is_sealed = TRUE`). Validates sealed-page layout signature. |
| `sparse`                | 10 | Expected to have **zero or one** recent sales. Validates no-section behaviour. |
| `difficult_variants`    |  8 | 1st edition / shadowless / reverse holo / promo / stamped / alt art. Validates variant disambiguation. |
| `vintage_or_wotc`       |  8 | WOTC era (Base/Jungle/Fossil/Team Rocket/Gym/Neo + e-Card era). Condition-heavy raw + graded. |
| `psa_or_grade_spread`   |  5 | Raw plus at least one of PSA9/PSA10. Validates grade-spread parsing. |
| `modern_or_recent`      |  1 | SwSh + Scarlet & Violet eras with active price or sales signal. |
| `general_quality`       |  0 (top-up) | Best available eligible cards by global quality score. Fills the remaining slots after minimums are met. |
| **Floor**               | **42** | |
| **Top-up**              | **16** | Filled by general_quality to reach exactly 58. |
| **Total**               | **58** | |

If a future selector run produces more real mapped rows (because the
bridge has grown), we can re-expand the cohort — the validator and
seed migration take `EXPECTED_TOTAL` as a single constant.

### Selection methodology

The selection SQL applies, in order:

1. **Eligibility**: `provider='pricecharting'`, `language='en'`,
   `is_active=TRUE`, `confidence >= 0.900`, `card_slug IS NOT NULL`,
   `provider_card_id` is numeric.
2. **Enrichment**: join to `cards` (for `is_sealed`, `set_name`,
   `card_name`, `set_release_date`), latest `daily_prices` row (cents),
   summed `card_volume.sales_30d`, aggregate `portfolio_items`
   distinct-user count, aggregate `watchlist` distinct-user count.
   **No user identities** are returned.
3. **Independent candidate pools** — one per minimum-coverage category
   plus a `general_quality` pool. A card may qualify for several pools.
   Each pool ranks the full eligible population by a category-specific
   quality score; **no priority cascade**, which is what caused v2's
   `modern_high_volume` empty bucket (modern cards kept being assigned
   to PSA / sparse / difficult before the modern pool saw them).
4. **Sequential pick with anti-join**: minimum cohort taken in the
   order sealed → sparse → difficult → vintage → psa → modern; each
   pool re-ranks after excluding cards taken by earlier pools.
5. **Hard caps** applied via window functions (≤10 Charizard, ≤8
   Pikachu, ≤6 energy/accessory, ≤6 jumbo, ≤8 Topps, ≤20 all-prices-null,
   ≤8 per `set_name`, ≤15 sealed). Cards busting a cap are dropped.
6. **General quality top-up** fills the deficit (16 rows in the 58-card
   technical pilot) with the highest-quality remaining eligibles,
   applying cap-aware ranking so the global caps still hold.
7. Final `LIMIT 100` (cap, not floor — accept what the selector returns).

### Exclusions (hard)

- Japanese-language pages.
- Non-English `language`.
- Confidence below 0.900.
- Missing `card_slug` mapping.
- Non-numeric or malformed `provider_card_id`.
- Items mistakenly marked sealed only because they lack a card number.
- User identifiers, emails, purchase prices, portfolio notes — at any
  stage. The manifest schema explicitly forbids these fields, the
  validator scans for them by name and by `@`-pattern.

### Replacing a bad pilot card

1. Edit `data/recent-sales-pilot-100.json`: replace the offending
   entry (keep the same `primary_category` so totals do not drift).
2. Run `node scripts/regenerate-pilot-migration.mjs` to rewrite
   `migrations/2026-06-17-recent-sales-pilot-100.sql`. Only the lines
   between the `-- BEGIN PILOT_ENTRIES` / `-- END PILOT_ENTRIES`
   sentinels are touched.
3. Run `node scripts/validate-recent-sales-pilot.mjs --strict`.
4. Re-apply the migration. Its `ON CONFLICT (provider,
   provider_card_id) DO UPDATE SET enabled=TRUE, reason=…` makes the
   replacement idempotent; existing pilot rows are not deleted.

### Disabling one row safely

To disable a single pilot card without removing it from the manifest:

```sql
UPDATE public.recent_sales_card_allow_list
   SET enabled = FALSE
 WHERE provider = 'pricecharting'
   AND provider_card_id = '<id>';
```

This stops the scraper from ingesting future sales for that card while
leaving its historical `recent_sales` rows intact (when ingestion
later turns on). The `enabled` flag is the **only** ingestion gate —
deletion is not required and is discouraged because it loses the row's
selection_reason metadata.

### Expected parser behaviours during the pilot

- Modern + vintage + PSA-heavy cards should produce mostly `parse_status='ok'`
  rows with `parse_confidence >= 80`.
- Sparse cards should produce **zero** rows; this is success, not
  failure. The import-run counters should reflect "pages_processed +1,
  rows_ok 0".
- Difficult variants should produce a mix of `ok` and `quarantined`.
  We expect a slightly elevated quarantine rate in this bucket;
  measured rather than assumed.
- Sealed pages should be classified into sealed-specific
  `observed_section` values, never into a singles section.
- Best Offer rows: `sale_price_cents` must equal the **accepted**
  price; the original ask goes into `original_price_cents`.
- `provider_sale_key` deduplication must prevent re-insertion of
  prior nights' sales.

### Acceptance criteria (five-night pilot)

The pilot is considered passing if, across nights 1–5:

| # | Criterion | Threshold |
|---|---|---|
| 1 | Nightly scraper completes normally on every pilot night | success |
| 2 | No additional PriceCharting HTTP requests beyond current cadence | unchanged |
| 3 | Parser does not affect current-price extraction | byte-for-byte unchanged |
| 4 | Mapped page processing rate | ≥ 95% without parser crash |
| 5 | Clean-row rate (`parse_status='ok'`) | ≥ 95% |
| 6 | Quarantine rate (excluding `difficult_variants`) | < 5% |
| 7 | Rejected rate (`parse_status='rejected'`) | < 1% |
| 8 | `provider_sale_key` dedup | no repeated inserts across nights |
| 9 | Layout signature on `market_import_runs` | stable across the five nights |
| 10 | Best Offer rows | `sale_price_cents` = accepted price |
| 11 | No duplicate sale inflation across nights | row counts reconcile to imported nights |
| 12 | Sparse cards | return zero rows without being counted as failures |
| 13 | Sealed products | remain mapped to sealed sections, not singles |
| 14 | Import-run counts | reconcile with inserted/upserted rows ± 0 |
| 15 | Storage growth | measured and reported per night, not assumed |

### Public display during the pilot

**None.** Throughout Blocks 4B-W-2A → 4B-W-2E the pilot is invisible
to customers. No `/api/recent-sales/*` route exists, no card-page
component renders a sales section, no FAQ wording changes, no
`NEXT_PUBLIC_RECENT_SALES_*` env vars exist. Customer-facing copy is
not introduced until the methodology and attribution components ship
in Block 4B-W-4.

---

## Feature flags

All server-only. **None NEXT_PUBLIC.** All fail-closed (any state
other than literal `"true"` reads as off). Registered in
`src/lib/env.ts` and `.env.example`. Reader functions in
`src/lib/recentSales/flags.ts`.

| Name | Gate |
|---|---|
| `RECENT_SALES_INGESTION_ENABLED` | scraper-side writes into `recent_sales` |
| `RECENT_SALES_ADMIN_VIEW_ENABLED` | future `/admin/recent-sales` surface |
| `RECENT_SALES_FREE_PREVIEW_ENABLED` | free customer preview component |
| `RECENT_SALES_PRO_PREVIEW_ENABLED` | locked Pro preview component |
| `RECENT_SALES_FULL_CATALOGUE` | bypass `recent_sales_card_allow_list` |

Vercel server env changes require a fresh deployment before the new
value lands in the bundle.

---

## Deployment order

This block ships **dormant scaffolding**. Recommended:

1. Push this code to `main`. Vercel deploys; no behaviour changes
   anywhere.
2. Apply `migrations/2026-06-17-recent-sales-stage-1.sql` manually
   in the Supabase SQL Editor.
3. Run `scripts/verify-recent-sales-schema.sql` to confirm four
   tables created, RLS enabled, no public policies, indexes present,
   backfill row counts as expected.
4. Confirm `recent_sales`, `recent_sales_card_allow_list`, and
   `market_import_runs` are empty (verification script § K).
5. Leave every flag unset. **Stop.**

Stage 2 (next block) seeds the technical-pilot allow-list (58 cards) and wires the
scraper-side ingestion behind `RECENT_SALES_INGESTION_ENABLED`.

---

## Rollback

The migration is purely additive. If the schema needs to be removed:

```sql
DROP TABLE IF EXISTS public.recent_sales;
DROP TABLE IF EXISTS public.recent_sales_card_allow_list;
DROP TABLE IF EXISTS public.market_import_runs;
DROP TABLE IF EXISTS public.provider_card_links;
```

Order matters because of the FK on `recent_sales.provider_card_link_id
→ provider_card_links(id)` and `recent_sales.import_run_id →
market_import_runs(id)`. Drop the children first, then the parents.

The migration does not modify any existing table; reverting code (via
`git revert`) plus the four DROPs above restores the system to its
pre-block state.

---

## Future admin review (Block 4B-W-3)

A later block will add:

- `GET /api/admin/recent-sales` — paginated quarantine queue + recent
  import_runs (gated by `RECENT_SALES_ADMIN_VIEW_ENABLED`).
- `POST /api/admin/recent-sales/:id/approve` — flips
  `parse_status='ok'`.
- `POST /api/admin/recent-sales/:id/reject` — sets
  `review_status='dismissed'`.
- `POST /api/admin/recent-sales/:id/correct` — inserts a corrected
  row, points `superseded_by_id` from the old row to the new row.
- `/admin/recent-sales` panel under `/admin/content-studio` styled on
  the Block 3D `OnboardingAutomationStatus` panel.

Every admin action is gated by `requireAdmin` (Block 1A).

---

## Future public RPCs (Block 4B-W-4+)

All `SECURITY DEFINER`, all preserve the `parse_status='ok' AND
review_status='active'` filter:

| RPC | Purpose |
|---|---|
| `rms_recent_sales(card_slug, observed_section, limit)` | most-recent N clean sales |
| `rms_latest_sale(card_slug, observed_section)` | single most-recent sale |
| `rms_summary_30d(card_slug, observed_section)` | sample count, median, p10-p90 range, marketplace split, best-offer count, freshness score |
| `rms_grade_breakdown(card_slug)` | one row per observed_section |

All currency fields return CENTS, USD (matching the existing
RPC convention).

---

## Future Free / locked Pro split

- **Free preview** (Block 4B-W-4): below the grade ladder on card
  pages. Shows: sample count, freshness chip, most-recent **one**
  clean observed sale (date / marketplace / condition / price).
  Source attribution: "PriceCharting". Gated by
  `RECENT_SALES_FREE_PREVIEW_ENABLED`.
- **Locked Pro preview** (Block 4B-W-5): below the Free preview.
  Shows a blurred summary of grade splits + median + marketplace
  breakdown, with a single "Notify me" CTA. **No checkout, no fake
  prices, no fake launch dates.** Gated by
  `RECENT_SALES_PRO_PREVIEW_ENABLED`.

---

## Japanese compatibility

The schema is already language-aware (`language TEXT` columns on
`provider_card_links` and `recent_sales`). The CHECK constraints
strict-allow `('en')` at Stage 1; a future migration extends the
allow-list to `('en','ja')` when the Japanese parser ships.

No code in this block reads or writes `language != 'en'`.

---

## Methodology language

Customer-facing copy in future blocks **must** use these terms:

- "Recent Market Evidence"
- "Observed Sales"
- "PriceCharting-tracked marketplace sales"

The following claims are **prohibited**:

- "Complete sales history"
- "Verified global market"
- "Guaranteed market value"
- "All sales"
- "Every sale" — PriceCharting tracks marketplace sales, not every
  transaction.

The block's audit produced a single new attribution component
(future work) that every price tile will use. Until that lands, the
existing FAQ language is preserved unchanged.

---

## Testing

- `src/lib/__tests__/cardSlug.test.ts` — 16 cases covering bare /
  prefixed / idempotent / malformed / type narrowing /
  cross-helper invariants / PriceCharting URL extraction.
- `src/lib/recentSales/__tests__/types.test.ts` — enums match SQL
  CHECK constraints; `parse_status` and `review_status` enum
  vocabularies do not overlap.
- `src/lib/recentSales/__tests__/flags.test.ts` — fail-closed defaults;
  literal-"true" only; flag isolation.
- `src/lib/recentSales/__tests__/noLeakage.test.ts` — codifies the
  "no behaviour change" guarantee at build time: no NEXT_PUBLIC
  recent-sales identifier anywhere in `src/`, no public card-page
  component imports recent-sales code, no `/api/recent-sales/*`
  route exists, the documented pricing RPCs are still referenced,
  the migration is additive with no DROP/TRUNCATE/ALTER on
  pre-existing tables.
- `scripts/verify-recent-sales-schema.sql` — read-only post-apply
  verification queries: table existence, RLS, no public policies,
  expected indexes, backfill counts, duplicate-identity check,
  Stage-1-invariant emptiness assertions.
- `src/lib/recentSales/__tests__/pilot.test.ts` (Block 4B-W-2A) —
  manifest invariants (58 entries — the technical-pilot target;
  each minimum-coverage category meets its floor; unique provider
  ids + card_slugs; numeric id; confidence ≥ 0.900; sealed correctness;
  sparse correctness; no PII); migration invariants (additive,
  ON CONFLICT idempotency, DO $$ post-condition, exactly 58 VALUES
  rows between the BEGIN/END sentinels, no INSERT into `recent_sales`
  or `market_import_runs`); selection and
  verify SQL are read-only; no source file under `src/` imports the
  manifest or references the placeholder marker.
- `scripts/validate-recent-sales-pilot.mjs` (Block 4B-W-2A) — offline
  Node validator with default / `--strict-ids` / `--strict-count` /
  `--strict` modes. Default passes for the scaffold; `--strict` is
  what the operator runs before applying the seed migration.
- `scripts/verify-recent-sales-pilot.sql` (Block 4B-W-2A) — read-only
  post-apply verification with category counts, link-validity check,
  duplicate-id check, sealed/sparse counts, modern/vintage split,
  price-band distribution, and Stage-1 emptiness invariants.

---

## What this block does NOT do

- No public UI.
- No card-page metadata change.
- No SEO copy change.
- No PriceCharting attribution component (deferred).
- No FAQ wording change.
- No public RPCs.
- No scraper-side integration.
- No admin review surface.
- No pc-prefix call site refactor.
- No `recent_sales`, `recent_sales_card_allow_list`, or
  `market_import_runs` rows inserted.
- No feature flag is on by default.
