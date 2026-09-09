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
  POKEPRICES_EDITORIAL_PROFILE,
  STRATEGIST_ROLE_RULES,
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
    expect(system).toContain('Do not invent')
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

  // Block 5B — style + gate assertions
  it('does not contain any em dash characters in the prose portion of the prompt', () => {
    // Guard against future edits reintroducing em dashes. The context
    // JSON block can legitimately include user data with em dashes,
    // so we only check the prose (everything before the JSON fence).
    const { system, contextJson } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    const prose = system.replace(contextJson, '').replace(/```[\s\S]*?```/g, '')
    expect(prose.includes('—')).toBe(false)
  })

  it('mandates American English in the writing style rules', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    expect(system).toMatch(/American English/i)
    expect(system).toMatch(/behavior.*not.*behaviour/i)
  })

  it('lists the AI-trope patterns the model must avoid', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    for (const trope of [
      'Honest answer:',
      "I'm going to push back",
      "In the world of",
      'not just X, but Y',
    ]) expect(system).toContain(trope)
  })

  it('states the primary-recommendation data-quality gate', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    expect(system).toContain('PRIMARY-RECOMMENDATION QUALITY GATE')
    expect(system).toMatch(/never .*weak/i)
    expect(system).toMatch(/Quality is more important than quota/i)
  })

  it('does not describe PokePrices as UK-only', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    expect(system).not.toMatch(/UK-focused/i)
    expect(system).not.toMatch(/UK TCG market/i)
  })

  it('declares the two editorial lanes (internal and external) as valid', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    expect(system).toMatch(/TWO EDITORIAL LANES/)
    expect(system).toMatch(/INTERNAL/)
    expect(system).toMatch(/EXTERNAL/)
    // External must not require proprietary data.
    expect(system).toMatch(/External articles do NOT require proprietary PokePrices data/i)
    // Explicit callout that lacking data is not grounds to reject an
    // external idea.
    expect(system).toMatch(/Do NOT downgrade an external idea/i)
  })

  it('honors explicit user intent — do not re-argue an accepted external request', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    expect(system).toMatch(/EXPLICIT USER INTENT WINS/)
    expect(system).toMatch(/Do not re-argue/i)
    // Common trigger phrases the strategist must respect.
    expect(system).toMatch(/external article/i)
    expect(system).toMatch(/general knowledge/i)
    expect(system).toMatch(/save this idea/i)
  })

  it('lists external article types in the recommendation schema', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    // The suggestedArticleType enum in the schema description must
    // include both lanes.
    expect(system).toMatch(/monthly_market_report/)   // internal
    expect(system).toMatch(/evergreen_guide/)         // external
    expect(system).toMatch(/upcoming_set/)            // external
    // Recommendation shape must carry a mode field so the client can
    // route the idea to the correct workflow.
    expect(system).toMatch(/"mode":\s*"internal"\|"external"/)
  })

  it('does not blanket-downgrade "SEO filler" — only "SEO filler with no useful angle"', () => {
    const { system } = buildStrategistSystemPrompt(emptyContext as any, emptyRadar as any)
    // The old prompt said "SEO filler" without qualification, which
    // caused the model to refuse legitimate external SEO articles.
    // The new prompt scopes the downrank properly.
    expect(system).toMatch(/SEO filler with no research/i)
  })

  it('exposes POKEPRICES_EDITORIAL_PROFILE + STRATEGIST_ROLE_RULES for reuse', () => {
    expect(typeof POKEPRICES_EDITORIAL_PROFILE).toBe('string')
    expect(POKEPRICES_EDITORIAL_PROFILE.length).toBeGreaterThan(400)
    expect(typeof STRATEGIST_ROLE_RULES).toBe('string')
    expect(STRATEGIST_ROLE_RULES.length).toBeGreaterThan(400)
    // Neither should contain em dashes.
    expect(POKEPRICES_EDITORIAL_PROFILE.includes('—')).toBe(false)
    expect(STRATEGIST_ROLE_RULES.includes('—')).toBe(false)
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

  it('accepts and preserves the mode field on recommendations', () => {
    const raw = '```json\n{"assistantMessage":"ok","recommendations":{"summary":"","primary":[{"headline":"Pikachu history","mode":"external","angle":"","whyNow":"","whyUseful":"","evidenceAvailable":[],"evidenceStillNeeded":[],"citationPotential":"high","searchOrEditorialIntent":"","suggestedVisualsOrDataBlocks":[],"existingContentOverlap":{"risk":"low","related":[]},"recommendedPublishDay":"Tuesday","confidence":"high","suggestedArticleType":"evergreen_guide"}],"alternatives":[]}}\n```'
    const parsed = parseStrategistResponse(raw)
    const r = parsed.recommendations!.primary[0]
    expect(r.mode).toBe('external')
    expect(r.suggestedArticleType).toBe('evergreen_guide')
  })

  it('silently drops a garbage mode value rather than blowing up', () => {
    const raw = '```json\n{"assistantMessage":"ok","recommendations":{"summary":"","primary":[{"headline":"H","mode":"purple","angle":"","whyNow":"","whyUseful":"","evidenceAvailable":[],"evidenceStillNeeded":[],"citationPotential":"medium","searchOrEditorialIntent":"","suggestedVisualsOrDataBlocks":[],"existingContentOverlap":{"risk":"none","related":[]},"recommendedPublishDay":"","confidence":"medium"}],"alternatives":[]}}\n```'
    const parsed = parseStrategistResponse(raw)
    const r = parsed.recommendations!.primary[0]
    expect(r.mode).toBeUndefined()
  })
})
