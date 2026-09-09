// src/lib/editorial/publishing/__tests__/signOff.test.ts
//
// Sign-off + schedule invariants for the simplified HQ:
//
//   * Any change to headline / intro / body / seo title / seo
//     description makes the current sign-off "stale".
//   * A no-op save (same content, different bodyDoc reference) does
//     NOT invalidate the sign-off.
//   * Ordinary hyphens etc. in the same text field don't cause false
//     positives.
//
// The scheduled_publish_at timestamp is preserved across sign-off
// clears at the DB layer; that is tested end-to-end via the
// PATCH route's integration behaviour and not here.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import { signOffKeyForStudio, materialContentChanged } from '../signOff'
import type { StudioDocument } from '@/lib/studio/types'

function makeStudio(overrides: Partial<StudioDocument> = {}): StudioDocument {
  return {
    version:    1,
    headline:   'Pikachu History',
    intro:      'From Base Set to the 30th anniversary.',
    themeKey:   'market',
    themeLabel: 'Market',
    authorName: 'PokePrices',
    seo:        { title: 'Pikachu History', description: 'A collector-focused history.' },
    heroImage:  null,
    bodyDoc: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Opening line.' }] },
    ] } as any,
    updatedAt: '2026-09-10T00:00:00Z',
    ...overrides,
  }
}

describe('signOffKeyForStudio', () => {
  it('is stable for identical content', () => {
    const a = makeStudio()
    const b = makeStudio()
    expect(signOffKeyForStudio(a)).toBe(signOffKeyForStudio(b))
  })
  it('changes when the headline changes', () => {
    const a = makeStudio()
    const b = makeStudio({ headline: 'Pikachu History: Deluxe Edition' })
    expect(signOffKeyForStudio(a)).not.toBe(signOffKeyForStudio(b))
  })
  it('changes when the intro changes', () => {
    const a = makeStudio()
    const b = makeStudio({ intro: 'Rewritten intro copy.' })
    expect(signOffKeyForStudio(a)).not.toBe(signOffKeyForStudio(b))
  })
  it('changes when the body doc changes', () => {
    const a = makeStudio()
    const b = makeStudio({ bodyDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Different lead.' }] }] } as any })
    expect(signOffKeyForStudio(a)).not.toBe(signOffKeyForStudio(b))
  })
  it('changes when the SEO title changes', () => {
    const a = makeStudio()
    const b = makeStudio({ seo: { title: 'Different SEO', description: a.seo.description } })
    expect(signOffKeyForStudio(a)).not.toBe(signOffKeyForStudio(b))
  })
  it('changes when the SEO description changes', () => {
    const a = makeStudio()
    const b = makeStudio({ seo: { title: a.seo.title, description: 'Different description' } })
    expect(signOffKeyForStudio(a)).not.toBe(signOffKeyForStudio(b))
  })
  it('does NOT change when a non-material field changes (updatedAt, hero image)', () => {
    const a = makeStudio()
    const b = makeStudio({ updatedAt: '2027-01-01T00:00:00Z', heroImage: { url: 'https://example.com/x.png', alt: 'hero' } })
    expect(signOffKeyForStudio(a)).toBe(signOffKeyForStudio(b))
  })
})

describe('materialContentChanged', () => {
  it('is true when there is no previous doc (first save)', () => {
    expect(materialContentChanged(null, makeStudio())).toBe(true)
  })
  it('is false when the doc is identical', () => {
    expect(materialContentChanged(makeStudio(), makeStudio())).toBe(false)
  })
  it('is true when the body changes', () => {
    const prev = makeStudio()
    const next = makeStudio({ bodyDoc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] } as any })
    expect(materialContentChanged(prev, next)).toBe(true)
  })
  it('is false when only the hero image / author changes', () => {
    const prev = makeStudio()
    const next = makeStudio({ heroImage: { url: 'https://x.example/hero.png', alt: '' }, authorName: 'Other' })
    expect(materialContentChanged(prev, next)).toBe(false)
  })
})
