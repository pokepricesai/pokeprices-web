// PP-TCG-500-PREP correction §B — unit tests for the shared gate.
// Exhaustive scenario coverage so page body + generateMetadata can
// confidently share this one source of truth.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveProviderMode } from '../resolveProviderMode'

vi.mock('../snapshot', () => ({ getProviderSnapshot: vi.fn() }))
vi.mock('../pilotCohort', () => ({ getPilotFeatures: vi.fn() }))

import { getProviderSnapshot } from '../snapshot'
import { getPilotFeatures } from '../pilotCohort'

const SNAP_WITH_DATA = {
  pp_card_slug: 'test',
  tcg_card_id: 'id',
  tcg_printing_key: 'normal',
  tcg_set_code: '',
  tcg_language: 'en',
  tcg_name: 'Test',
  pricing_eligibility: 'bulk_safe' as const,
  image_normal: null,
  image_large: null,
  image_source: null,
  market_prices: [{ source: 'tcgplayer' as const, finish: 'normal', list_type: 'retail' as const, currency: 'USD', market: 0.5, low: 0.1, trend: null, source_updated_at: null }],
  graded_prices: [{ grader: 'psa' as const, grade: '10' as const, currency: 'USD', price: 10, sales_volume: null, source_updated_at: null }],
}
const SNAP_EMPTY = {
  pp_card_slug: 'test',
  tcg_card_id: 'id',
  tcg_printing_key: 'normal',
  tcg_set_code: '',
  tcg_language: 'en',
  tcg_name: 'Test',
  pricing_eligibility: 'not_eligible' as const,
  image_normal: null,
  image_large: null,
  image_source: null,
  market_prices: [],
  graded_prices: [],
}

const sb = {} as never

beforeEach(() => {
  vi.resetAllMocks()
})

describe('resolveProviderMode', () => {
  it('provider-active: snapshot populated + pilot ON → useProvider=true, mustFailClosed=false', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SNAP_WITH_DATA)
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ prices: true, images: false, history: false })
    const r = await resolveProviderMode(sb, 'test')
    expect(r.useProvider).toBe(true)
    expect(r.mustFailClosed).toBe(false)
    expect(r.pilotPricesOn).toBe(true)
    expect(r.snapshotLookupFailed).toBe(false)
    expect(r.pilotLookupFailed).toBe(false)
    expect(r.snapshot).toBe(SNAP_WITH_DATA)
  })

  it('certified legacy: snapshot empty + pilot OFF + both lookups succeeded → useProvider=false, mustFailClosed=false', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SNAP_EMPTY)
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ prices: false, images: false, history: false })
    const r = await resolveProviderMode(sb, 'test')
    expect(r.useProvider).toBe(false)
    expect(r.mustFailClosed).toBe(false)
    expect(r.pilotPricesOn).toBe(false)
  })

  it('also certified legacy: snapshot is null (no mapping row) + pilot OFF + both succeeded → useProvider=false, mustFailClosed=false', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ prices: false, images: false, history: false })
    const r = await resolveProviderMode(sb, 'test')
    expect(r.useProvider).toBe(false)
    expect(r.mustFailClosed).toBe(false)
  })

  it('pilot ON but snapshot returned empty → mustFailClosed=true (ambiguous state)', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SNAP_EMPTY)
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ prices: true, images: false, history: false })
    const r = await resolveProviderMode(sb, 'test')
    expect(r.useProvider).toBe(false)
    expect(r.pilotPricesOn).toBe(true)
    expect(r.mustFailClosed).toBe(true)
  })

  it('snapshot threw + pilot ON → mustFailClosed=true', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db timeout'))
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ prices: true, images: false, history: false })
    const r = await resolveProviderMode(sb, 'test')
    expect(r.snapshotLookupFailed).toBe(true)
    expect(r.pilotPricesOn).toBe(true)
    expect(r.mustFailClosed).toBe(true)
  })

  it('snapshot threw + pilot OFF → mustFailClosed=true (snapshot failure means we cannot certify legacy)', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db timeout'))
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ prices: false, images: false, history: false })
    const r = await resolveProviderMode(sb, 'test')
    expect(r.snapshotLookupFailed).toBe(true)
    expect(r.pilotPricesOn).toBe(false)
    expect(r.useProvider).toBe(false)
    expect(r.mustFailClosed).toBe(true)  // CORRECTION: previous behaviour would have allowed legacy here
  })

  it('pilot threw + snapshot empty → mustFailClosed=true (pilot failure means we cannot certify legacy)', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(SNAP_EMPTY)
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('rls denied'))
    const r = await resolveProviderMode(sb, 'test')
    expect(r.snapshotLookupFailed).toBe(false)
    expect(r.pilotLookupFailed).toBe(true)
    expect(r.pilotPricesOn).toBe(false)   // Default; but we couldn't verify it
    expect(r.useProvider).toBe(false)
    expect(r.mustFailClosed).toBe(true)
  })

  it('both lookups threw → mustFailClosed=true', async () => {
    (getProviderSnapshot as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('x'))
    ;(getPilotFeatures as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('y'))
    const r = await resolveProviderMode(sb, 'test')
    expect(r.snapshotLookupFailed).toBe(true)
    expect(r.pilotLookupFailed).toBe(true)
    expect(r.useProvider).toBe(false)
    expect(r.mustFailClosed).toBe(true)
  })
})
