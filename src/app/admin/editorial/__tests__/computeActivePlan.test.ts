// src/app/admin/editorial/__tests__/computeActivePlan.test.ts
//
// Block 5 final — locks the invariant that the visible strategist
// plan is derived from history via a single canonical fold. Any
// future edit that reintroduces manual currentRecs mutation will
// break these tests.

import { describe, it, expect } from 'vitest'
import { computeActivePlan, type ActivePlan } from '@/lib/editorial/activePlan'
import type { StrategistRecommendation, StrategistResponse } from '@/lib/editorial/strategistPrompt'

const P1: StrategistRecommendation = {
  headline: 'Population scarcity study', angle: 'a', whyNow: 'n', whyUseful: 'u',
  evidenceAvailable: [], evidenceStillNeeded: [],
  citationPotential: 'high', searchOrEditorialIntent: '', suggestedVisualsOrDataBlocks: [],
  existingContentOverlap: { risk: 'none', related: [] },
  recommendedPublishDay: 'Tuesday', confidence: 'high',
  suggestedArticleType: 'data_study', radarOpportunityId: null, radarScore: null,
}
const P2: StrategistRecommendation = { ...P1, headline: 'Storm Emerald', suggestedArticleType: 'new_set' }
const ALT1: StrategistRecommendation = { ...P1, headline: 'Alt one' }
const ALT2: StrategistRecommendation = { ...P1, headline: 'Alt two' }
const ALT3: StrategistRecommendation = { ...P1, headline: 'Alt three' }

function turn(recs?: ActivePlan): { role: 'assistant'; content: string; ts: string; parsed?: StrategistResponse } {
  return {
    role: 'assistant', content: '', ts: '2026-09-06T00:00:00Z',
    parsed: {
      assistantMessage: '',
      recommendations: recs ? {
        summary: recs.summary, primary: [...recs.primary], alternatives: [...recs.alternatives],
      } : undefined,
    },
  }
}

describe('computeActivePlan', () => {
  it('returns undefined when there are no assistant turns', () => {
    expect(computeActivePlan([])).toBeUndefined()
  })

  it('takes the initial pack when only one assistant turn has recommendations', () => {
    const plan = computeActivePlan([turn({ summary: 'two picks', primary: [P1, P2], alternatives: [ALT1] })])
    expect(plan?.primary.map(p => p.headline)).toEqual(['Population scarcity study', 'Storm Emerald'])
    expect(plan?.alternatives.map(a => a.headline)).toEqual(['Alt one'])
  })

  it('preserves the initial primary when a later turn returns empty primary and new alternatives (the Luke bug)', () => {
    const history = [
      turn({ summary: 'initial', primary: [P1, P2],  alternatives: [ALT1] }),
      turn({ summary: 'chat',    primary: [],        alternatives: [ALT1, ALT2, ALT3] }),
    ]
    const plan = computeActivePlan(history)
    expect(plan?.primary.map(p => p.headline)).toEqual(['Population scarcity study', 'Storm Emerald'])
    expect(plan?.alternatives.map(a => a.headline)).toEqual(['Alt one', 'Alt two', 'Alt three'])
  })

  it('lets a later turn narrow primary to a single item when it explicitly returns one', () => {
    const history = [
      turn({ summary: 'initial', primary: [P1, P2], alternatives: [ALT1] }),
      turn({ summary: 'chat',    primary: [P1],     alternatives: [ALT2, ALT3] }),
    ]
    const plan = computeActivePlan(history)
    expect(plan?.primary.map(p => p.headline)).toEqual(['Population scarcity study'])
    expect(plan?.alternatives.map(a => a.headline)).toEqual(['Alt two', 'Alt three'])
  })

  it('ignores assistant turns that have no recommendations block', () => {
    const history = [
      turn({ summary: 'initial', primary: [P1, P2], alternatives: [ALT1] }),
      turn(),                                                                    // chat-only reply
      turn({ summary: 'chat',    primary: [],       alternatives: [ALT2] }),
    ]
    const plan = computeActivePlan(history)
    expect(plan?.primary.map(p => p.headline)).toEqual(['Population scarcity study', 'Storm Emerald'])
    expect(plan?.alternatives.map(a => a.headline)).toEqual(['Alt two'])
  })

  it('ignores user turns entirely', () => {
    const history = [
      { role: 'user' as const, content: 'MODE=recommend', ts: '2026-09-06T00:00:00Z' },
      turn({ summary: 'initial', primary: [P1], alternatives: [] }),
      { role: 'user' as const, content: 'reject #1', ts: '2026-09-06T00:01:00Z' },
    ]
    const plan = computeActivePlan(history)
    expect(plan?.primary.map(p => p.headline)).toEqual(['Population scarcity study'])
  })

  it('handles a malformed assistant turn without throwing', () => {
    const history: any[] = [
      turn({ summary: 'initial', primary: [P1], alternatives: [] }),
      { role: 'assistant', content: '', ts: 'x', parsed: { assistantMessage: '', recommendations: { primary: null, alternatives: undefined } as any } },
    ]
    expect(() => computeActivePlan(history)).not.toThrow()
    const plan = computeActivePlan(history)
    // Malformed arrays are normalized to [], and merge preserves prev.
    expect(plan?.primary.map(p => p.headline)).toEqual(['Population scarcity study'])
  })
})
