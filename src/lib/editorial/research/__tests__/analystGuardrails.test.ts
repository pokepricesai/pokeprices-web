// src/lib/editorial/research/__tests__/analystGuardrails.test.ts
//
// Block 6 — deterministic guardrails on the Research Analyst output.
//
// The Analyst is an AI role. Prompts alone are insufficient: this
// module tests the code-side enforcement that the Analyst can never
// upgrade a blocked pack to publishable, invent facts absent from
// the pack, or override critical warnings.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { parseAnalystResponse } from '../analystPrompt'
import type { EvidencePack } from '../types'

function packWithQuality(overrides: Partial<EvidencePack['quality']> = {}, warnings: EvidencePack['warnings'] = []): EvidencePack {
  return {
    version: 1,
    recipe: 'generic_fallback',
    project: { id: 1, title: 't', articleType: 'evergreen', angle: null, targetPublishAt: null },
    generatedAt: '2026-09-06T00:00:00Z',
    dataAsOf: '2026-09-06',
    methodology: { summary: 's', filters: [], excludedGroups: [], dedupKey: 'k' },
    verifiedFacts: [], derivedFindings: [], dataTables: [],
    internalSources: [], externalSources: [], internalLinks: [], visualOpportunities: [],
    warnings, researchGaps: [], rejectedClaims: [], notes: [], quarantinedRows: [],
    quality: {
      status: 'ok', dataStrength: 'strong', sampleSize: 100,
      freshness: { asOf: '2026-09-06', daysOld: 0, isStale: false },
      publishable: true, reasons: [],
      ...overrides,
    },
  }
}

function fenced(json: object): string {
  return "```json\n" + JSON.stringify(json) + "\n```"
}

describe('parseAnalystResponse — publishRecommendation guardrails', () => {
  it('accepts a plausible ready response for an ok pack', () => {
    const raw = fenced({
      summary: 'Solid dataset with clear angle.',
      strongestFindings: [{ finding: 'X', reason: 'Y' }],
      weakerFindings: [], contradictions: [], missingResearch: [],
      recommendedAngle: 'Angle', headlineCandidates: ['A','B'], requiredCaveats: [],
      unresolvedQuestions: [], recommendedVisuals: [],
      publishRecommendation: 'ready', publishRecommendationReasons: ['All gates cleared'],
    })
    const a = parseAnalystResponse(raw, packWithQuality())
    expect(a.publishRecommendation).toBe('ready')
  })

  it('FORCES publishRecommendation=blocked when pack.quality.status is blocked, even if Analyst tried to say ready', () => {
    const raw = fenced({
      summary: '', strongestFindings: [], weakerFindings: [], contradictions: [], missingResearch: [],
      recommendedAngle: '', headlineCandidates: [], requiredCaveats: [], unresolvedQuestions: [], recommendedVisuals: [],
      publishRecommendation: 'ready', publishRecommendationReasons: [],
    })
    const a = parseAnalystResponse(raw, packWithQuality({ status: 'blocked', publishable: false }))
    expect(a.publishRecommendation).toBe('blocked')
    expect(a.publishRecommendationReasons.join(' ')).toMatch(/blocked/)
  })

  it('DOWNGRADES ready to ready_with_caveats when pack.quality.status is needs_review', () => {
    const raw = fenced({
      summary: '', strongestFindings: [], weakerFindings: [], contradictions: [], missingResearch: [],
      recommendedAngle: '', headlineCandidates: [], requiredCaveats: [], unresolvedQuestions: [], recommendedVisuals: [],
      publishRecommendation: 'ready', publishRecommendationReasons: [],
    })
    const a = parseAnalystResponse(raw, packWithQuality({ status: 'needs_review' }))
    expect(a.publishRecommendation).toBe('ready_with_caveats')
  })

  it('DOWNGRADES ready to more_research_needed when the pack has critical warnings', () => {
    const raw = fenced({
      summary: '', strongestFindings: [], weakerFindings: [], contradictions: [], missingResearch: [],
      recommendedAngle: '', headlineCandidates: [], requiredCaveats: [], unresolvedQuestions: [], recommendedVisuals: [],
      publishRecommendation: 'ready', publishRecommendationReasons: [],
    })
    const a = parseAnalystResponse(raw, packWithQuality({ status: 'ok' }, [
      { id: 'w', severity: 'critical', message: 'boom' },
    ]))
    expect(a.publishRecommendation).toBe('more_research_needed')
    expect(a.publishRecommendationReasons.join(' ')).toMatch(/critical/)
  })

  it('handles malformed / non-fenced input without throwing', () => {
    const a = parseAnalystResponse('not json', packWithQuality())
    expect(a.publishRecommendation).toBe('more_research_needed')
    expect(a.summary).toBe('')
  })

  it('normalises array/object shapes even when Analyst returns rubbish', () => {
    const raw = fenced({
      summary: 42, strongestFindings: 'oops', weakerFindings: [{}, { finding: 42 }],
      publishRecommendation: 'not_a_valid_enum',
    })
    const a = parseAnalystResponse(raw, packWithQuality())
    expect(a.summary).toBe('')
    expect(a.strongestFindings).toEqual([])
    expect(a.publishRecommendation).toBe('more_research_needed')
  })
})

describe('32× regression via pack.quality.status = blocked', () => {
  // In Block 5 the "32× median grading premium" case was flagged at
  // the Radar level via researchRequired=true. In Block 6, that
  // Radar signal becomes a project whose derived research pack would
  // be blocked (raw side all listing floor). No Analyst response can
  // upgrade such a pack to ready or ready_with_caveats.
  it('cannot upgrade a "32× artifact"-shaped blocked pack to publishable', () => {
    const artifactPack = packWithQuality(
      { status: 'blocked', dataStrength: 'weak', publishable: false, reasons: ['raw side of the sample is a listing floor'] },
      [{ id: 'w', severity: 'critical', message: 'all raw prices under $3 — grading multiple is a data-composition artifact' }],
    )
    const raw = fenced({
      summary: 'The 32× median PSA10/raw multiple is a strong story.',
      strongestFindings: [{ finding: '32× median grading premium', reason: 'headline number' }],
      weakerFindings: [], contradictions: [], missingResearch: [],
      recommendedAngle: 'Publish a strong grading premium study using the 32× headline.',
      headlineCandidates: ['Grading a Pokémon card makes it worth 32× more'],
      requiredCaveats: [], unresolvedQuestions: [], recommendedVisuals: [],
      publishRecommendation: 'ready', publishRecommendationReasons: ['Strong headline'],
    })
    const a = parseAnalystResponse(raw, artifactPack)
    expect(a.publishRecommendation).toBe('blocked')
  })
})
