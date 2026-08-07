// src/lib/grading/sellingProfiles.ts
//
// Block 5A-W-52B.2 — corrected UK eBay business fees.
//
// The pre-52B.2 UK business profile used 12.8% + a flat £0.30
// fixed fee. That was wrong for Pokémon/trading cards: the
// current UK Collectables base rate is 10.9%, eBay charges a
// separate 0.35% regulatory operating fee on the total sale, and
// the per-order fee is £0.30 for orders ≤£10 and £0.40 for
// orders above £10.
//
// This module now models each fee component explicitly so the
// deterministic calculator can reproduce eBay's real invoice
// arithmetic. There is no separate third-party payment
// processing fee (bundled into the marketplace + regulatory
// fees).

export type SellerType = 'private' | 'business' | 'other'
export type SellingCurrency = 'GBP' | 'USD'

/**
 * A rule for computing the per-order fixed fee from the sale
 * value. eBay UK's business fee is £0.30 on orders ≤£10 and
 * £0.40 above, so we model it as a tiered rule the calculator
 * evaluates dynamically for each side of the raw-vs-graded
 * comparison.
 *
 * Keeping this as data (not a function) so it stays
 * JSON-serializable for logging + easy audit.
 */
export type FixedSellingFeeRule =
  | { kind: 'flat'; flat: number }
  | {
      kind: 'tiered_by_sale'
      /**
       * Tiers evaluated in order; the first `maxSaleCents` the
       * sale value satisfies wins. Use Number.POSITIVE_INFINITY
       * for the final catch-all tier.
       */
      tiers: Array<{ maxSaleCents: number; feeCents: number }>
    }

export interface SellingProfile {
  id: string
  displayName: string
  marketplace: string
  sellerType: SellerType
  currency: SellingCurrency
  /** Marketplace final-value fee as a decimal (0.109 = 10.9%). */
  marketplaceFeeRate: number
  /**
   * Regulatory / operating fee levied by the marketplace on the
   * total sale amount, as a decimal (0.0035 = 0.35%). eBay UK
   * charges this separately from the FVF as of the 2024
   * restructure.
   */
  regulatoryFeeRate: number
  /**
   * Third-party payment processing fee. Zero for eBay UK where
   * processing is bundled into `marketplaceFeeRate`. Non-zero
   * for markets that split it out (Cardmarket, direct shops).
   */
  paymentFeeRate: number
  fixedSellingFeeRule: FixedSellingFeeRule
  /**
   * Block 5A-W-52B (VAT correction) — eBay UK publishes business
   * seller fees EXCLUSIVE of VAT. When true, the calculator
   * grosses fees up by `feeVatRate` unless the caller sets
   * `sellerCanReclaimFeeVat: true` (VAT-registered sellers can
   * reclaim the input VAT so it's not an ultimate cost).
   *
   * Private profiles leave this undefined — their fees are zero
   * anyway.
   */
  feesExcludeVat?: boolean
  /** VAT rate applied to fees when `feesExcludeVat === true`. Default 0.20 (UK). */
  feeVatRate?: number
  effectiveDate: string
  sourceNote: string
}

/**
 * Compute the fixed per-order fee for a given sale value. Used
 * by the calculator on both the raw side and the graded side so
 * the incremental comparison remains fair.
 */
export function resolveFixedSellingFee(rule: FixedSellingFeeRule, saleValueCents: number): number {
  if (rule.kind === 'flat') return rule.flat
  for (const tier of rule.tiers) {
    if (saleValueCents <= tier.maxSaleCents) return tier.feeCents
  }
  // If no tier matched (shouldn't happen when the last tier uses
  // POSITIVE_INFINITY), fall back to the last tier's fee.
  return rule.tiers[rule.tiers.length - 1]?.feeCents ?? 0
}

// ── Default UK profiles ────────────────────────────────

/**
 * UK eBay private seller. Default for the PokePrices target
 * audience per CLAUDE.md.
 *
 * eBay UK abolished final-value + regulatory + fixed fees for
 * non-Motors private sellers on 3 October 2024. Private sellers
 * currently pay nothing on the sale.
 */
export const UK_EBAY_PRIVATE: SellingProfile = {
  id: 'uk_ebay_private',
  displayName: 'eBay UK — private seller',
  marketplace: 'ebay_uk',
  sellerType: 'private',
  currency: 'GBP',
  marketplaceFeeRate: 0,
  regulatoryFeeRate: 0,
  paymentFeeRate: 0,
  fixedSellingFeeRule: { kind: 'flat', flat: 0 },
  effectiveDate: '2026-08-07',
  sourceNote:
    'eBay UK abolished private-seller final-value fees for non-Motors categories on 3 October 2024. ' +
    'Private sellers pay no marketplace fee, no regulatory fee, no payment fee, and no per-order fee.',
}

/**
 * UK eBay business seller — Collectables category (Pokémon cards
 * fall under this per eBay UK's category tree).
 *
 * Fees per eBay UK's published Business Seller Fees page:
 *   * Final-value fee: 10.9%
 *   * Regulatory operating fee: 0.35% of the total sale amount
 *   * Per-order fixed fee: £0.30 for orders ≤ £10, £0.40 above
 *   * Payment processing is included in the FVF (no separate charge)
 *
 * The 10p reduced fixed-fee treatment applies only to certain
 * selected Collectables sub-categories; we do NOT claim it for
 * trading cards without a verified category mapping. The standard
 * £0.30/£0.40 tier is used until a category-specific lookup is
 * added.
 */
export const UK_EBAY_BUSINESS: SellingProfile = {
  id: 'uk_ebay_business',
  displayName: 'eBay UK — business seller (Collectables)',
  marketplace: 'ebay_uk',
  sellerType: 'business',
  currency: 'GBP',
  marketplaceFeeRate: 0.109,   // 10.9%
  regulatoryFeeRate: 0.0035,   // 0.35%
  paymentFeeRate: 0,
  fixedSellingFeeRule: {
    kind: 'tiered_by_sale',
    tiers: [
      { maxSaleCents: 1000, feeCents: 30 },                       // ≤ £10 → £0.30
      { maxSaleCents: Number.POSITIVE_INFINITY, feeCents: 40 },   // > £10 → £0.40
    ],
  },
  // eBay UK's business seller fee page explicitly states rates
  // are quoted EXCLUSIVE OF VAT. A UK VAT-registered seller can
  // reclaim the input VAT on eBay fees (so it's not a real
  // cost); a non-VAT-registered business bears the 20% VAT.
  feesExcludeVat: true,
  feeVatRate: 0.20,
  effectiveDate: '2026-08-07',
  sourceNote:
    'eBay UK Business Seller Fees for Collectables (Aug 2026): 10.9% final-value fee, ' +
    '0.35% regulatory operating fee on total sale, £0.30 per order for orders ≤ £10 and ' +
    '£0.40 above, no separate payment processing charge. Rates are quoted excluding VAT — ' +
    'the calculator grosses fees by 20% unless the caller marks fee VAT as reclaimable. ' +
    'Certain selected sub-categories may qualify for reduced per-order treatment — not ' +
    'claimed here without a verified mapping.',
}

/**
 * Generic fallback for marketplaces the app does not model
 * explicitly. Conservative rates; callers should supply real
 * numbers when known.
 */
export const GENERIC_SELLING: SellingProfile = {
  id: 'generic',
  displayName: 'Custom / other marketplace',
  marketplace: 'other',
  sellerType: 'other',
  currency: 'GBP',
  marketplaceFeeRate: 0.13,
  regulatoryFeeRate: 0,
  paymentFeeRate: 0.029,
  fixedSellingFeeRule: { kind: 'flat', flat: 0 },
  effectiveDate: '2026-08-07',
  sourceNote:
    'Generic fallback. Callers should supply real seller rates when known.',
}

export const SELLING_PROFILES: Record<string, SellingProfile> = {
  uk_ebay_private:  UK_EBAY_PRIVATE,
  uk_ebay_business: UK_EBAY_BUSINESS,
  generic:          GENERIC_SELLING,
}

/**
 * Default profile for the current PokePrices audience: UK-first,
 * mostly private sellers.
 */
export const DEFAULT_SELLING_PROFILE = UK_EBAY_PRIVATE
