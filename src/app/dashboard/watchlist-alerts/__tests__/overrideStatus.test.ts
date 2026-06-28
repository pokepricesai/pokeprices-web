// Bugfix tests for the per-card watchlist alert override visible-state
// helper. Pure unit tests — no React, no DOM, no supabase client; runs
// in the project's default node vitest env without infrastructure
// additions.
//
// These pin the four states the control's collapsed summary line
// produces, so a regression that mis-labels (e.g. shows "OFF" when
// the user hasn't disabled anything) gets caught without needing to
// render the React component.

import { describe, it, expect } from 'vitest'
import {
  describeOverrideState,
  DEFAULT_ROW,
  SUGGESTED_RISE,
  SUGGESTED_DROP,
  type OverrideRow,
} from '../overrideStatus'

function row(over: Partial<OverrideRow> = {}): OverrideRow {
  return { ...DEFAULT_ROW, ...over }
}

describe('describeOverrideState', () => {
  it('default row (no DB write yet) → ON · Using global defaults', () => {
    const out = describeOverrideState(DEFAULT_ROW)
    expect(out.stateLabel).toBe('ON')
    expect(out.summary).toBe('Using global defaults')
    expect(out.isCustom).toBe(false)
  })

  it('row with enabled=false (master per-card switch) → OFF · Alerts off for this card', () => {
    const out = describeOverrideState(row({ enabled: false }))
    expect(out.stateLabel).toBe('OFF')
    expect(out.summary).toBe('Alerts off for this card')
    expect(out.isCustom).toBe(false)
  })

  it('row with use_global_defaults=false + custom thresholds → ON · Custom: rise X% · drop Y%', () => {
    const out = describeOverrideState(row({
      use_global_defaults: false,
      rise_pct: 25,
      drop_pct: 5,
    }))
    expect(out.stateLabel).toBe('ON')
    expect(out.summary).toBe('Custom: rise 25% · drop 5%')
    expect(out.isCustom).toBe(true)
  })

  it('row with use_global_defaults=false but NULL thresholds → falls back to suggested defaults in copy', () => {
    // Happens transiently right after the user toggles off
    // "Use my global Watchlist defaults" before saving any values.
    // The summary should never read "Custom: rise null% · drop null%".
    const out = describeOverrideState(row({
      use_global_defaults: false,
      rise_pct: null,
      drop_pct: null,
    }))
    expect(out.stateLabel).toBe('ON')
    expect(out.summary).toBe(`Custom: rise ${SUGGESTED_RISE}% · drop ${SUGGESTED_DROP}%`)
    expect(out.isCustom).toBe(true)
  })

  it('enabled=false WINS over custom thresholds — OFF state always reads "Alerts off"', () => {
    const out = describeOverrideState(row({
      enabled: false,
      use_global_defaults: false,
      rise_pct: 25,
      drop_pct: 5,
    }))
    expect(out.stateLabel).toBe('OFF')
    expect(out.summary).toBe('Alerts off for this card')
  })
})
