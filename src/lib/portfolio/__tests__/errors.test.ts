// Block 5A-W-50F/FIX3 — friendly error mapper for trigger raises.

import { describe, it, expect } from 'vitest'
import { friendlyPortfolioUpdateError } from '../errors'

describe('friendlyPortfolioUpdateError', () => {
  it('preserves the "purchase date cannot be in the future" raise', () => {
    const raw = 'ERROR:  The purchase date cannot be in the future.\nCONTEXT: PL/pgSQL function record_portfolio_item_event() ...'
    expect(friendlyPortfolioUpdateError(raw)).toBe('The purchase date cannot be in the future.')
  })

  it('preserves the "purchase date cannot be later than activity already recorded" raise', () => {
    const raw = 'The purchase date cannot be later than activity already recorded for this holding.'
    expect(friendlyPortfolioUpdateError(raw)).toBe('The purchase date cannot be later than activity already recorded for this holding.')
  })

  it('FIX4 — preserves the "purchase date cannot be cleared" raise', () => {
    const raw = 'ERROR:  The purchase date cannot be cleared. Change it to the correct date instead.\nCONTEXT: ...'
    expect(friendlyPortfolioUpdateError(raw))
      .toBe('The purchase date cannot be cleared. Change it to the correct date instead.')
  })

  it('falls back to a generic message for an unknown SQL error', () => {
    expect(friendlyPortfolioUpdateError('column "foo" does not exist'))
      .toBe('Could not save your changes. Please try again.')
  })

  it('falls back to generic on null / empty input', () => {
    expect(friendlyPortfolioUpdateError(null)).toBe('Could not save your changes. Please try again.')
    expect(friendlyPortfolioUpdateError('')).toBe('Could not save your changes. Please try again.')
  })

  it('never leaks internal SQL detail to the user', () => {
    const raw = 'permission denied for table portfolio_item_events\nCONTEXT: RLS policy pie_owner_select'
    const msg = friendlyPortfolioUpdateError(raw)
    expect(msg).not.toContain('RLS')
    expect(msg).not.toContain('portfolio_item_events')
  })
})
