// Block 5A-W-50F / FIX1 — the event write path is trigger-owned, so
// there is no client-side recording surface to test any more.
// classifyQuantityChange survives as a pure display helper.

import { describe, it, expect } from 'vitest'
import { classifyQuantityChange } from '../events'

describe('classifyQuantityChange', () => {
  it('returns null for a no-op change', () => {
    expect(classifyQuantityChange(3, 3)).toBeNull()
    expect(classifyQuantityChange(null, 0)).toBeNull()
  })

  it('classifies first-time add as holding_added with full quantity', () => {
    expect(classifyQuantityChange(0, 2)).toEqual({ event_type: 'holding_added', quantity_delta: 2 })
    expect(classifyQuantityChange(null, 1)).toEqual({ event_type: 'holding_added', quantity_delta: 1 })
  })

  it('classifies remove-to-zero as holding_removed with negative delta', () => {
    expect(classifyQuantityChange(3, 0)).toEqual({ event_type: 'holding_removed', quantity_delta: -3 })
  })

  it('classifies quantity increase as quantity_added with delta only', () => {
    expect(classifyQuantityChange(2, 5)).toEqual({ event_type: 'quantity_added', quantity_delta: 3 })
  })

  it('classifies quantity decrease as quantity_removed with negative delta only', () => {
    expect(classifyQuantityChange(5, 2)).toEqual({ event_type: 'quantity_removed', quantity_delta: -3 })
  })
})
