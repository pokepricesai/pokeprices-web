# Block 5A-W-50G — Japanese set assets

Design + operator runbook for automating Japanese set logos and symbols.
Nothing here is executed automatically. This directory holds:

- `schema-proposal.sql` — DRAFT `set_metadata` additions (do not apply until reviewed)
- `README.md` — this file

The runnable pieces live outside `docs/`:

- `src/lib/set-assets/jpMatch.ts` — pure matching engine (tested)
- `scripts/set-assets/jp-tcgdex-fetch.mjs` — fetches from TCGdex `ja` locale
- `scripts/set-assets/jp-review-report.mjs` — generates the visual HTML review
- `scripts/set-assets/jp-import.mjs` — dry-run by default; uploads + updates on `--write`

---

## Sources

| Source | Locale | Coverage | Trust |
|---|---|---|---|
| TCGdex `/v2/ja/sets` | Japanese | Modern mainline expansions + several older sets | High for modern; medium for older/promo |
| Bulbapedia / Bulbagarden Archives | Multi | Comprehensive for older Japanese products | Manual only |
| pokemon-card.com | Japanese | Newer official products | Manual only |

- **Never** use Google Images, marketplace listings, or arbitrary shop scans.
- **Never** substitute an English-equivalent logo for a Japanese-only product.
- **Never** use AI-generated recreations of official logos.

## Matching strategy

`src/lib/set-assets/jpMatch.ts` scores each PokePrices JP set against every TCGdex candidate.

**Signals:**
- Exact / normalised name match (PokePrices retains the `Japanese ` prefix internally; comparison strips it)
- Release date proximity
- Card count proximity
- Serie / era agreement
- Substring name overlap (last-resort weak signal)

**Weights** are defined in `WEIGHTS` in `jpMatch.ts`; changes must land with a test that pins the new threshold.

**Classification:**
| Bucket | Rule |
|---|---|
| CONFIRMED_AUTOMATIC | score ≥ 70 AND no warnings AND second candidate ≥ 15 pts behind |
| PROBABLE_REVIEW | score ≥ 40 OR warnings present |
| AMBIGUOUS | second candidate within 15 pts of best |
| NO_MATCH | best score < 40 OR zero candidates |

**Forced downgrades** (see `jp-review-report.mjs`):
- Known paired expansions (`X & Y` naming) always drop from CONFIRMED to PROBABLE_REVIEW.
- Names matching `FALLBACK_ONLY_MARKERS` (McDonald's, Carddass, vending, decks) are surfaced in a dedicated `FALLBACK_ONLY` bucket.

## Storage layout

Supabase Storage bucket **`set-assets`** (public read, service-role write). Deterministic paths:

```
set-assets/
  jp/
    battle-partners/logo.webp
    battle-partners/symbol.webp
    japanese-leaders-stadium/logo.webp
    ...
  en/          (reserved for future migration of the current bundled assets)
```

`stable-set-key` is a slugified form of the visible name (no `Japanese ` prefix). Choose it once, per set, at review time — it must NEVER change afterwards so cache invalidation stays predictable.

## Provenance columns

New columns on `set_metadata` (see `schema-proposal.sql`):

| Column | Purpose |
|---|---|
| `logo_url` | Full public URL of the logo, or NULL |
| `symbol_url` | Full public URL of the symbol, or NULL |
| `logo_source` | `tcgdex` / `bulbapedia` / `pokemon-card` / `manual` / `bundled` |
| `symbol_source` | Same enum as `logo_source` |
| `logo_source_id` | Source-specific ID (e.g. TCGdex set id `sv08a`) |
| `logo_confidence` | `confirmed` / `probable` / `ambiguous` / `unavailable` |
| `logo_review_status` | `pending` / `confirmed` / `rejected` / `unavailable` |
| `logo_retrieved_at` | Timestamp of the successful upload |

Provenance is never removed after import (audit trail).

## UI fallback ladder

Runtime asset selection for JP sets (implementation lands in a follow-up block):

1. `set_metadata.logo_url` — real Japanese logo
2. `set_metadata.symbol_url` — real Japanese symbol (renders as centred small mark)
3. Text badge — restrained typography using the visible set name / abbreviation + small `JP` indicator
4. Generic Japanese-set placeholder

**Removed from the ladder for JP sets**: `s.set_image_url` (first-card fallback). The first-card image is misleading as a set identity — no random card scan should ever represent a set once we have a reviewed logo/symbol.

The English ladder is unchanged: bundled `LOGO_MAP` / `SYMBOL_MAP` → nothing → emoji. English rows can migrate to the new columns in a later block if we want the storage/UI to converge.

## Display rules

Browse tile:
- `object-fit: contain` inside the 72×52 asset area
- preserve transparency
- no cropping, consistent tile height

Set page header:
- logo up to 240×56, contained
- optional 28×28 symbol as secondary
- retain the existing `JapaneseBadge`
- visible name still strips only the leading `Japanese ` prefix (`displaySetName`)

Mobile:
- logos remain legible at 375px
- symbols never stretched
- no layout shift from missing image dimensions

## Quality gates enforced by `jp-import.mjs`

- HTTP 200 check (no HTML error pages saved as images)
- MIME type must match `image/(webp|png|jpeg|svg+xml)` — HTML/error pages rejected
- SHA-256 content hash written to the rollback manifest (for duplicate detection during a later dedup pass)
- Original source URL + retrieval timestamp stored via `logo_source_id` + `logo_retrieved_at`
- Immutable per-set paths so any CDN cache can be invalidated by uploading to the same key

**Not yet implemented (add if a per-asset duplicate leak surfaces):**
- perceptual hashing to detect near-identical assets across unrelated sets
- automatic transparent-padding trim

## Rollout order

1. Run `node scripts/set-assets/jp-tcgdex-fetch.mjs` — writes `reports/jp-tcgdex-fetch.json`
2. Ensure `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` (legacy `eyJ...` JWT) are set in the shell
3. Run `npx tsx scripts/set-assets/jp-review-report.mjs` — writes `reports/jp-set-assets-review.html`
4. Open the HTML in a browser. Visually confirm the CONFIRMED bucket. Reject anything wrong.
5. Curate a JSON manifest at `reports/jp-approved.json` (see `jp-import.mjs` for the shape)
6. Apply `schema-proposal.sql` in the Supabase SQL Editor (rename to a `migrations/` file first)
7. Create the `set-assets` bucket in Supabase Storage (public read)
8. Test: `node scripts/set-assets/jp-import.mjs --manifest reports/jp-approved.json --single-set "Japanese Battle Partners"`
9. Test with `--write`: same command + `--write`
10. Confirmed batch: `node scripts/set-assets/jp-import.mjs --manifest ... --confirmed-only --write`
11. Manually approved remainder: `node scripts/set-assets/jp-import.mjs --manifest reports/jp-approved-manual.json --write`
12. UI block: switch `getSetAssets` to read from `set_metadata` when the column is populated; drop `s.set_image_url` fallback for JP tiles.

Everything in steps 6–12 waits on human review of the HTML report.

## Rollback

- Storage: delete objects under `set-assets/jp/{key}/` via Supabase dashboard.
- Metadata: `reports/jp-import-rollback.json` (written by every `--write` run) captures the previous values for every touched row.
  ```sql
  -- Restore one set from the rollback manifest by hand:
  UPDATE set_metadata SET
    logo_url            = <previous logo_url>,
    symbol_url          = <previous symbol_url>,
    logo_source         = <previous logo_source>,
    ...
  WHERE set_name = '<set_name>';
  ```
- Full schema rollback: see the `-- Rollback:` block at the top of `schema-proposal.sql`.
