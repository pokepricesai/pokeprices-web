# PokePrices Bing / IndexNow — Recommended Fix Plan

Date: 2026-09-28. Do not implement without owner approval; every item below is a proposal, not an action taken.

Ranking: **P0** — definite serious indexing fault. **P1** — highly likely meaningful issue. **P2** — optimisation / uncertain impact. **P3** — observation only.

---

## P0 — Raise Bing's crawl rate in Bing Webmaster Tools

- **Evidence**: `bing-probe.json` → `GetCrawlSettings` returns `CrawlRate: [5,5,...,5]` (24 hours × 5 = 120 URLs/day). At that ceiling, Bing can crawl at most ~24k URLs in the ~200 days since the site was discovered (2026-03-12). Owner reports ~18k indexed. The ceiling explains ~all of the gap; increasing it is the single biggest lever available.
- **Impact**: The only ceiling actively binding today. Doubling the crawl rate should double the addressable indexation rate.
- **Proposed fix**: In Bing Webmaster Tools → Crawl Control, raise the crawl rate to the maximum the account allows for every hour. This is a WMT-side setting; no code change required. **Owner must do this manually — audit can't submit it.**
- **Risk**: Very low. Vercel + Cloudflare in front of the site handle bursts fine.
- **Verify afterward**: Re-run the WMT `GetCrawlSettings` probe (see `bing-probe.json` code path) and confirm the new value. Watch `CrawlStats.CrawledPages` climb over 7–14 days.

## P0 — Fix the site variant / canonical mismatch with Bing

- **Evidence**: Bing WMT has `https://pokeprices.io/` (bare) verified. Every URL in the sitemap uses `https://www.pokeprices.io/` (www). `https://pokeprices.io/` → `https://www.pokeprices.io/` is a **307 Temporary Redirect**, not 301 Permanent. Bing's crawler still tracks the bare-domain property while the sitemap teaches it www, leading to split canonical attribution.
- **Impact**: When Bing crawls a card URL, it lands on the www variant (200 OK, self-canonical www) and should record indexation under the www URL — but WMT's "site" is bare, so aggregate crawl/index counts may be under-attributed. It also means URL Inspection tests via WMT can be ambiguous.
- **Proposed fix (two options, both required)**:
  1. **Also verify `https://www.pokeprices.io/` in Bing WMT** as a separate property; this is the shape that matches every URL you actually ship. Keep the bare-domain property registered too.
  2. **Change bare→www redirect from 307 to 301**. This is a Vercel / Cloudflare-level rule (bare-domain project → redirect config). Confirm which layer performs the redirect today.
- **Risk**: Very low. 301 is the correct canonical redirect and is safer than 307 for SEO.
- **Verify afterward**: `curl -I https://pokeprices.io/` should show `HTTP/1.1 301 Moved Permanently`. Both site variants in WMT will begin to show data; over time WMT will consolidate on the www property.

## P1 — Ship a scheduled bulk IndexNow submission cron

- **Evidence**:
  - No cron in `vercel.json` invokes bulk IndexNow.
  - `.indexnow-snapshot.json` is `{}` — no prior successful submissions have been recorded since it was added on 2026-09-11.
  - No script in the repo produces the `urls-and-hashes.tsv` input file expected by `npm run indexnow:changed --file`.
  - The only automatic IndexNow trigger is per-article publish — 12 URLs total.
- **Impact**: Bing has to discover 64k URLs via crawl alone at 120/day. IndexNow should have been shortcutting this since May 2026. Doing so now, on a diff-only basis, adds a compounding second discovery channel independent of crawl budget.
- **Proposed fix (design, not implementation)**:
  1. Add a Node CLI or edge cron endpoint (e.g. `/api/cron/indexnow-refresh`) that:
     - Enumerates every URL from `seo_pages` where `in_sitemap = true` AND `is_indexable_now = true` (single Supabase query — table already exists per Stage 4C).
     - Computes a stable content hash per URL from a lightweight signature: `(page_family, entity_id, price_hash, updated_at)` — no need to fetch HTML.
     - Writes a `urls-and-hashes.tsv` to a temp path and shells out to the existing CLI in `--changed-only --snapshot .indexnow-snapshot.json` mode. Or, better, wire the pure logic in `src/lib/indexnow/submitter.mjs` directly into the cron handler and skip the file round-trip.
  2. Persist the snapshot back to Supabase (a new `indexnow_snapshot` KV table), not the repo — the current git-file model breaks in production because Vercel functions cannot write to git.
  3. Add a submission-run log table (`indexnow_runs` mirroring `seo_bq_ingest_runs`) so we can prove submissions happened.
  4. Schedule at low cadence to start: hourly with a per-run cap of, say, 500 URLs. Grow after we see behaviour.
- **Risk (of the design as sketched)**: The Aug-2026 amplification lesson is *not* to blast the same URLs twice. Snapshot + hash guarantee that. Also cap batch size (already `MAX_BATCH_SIZE=1000` per submitter) and enforce a hard per-day URL ceiling in the cron.
- **Verify afterward**: `indexnow_runs` table grows daily; Bing WMT → IndexNow tab shows submitted counts climbing.

## P1 — Add creators + vendors to a sitemap

- **Evidence**: 10 approved creators, 11 active vendors. Both have public `/creators/[slug]` and `/vendors/[slug]` routes; neither is in any sitemap.
- **Impact**: Small (21 URLs), but the divergence between "URL exists" and "sitemap knows about it" is a smell auditors will flag.
- **Proposed fix**: Add either two more sub-sitemaps or extend `sitemap-pages.xml` with the currently active rows via a Supabase query. Either shape works.
- **Risk**: None.
- **Verify afterward**: Live sitemap probe shows the new URLs; `seo_pages.in_sitemap` flips to true for those rows next ingest.

## P1 — Unblock the Stage 5B Bing BigQuery ingest

- **Evidence**: `bing-run1.json` / `bing-run2.json` both fail with `bigquery.datasets.create` permission denied. `seo_page_rollups` has 0 rows for `source='bing'`. Mission Control has zero first-party visibility into Bing today.
- **Impact**: Without this, we can never answer *"which cohort is Bing indexing vs skipping?"* from our own data. Every audit becomes a manual WMT probe like `bing-probe.json`.
- **Proposed fix**:
  1. Fix the IAM: grant the Vercel-OIDC → WIF → SA principal `bigquery.dataEditor` (or, minimally, `bigquery.datasets.create` on the target project). Owner-level GCP action.
  2. Re-run `/api/cron/seo-bing-daily` manually; confirm one row lands in `seo_bq_ingest_runs` with `source='bing'` and `status='ok'`.
- **Risk**: Very low — a controlled permission grant on a dedicated `pokeprices-seo` project.
- **Verify afterward**: `seo_page_rollups` starts populating rows with `source='bing'`; the next audit can compare Bing indexation per URL directly against the sitemap.

## P2 — Migrate `.indexnow-snapshot.json` off git

- **Evidence**: Snapshot currently sits at repo root, tracked in git. This works only if a human commits after every successful run — a manual step nobody has performed. In practice the file has stayed empty for 17 days.
- **Impact**: Even if bulk cron lands (see P1), a git-file snapshot cannot survive Vercel's read-only filesystem. The snapshot MUST live in Supabase (or Vercel Blob) to be useful.
- **Proposed fix**: Introduce an `indexnow_snapshot` table keyed by URL with a `content_hash text` column. Update `src/lib/indexnow/submitter.mjs` callers to load/persist from Supabase instead of the JSON file. Retire `.indexnow-snapshot.json`.
- **Risk**: Low — the pure logic already accepts a `Map<string,string>` for snapshots; only the CLI wrapper reads the JSON file.
- **Verify afterward**: Delete the file; run the cron; confirm the DB row count grows.

## P2 — Consider raising the 7-day price freshness window for sitemap-cards

- **Evidence**: `src/lib/seo-indexability/sitemapCards.ts:70` sets `RECENT_PRICE_WINDOW_DAYS = 7`. Cards with only prices older than 7 days fall out of the sitemap until the scraper produces fresh data. This shows up as ~1,900 cards excluded today.
- **Impact**: A card that used to be in the sitemap disappearing for a day or two teaches search engines it's soft-removed. When it reappears they may re-crawl and re-index — burning crawl budget for no lasting gain.
- **Proposed fix**: Widen to 30 days, or use `MAX(price_signal_date)` per card and gate at ≤ 90 days. This retains the "no thin pages" guard while smoothing sitemap membership.
- **Risk**: Low. Adds ~1,900 cards to the sitemap; only affects Bing/Google discovery, not the on-page render.
- **Verify afterward**: Sitemap card count rises to ~65,000; `seo_pages.in_sitemap` flips for the newly-included cards.

## P2 — Reduce the 1 MB Pokémon-page payload

- **Evidence**: Sampled `/pokemon/pikachu` was **1.6 MB with 652 `<a>` tags**. Not thin — the opposite: possibly over-dense.
- **Impact**: Rendering that many links in a server component is fine but risks content-density heuristics on lower-authority engines and lengthens time-to-interactive. Not a proven indexation cause.
- **Proposed fix**: Paginate or lazy-render the card grid on Pokémon pages. This is a UX/perf change with SEO adjacency, not an SEO fix per se.
- **Risk**: Medium — care needed to keep at least the top ~30–50 cards server-rendered so internal-link value survives.
- **Verify afterward**: Page weight down; Lighthouse `Total Blocking Time` improves; no drop in `pages_with_impressions_28d` for the `/pokemon/*` cohort.

## P3 — Observations (no action recommended immediately)

- `sitemap-cards-*.xml` sharding is hand-sliced; when `cards` exceeds 100k the tail will silently drop. Non-urgent — headroom is ~35k rows.
- The `robots.txt` `Disallow` list matches the submitter's rejected-path prefixes exactly. No divergence to fix.
- All 130 sampled URLs render correct self-referential canonicals with the www hostname. No canonical-collapse bugs.
- Legacy URL patterns (`/card/{id}`, `/cards/pc-{id}`) all return proper 404. No redirect chain to maintain.

---

## Summary priority order

1. **Bing WMT Crawl Control** — raise crawl rate.
2. **Bing WMT** — verify `https://www.pokeprices.io/` as a second property, then convert bare→www redirect to 301.
3. **Ship a scheduled bulk-IndexNow cron** with DB-backed snapshot.
4. **Fix GCP IAM** so Stage 5B Bing ingest lands and Mission Control regains first-party visibility.
5. Add creators + vendors to a sitemap.
6. Migrate snapshot off git; widen price-freshness window; consider Pokémon-page pagination.

Nothing above is "urgent because the site is broken" — the site is behaving as designed. The gap is between what was designed (manual submission, default crawl rate) and what a 65k-URL site actually needs (automated submission + higher crawl rate + first-party Bing telemetry).
