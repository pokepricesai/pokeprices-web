// src/lib/portfolio/errors.ts
//
// Block 5A-W-50F/FIX3 — user-facing message mapper for portfolio_items
// mutation errors surfaced by the trigger. The trigger raises verbose
// PostgreSQL exceptions like:
//
//   "The purchase date cannot be later than activity already recorded
//    for this holding."
//
// which are already user-friendly. This helper preserves those
// messages when they match, and otherwise falls back to a safe
// generic message so raw internal errors (column mismatches, RLS
// denials) never leak to the user.

const KNOWN_TRIGGER_MESSAGES: RegExp[] = [
  /The purchase date cannot be in the future\./,
  /The purchase date cannot be later than activity already recorded for this holding\./,
  // Block 5A-W-50F/FIX4 — clearing a recorded date is rejected.
  /The purchase date cannot be cleared\. Change it to the correct date instead\./,
]

export function friendlyPortfolioUpdateError(raw: string | null | undefined): string {
  if (!raw) return 'Could not save your changes. Please try again.'
  for (const rx of KNOWN_TRIGGER_MESSAGES) {
    const m = raw.match(rx)
    if (m) return m[0]
  }
  return 'Could not save your changes. Please try again.'
}
