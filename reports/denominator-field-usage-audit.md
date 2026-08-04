# Denominator field usage audit

_Block 5A-W-51B.1 — supporting evidence for a future card_number_display schema refactor. No changes proposed in this block._

## Scope

Every usage of the three fields that participate in card numbering:

| Field | Type | Source |
|---|---|---|
| `set_metadata.total_cards` | integer | seeded via `seed_set_cards.py --printed-total <N>` |
| `cards.set_printed_total` | text | mirror of `--printed-total` at seed time |
| `cards.card_number_display` | text | composed as `f"{card_number}/{printed_total}"` at seed time |

## Current semantics (as of 2026-08-05)

- `set_metadata.total_cards` holds the value passed to `--printed-total` when the set was seeded. For English sets this happened to be the printed base denominator. For Japanese sets it was populated from `manifests/japanese_sets.json`'s `total_cards` field, which was in turn taken from the PriceCharting catalogue row count. Battle Partners's `total_cards = 130` is a PriceCharting count, not the printed `/100`.
- `cards.set_printed_total` mirrors the same value into every card row.
- `cards.card_number_display` is composed at seed time as `card_number || '/' || set_printed_total`.

So the three fields carry ONE value that's forced to serve two distinct purposes: catalogue count AND printed denominator. When those diverge (Japanese secret-rare sets), the printed denominator loses.

## Read sites (production and tooling)

### `set_metadata.total_cards`

| File | Line | What it reads for |
|---|---:|---|
| `supabase/functions/content-studio-generate/index.ts` | 894 | Determines how many cards are in a set when generating a share graphic. Currently displays the wrong count for JP sets with the CONFIRMED_MISMATCH state. |
| `scripts/scanner/audit-jp-denominators.mjs` | 53 | This block's audit script. Read-only. |
| `scripts/scanner/audit-normalization-impact.mjs` | — | Does not read this field directly. |

**Not read** by: browse, portfolio, scanner, set page, card page, alerts, watchlist, insights.

### `cards.set_printed_total`

| File | Line | What it reads for |
|---|---:|---|
| `src/lib/seo-helpers.ts` | — | Card page SEO title uses it to render "N/M" when `card_number_display` is null. |
| `src/app/scan-test/ScanTestClient.tsx` | 1047, 1059 | Scanner debug UI shows it in the denom-match diagnostic tag. |
| `src/app/api/content-studio/render/route.tsx` | 226, 283, 375, 431, 510, 563, 595 | Share-graphic rendering — passes `card_number, card_number_display, set_printed_total` to `fmtCardNumber()`. Only used when `card_number_display` is null. |
| `scan_card_match` RPC | see migration 2026-08-04-scan-card-match-denominator-tolerance.sql | Normalised as `norm_total` and compared against the scanned denominator. Under 51B the mismatch produces `denominator_conflict=true` rather than exclusion. |

### `cards.card_number_display`

Ubiquitous read-side field. Every surface that shows "N/M" reads it directly:

| File | Line |
|---|---:|
| `src/components/CardScanner.tsx` | 46, 56, 246, 354, 706, 924 |
| `src/components/CardQuickActions.tsx` | 41, 116, 211, 596 |
| `src/components/Navbar.tsx` | 16, 326, 327 (search dropdown) |
| `src/components/SearchBar.tsx` | 102, 103 |
| `src/app/api/content-studio/render/route.tsx` | 226, 283, 375, 431, 510, 563 (share graphics) |
| `src/app/scan-test/ScanTestClient.tsx` | 186, 1047 |
| `src/app/pokemon/[slug]/page.tsx` | 62, 628 (species page card list) |
| `src/app/pokemon/[slug]/SpeciesInteractiveSection.tsx` | 16 |
| `src/lib/scanner/**` | test fixtures |
| RPCs | `get_card_detail_by_url_slug`, `scan_card_match`, `get_set_list_v2`, `search_global` — all project this field |

**Read pattern**: `${card_number_display || card_number}` in every UI site. If the field is wrong, every surface shows the wrong value simultaneously.

## Write sites

Only the scraper (`pokeprices` Python repo) writes these fields, all at seed time:

| File | Line | Which fields |
|---|---:|---|
| `seed_set_cards.py` | 125–128 | `card_number_display`, `set_printed_total`, and (via `upsert_set_metadata`) `total_cards` |
| `bulk_seed_japanese.py` | 74–75 | passes `manifest["total_cards"]` as `--printed-total` — the operational source of the JP mismatch |

**Neither web-repo code nor any Supabase RPC currently issues an UPDATE against these three columns.** All values are decided at seed time and never revised.

## Preferred future model (for a follow-up block)

Introduce a fourth column:

```
set_metadata.total_cards           -- catalogue row count (unchanged use)
set_metadata.printed_denominator   -- NEW: number actually printed after the slash
cards.set_printed_total            -- populated from printed_denominator (not total_cards)
cards.card_number_display          -- composed as card_number || '/' || printed_denominator
```

Migration path (not in this block):

1. Add `set_metadata.printed_denominator INTEGER NULL`.
2. Backfill from `scripts/scanner/data/jp-printed-denominators.reference.json` for the 10 verified JP sets. Leave NULL for sets not yet cross-checked.
3. Recompute `cards.set_printed_total` and `cards.card_number_display` for every affected row where `printed_denominator IS NOT NULL AND printed_denominator <> total_cards`. Scoped correction only — the vast majority of the catalogue (English sets, JP sets already correct) is untouched.
4. Update `seed_set_cards.py` to accept `--printed-denominator <N>` distinct from `--printed-total <N>` (or rename `--printed-total` to `--printed-denominator` and add operational documentation).
5. Update `bulk_seed_japanese.py` to prefer `manifest["printed_denominator"]` with a fallback+warning on `total_cards`.
6. Backfill `manifests/japanese_sets.json` with per-set `printed_denominator` values (initially from the same reference JSON).

## What this block does not do

- Does not add `printed_denominator` column.
- Does not update `set_metadata.total_cards` for any set.
- Does not update `cards.set_printed_total` or `cards.card_number_display`.
- Does not change the scraper.

All the above are scheduled for a review-first data-correction block that follows the normalisation fix landing in production. The normalisation fix must come first because updating `card_number_display` from `102/130` → `102/100` while the bug is still live would move Battle Partners cards from one collision cluster (`12/130`) into another (`12/10`), producing new wrong matches rather than fixed ones.
