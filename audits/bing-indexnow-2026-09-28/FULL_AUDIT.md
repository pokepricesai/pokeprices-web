# PokePrices — Full Bing / IndexNow Audit

Date: 2026-09-28. Read-only. Every claim links to a file:line, live probe timestamp, or repo commit.

## A. Site architecture — indexable URL families

Discovered by walking `src/app/` and reading each `page.tsx` / `sitemap*.xml/route.ts`.

| Family | Route | File | Robots | Canonical | Data source |
|---|---|---|---|---|---|
| Homepage | `/` | `src/app/page.tsx` | default | `https://www.pokeprices.io` | static |
| Sets | `/set/[slug]` | `src/app/set/[slug]/page.tsx` | default | `https://www.pokeprices.io/set/{encoded set_name}` | `set_metadata` |
| Set cards | `/set/[slug]/card/[cardSlug]` | `src/app/set/[slug]/card/[cardSlug]/page.tsx` | `{index:false, follow:true}` when `!isCardIndexable()` | `https://www.pokeprices.io/set/{slug}/card/{cardSlug}` | RPC `get_card_detail_by_url_slug` on `cards` |
| Pokémon | `/pokemon/[slug]` | `src/app/pokemon/[slug]/page.tsx` | `{index: total_cards>0, follow:true}` | `https://www.pokeprices.io/pokemon/{slug}` | `pokemon_species` |
| Insights | `/insights/[slug]` | `src/app/insights/[slug]/page.tsx` | default | `https://www.pokeprices.io/insights/{slug}` | `insights` where `status='published'` |
| Card-shows | `/card-shows/[country]/[slug]` | dynamic route | `{index:false, follow:false}` if event missing | `https://www.pokeprices.io/card-shows/{country}/{slug}` | `@/data/cardShows` (in-memory) |
| Creators | `/creators/[slug]` | `src/app/creators/[slug]/page.tsx` | default | `https://www.pokeprices.io/creators/{slug}` | `creators` where `status='approved'` |
| Vendors | `/vendors/[slug]` | `src/app/vendors/[slug]/page.tsx` | noindex if inactive | `https://www.pokeprices.io/vendors/{slug}` | `vendors` where `active=true` |
| Static hubs | `/browse`, `/tools`, `/ai-assistant`, `/dealer`, `/studio`, `/games/*`, `/visualisations/*`, `/creators`, `/vendors`, `/card-shows`, `/card-shows/{country}`, `/pokemon`, `/insights`, `/cards/search`, `/roadmap`, `/contact`, `/privacy`, `/terms` | various | default (public) | canonical URL matches path | none / hardcoded |
| Excluded | `/admin/*`, `/intel/*`, `/dashboard/*`, `/scan-test`, `/api/*`, `/_next/*` | various | `noindex, nofollow` (admin/intel) + `robots.txt` `Disallow` | n/a | n/a |

Canonicals across every path family are hardcoded to `https://www.pokeprices.io` (with www). Confirmed for:
- `src/lib/seo/seo-helpers.ts:3` — `const SITE = 'https://www.pokeprices.io'`
- `src/app/vendors/[slug]/page.tsx:7` — `const SITE_URL = 'https://www.pokeprices.io'`
- `src/app/set/[slug]/card/[cardSlug]/page.tsx:155` — error-fallback also uses www

No route emits a canonical pointing to the bare domain.

## B. Sitemap generation

Sitemap index: `src/app/sitemap.xml/route.ts` emits 10 children with `lastmod = now()` per request.

Live counts (probed 2026-09-28 09:00 UTC):

| Sitemap | HTTP | `<loc>` count |
|---|---:|---:|
| sitemap-pages.xml | 200 | 29 |
| sitemap-sets.xml | 200 | 288 |
| sitemap-pokemon.xml | 200 | 1,025 |
| sitemap-insights.xml | 200 | 12 |
| sitemap-card-shows.xml | 200 | 32 |
| sitemap-cards-1.xml | 200 | 9,913 (id range 0–10k) |
| sitemap-cards-2.xml | 200 | 9,947 (id range 10k–20k) |
| sitemap-cards-3.xml | 200 | 9,784 (id range 20k–30k) |
| sitemap-cards-4.xml | 200 | 19,459 (id range 30k–50k) |
| sitemap-cards-5.xml | 200 | 14,024 (id range 50k–100k) |
| **Total** | | **64,513** |

Bing WMT `GetFeeds` reports `UrlCount = 64276` for the sitemap index, last crawled 2026-09-19 (`bing-probe.json`). The 237-URL delta between local probe and Bing's cached value is normal for a sitemap that regenerates on each request.

Sitemap-URL generation for cards (`src/lib/seo-indexability/sitemapCards.ts:96-191`) applies a hard filter:
- `card_url_slug NOT NULL`
- `set_name NOT NULL`
- `daily_prices` row exists with `date ≥ now() - 7 days` and at least one of ~20 grade-tier price fields > 0

DB shows 65,040 cards (all have `card_url_slug` and `set_name` — zero `NULL` rows). The sitemap covers 63,127. The ~1,900 gap is cards with no positive price signal in the last 7 days. Failure-mode is fail-open (`sitemapCards.ts:159-164`): if the price query errors, every card with a slug is emitted.

Two families are absent from every sitemap:
- Creators — 10 approved rows in `creators`
- Vendors — 11 active rows in `vendors`

Neither has route logic marking it noindex, so both are shipping to production as HTML pages that Bing/Google can only reach by internal link (see §I). At 21 URLs total the SEO impact is negligible, but the divergence between "public route" and "sitemap coverage" is worth patching.

Hard cap warning: `src/app/sitemap-cards-4.xml/route.ts` explicitly stops at row 50,000. `sitemap-cards-5.xml` catches rows 50,000–99,999. There is no `sitemap-cards-6.xml`; once the `cards` table crosses 100k it will silently drop new rows. Today's headroom is comfortable (65,040 < 100k) but the boundary is visible for future audits.

## C. Robots / hostname / redirect audit (live probes 2026-09-28)

- `https://www.pokeprices.io/robots.txt` → HTTP 200, body:
  ```
  User-Agent: *
  Allow: /
  Disallow: /admin
  Disallow: /intel
  Disallow: /api
  Disallow: /scan-test
  Disallow: /dashboard
  Sitemap: https://www.pokeprices.io/sitemap.xml
  ```
- `https://www.pokeprices.io/a8f92c1d7e4b49d2b7c5e913f4aa8179.txt` → HTTP 200, body `a8f92c1d7e4b49d2b7c5e913f4aa8179`. IndexNow key verification OK.
- `https://pokeprices.io/robots.txt` → **HTTP 307 Temporary Redirect** → `https://www.pokeprices.io/robots.txt`
- `https://pokeprices.io/` → **HTTP 307 Temporary Redirect** → `https://www.pokeprices.io/`

The bare-domain 307 redirect is a canonicalisation weakness. Google and Bing both consolidate signal more strongly for 301 Permanent Redirect. Combined with Bing WMT having the site *verified as* `https://pokeprices.io/` (see §F), the two properties are in tension.

`next.config.js` global response headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy`. **No `X-Robots-Tag` header set anywhere** (verified by grepping response headers on 130 sampled URLs).

## D. Canonical audit (live probes)

Sampled 130 URLs across every sitemap cohort (see `LIVE_SAMPLE.csv`). Findings:

- **130/130 returned HTTP 200.**
- **130/130 emitted a self-referential canonical** matching the requested URL exactly (including `%20` for spaces).
- **0 redirects** (final URL always = requested URL).
- **0 pages** carried a `<meta name="robots">` with `noindex`.
- Pokemon/set/insight/page/card-show pages explicitly emit `content="index, follow"`; card pages omit the meta tag entirely (Next.js default behaviour when `metadata.robots` isn't set — implicit `index, follow`). This is consistent with `src/app/set/[slug]/card/[cardSlug]/page.tsx` which only emits `{index:false, follow:true}` when the card fails `isCardIndexable()`.
- **0 pages** matched soft-404 markers ("card not found", "no data", "page not found").
- Body sizes: cards 78–108 KB, sets ~50 KB, pokemon ~1 MB, insights 50–77 KB, card-shows 63–71 KB, static hubs 37–190 KB. All non-empty; all contain real content.

Sanity check on 404 handling:
- `https://www.pokeprices.io/set/Chaos%20Rising/card/charizard-3` (fake slug in a real set) → **HTTP 404**. Body is the Next.js not-found shell (28 KB) with title "PokePrices — Pokémon Card Value Checker & Price Guide". Correct behaviour (the URL is not in any sitemap; DB confirms no such card).
- `https://www.pokeprices.io/set/Chaos%20Rising/card/ampharos-29` (real card) → **HTTP 200**, 90 KB, title "Ampharos 29/83 Price: $53 PSA 10 vs $2 Raw — Worth Grading? (2026)". Correct.

## E. Live IndexNow infrastructure

- Endpoint: `https://api.indexnow.org/indexnow` (single, by design after Aug-2026 amplification fix).
- Key file: HTTP 200, matches configured key.
- Payload builder (`submitter.mjs:244-251`) sets `host`, `key`, `keyLocation`, `urlList`. All fields present in the tested code path.
- Rejected paths (`submitter.mjs:32-45`) match `robots.txt` disallow list exactly. No leakage risk.
- Retry policy tested (`submitter-hygiene.test.ts`) and pins the fixed classification. 26 hygiene regression tests pass on current HEAD.
- No live submission was performed as part of this audit.

## F. Historical Bing evidence (from `bing-probe.json`, dated 2026-09-21)

Sanitised summary:

- **Verified site URL**: `https://pokeprices.io/` (bare, not www). `IsVerified = true`. Verification method: DNS.
- **Site discovered by Bing**: 2026-03-12 (`DiscoveryDate`). ~6.6 months ago.
- **Sitemap submitted**: 2026-05-29 13:35 UTC; type `Sitemap Index`; `UrlCount = 64,276`; `Status = Success`; last crawled 2026-09-19 23:50.
- **Rank & traffic**: 132 distinct dates 2026-05-11 → 2026-09-19; total 4,837 clicks, 403,137 impressions.
- **Page stats**: 565 distinct pages appearing in search over the 19-day window; sum 2,711 clicks / 141,601 impressions.
- **Query stats**: 1,518 distinct queries in the 19-day window.
- **Crawl stats (130 daily samples, one sample row 2026-05-13)**: `CrawledPages = 45`, `Code2xx = 219`, `Code301/302/4xx/5xx = 0`, `BlockedByRobotsTxt = 0`, `CrawlErrors = 0`, `InIndex = 196`, `InLinks = 2`.
- **CrawlSettings**: `CrawlBoostAvailable = false`, `CrawlBoostEnabled = false`, `CrawlRate = [5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5]` — **5 URLs/hour, every hour of the day = 120 URLs/day maximum crawl rate**.
- **LinkCounts**: `Links = []`, `TotalPages = 0` (Bing reports the site has zero counted external backlinks).
- **CrawlIssues**: 0 issues.
- **CountryRegionSettings**: empty (site not partitioned by country in WMT).

The crawl-rate figure is the single most explanatory number in the whole audit. At 5/hour Bing can index at most ~44k URLs per year even ignoring re-crawls. From site discovery on 2026-03-12 to the audit date (~200 days), the theoretical crawl ceiling is ~24k URLs — consistent with the owner's reported "~18k indexed" once you account for excluded URLs, thin-content de-indexing, and re-crawl overhead.

## G. SEO warehouse state (Supabase, live)

`seo_pages` (registry — one row per URL per site):
- Total pokeprices rows: 66,523
- `in_sitemap = true`: 64,505 (matches live sitemap count)
- `in_sitemap = false`: 2,018 (non-indexable / retired URLs)
- `first_discovered_by = 'sitemap'`: 64,501
- `first_discovered_by = 'gsc'`: 72
- `first_discovered_by = 'bing'`: **0**

`seo_page_rollups`:
- `source = 'google'`: 33,319 rows
- `source = 'bing'`: **0 rows**
- `source = 'combined'`: **0 rows**

`seo_kpi_daily` (Google, most recent = 2026-09-25):
- `total_urls_known = 66,523`
- `urls_in_sitemap = 64,505`
- `urls_indexable = 63,110`
- `clicks_28d = 4,459`
- `impressions_28d = 715,921`
- `pages_with_impressions_28d = 30,536`
- `pages_ge1_click_28d = 2,288`
- `pages_ge28_click_28d = 5`

`seo_bq_ingest_runs` (last 10 rows): all Google `page_daily_ingest` / `rollup_refresh`, all `status='ok'`, running daily 06:00 UTC. **No Bing rows in the last 10 runs.**

The absence of Bing rows in `seo_page_rollups` and `seo_bq_ingest_runs` is caused by `bing-run1.json` / `bing-run2.json` (2026-09-21) failing with `bigquery.datasets.create` permission denied. The Stage 5B pipeline is code-complete but currently blocked on GCP IAM. **Until it lands, Mission Control has no first-party visibility into what Bing has actually indexed vs. crawled vs. discarded.** All Bing-side numbers in this audit come from `bing-probe.json` (a one-off 2026-09-21 diagnostic) or Bing WMT itself.

## H. Bing-* JSON artefacts at repo root

`bing-probe.json`, `bing-probe-2.json`, `bing-micro.json`, `bing-run1.json`, `bing-run2.json`, `bing-unauth.json` are:
- 3 Bing WMT API probe snapshots (2026-09-21) — the source of every "Bing WMT says…" number above.
- 2 Stage 5B BigQuery ingest runs — both failing with the same permission error.
- 1 unauthenticated probe of the Bing WMT API (returns `{"error":"unauthorised"}`).

**None contain IndexNow submission telemetry.** This is consistent with the finding that PokePrices does not log or persist any submission history.

## I. Internal-linking / discoverability spot checks

Sampled 3 pages (2026-09-28):
- `/set/Chaos Rising/card/ampharos-29` (real card): 90 KB, 24 `<a>` tags, most linking to related cards in the same set, PSA population, insights.
- `/pokemon/pikachu`: 1.6 MB, 652 `<a>` tags, ~634 pointing to card/set/pokemon URLs. Very rich internal-link graph.
- `/set/Chaos Rising`: 50 KB, 36 `<a>` tags, 25 internal links to `/set/{name}/card/*`.

No orphan card cohort observed via spot checks — card pages surface via their set page and Pokémon species pages, and the Pokémon page in particular is a strong hub. Bing's Crawl Stats confirm no `BlockedByRobotsTxt` or `CrawlErrors`, so discoverability from Bing's crawler is not the bottleneck; **crawl budget is**.

## J. Duplication / content-quality signals

- Titles on card pages are individually generated with grade spread and price data (verified sample: "Ampharos 29/83 Price: $53 PSA 10 vs $2 Raw — Worth Grading? (2026)"). Not a boilerplate.
- Descriptions are metadata-driven from the RPC.
- Every canonical is self-referential; no cross-family canonicalisation collapses observed.
- URL encoding uses `%20` for spaces consistently (both in sitemap and in canonicals). Bing accepts this; no encode/decode mismatch found.
- One potential aesthetic concern: **the `pokemon/*` pages are ~1 MB each** (652 `<a>` tags, 974k text chars). Not thin, but very large — could trigger content-density heuristics on lower-authority engines. Not urgent.

## K. Legacy / redirect audit

Legacy URL probes (all returned 404 correctly):
- `/card/959616` → 404
- `/cards/pc-959616` → 404
- `/set` (bare) → 404
- `/pokemon/9999` → 404
- `/set/Nonexistent%20Set` → 404
- `/set/Chaos%20Rising/card/nonexistent-card-999` → 404

`next.config.js` defines no `redirects` or `rewrites`. `src/middleware.ts` only protects `/intel/*` with a cookie check. No SEO-affecting rewrites.

## L. Database integrity (read-only counts)

| Check | Count | Notes |
|---|---:|---|
| `cards` with `card_url_slug IS NULL OR set_name IS NULL` | 0 | Clean; no malformed slugs |
| `cards` total | 65,040 | |
| `cards` in sitemap (via 7d price filter) | ~63,127 | ~1,913 cards temporarily below the freshness bar |
| `set_metadata` | 288 | Exact match with sitemap-sets |
| `pokemon_species` | 1,025 | Exact match with sitemap-pokemon (all have `total_cards ≥ 1`) |
| `insights` published | 12 | Matches sitemap |
| `card_shows` (upcoming, non-cancelled) in sitemap | 32 | Static data source; not DB |
| `creators` approved | 10 | Not in any sitemap |
| `vendors` active | 11 | Not in any sitemap |

## M. Prior investigation trail (git log)

- `0259e79` (2026-05-29) — Initial IndexNow support: key file + manual submitter script.
- `ce27201` (2026-07-22) — Block 5A-W-46B: harden IndexNow submitter (validation, batching, retry classification).
- Aug 2026 — Amplification incident: dual-endpoint retry loops in `build-w46e-lite-fix1-indexnow.mjs` posted ~21k submissions for a small cohort.
- `f7770a7` (2026-09-11) — Block 5A-W-58C: single-endpoint policy, tightened retry, snapshot-tracking, deprecation guards on historical scripts.
- `4763092` (2026-09-21) — Stage 5B Bing warehouse into BigQuery (currently blocked on IAM permission).
- `cd3195c` (2026-09-27) — smart-endpoint v168 (unrelated).

No commit ever added a scheduled bulk-IndexNow trigger. That's the shape of the omission.
