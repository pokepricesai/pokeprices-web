// src/lib/studio/dataBlocks/__tests__/registry.test.ts
//
// EIC Block 8 — payload validation regression tests.

import { describe, it, expect } from 'vitest'
import { DATA_BLOCK_REGISTRY, validateDataBlockPayload } from '../registry'

describe('registry — every variant validates its own happy-path payload', () => {
  it('ranking_table', () => {
    const p = validateDataBlockPayload('ranking_table', {
      title: 'Top 3', columns: [{ key: 'cardName', label: 'Card', format: 'text' }, { key: 'price', label: 'Price', format: 'usd', align: 'right' }],
      rows: [{ cells: { cardName: 'A', price: 50 } }, { cells: { cardName: 'B', price: 100 } }],
      mode: 'snapshot', provenance: { asOf: '2026-09-06' },
    })
    expect(p).not.toBeNull()
    expect(p!.rows).toHaveLength(2)
  })
  it('card_block snapshot', () => {
    const p = validateDataBlockPayload('card_block', {
      card: { cardSlug: '100', cardName: 'X' },
      show: { raw: true, psa10: true },
      mode: 'snapshot',
      snapshot: { rawUsd: 200, psa10Usd: 3000, asOf: '2026-09-06' },
    })
    expect(p).not.toBeNull()
  })
  it('card_block live has no snapshot', () => {
    const p = validateDataBlockPayload('card_block', { card: { cardSlug: '100', cardName: 'X' }, show: {}, mode: 'live' })
    expect(p!.mode).toBe('live')
    expect(p!.snapshot).toBeUndefined()
  })
  it('card_grid rejects an empty cards list', () => {
    expect(validateDataBlockPayload('card_grid', { cards: [], mode: 'snapshot' })).toBeNull()
  })
  it('methodology requires summary', () => {
    expect(validateDataBlockPayload('methodology', { title: 'Methodology', summary: '' })).toBeNull()
    const p = validateDataBlockPayload('methodology', { title: 'Methodology', summary: 'How we did it', asOf: '2026-09-06' })
    expect(p).not.toBeNull()
  })
  it('stat_callout requires both value and label', () => {
    expect(validateDataBlockPayload('stat_callout', { value: '', label: 'x' })).toBeNull()
    expect(validateDataBlockPayload('stat_callout', { value: '1', label: '' })).toBeNull()
  })
  it('price_chart with no series is rejected', () => {
    expect(validateDataBlockPayload('price_chart', { card: { cardSlug: '1', cardName: 'X' }, series: [], mode: 'live', points: [] })).toBeNull()
  })
  it('raw_psa_comparison requires at least one row', () => {
    expect(validateDataBlockPayload('raw_psa_comparison', { rows: [], showRatios: false, mode: 'snapshot' })).toBeNull()
    const p = validateDataBlockPayload('raw_psa_comparison', { rows: [{ card: { cardSlug: '1', cardName: 'X' }, rawCents: 500 }], showRatios: false, mode: 'snapshot' })
    expect(p!.rows).toHaveLength(1)
  })
})

describe('registry — malformed payloads fail gracefully rather than crashing', () => {
  it('returns null for garbage input to every variant', () => {
    for (const v of Object.keys(DATA_BLOCK_REGISTRY) as Array<keyof typeof DATA_BLOCK_REGISTRY>) {
      expect(validateDataBlockPayload(v, null)).toBeNull()
      expect(validateDataBlockPayload(v, 'not an object' as any)).toBeNull()
    }
  })
  it('drops non-numeric row cells but keeps the row skeleton', () => {
    const p = validateDataBlockPayload('ranking_table', {
      title: 't', columns: [{ key: 'a', label: 'A' }],
      rows: [{ cells: { a: 5, junk: { deep: 'object' } } }],
      mode: 'snapshot', provenance: { asOf: '2026-09-06' },
    })
    expect(p!.rows[0].cells).toEqual({ a: 5 })
  })
})
