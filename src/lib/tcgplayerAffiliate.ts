// src/lib/tcgplayerAffiliate.ts
// TCGplayer affiliate URL builder.
//
// CN-05 Sprint 4. Uses the Impact share-link deep-link pattern:
// appending `?u={encoded_destination}&sharedid={subid}` to the base
// partner URL preserves the destination and attaches `irclickid`
// server-side on redirect. Verified end-to-end in Sprint 4; no API
// access required and no scraping.
//
// Site base link (user-confirmed, approved for all 5 sites):
//   https://partner.tcgplayer.com/k4EaNV
//
// Two destination modes:
//   * exact-product — pass `productId` when a verified mapping
//     exists. Label: "View this card on TCGplayer".
//   * search        — no verified product ID. Falls back to the
//     per-game search URL. Label: "Find this card on TCGplayer" so
//     users know it is a search, not an exact product page.
//
// This repo has no stored TCGplayer product IDs on `cards` today,
// so every call resolves to the search path. If a product-ID
// mapping is backfilled later, callers that pass `productId` get
// the exact-product URL automatically with no component changes.

const PARTNER_BASE = 'https://partner.tcgplayer.com/k4EaNV'

export type TcgplayerGame =
  | 'pokemon'
  | 'magic'
  | 'yugioh'
  | 'one-piece-card-game'
  | 'lorcana'

export interface TcgplayerLinkInput {
  cardName: string
  game: TcgplayerGame
  /** Verified TCGplayer product ID. If omitted or non-numeric, the
   *  resolver falls back to a per-game search URL. */
  productId?: string | number | null
  /** Impact SubID (sharedid). Used for per-placement attribution in
   *  Impact's partner reports. Capped at 70 chars by Impact. */
  subid?: string
}

export interface TcgplayerLink {
  /** Full affiliate URL to put in href. */
  href: string
  /** True when the destination is a specific TCGplayer product page. */
  isExact: boolean
  /** Suggested CTA label (honest about search vs product). */
  label: string
}

function toProductUrl(id: string | number): string {
  return `https://www.tcgplayer.com/product/${encodeURIComponent(String(id))}`
}

function toSearchUrl(game: TcgplayerGame, cardName: string): string {
  const q = cardName.trim().replace(/\s+/g, ' ')
  return `https://www.tcgplayer.com/search/${game}/product?q=${encodeURIComponent(q)}`
}

function wrap(destination: string, subid: string | undefined): string {
  const u = new URL(PARTNER_BASE)
  u.searchParams.set('u', destination)
  if (subid) {
    const trimmed = subid.length > 70 ? subid.slice(0, 70) : subid
    u.searchParams.set('sharedid', trimmed)
  }
  return u.toString()
}

export function buildTcgplayerLink(input: TcgplayerLinkInput): TcgplayerLink {
  const name = (input.cardName ?? '').trim()
  if (name.length === 0) {
    // Degenerate input — still return a non-null link to the game's
    // search landing so callers don't need to null-check twice. Label
    // signals the gap.
    return {
      href: wrap(toSearchUrl(input.game, 'cards'), input.subid),
      isExact: false,
      label: 'Browse on TCGplayer',
    }
  }

  const idStr = input.productId == null ? '' : String(input.productId).trim()
  const hasExact = idStr.length > 0 && /^[0-9]+$/.test(idStr)
  if (hasExact) {
    return {
      href: wrap(toProductUrl(idStr), input.subid),
      isExact: true,
      label: 'View this card on TCGplayer',
    }
  }

  return {
    href: wrap(toSearchUrl(input.game, name), input.subid),
    isExact: false,
    label: 'Find this card on TCGplayer',
  }
}
