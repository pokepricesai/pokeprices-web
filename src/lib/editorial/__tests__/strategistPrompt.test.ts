// src/lib/editorial/__tests__/strategistPrompt.test.ts
//
// EIC Block 5 — tests for the strategist prompt bundle + response
// parser. The prompt-assembly test asserts the compact context
// object round-trips cleanly and never sends more than we intend.
// The parser tests cover the resilience of parseStrategistResponse
// against fenced/unfenced/malformed JSON returned by the model.

import { describe, it, expect } from 'vitest'
import {
  buildStrategistSystemPrompt,
  parseStrategistResponse,
} from '../strategistPrompt'

const emptyContext = {
  meta: { today: '2026-09-06', generatedAt: '2026-09-06T12:00:00Z', articleBodyExcerptChars: 1500 },
  articles: [],
  projects: [],
  release: {
    today: '2026-09-06', windowDaysBack: 45, windowDaysForward: 120,
    recent: [], upcoming: [], upcomingCoverageIsThin: true, gapNote: null,
  },
  summary: {
    totalArticles: 0, articlesPublishedThisMonth: 0, activeProjects: 0, ideasInBacklog: 0,
    upcomingReleases: 0, recentReleases: 0, releasesWithoutCoverage: 0,
  },
} as const

const emptyRadar = {
  meta: {
    today: '2026-09-06', generatedAt: '2026-09-06T12:00:00Z',
    detectorsRun: [], detectorsSuppressed: [],
    dataFreshness: { cardTrendsAsOf: '2026-09-06' },
  },
  opportunities: [],
} as const

describe('buildStrategistSystemPrompt', () => {
  it('includes the today date and non-invention rule in the system prompt', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    expect(system).toContain('2026-09-06')
    expect(system).toContain('Do NOT invent')
    expect(system).toContain('two exceptional articles per week')
  })

  it('embeds a JSON context block the model can parse', () => {
    const { system, contextJson } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    // The system prompt should include the exact JSON we hand out.
    expect(system).toContain(contextJson)
    expect(() => JSON.parse(contextJson)).not.toThrow()
    const round = JSON.parse(contextJson)
    expect(round.today).toBe('2026-09-06')
    expect(round.weeklyGoal).toContain('two')
  })

  it('excludes rejected radar opportunities from the compact context', () => {
    const radar = {
      ...emptyRadar,
      opportunities: [
        { id: 'x1', kind: 'monthly_report', headlineSuggestion: 'Aug 2026', angle: '', whyNow: '',
          score: 100, scoreReasons: [], dataStrength: 'strong', citationPotential: 'high',
          suggestedArticleType: 'monthly_market_report', suggestedTiming: 'this week',
          relatedSets: [], relatedCards: [], metrics: [], evidenceSummary: [],
          overlap: { verdict: 'low', topMatchSlug: null, topMatchHeadline: null }, visuals: [] },
        { id: 'x2', kind: 'grading_spread', headlineSuggestion: 'PSA 10 premium', angle: '', whyNow: '',
          score: 90, scoreReasons: [], dataStrength: 'strong', citationPotential: 'high',
          suggestedArticleType: 'data_study', suggestedTiming: null,
          relatedSets: [], relatedCards: [], metrics: [], evidenceSummary: [],
          overlap: { verdict: 'low', topMatchSlug: null, topMatchHeadline: null }, visuals: [] },
      ],
    } as any
    const { contextJson } = buildStrategistSystemPrompt(emptyContext as any, radar, { rejectedRadarIds: ['x1'] })
    const parsed = JSON.parse(contextJson)
    expect(parsed.radar.opportunities.map((o: any) => o.id)).toEqual(['x2'])
    expect(parsed.radar.rejectedIdsThisSession).toEqual(['x1'])
  })
})

describe('parseStrategistResponse', () => {
  it('parses a well-formed fenced JSON reply', () => {
    const raw = 'Some prose here.\n```json\n{"assistantMessage":"hi","recommendations":{"summary":"one strong pick","primary":[{"headline":"H","angle":"a","whyNow":"n","whyUseful":"u","evidenceAvailable":[],"evidenceStillNeeded":[],"citationPotential":"high","searchOrEditorialIntent":"","suggestedVisualsOrDataBlocks":[],"existingContentOverlap":{"risk":"low","related":[]},"recommendedPublishDay":"Tuesday","confidence":"high"}],"alternatives":[]}}\n```'
    const parsed = parseStrategistResponse(raw)
    expect(parsed.assistantMessage).toBe('hi')
    expect(parsed.recommendations?.primary.length).toBe(1)
    expect(parsed.recommendations?.primary[0].headline).toBe('H')
    expect(parsed.recommendations?.primary[0].citationPotential).toBe('high')
  })

  it('coerces unknown enum values to sensible defaults', () => {
    const raw = '```json\n{"assistantMessage":"ok","recommendations":{"summary":"","primary":[{"headline":"H","angle":"","whyNow":"","whyUseful":"","evidenceAvailable":[],"evidenceStillNeeded":[],"citationPotential":"stellar","searchOrEditorialIntent":"","suggestedVisualsOrDataBlocks":[],"existingContentOverlap":{"risk":"catastrophic","related":[]},"recommendedPublishDay":"","confidence":"cosmic"}],"alternatives":[]}}\n```'
    const parsed = parseStrategistResponse(raw)
    const r = parsed.recommendations!.primary[0]
    expect(r.citationPotential).toBe('medium')            // default
    expect(r.confidence).toBe('medium')                   // default
    expect(r.existingContentOverlap.risk).toBe('none')    // default
  })

  it('drops recommendation entries missing a headline', () => {
    const raw = '```json\n{"assistantMessage":"ok","recommendations":{"summary":"","primary":[{"headline":"Keep"},{"angle":"drop me — no headline"}],"alternatives":[]}}\n```'
    const parsed = parseStrategistResponse(raw)
    expect(parsed.recommendations!.primary.length).toBe(1)
    expect(parsed.recommendations!.primary[0].headline).toBe('Keep')
  })

  it('falls back to plain assistant message when no JSON is present', () => {
    const raw = 'I only see one genuinely strong opportunity this week — the August 2026 monthly report.'
    const parsed = parseStrategistResponse(raw)
    expect(parsed.assistantMessage).toBe(raw)
    expect(parsed.recommendations).toBeUndefined()
  })

  it('handles JSON without a fence', () => {
    const raw = '{"assistantMessage":"no fence"}'
    const parsed = parseStrategistResponse(raw)
    expect(parsed.assistantMessage).toBe('no fence')
  })
})
