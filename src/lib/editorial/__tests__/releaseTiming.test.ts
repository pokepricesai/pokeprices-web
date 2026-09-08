// src/lib/editorial/__tests__/releaseTiming.test.ts
//
// EIC Block 3 — timing opportunity windows.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { timingOpportunitiesFor, RELEASE_WINDOW } from '../releaseContext'

describe('timingOpportunitiesFor', () => {
  it('flags "preview" for a release 60 days away', () => {
    const opps = timingOpportunitiesFor(60)
    expect(opps.find(o => o.key === 'preview')?.applicable).toBe(true)
    expect(opps.find(o => o.key === 'reveal')?.applicable).toBe(false)
    expect(opps.find(o => o.key === 'launch')?.applicable).toBe(false)
  })

  it('flags "reveal" for a release ~14 days away', () => {
    const opps = timingOpportunitiesFor(14)
    expect(opps.find(o => o.key === 'reveal')?.applicable).toBe(true)
  })

  it('flags "launch" during release week (both sides of zero)', () => {
    expect(timingOpportunitiesFor(3).find(o => o.key === 'launch')?.applicable).toBe(true)
    expect(timingOpportunitiesFor(0).find(o => o.key === 'launch')?.applicable).toBe(true)
    expect(timingOpportunitiesFor(-2).find(o => o.key === 'launch')?.applicable).toBe(true)
  })

  it('flags "reaction" ~10 days after release', () => {
    const opps = timingOpportunitiesFor(-10)
    expect(opps.find(o => o.key === 'reaction')?.applicable).toBe(true)
  })

  it('flags "launch" 5 days after release (extended launch window covers immediate post-release)', () => {
    const opps = timingOpportunitiesFor(-5)
    expect(opps.find(o => o.key === 'launch')?.applicable).toBe(true)
  })

  it('flags "performance" ~30 days after release', () => {
    const opps = timingOpportunitiesFor(-30)
    expect(opps.find(o => o.key === 'performance')?.applicable).toBe(true)
  })

  it('leaves no dead zone between adjacent stages', () => {
    // Every daysDelta in −60..+90 should have at least one applicable stage.
    for (let d = -60; d <= 90; d++) {
      const opps = timingOpportunitiesFor(d)
      expect(opps.some(o => o.applicable), `no applicable stage for daysDelta=${d}`).toBe(true)
    }
  })

  it('returns no applicable opportunity for a release 200 days away', () => {
    const opps = timingOpportunitiesFor(200)
    expect(opps.some(o => o.applicable)).toBe(false)
  })

  it('returns no applicable opportunity for a release 200 days ago', () => {
    const opps = timingOpportunitiesFor(-200)
    expect(opps.some(o => o.applicable)).toBe(false)
  })
})

describe('RELEASE_WINDOW constants', () => {
  it('matches Block 3 spec: 45 days back, 120 days forward', () => {
    expect(RELEASE_WINDOW.daysBack).toBe(45)
    expect(RELEASE_WINDOW.daysForward).toBe(120)
  })
})
