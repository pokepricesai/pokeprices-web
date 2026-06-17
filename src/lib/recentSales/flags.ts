// src/lib/recentSales/flags.ts
// Block 4B-W-1 — typed server-only feature-flag readers for the
// recent-sales workstream.
//
// Five flags are documented here. Every reader follows the same
// fail-closed pattern as the email onboarding flags (Block 3B/3D):
// the value must be the literal string "true" to be considered on.
// Any other state — unset, empty, "1", "yes", "TRUE", "True", "false"
// — returns false.
//
// Vercel server env changes require a deployment for the new value
// to land in the bundle. See docs/recent-sales-architecture.md.
//
// IMPORTANT: none of these flags are exposed via NEXT_PUBLIC. They
// are server-only by design. A new test (no-public-leakage) enforces
// this at build time by scanning the env catalogue.

import 'server-only'

function readLiteralTrue(name: string): boolean {
  // strict: only the lowercase literal "true" passes.
  return (process.env[name] ?? '').trim() === 'true'
}

/**
 * Gates the scraper-side write path into `recent_sales`. When false,
 * no row is ever inserted, regardless of which other flag is set.
 * Stage-2 pilot ingestion does not begin until this flag is on AND
 * the operator has seeded `recent_sales_card_allow_list`.
 */
export function isIngestionEnabled(): boolean {
  return readLiteralTrue('RECENT_SALES_INGESTION_ENABLED')
}

/**
 * Gates the admin-only review surface at `/admin/recent-sales`
 * (built in a later block). When false, the surface returns 404.
 */
export function isAdminViewEnabled(): boolean {
  return readLiteralTrue('RECENT_SALES_ADMIN_VIEW_ENABLED')
}

/**
 * Gates the customer-facing Free preview component on card pages
 * (built in a later block). When false, the card page renders
 * unchanged from today.
 */
export function isFreePreviewEnabled(): boolean {
  return readLiteralTrue('RECENT_SALES_FREE_PREVIEW_ENABLED')
}

/**
 * Gates the locked Pro preview component on card pages (built in a
 * later block). When false, no Pro-locked CTA is rendered.
 */
export function isProPreviewEnabled(): boolean {
  return readLiteralTrue('RECENT_SALES_PRO_PREVIEW_ENABLED')
}

/**
 * Gates catalogue-wide ingestion. When false, ingestion only writes
 * rows for cards present in `recent_sales_card_allow_list`. When true,
 * the allow-list is ignored. Stage 5 flip.
 */
export function isFullCatalogueEnabled(): boolean {
  return readLiteralTrue('RECENT_SALES_FULL_CATALOGUE')
}

// ─────────────────────────────────────────────────────────────────────
// Bulk snapshot — used by the admin status panel in a later block.
// ─────────────────────────────────────────────────────────────────────

export type RecentSalesFlagSnapshot = {
  ingestion:     boolean
  adminView:     boolean
  freePreview:   boolean
  proPreview:    boolean
  fullCatalogue: boolean
}

export function readRecentSalesFlagSnapshot(): RecentSalesFlagSnapshot {
  return {
    ingestion:     isIngestionEnabled(),
    adminView:     isAdminViewEnabled(),
    freePreview:   isFreePreviewEnabled(),
    proPreview:    isProPreviewEnabled(),
    fullCatalogue: isFullCatalogueEnabled(),
  }
}

/**
 * List of every recent-sales env var name. Tests use this to assert
 * none are exposed via NEXT_PUBLIC.
 */
export const RECENT_SALES_FLAG_NAMES: ReadonlyArray<string> = [
  'RECENT_SALES_INGESTION_ENABLED',
  'RECENT_SALES_ADMIN_VIEW_ENABLED',
  'RECENT_SALES_FREE_PREVIEW_ENABLED',
  'RECENT_SALES_PRO_PREVIEW_ENABLED',
  'RECENT_SALES_FULL_CATALOGUE',
]
