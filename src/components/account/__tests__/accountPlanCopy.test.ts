// Block 5A-W-26 — AccountPlanBadge copy tests.

import { describe, it, expect } from 'vitest'
import {
  getPlanCopy,
  UPGRADE_CTA,
  PRO_CONFIRMATION_LINES,
} from '../accountPlanCopy'
import { PLAN_LIMITS } from '@/lib/account/entitlements'

describe('getPlanCopy', () => {
  it('free → name + numeric limits + weekly overview line', () => {
    const c = getPlanCopy('free')
    expect(c.planName).toBe('Free account')
    // Numbers come from PLAN_LIMITS so a future bump auto-updates copy.
    expect(c.limitsLine).toBe(
      `Portfolio ${PLAN_LIMITS.free.portfolioItems} cards · Watchlist ${PLAN_LIMITS.free.watchlistItems} cards · ${PLAN_LIMITS.free.customAlertOverrides} custom alerts`,
    )
    expect(c.benefitsLine).toBe('Weekly overview included')
  })

  it('pro → name + unlimited line + instant alerts line', () => {
    const c = getPlanCopy('pro')
    expect(c.planName).toBe('Pro account')
    expect(c.limitsLine).toMatch(/Unlimited/)
    expect(c.benefitsLine).toBe('Instant alerts included')
  })

  it('copy NEVER mentions Stripe / Buy now / payment language', () => {
    for (const plan of ['free', 'pro'] as const) {
      const c = getPlanCopy(plan)
      const blob = `${c.planName} ${c.limitsLine} ${c.benefitsLine}`.toLowerCase()
      expect(blob).not.toMatch(/stripe/)
      expect(blob).not.toMatch(/buy now/)
      expect(blob).not.toMatch(/checkout/)
      expect(blob).not.toMatch(/credit card/)
    }
  })
})

describe('UPGRADE_CTA', () => {
  it('uses friendly future-tense heading + value-prop blurb', () => {
    expect(UPGRADE_CTA.heading).toBe('Pro is coming soon')
    expect(UPGRADE_CTA.blurb).toMatch(/Unlock/)
    expect(UPGRADE_CTA.buttonLabel).toBe('Join early access')
  })

  it('button href is a mailto with a pre-filled subject (no Stripe link)', () => {
    expect(UPGRADE_CTA.buttonHref.startsWith('mailto:')).toBe(true)
    expect(UPGRADE_CTA.buttonHref).toMatch(/subject=/i)
    expect(UPGRADE_CTA.buttonHref).not.toMatch(/stripe/i)
    expect(UPGRADE_CTA.buttonHref).not.toMatch(/checkout/i)
  })
})

describe('PRO_CONFIRMATION_LINES', () => {
  it('opens with the "You\'re on Pro" line and lists each unlocked feature', () => {
    expect(PRO_CONFIRMATION_LINES[0]).toBe("You're on Pro")
    const blob = PRO_CONFIRMATION_LINES.join(' ').toLowerCase()
    expect(blob).toMatch(/unlimited portfolio/)
    expect(blob).toMatch(/watchlist/)
    expect(blob).toMatch(/custom alerts/)
    expect(blob).toMatch(/instant alerts/)
  })
})
