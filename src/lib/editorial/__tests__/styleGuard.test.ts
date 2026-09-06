// src/lib/editorial/__tests__/styleGuard.test.ts
//
// EIC Block 5C — style guard unit tests. Covers detection of em
// dashes and forbidden trope phrases across every text field of a
// parsed strategist response.

import { describe, it, expect } from 'vitest'
import { auditStrategistStyle, buildStyleRepairUserTurn, FORBIDDEN_TROPE_PHRASES } from '../styleGuard'

function baseResponse(overrides: any = {}) {
  return {
    assistantMessage: '',
    recommendations: {
      summary: '',
      primary: [],
      alternatives: [],
      ...overrides.recommendations,
    },
    ...overrides,
  }
}

describe('auditStrategistStyle', () => {
  it('returns no violations for a clean response', () => {
    const audit = auditStrategistStyle(baseResponse({
      assistantMessage: 'Two strong picks this week: the August market report and the release-driven Storm Emerald guide.',
      recommendations: {
        summary: 'Two data-led picks.',
        primary: [{
          headline: 'Pokemon Card Market Report August 2026',
          angle: 'Analyze the August dataset.',
          whyNow: 'Previous month has ended.',
          whyUseful: 'Recurring flagship format.',
          evidenceAvailable: ['135 trusted tracked cards'],
          evidenceStillNeeded: ['top mover selection'],
          citationPotential: 'high',
          searchOrEditorialIntent: 'monthly recap',
          suggestedVisualsOrDataBlocks: ['ranking_table'],
          existingContentOverlap: { risk: 'none', related: [] },
          recommendedPublishDay: 'Tuesday',
          confidence: 'high',
        }],
        alternatives: [],
      },
    }))
    expect(audit.hasViolations).toBe(false)
    expect(audit.violations.length).toBe(0)
  })

  it('flags an em dash in assistantMessage', () => {
    const audit = auditStrategistStyle(baseResponse({
      assistantMessage: 'One strong pick — the August report.',
    }))
    expect(audit.hasViolations).toBe(true)
    expect(audit.violations.some(v => v.kind === 'em_dash' && v.where === 'assistantMessage')).toBe(true)
  })

  it('flags em dashes inside recommendation fields', () => {
    const audit = auditStrategistStyle(baseResponse({
      recommendations: {
        summary: '',
        primary: [{ headline: 'The Grading Study — First Look', angle: 'ok', whyNow: 'now', whyUseful: 'u',
          evidenceAvailable: [], evidenceStillNeeded: [], citationPotential: 'medium',
          searchOrEditorialIntent: '', suggestedVisualsOrDataBlocks: [],
          existingContentOverlap: { risk: 'none', related: [] }, recommendedPublishDay: '', confidence: 'medium' }],
        alternatives: [],
      },
    }))
    expect(audit.violations.some(v => v.kind === 'em_dash' && v.where === 'primary[0].headline')).toBe(true)
  })

  it('flags each specifically-listed trope phrase', () => {
    for (const phrase of FORBIDDEN_TROPE_PHRASES) {
      const audit = auditStrategistStyle(baseResponse({
        assistantMessage: `${phrase} that we should skip this.`,
      }))
      expect(audit.hasViolations, `phrase "${phrase}" should be flagged`).toBe(true)
      expect(audit.violations.some(v => v.kind === 'trope' && v.match === phrase)).toBe(true)
    }
  })

  it('counts multiple occurrences of the same trope', () => {
    const audit = auditStrategistStyle(baseResponse({
      assistantMessage: "That said, the data is thin. That said, we can still ship the monthly report.",
    }))
    const tropeViolation = audit.violations.find(v => v.match === 'That said')
    expect(tropeViolation).toBeTruthy()
    expect(tropeViolation!.count).toBe(2)
  })

  it('walks assistantMessage, summary, primary, alternatives + array fields', () => {
    const audit = auditStrategistStyle(baseResponse({
      assistantMessage: 'Clean top-level.',
      recommendations: {
        summary: 'Honest answer: keep the report.',
        primary: [{
          headline: 'ok', angle: 'ok', whyNow: 'ok', whyUseful: 'ok',
          evidenceAvailable: ['One item — with em dash'],
          evidenceStillNeeded: [], citationPotential: 'high',
          searchOrEditorialIntent: '', suggestedVisualsOrDataBlocks: [],
          existingContentOverlap: { risk: 'none', related: [] },
          recommendedPublishDay: '', confidence: 'high',
        }],
        alternatives: [{
          headline: 'ok', angle: "In the world of Pokémon, this matters.", whyNow: '', whyUseful: '',
          evidenceAvailable: [], evidenceStillNeeded: [], citationPotential: 'medium',
          searchOrEditorialIntent: '', suggestedVisualsOrDataBlocks: [],
          existingContentOverlap: { risk: 'none', related: [] },
          recommendedPublishDay: '', confidence: 'medium',
        }],
      },
    }))
    expect(audit.violations.map(v => v.where).sort()).toEqual([
      'alternatives[0].angle',
      'primary[0].evidenceAvailable[0]',
      'recommendations.summary',
    ])
  })

  it('handles nonsense input without throwing', () => {
    expect(() => auditStrategistStyle(null)).not.toThrow()
    expect(() => auditStrategistStyle(undefined)).not.toThrow()
    expect(() => auditStrategistStyle('a string')).not.toThrow()
    expect(auditStrategistStyle(null).hasViolations).toBe(false)
  })
})

describe('buildStyleRepairUserTurn', () => {
  it('lists every violation with location + count', () => {
    const audit = auditStrategistStyle(baseResponse({
      assistantMessage: 'That said — this is a mess.',
    }))
    const prompt = buildStyleRepairUserTurn('raw', audit)
    expect(prompt).toContain('STYLE-REPAIR-PASS')
    expect(prompt).toContain('em_dash at assistantMessage')
    expect(prompt).toContain('trope "That said" at assistantMessage')
    expect(prompt).toContain('Preserve every fact')
    expect(prompt).toContain('Preserve the JSON schema exactly')
  })
})
