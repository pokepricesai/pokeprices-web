// src/lib/editorial/research/__tests__/monthlyMarketReport.test.ts
//
// Block 6 — month-inference tests for the Monthly Market Report recipe.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { inferTargetMonth } from '../monthlyMarketReport'

describe('inferTargetMonth', () => {
  it('parses "<Month YYYY>" from a title', () => {
    expect(inferTargetMonth('Pokemon Card Market Report — August 2026', '2026-09-06')).toEqual({ year: 2026, month: 8 })
    expect(inferTargetMonth('January 2027 recap',                       '2027-02-15')).toEqual({ year: 2027, month: 1 })
  })
  it('extracts a year even when the month name is elsewhere', () => {
    expect(inferTargetMonth('2025 September wrap-up', '2026-01-05')).toEqual({ year: 2025, month: 9 })
  })
  it('falls back to previous calendar month when nothing matches', () => {
    expect(inferTargetMonth('Untitled', '2026-09-06')).toEqual({ year: 2026, month: 8 })
    expect(inferTargetMonth('Untitled', '2026-01-15')).toEqual({ year: 2025, month: 12 })
  })
  it('is case-insensitive', () => {
    expect(inferTargetMonth('AUGUST 2026 MARKET REPORT', '2026-09-06')).toEqual({ year: 2026, month: 8 })
  })
})
