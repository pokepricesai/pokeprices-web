// src/lib/scanner/normalizeCardNumber.ts
//
// Block 5A-W-51B.1 — JS mirror of the Postgres _normalize_card_number
// function used by scan_card_match. Kept in sync with:
//   migrations/2026-08-05-fix-card-number-normalisation.sql
//
// Purpose: give the vitest suite something to test the corrected
// normalisation behaviour against without spinning up a Postgres
// instance. The migration is authoritative — this JS mirror MUST
// produce identical output for every input the tests cover.
//
// The regex `(^|[^0-9])0+([0-9])` requires the zero run to be at the
// start of a numeric component: the string start OR immediately after
// a non-digit character (typically "/", "-", or a letter prefix).
// Internal zeros between digits are preserved.
//
// Behaviour (all verified in normalizeCardNumber.test.ts):
//   "001"       -> "1"
//   "012"       -> "12"
//   "030/086"   -> "30/86"
//   "SWSH-001"  -> "swsh-1"
//   "102"       -> "102"
//   "100"       -> "100"
//   "102/100"   -> "102/100"
//   "12/100"    -> "12/100"
//   "200/100"   -> "200/100"
//   "20/10"     -> "20/10"
//   "TG12/TG30" -> "tg12/tg30"

const WHITESPACE = /\s+/g
const LEADING_ZERO_RUN = /(^|[^0-9])0+([0-9])/g

export function normalizeCardNumber(input: string | null | undefined): string | null {
  if (input == null) return null
  const trimmed = input.trim()
  if (trimmed === '') return null
  const lowered = input.toLowerCase().replace(WHITESPACE, '')
  return lowered.replace(LEADING_ZERO_RUN, '$1$2')
}
