// src/lib/editorial/__tests__/styleFix.test.ts
//
// Final Cleanup — deterministic style-fix regressions.

import { describe, it, expect } from 'vitest'
import { applyDeterministicStyleFixes, applyStyleFixesToDraft } from '../styleFix'

describe('applyDeterministicStyleFixes', () => {
  it('replaces em dashes with comma+space', () => {
    const { text, changed } = applyDeterministicStyleFixes('This card — the Charmeleon — is rare.')
    expect(text).toBe('This card, the Charmeleon, is rare.')
    expect(changed).toBe(2)
  })
  it('replaces British spellings with American forms, preserving case', () => {
    const { text, changed } = applyDeterministicStyleFixes('Catalogue Behaviour Colour')
    expect(text).toBe('Catalog Behavior Color')
    expect(changed).toBe(3)
  })
  it('collapses double spaces + removes space-before-punctuation', () => {
    const { text } = applyDeterministicStyleFixes('two  spaces , here .')
    expect(text).toBe('two spaces, here.')
  })
  it('does not touch text that is already clean', () => {
    const { text, changed } = applyDeterministicStyleFixes('This is fine prose.')
    expect(text).toBe('This is fine prose.')
    expect(changed).toBe(0)
  })
})

describe('applyStyleFixesToDraft', () => {
  it('walks every reader-facing string field of the draft', () => {
    const draft = {
      headline: 'Charizard — analysed',
      intro: 'The behaviour is colour-first.',
      seoTitle: 'Charizard — study',
      seoDescription: 'A catalogue analysis.',
      sections: [
        { id: 's1', heading: 'Analyse', paragraphs: ['One — two — three.'] },
      ],
      conclusion: 'A colour study.',
    }
    const { draft: fixed, changed } = applyStyleFixesToDraft(draft)
    expect(fixed.headline).toBe('Charizard, analyzed')
    expect(fixed.intro).toBe('The behavior is color-first.')
    expect(fixed.sections[0].heading).toBe('Analyze')
    expect(fixed.sections[0].paragraphs[0]).toBe('One, two, three.')
    expect(fixed.conclusion).toBe('A color study.')
    expect(changed).toBeGreaterThan(0)
  })
})
