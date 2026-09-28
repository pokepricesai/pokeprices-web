# PokePrices Bing / IndexNow Audit — Executive Summary

Date: 2026-09-28
Scope: PokePrices (Pokémon TCG). MagicPrices not covered.

## Headline numbers

| Metric | Value | Source |
|---|---:|---|
| Cards in DB (all with slug + set_name) | **65,040** | `cards` table, Supabase REST |
| Set pages in DB | 288 | `set_metadata` |
| Pokémon species (all with cards) | 1,025 | `pokemon_species` |
| Insight articles (all published) | 12 | `insights` |
| Card-show events (upcoming, not cancelled) | 32 | `sitemap-card-shows.xml` |
| Static pages | 29 | `sitemap-pages.xml` |
| Creators (approved) | 10 | `creators` (not in sitemap) |
| Vendors (active) | 11 | `vendors` (not in sitemap) |
| **Expected indexable URLs (in sitemaps)** | **64,505** | Sum of live sitemap `<loc>` counts + `seo_kpi_daily.urls_in_sitemap` |
| **Bing sitemap accepted (WMT UrlCount)** | **64,276** | `bing-probe.json` GetFeeds probe 2026-09-19 |
| **Bing indexed (owner-reported)** | **~18,000** | Owner-supplied; not verifiable from repo (see "unknowns") |
| Google `pages_with_impressions_28d` | 30,536 | `seo_kpi_daily` 2026-09-25 |
| **Gap: sitemap → Bing indexed** | **~46,000 URLs (~72% not indexed)** | Computed |

## IndexNow currently operational: **PARTIAL — effectively dormant for bulk**

- Editorial publish path (`/api/cron/publish-scheduled` → `runPostPublish`) submits **one URL per newly-published article**. Only 12 insights exist total, and each triggers IndexNow only on first publish.
- CLI path (`npm run indexnow:changed`) works but is **manual-only**. Nothing in `vercel.json`, `.github/workflows/`, or any DB queue schedules bulk submission of card/set/pokemon URLs.
- `.indexnow-snapshot.json` at the repo root is literally `{}`. It was created on 2026-09-11 as part of the Aug-2026 amplification-hygiene fix (commit `f7770a7`) and has never been updated with any accepted URLs.
- No script in the repo generates the `urls-and-hashes.tsv` file the CLI expects.
- Historical cohort scripts (`build-w46c-cohort.mjs`, `build-w46e-lite-fix1-indexnow.mjs`, `build-card-shows-indexnow.mjs`) are explicitly deprecated and require a `--i-know-this-is-historical` flag to run.

**Result**: since 2026-09-11, IndexNow has almost certainly submitted **only a handful of newly-published article URLs**. Bing has had to discover ~64k URLs almost entirely via slow sitemap crawling.

## Strongest evidence

- **Bing crawl rate = 5/hour for every hour of the day** (`CrawlRate: [5,5,...]` — 24 fives) → **120 URLs/day maximum**. At that rate, crawling 64k URLs takes ~1.5 years. Bing has been active on the site since 2026-03-12 (~6.6 months), which mathematically caps discovered pages around 24k. **This is the single dominant reason for the 18k number.**
- **Zero external backlinks reported** by Bing (`GetLinkCounts` → `Links: [], TotalPages: 0`, root `AnchorCount: 0`). Bing has no authority signal to justify raising the crawl budget.
- **Bing WMT site is verified as `https://pokeprices.io/` (bare)**, but every URL in the sitemap uses `https://www.pokeprices.io/` (www). The bare-domain redirect is **307 Temporary**, not 301 Permanent — canonical consolidation is weaker than it should be.
- **No Bing-source data in `seo_page_rollups`** (0 rows for `source='bing'`). Stage 5B BigQuery ingest has been failing since 2026-09-21 (`bigquery.datasets.create` permission denied), so we currently have no first-party data on what Bing has actually indexed vs. crawled vs. rejected.
- **IndexNow submission history is invisible.** There is no DB table logging submissions, no cron log, no persistent queue. The only artifact is a snapshot file that is empty.

## Likely failure points

Ranked by confidence.

1. **PROVEN** — Bing crawl budget throttled to 5 URLs/hour default rate. Fixing this alone would multiply the crawlable universe over time.
2. **PROVEN** — Bulk IndexNow submission never happens on a schedule. `.indexnow-snapshot.json` is empty; only per-article publish triggers submission; only 12 articles exist.
3. **PROVEN** — Bing WMT site is registered as bare domain; site canonicalises to www; bare→www is 307 not 301. Even if Bing crawls faster, canonical attribution may fragment.
4. **STRONG EVIDENCE** — Zero backlinks per Bing WMT → low crawl priority is expected under Microsoft's crawl-budget heuristics.
5. **STRONG EVIDENCE** — No `urls-and-hashes.tsv` generator exists, so even a diligent operator can't easily run `npm run indexnow:changed` against the full inventory without hand-building the list.
6. **HYPOTHESIS** — Historical Aug-2026 amplification (21k over-submissions from dual-endpoint retry loops) may have reduced Bing's trust in submissions from this host for some period. Requires Bing WMT rate-limit / crawl-throttle data to confirm.

## Unknowns requiring Bing Webmaster Tools data

To close the audit we need the operator to pull from Bing WMT:

1. **IndexNow submission history / dashboard**: how many URLs Bing acknowledges receiving from IndexNow in the last 30/90 days, and how many "resulted in indexation."
2. **URL Inspection for 5–10 representative URLs** from each cohort (cards-1, cards-5, pokemon, sets, insights) — Bing's status: Discovered? Crawled? Indexed? Excluded (Duplicate, Soft-404, Alternate, etc.)? Its verdict per URL is the ground truth we cannot infer.
3. **Sitemap details in WMT**: per-sitemap URL count, "URLs indexed" per sitemap (Bing shows this), and any warnings on the sitemap-cards-* / sitemap-pokemon shards.
4. **Backlinks report** — confirm whether Bing genuinely sees zero backlinks or the API just returns zero for accounts under a threshold.
5. **Crawl-rate override** — check "Crawl Control" in Bing WMT; the current per-hour cap of 5 is either default or set. Increasing this in WMT is the fastest lever we have.
6. **Site variant** — either verify `https://www.pokeprices.io/` in WMT so it becomes the primary tracked property, or (safer) enforce a 301 (not 307) redirect from bare→www.

Everything above is derived from the repo, live HTTP probes, Supabase read-only queries, and the archived `bing-probe*.json` files from the 2026-09-21 diagnostic.
