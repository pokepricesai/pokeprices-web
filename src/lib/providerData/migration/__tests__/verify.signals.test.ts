// Signal-parsing is what tells the migration worker "is this card
// in provider mode or still legacy?". These tests fix the HTML
// fingerprints we rely on so that a UI refactor can't silently flip
// the verification contract.

import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { parseSignals } from '../verify'

describe('parseSignals — provider-mode detection', () => {
  it('empty body → nothing matches', () => {
    const s = parseSignals('')
    expect(s.marketplace_panel_present).toBe(false)
    expect(s.faq_tcggraph_present).toBe(false)
    expect(s.grade_ladder_has_psa10).toBe(false)
    expect(s.provider_active).toBe(false)
  })

  it('marketplace panel heading alone is sufficient for provider_active', () => {
    const body = '<h2>Marketplace Snapshots</h2>'
    const s = parseSignals(body)
    expect(s.marketplace_panel_present).toBe(true)
    expect(s.provider_active).toBe(true)
  })

  it('FAQ TCGGraph realised-sale aggregation phrase alone is sufficient', () => {
    const body = '<p>Powered by TCGGraph realised-sale aggregation across sources.</p>'
    const s = parseSignals(body)
    expect(s.faq_tcggraph_present).toBe(true)
  })

  it('grade ladder with PSA 10 and a dollar figure signals a graded surface', () => {
    const body = '<div>PSA 10</div><div style="font-weight:800;color:var(--text)">$2,450</div>'
    const s = parseSignals(body)
    expect(s.grade_ladder_has_psa10).toBe(true)
  })

  it('"currently reads" FAQ with no PSA 9 line = provider active', () => {
    const body = '<p>Our FAQ currently reads: price history is realised-sale only"</p>'
    const s = parseSignals(body)
    expect(s.provider_active).toBe(true)
  })

  it('"currently reads" FAQ that mentions PSA 9 = legacy (not provider)', () => {
    // PriceCharting's legacy page lists PSA 9: in the FAQ passage.
    const body = '<p>Our FAQ currently reads: PSA 9: $100, raw: $20"</p>'
    const s = parseSignals(body)
    expect(s.provider_active).toBe(false)
  })

  it('PSA 7 muted-dash row (graded suppressed) = provider active', () => {
    const body = 'PSA 7</div><div style="color:var(--border)">—</div>'
    const s = parseSignals(body)
    expect(s.provider_active).toBe(true)
  })

  it('legacy-looking body (no marketplace, no FAQ phrase, PSA 9 in FAQ) stays legacy', () => {
    const body = `
      <h1>Charizard</h1>
      <p>price history for raw and PSA grades.</p>
      <p>Our FAQ currently reads: PSA 9: averaged across the last 30 days"</p>
    `
    const s = parseSignals(body)
    expect(s.marketplace_panel_present).toBe(false)
    expect(s.provider_active).toBe(false)
  })
})
