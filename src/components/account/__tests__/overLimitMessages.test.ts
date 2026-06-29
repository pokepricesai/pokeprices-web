// Block 5A-W-26 — over-limit message helper tests.

import { describe, it, expect } from 'vitest'
import {
  portfolioOverLimitMessage,
  watchlistOverLimitMessage,
  customAlertOverLimitMessage,
} from '../overLimitMessages'

// ─────────────────────────────────────────────────────────────────────
// Pro short-circuit (never any message)
// ─────────────────────────────────────────────────────────────────────

describe('over-limit helpers — pro plan', () => {
  it('portfolio returns null for pro at any count', () => {
    expect(portfolioOverLimitMessage('pro', 0)).toBeNull()
    expect(portfolioOverLimitMessage('pro', 9999)).toBeNull()
  })
  it('watchlist returns null for pro at any count', () => {
    expect(watchlistOverLimitMessage('pro', 0)).toBeNull()
    expect(watchlistOverLimitMessage('pro', 9999)).toBeNull()
  })
  it('custom alert returns null for pro at any count', () => {
    expect(customAlertOverLimitMessage('pro', 0)).toBeNull()
    expect(customAlertOverLimitMessage('pro', 9999)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Under / at limit on free (no message either)
// ─────────────────────────────────────────────────────────────────────

describe('over-limit helpers — free plan, under limit', () => {
  it('portfolio: under or at 25 → null', () => {
    expect(portfolioOverLimitMessage('free', 0)).toBeNull()
    expect(portfolioOverLimitMessage('free', 25)).toBeNull()
  })
  it('watchlist: under or at 10 → null', () => {
    expect(watchlistOverLimitMessage('free', 0)).toBeNull()
    expect(watchlistOverLimitMessage('free', 10)).toBeNull()
  })
  it('custom alert: under or at 3 → null', () => {
    expect(customAlertOverLimitMessage('free', 0)).toBeNull()
    expect(customAlertOverLimitMessage('free', 3)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Free + over limit (real users from the post-deploy SQL)
// ─────────────────────────────────────────────────────────────────────

describe('over-limit helpers — free plan, OVER limit', () => {
  it('portfolio: returns a non-destructive message that names the current count + the limit', () => {
    const msg = portfolioOverLimitMessage('free', 569)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/569/)
    expect(msg).toMatch(/25/)
    expect(msg).toMatch(/safe/i)
    expect(msg).toMatch(/Upgrade coming soon/i)
    // Mentions an editable action (view, edit or remove) — confirms
    // the user that nothing is being deleted.
    expect(msg).toMatch(/view|edit|remove/i)
  })

  it('watchlist over-limit message names the current count', () => {
    const msg = watchlistOverLimitMessage('free', 47)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/47/)
    expect(msg).toMatch(/10/)
    expect(msg).toMatch(/safe/i)
  })

  it('custom alert over-limit message references "thresholds" (not "cards")', () => {
    const msg = customAlertOverLimitMessage('free', 5)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/5/)
    expect(msg).toMatch(/3/)
    expect(msg).toMatch(/threshold/i)
  })

  it('every over-limit message ends with "Upgrade coming soon to add more."', () => {
    expect(portfolioOverLimitMessage('free', 100)?.endsWith('Upgrade coming soon to add more.')).toBe(true)
    expect(watchlistOverLimitMessage('free', 100)?.endsWith('Upgrade coming soon to add more.')).toBe(true)
    expect(customAlertOverLimitMessage('free', 100)?.endsWith('Upgrade coming soon to add more.')).toBe(true)
  })
})
