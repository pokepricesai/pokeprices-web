// src/lib/providerData/resolveProviderMode.ts
//
// PP-TCG-500-PREP correction §B — the ONE place that decides whether a
// card page is in provider mode. Both the page body renderer and
// generateMetadata consume this so the two can never diverge.
//
// Fail-closed rule: metadata and page body MUST avoid publishing legacy
// numerical price claims whenever we cannot CERTIFY that this card is
// supposed to be legacy. The adapter's own gates (approved mapping,
// effective eligibility, active printing) are already fail-closed; this
// helper layers on the pilot-cohort gate and treats any lookup failure
// as "cannot certify".
//
// A card is "certified legacy" ONLY when BOTH:
//   • the pilot cohort read succeeded AND reports prices_enabled=false
//   • the provider snapshot read succeeded AND the resulting snapshot
//     has NO market_prices, NO graded_prices, and NO image_normal
// Any other outcome (snapshot threw, pilot threw, pilot says ON while
// snapshot came back empty) is NOT certified → consumers must omit the
// legacy numerical SEO claims rather than publish them.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProviderSnapshot, type ProviderSnapshot } from '@/lib/providerData/snapshot'
import { getPilotFeatures } from '@/lib/providerData/pilotCohort'

export type ProviderMode = {
  snapshot: ProviderSnapshot | null
  /** The pokemon_tcg_pilot_cohort row said prices_enabled=true. */
  pilotPricesOn: boolean
  /** The provider snapshot query threw an exception. */
  snapshotLookupFailed: boolean
  /** The pilot cohort query threw an exception. */
  pilotLookupFailed: boolean
  /** TRUE iff the snapshot has at least one market/graded row OR an image. */
  useProvider: boolean
  /** TRUE iff consumers CANNOT safely publish legacy numerical prices
   *  for this card. Set when: snapshot has provider data, OR either
   *  lookup failed, OR pilot says ON but snapshot came back empty. */
  mustFailClosed: boolean
}

export async function resolveProviderMode(sb: SupabaseClient, pp_card_slug: string): Promise<ProviderMode> {
  const [snapshotResult, pilotResult] = await Promise.allSettled([
    getProviderSnapshot(sb, pp_card_slug),
    getPilotFeatures(sb, pp_card_slug),
  ])
  const snapshot = snapshotResult.status === 'fulfilled' ? snapshotResult.value : null
  const snapshotLookupFailed = snapshotResult.status === 'rejected'
  const pilotLookupFailed = pilotResult.status === 'rejected'
  const pilot = pilotResult.status === 'fulfilled' ? pilotResult.value : null
  const pilotPricesOn = pilot?.prices === true

  const providerHasPrices = (snapshot?.market_prices?.length ?? 0) > 0 ||
                             (snapshot?.graded_prices?.length ?? 0) > 0
  const providerHasImage = Boolean(snapshot?.image_normal)
  const useProvider = providerHasPrices || providerHasImage

  // Certification: can we POSITIVELY say this card is legacy?
  //   - snapshot read succeeded (so empty really means "no provider data")
  //   - pilot read succeeded (so prices=false really means "not in pilot")
  //   - snapshot came back empty (no provider data to serve)
  //   - pilot says off (not in the cohort or prices_enabled=false)
  const certifiedLegacy =
    !useProvider &&
    !pilotPricesOn &&
    !pilotLookupFailed &&
    !snapshotLookupFailed

  // Must fail closed if we can't serve provider data AND we can't
  // certify legacy. Includes: pilot ON but snapshot empty, snapshot
  // threw, pilot threw, mixed states.
  const mustFailClosed = !useProvider && !certifiedLegacy

  return {
    snapshot,
    pilotPricesOn,
    snapshotLookupFailed,
    pilotLookupFailed,
    useProvider,
    mustFailClosed,
  }
}
