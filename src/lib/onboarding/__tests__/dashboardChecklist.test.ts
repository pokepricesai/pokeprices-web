// Block 5A-W-30 — tests for the dashboard onboarding checklist helper.
// Pure logic only; no DB calls.

import { describe, it, expect } from 'vitest'
import {
  buildDashboardChecklist,
  type DashboardChecklistInputs,
} from '../dashboardChecklist'

function inputs(over: Partial<DashboardChecklistInputs> = {}): DashboardChecklistInputs {
  return {
    plan:                       'free',
    portfolioCount:             0,
    watchlistCount:             0,
    weeklyOverviewEnabled:      false,
    customAlertOverrideCount:   0,
    proEarlyAccessSubmitted:    false,
    ...over,
  }
}

describe('buildDashboardChecklist — empty / no-data state', () => {
  it('marks every item incomplete when the user has done nothing', () => {
    const r = buildDashboardChecklist(inputs())
    expect(r.items).toHaveLength(5)
    expect(r.items.every(i => !i.complete)).toBe(true)
    expect(r.completedCount).toBe(0)
    expect(r.totalCount).toBe(5)
    expect(r.allComplete).toBe(false)
  })

  it('treats null counts as incomplete (graceful failure)', () => {
    const r = buildDashboardChecklist(inputs({
      portfolioCount:           null,
      watchlistCount:           null,
      weeklyOverviewEnabled:    null,
      customAlertOverrideCount: null,
      proEarlyAccessSubmitted:  null,
    }))
    expect(r.completedCount).toBe(0)
    expect(r.items.every(i => !i.complete)).toBe(true)
  })

  it('emits the five expected item ids in order for a free user', () => {
    const r = buildDashboardChecklist(inputs())
    expect(r.items.map(i => i.id)).toEqual([
      'portfolio',
      'watchlist',
      'weekly',
      'custom-alerts',
      'pro-early-access',
    ])
  })

  it('every item has a non-empty label, description, and dashboard href', () => {
    const r = buildDashboardChecklist(inputs())
    for (const it of r.items) {
      expect(it.label.length).toBeGreaterThan(0)
      expect(it.description.length).toBeGreaterThan(0)
      expect(it.href.startsWith('/dashboard')).toBe(true)
    }
  })
})

describe('buildDashboardChecklist — per-item completion', () => {
  it('completes the portfolio item when portfolioCount > 0', () => {
    const r = buildDashboardChecklist(inputs({ portfolioCount: 3 }))
    const portfolio = r.items.find(i => i.id === 'portfolio')!
    expect(portfolio.complete).toBe(true)
    expect(portfolio.href).toBe('/dashboard/portfolio')
  })

  it('does NOT complete portfolio at count = 0', () => {
    const r = buildDashboardChecklist(inputs({ portfolioCount: 0 }))
    expect(r.items.find(i => i.id === 'portfolio')!.complete).toBe(false)
  })

  it('completes the watchlist item when watchlistCount > 0', () => {
    const r = buildDashboardChecklist(inputs({ watchlistCount: 1 }))
    const watchlist = r.items.find(i => i.id === 'watchlist')!
    expect(watchlist.complete).toBe(true)
    expect(watchlist.href).toBe('/dashboard/watchlist-alerts')
  })

  it('completes the weekly item only when weeklyOverviewEnabled is exactly true', () => {
    expect(buildDashboardChecklist(inputs({ weeklyOverviewEnabled: true  })).items.find(i => i.id === 'weekly')!.complete).toBe(true)
    expect(buildDashboardChecklist(inputs({ weeklyOverviewEnabled: false })).items.find(i => i.id === 'weekly')!.complete).toBe(false)
    expect(buildDashboardChecklist(inputs({ weeklyOverviewEnabled: null  })).items.find(i => i.id === 'weekly')!.complete).toBe(false)
  })

  it('completes the custom-alerts item when customAlertOverrideCount > 0', () => {
    const r = buildDashboardChecklist(inputs({ customAlertOverrideCount: 2 }))
    const custom = r.items.find(i => i.id === 'custom-alerts')!
    expect(custom.complete).toBe(true)
    expect(custom.href).toBe('/dashboard/watchlist-alerts')
  })

  it('does NOT complete custom-alerts at count = 0', () => {
    const r = buildDashboardChecklist(inputs({ customAlertOverrideCount: 0 }))
    expect(r.items.find(i => i.id === 'custom-alerts')!.complete).toBe(false)
  })

  it('handles NaN / Infinity / negative counts as incomplete', () => {
    const r1 = buildDashboardChecklist(inputs({ portfolioCount: NaN as unknown as number }))
    const r2 = buildDashboardChecklist(inputs({ watchlistCount: -3 }))
    const r3 = buildDashboardChecklist(inputs({ customAlertOverrideCount: Infinity }))
    expect(r1.items.find(i => i.id === 'portfolio')!.complete).toBe(false)
    expect(r2.items.find(i => i.id === 'watchlist')!.complete).toBe(false)
    // Infinity > 0 but isFinite gate keeps it from being treated as a real number.
    expect(r3.items.find(i => i.id === 'custom-alerts')!.complete).toBe(false)
  })
})

describe('buildDashboardChecklist — free vs pro variant', () => {
  it('free users see Join Pro early access', () => {
    const r = buildDashboardChecklist(inputs({ plan: 'free' }))
    const ids = r.items.map(i => i.id)
    expect(ids).toContain('pro-early-access')
    expect(ids).not.toContain('explore-instant-alerts')
  })

  it('pro users see Explore instant alerts instead', () => {
    const r = buildDashboardChecklist(inputs({ plan: 'pro' }))
    const ids = r.items.map(i => i.id)
    expect(ids).toContain('explore-instant-alerts')
    expect(ids).not.toContain('pro-early-access')
  })

  it('early access completes the free item only when proEarlyAccessSubmitted is true', () => {
    expect(buildDashboardChecklist(inputs({ plan: 'free', proEarlyAccessSubmitted: true  })).items.find(i => i.id === 'pro-early-access')!.complete).toBe(true)
    expect(buildDashboardChecklist(inputs({ plan: 'free', proEarlyAccessSubmitted: false })).items.find(i => i.id === 'pro-early-access')!.complete).toBe(false)
    expect(buildDashboardChecklist(inputs({ plan: 'free', proEarlyAccessSubmitted: null  })).items.find(i => i.id === 'pro-early-access')!.complete).toBe(false)
  })

  it('explore-instant-alerts completes once a pro user has any custom override', () => {
    const r = buildDashboardChecklist(inputs({ plan: 'pro', customAlertOverrideCount: 1 }))
    expect(r.items.find(i => i.id === 'explore-instant-alerts')!.complete).toBe(true)
  })

  it('free users do not see explore-instant-alerts even if they have custom overrides', () => {
    const r = buildDashboardChecklist(inputs({ plan: 'free', customAlertOverrideCount: 5 }))
    expect(r.items.map(i => i.id)).not.toContain('explore-instant-alerts')
  })

  it('keeps the same first four item ids regardless of plan', () => {
    const free = buildDashboardChecklist(inputs({ plan: 'free' }))
    const pro  = buildDashboardChecklist(inputs({ plan: 'pro' }))
    expect(free.items.slice(0, 4).map(i => i.id)).toEqual(pro.items.slice(0, 4).map(i => i.id))
  })
})

describe('buildDashboardChecklist — totals', () => {
  it('counts each completed item once', () => {
    const r = buildDashboardChecklist(inputs({
      plan:                       'free',
      portfolioCount:             1,
      watchlistCount:             2,
      weeklyOverviewEnabled:      true,
      customAlertOverrideCount:   0,
      proEarlyAccessSubmitted:    false,
    }))
    expect(r.completedCount).toBe(3)
    expect(r.totalCount).toBe(5)
    expect(r.allComplete).toBe(false)
  })

  it('reports allComplete=true only when every item is complete', () => {
    const r = buildDashboardChecklist(inputs({
      plan:                       'free',
      portfolioCount:             1,
      watchlistCount:             1,
      weeklyOverviewEnabled:      true,
      customAlertOverrideCount:   1,
      proEarlyAccessSubmitted:    true,
    }))
    expect(r.allComplete).toBe(true)
    expect(r.completedCount).toBe(r.totalCount)
  })
})
