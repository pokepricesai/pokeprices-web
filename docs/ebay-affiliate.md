# eBay affiliate engine

The single source of truth for every eBay affiliate URL in PokePrices.
Anything outside the central module is a regression — `npm run audit:ebay`
fails when it finds one.

## Current architecture

```
src/lib/ebayAffiliate.ts
  ├ buildAffiliateLink(input)        ← typed engine for new code
  ├ affiliateWrapEbayUrl(rawUrl, ctx) ← defensive wrapper for AI answers
  ├ hasMarketplaceCampaign(mp)       ← UI guard
  └ getEbay{Uk,Us}{,Sold}Url, buildCardEbayQuery
                                     ← byte-identical legacy helpers
```

Components that already render affiliate UI:

| Component | File | Purpose |
|---|---|---|
| `EbayLiveListings` | `src/components/EbayLiveListings.tsx` | UK+US block beside cards / sets / Pokémon |
| `EbayInlineLink` (named export) | same file | Compact inline link (mover rows) |
| `CardQuickActions` chips | `src/components/CardQuickActions.tsx` | Four card-page chips (UK / US × raw / sold) |
| `DealerEbaySoldLink` | `src/app/dealer/DealerPageClient.tsx` | Single graded sold-search link per dealer row |
| `ChatLink` | `src/components/InlineChat.tsx` | Wraps any eBay URL that appears in an AI answer |
| `EbayAffiliateAction` | `src/components/affiliate/EbayAffiliateAction.tsx` | Reusable foundation for the next affiliate block |

## Supported marketplaces

`uk` and `us` today. Other markets are reserved for the marketplace
localisation block. Adding a marketplace requires:

1. A working campaign ID in EPN.
2. A new `Marketplace` literal in `ebayAffiliate.ts`.
3. A new MKRID, hostname, siteid block in the engine constants.
4. Tests covering the new marketplace's URL shape.

## Campaign environment variables

| Variable | Scope | Required? | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_EBAY_CAMPID_UK` | public | recommended | When missing, the engine returns `url: null` for UK and the calling component hides the action. |
| `NEXT_PUBLIC_EBAY_CAMPID_US` | public | recommended | Same behaviour for US. |

The IDs must be public because the affiliate URL is built client-side
for analytics dimension visibility. They are not secrets in the
traditional sense; treat them like any commerce identifier — rotation
should be coordinated with EPN.

`MKRID`, `siteid`, `_sacat` (category) and `mkrid` MKEVT flags are
hard-coded in `ebayAffiliate.ts` because changing them would break
existing EPN tracking.

## Link intents

| Intent | Query shape | URL flags |
|---|---|---|
| `raw` | `<name> #<num> <set> pokemon card` | singles category |
| `psa8`/`psa9`/`psa10` | `<name> #<num> <set> PSA <n>` | singles category |
| `graded` | `<name> #<num> <set> <company> <grade>` | singles category |
| `sold_search` | same as raw, **or** carries grade context when provided | singles category, `LH_Sold=1`, `LH_Complete=1` |
| `japanese` | `<name> #<num> Japanese Pokemon card` | singles category |
| `set_search` | `<set> pokemon set` | singles category |
| `pokemon_search` | `<pokemon> pokemon card` | singles category |
| `sealed` | `<product> pokemon` | **sealed parent category** `2536` |
| `exact_listing` | precise affiliate search by item id | singles category |
| `other` | `<name> #<num> <set> pokemon card` | singles category |

The engine drops control characters from every input string, collapses
inner whitespace, and avoids double-appending the same `#<num>` suffix
or duplicate "pokemon card" tail.

## Custom-ID formats

### Legacy (preserved for live EPN reports)

The pre-Block-2C helpers continue to emit the exact same custom IDs:

- `CardQuickActions` raw chips → bare numeric `card_slug`
- `CardQuickActions` sold chips → `<card_slug>-sold`
- `SetPageClient` set-level → `set-<set name>`
- `EbayInlineLink` mover rows  → `mover-<slug>`
- Pokémon page hero block      → `pokemon-<slug>`

Pass these as `legacyCustomId` when calling the engine and they survive
byte-for-byte.

### v2 (default for new placements)

```
pp:<placement>:<intent>:<marketplace>:<page_type>:<reference>
```

Slot rules:

- Slots are lower-cased and reduced to `[a-z0-9._-]`.
- Empty slots become `_`.
- Full string is restricted to `[A-Za-z0-9._:-]` after assembly.
- Length-capped at 200 characters (eBay allows 256; the 56-char buffer
  leaves room for any future `?campid=` reconciliation suffix).

Examples used today:

- `pp:dealer_row:sold_search:uk:dealer:base-set-charizard` (dealer page)
- `pp:ai_response:exact_listing:us:ai_assistant:_` (AI chat link wrap)

## Exact listing behaviour

eBay does **not** publish a verified affiliate exact-item URL format
that we have proven works end-to-end. Block 2C therefore translates any
`/itm/<id>` URL into an affiliate search keyed on the numeric item ID:

```
https://www.ebay.com/sch/i.html?_nkw=365842915432&campid=...&customid=pp:ai_response:exact_listing:us:...
```

The user lands on a precise search result that points at the original
listing, with affiliate tracking attached. UI must label this clearly as
a "search" outcome, never as a guaranteed exact listing.

## Sold-search limitation

`sold_search` runs the same affiliate search with `LH_Sold=1 &
LH_Complete=1`. This is an outbound eBay search, not PokePrices sold
data. Labels must say "Check sold listings on eBay" or equivalent — they
must never imply we publish our own sold data.

Block 2C does not ingest or calculate sold prices.

## Analytics dimensions

Every affiliate event emitted from the engine (or the components above)
carries the following parameters via `src/lib/analytics.ts`:

`placement`, `intent`, `marketplace`, `card_slug`, `set_slug`,
`grading_company`, `grade`, `language`, `custom_tracking_id`,
`source_component`, plus the auto-attached `auth_state`, `user_plan`,
`page_type`.

New intents added in Block 2C:

- `sealed`
- `exact_listing`

These are also documented in `docs/analytics-events.md`.

## Disclosure rules

- The block-shaped `EbayLiveListings` and `EbayAffiliateAction` carry an
  inline "Affiliate link · we may earn commission" line directly under
  the buttons.
- The card-page chip row inside `CardQuickActions` shows the same
  disclosure once per box (not once per chip), inside the same UI panel.
- The dealer-page sold link is a single button; the page already shows
  its own affiliate disclosure in the surrounding context, so the chip
  itself does not need to repeat the full text.
- AI answers render eBay links through `ChatLink` which marks them
  `rel="sponsored"`. The persistent affiliate disclosure on the AI
  assistant page is appropriate context.
- Misleading labels are forbidden. The repository must not use "best
  price", "cheapest" or "guaranteed value" beside affiliate links
  unless the claim is objectively verified — and Block 2C does not
  introduce any such label.

## Known marketplace / localisation limitations

- Today only UK and US are wired. There is no automatic geo-routing.
- Sealed product searches use a parent category. eBay sub-categories
  for booster boxes / ETBs / tins may move sealed listings; the
  category will need a future refinement once we measure click quality.
- The reusable `EbayAffiliateAction` component is implemented but
  **deliberately not inserted at any new location** in this block.

## Future rollout plan (out of scope for Block 2C)

The next affiliate block can:

1. Insert `EbayAffiliateAction` beside the raw / PSA 9 / PSA 10 price
   tiles on card pages, portfolio rows, watchlist rows, AI answers,
   grading report and market movers.
2. Roll out the v2 custom-ID format to those placements alongside the
   legacy IDs for at least one EPN reporting cycle so we can reconcile.
3. Wire `affiliate_link_view` impressions on each new placement.
4. Plug in geo-aware default marketplace (Vercel geo header) and a
   user-overridable preference.

## Repository audit

Run `npm run audit:ebay` to surface any user-facing eBay URL outside the
central module. The allow-list lives in
`scripts/audit-ebay-links.mjs`. CI integration is a future follow-up.
