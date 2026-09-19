// src/app/admin/design/_lib/prototypeCard.ts
// ============================================================================
// Shared constants for the three card-page prototype experiments living
// under /admin/design/card-layout-{a,b,c}.
//
// The prototypes are private admin-only design experiments. They must not
// affect production SEO, canonical or sitemap in any way. See:
//   src/app/admin/design/layout.tsx       (per-section admin chrome + noindex)
//   src/app/admin/design/_lib/loadPrototypeCard.ts (server-only data loader)
//
// A single high-value, data-rich card is used across all three prototypes
// so the comparison is apples-to-apples: only information architecture
// changes between A / B / C.
// ============================================================================

/** URL-encoded set name — used for building /set/{set}/card/{slug} links. */
export const PROTOTYPE_SET_NAME = 'Base Set'

/**
 * The chosen prototype card.
 *
 * Base Set Charizard [1st Edition] #4 was selected because it exercises
 * essentially every price tier stored in daily_prices — raw, PSA 7-10,
 * CGC 9.5/10/10 Pristine, BGS 10 / BGS 10 Black, SGC 10, plus PSA 1-6 —
 * and carries meaningful trend + volume history. This is arguably the
 * data-richest card in the catalogue.
 *
 * PriceCharting product id (bare, no `pc-` prefix): 715593
 */
export const PROTOTYPE_CARD_URL_SLUG = 'charizard-1st-edition-4'

/** Canonical live URL for the same card — used only for a "view live" link
 *  on the admin chrome so you can compare against production side by side. */
export const PROTOTYPE_LIVE_HREF =
  `/set/${encodeURIComponent(PROTOTYPE_SET_NAME)}/card/${PROTOTYPE_CARD_URL_SLUG}`
