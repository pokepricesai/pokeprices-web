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
| `EbayCompactLink` | `src/components/affiliate/EbayCompactLink.tsx` | Block 2D core compact link, marketplace-aware via `useMarketplace()` |
| `EbayCardPriceActions` | `src/components/affiliate/EbayCardPriceActions.tsx` | Block 2D — "Find raw / PSA 9 / PSA 10 copies on eBay" row beside `<GradeLadder>` |
| `EbayHoldingAction` | `src/components/affiliate/EbayHoldingAction.tsx` | Block 2D — single "Check current listings" link on portfolio + watchlist rows |
| `EbayGradingScenarioAction` | `src/components/affiliate/EbayGradingScenarioAction.tsx` | Block 2D — "Compare raw / PSA 9 / PSA 10 listings" beside the grading calculator's selected card |
| `MarketplaceSelector` | `src/components/affiliate/MarketplaceSelector.tsx` | Compact marketplace dropdown in the navbar; hidden when <2 marketplaces configured |

## Supported marketplaces

Block 2D introduces a central registry in `src/lib/marketplaces.ts`. UK
and US ship implemented AND configured. CA, AU, DE, FR, IT and ES are
documented in the registry with hostnames, site IDs and MKRIDs but are
**not selectable** today — see the readiness model below.

`MarketplaceCode = 'UK' | 'US' | 'CA' | 'AU' | 'DE' | 'FR' | 'IT' | 'ES'`.

### Marketplace readiness model

A marketplace passes through three independent states:

| State | Meaning | Source of truth |
|---|---|---|
| **implemented** | The central URL engine in `ebayAffiliate.ts` can emit a NATIVE affiliate URL for this marketplace. | `IMPLEMENTED_MARKETPLACES` in `src/lib/marketplaces.ts`. Today: `UK`, `US`. |
| **configured** | A non-empty campaign id is present in the static `PUBLIC_EBAY_CAMPAIGN_IDS` map (built from a `NEXT_PUBLIC_EBAY_CAMPID_<CODE>` env var at build time). | `PUBLIC_EBAY_CAMPAIGN_IDS` in `src/lib/marketplaces.ts`. |
| **selectable** | implemented AND configured. The selector and the settings dropdown only show selectable marketplaces. | `isMarketplaceSelectable()` / `selectableMarketplaces()`. |

`configured` alone is **not enough**. Until a marketplace is also
implemented (i.e. the engine can produce a correctly-attributed URL for
it), it will not appear in the selector or be surfaced as a choice.

### Deployment flow for a new marketplace

NEXT_PUBLIC variables are baked into the browser bundle at **build
time**. Populating a campaign id in Vercel without redeploying does
**not** activate the marketplace. The real activation sequence is:

1. Add the marketplace's campaign id to Vercel project environment as
   `NEXT_PUBLIC_EBAY_CAMPID_<CODE>`.
2. Confirm the central URL engine (`ebayAffiliate.ts`) supports that
   marketplace and add it to `IMPLEMENTED_MARKETPLACES` once it does.
3. Trigger a Vercel deployment so the new env var lands in the client
   bundle.
4. Sanity-check one affiliate URL end-to-end on a deployed preview:
   correct domain, MKRID, site id, campaign id, custom id, search
   query, and (for `sold_search` only) the sold filters.
5. Verify EPN attribution arrives under the new campaign id in the
   partner dashboard within the next reporting cycle.
6. Only then does the marketplace surface in the selector and the
   settings dropdown.

## Marketplace selection precedence

Resolved client-side by `resolveMarketplace(...)` in
`src/lib/marketplaceResolver.ts`:

1. **Manual cookie** — `pp_marketplace`. Set by `MarketplaceSelector`
   on every click (365-day persistence, lax, secure on HTTPS). The
   **explicit user choice always wins**: even when the user is signed
   in with a stored profile preference, even if the best-effort profile
   save fails after the selector click. The cookie is never cleared by
   the app — only an explicit re-selection replaces it.
2. **Profile preference** — `profiles.marketplace_preference` for
   signed-in users. Legacy values `'EU'` and `'other'` are coerced at
   read time (`'EU'` → the first SELECTABLE European marketplace,
   `'other'` → null so the resolver continues to step 3).
3. **Geolocation cookie** — `pp_geo_country` populated lazily from
   `/api/geo` (route handler returns the `x-vercel-ip-country` header).
   No IP is stored, no third-party geolocation provider is called.
4. **Ultimate fallback** — UK if selectable, else US if selectable,
   else any selectable marketplace. When zero marketplaces are
   selectable, every affiliate component renders nothing.

Only **selectable** marketplaces are ever returned by the resolver.

The resolver is pure (no React, no fetch) so it can be unit-tested in
isolation. `useMarketplace()` in `src/lib/marketplaceClient.ts` wires it
to the live cookies and the optional `/api/geo` lookup.

## Cookies

| Cookie | Purpose | Notes |
|---|---|---|
| `pp_marketplace` | Manual marketplace selection from the selector. | 365d, `SameSite=Lax`, `Secure` on HTTPS. Cleared on logout if the user signed in and chose a profile preference. |
| `pp_geo_country` | Result of `/api/geo` lookup. Stored to avoid re-hitting the route on every page. | 30d, `SameSite=Lax`, `Secure` on HTTPS. Stores a two-letter country code or empty — never IPs. |

## Campaign environment variables

All campaign IDs are read through the static
`PUBLIC_EBAY_CAMPAIGN_IDS` map in `src/lib/marketplaces.ts`. Each entry
in that map is a literal `process.env.NEXT_PUBLIC_EBAY_CAMPID_<CODE>`
access so Next.js's build-time inliner replaces it in the browser
bundle. **Dynamic access via `process.env[someName]` is not inlined on
the client and silently resolves to `undefined` in production** — never
read campaign IDs that way.

| Variable | Scope | Required? | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_EBAY_CAMPID_UK` | public | recommended | When missing, the engine returns `url: null` for UK and the calling component hides the action. |
| `NEXT_PUBLIC_EBAY_CAMPID_US` | public | recommended | Same behaviour for US. |
| `NEXT_PUBLIC_EBAY_CAMPID_CA` | public | optional | Reserved. Populating it alone does NOT activate Canada; the URL engine must also be extended and a new deployment shipped. |
| `NEXT_PUBLIC_EBAY_CAMPID_AU` | public | optional | Reserved (same as CA). |
| `NEXT_PUBLIC_EBAY_CAMPID_DE` | public | optional | Reserved (same as CA). |
| `NEXT_PUBLIC_EBAY_CAMPID_FR` | public | optional | Reserved (same as CA). |
| `NEXT_PUBLIC_EBAY_CAMPID_IT` | public | optional | Reserved (same as CA). |
| `NEXT_PUBLIC_EBAY_CAMPID_ES` | public | optional | Reserved (same as CA). |

Adding or changing any `NEXT_PUBLIC_*` value requires a new Vercel
deployment to land in the browser bundle. Setting it in the Vercel
dashboard without redeploying changes nothing on the live site.

The IDs are public because the affiliate URL is built client-side
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

- UK and US are implemented + configured. CA / AU / DE / FR / IT / ES
  are reserved in the registry but **not selectable**: the URL composer
  in `ebayAffiliate.ts` does not yet emit native URLs for them, so they
  are deliberately hidden from the selector and the settings dropdown.
  Configuring just the env var would create the misleading appearance
  of marketplace support without correct attribution.
- Geolocation uses Vercel's `x-vercel-ip-country` header only. IPs are
  never logged or sent to a third party.
- Sealed product searches use a parent category. eBay sub-categories
  for booster boxes / ETBs / tins may move sealed listings; the
  category will need a future refinement once we measure click quality.

## Future rollout plan

1. Extend the URL composer in `ebayAffiliate.ts` to emit valid URLs for
   CA / AU / DE / FR / IT / ES once each marketplace's preferred query
   shape is confirmed.
2. Add each newly-implemented marketplace to `IMPLEMENTED_MARKETPLACES`
   in `src/lib/marketplaces.ts`.
3. Populate the corresponding `NEXT_PUBLIC_EBAY_CAMPID_<CODE>` env var
   in Vercel and trigger a deployment.
4. After at least one EPN reporting cycle, retire any remaining legacy
   custom IDs that the v2 format has fully reconciled with.
5. Optional dealer-page marketplace override — separate from the
   primary selector — once dealer rows route through `EbayCompactLink`.

## Repository audit

Run `npm run audit:ebay` to surface any user-facing eBay URL outside the
central module. The allow-list lives in
`scripts/audit-ebay-links.mjs`. CI integration is a future follow-up.
