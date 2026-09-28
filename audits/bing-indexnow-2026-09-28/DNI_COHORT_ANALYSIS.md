# Bing DNI Cohort Analysis — placeholder

Date: 2026-09-28.

## Current Bing WMT position (owner-supplied)

| Cohort | Count |
|---|---:|
| Indexed | 40,154 |
| DiscoveredNotIndexed | 24,244 |
| ContentQuality | 34 |
| NotYetCrawled | 27 |
| NoIndex | 12 |
| **Total** | **64,471** |

## Tooling in place

The analysis script `scripts/seo/analyse-bing-dni.mjs` (Stage 6A) is ready
to consume a **URL-level export from Bing WMT** and produce a full
cohort-by-status breakdown.

### Expected input format

Bing WMT → *Sitemap Index Coverage* → *URL Inspection* → *Export*. CSV
with (at minimum) these columns, case-insensitive:

- `URL` — full canonical URL, e.g. `https://www.pokeprices.io/set/Chaos%20Rising/card/ampharos-29`
- `Status` — one of `Indexed`, `DiscoveredNotIndexed`, `ContentQuality`, `NotYetCrawled`, `NoIndex`
- `Impressions` *(optional)* — integer, 28-day window
- `Clicks` *(optional)* — integer, 28-day window

Extra columns are tolerated and ignored.

### How to run

```bash
node scripts/seo/analyse-bing-dni.mjs \
    --input path/to/bing-url-export.csv \
    --output audits/bing-indexnow-2026-09-28/DNI_COHORT_ANALYSIS.md
```

With `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the
environment, the script joins each card URL back to its `cards.id` and
buckets it into the correct sitemap shard (cards-1 … cards-5) so the
report shows shard-level DNI concentration. Pass `--no-db` for a
CSV-only summary that does not require credentials.

### Cohorts the script cross-tabulates against status

- **Page family** — card / set / pokemon / insight / card_show / creator / vendor / static
- **Card shard** — cards-1 … cards-5 (requires DB join)
- **Impression bucket** — zero / 1-9 / 10-99 / 100-999 / 1000+
- **Top 30 DNI URLs** — sorted by impressions if the column is present

Every claim in the emitted markdown is grounded in the input CSV. The
script does not fabricate metadata Bing did not provide.

## What we can already say without the export

From the read-only 2026-09-28 audit:

- 130-URL sample across every cohort returned HTTP 200 with correct
  self-canonicals and non-thin bodies.
- No systemic soft-404, noindex, or robots issue detected.
- All 65,040 cards in the database have `card_url_slug` and `set_name`
  populated.
- ~1,900 cards are excluded from the sitemap by the 7-day
  price-freshness filter (`sitemap-cards-*` shards). These are the most
  likely single technical cohort behind a DNI cluster if one exists at
  the "cards with no recent price data" level, because they cycle in
  and out of the sitemap and Bing may deprioritise unstable URLs.

## Next step

Once the owner exports the URL-level list from Bing WMT and drops it
next to this file, rerun the script and this report will be replaced
with the actual cross-tab breakdown.
