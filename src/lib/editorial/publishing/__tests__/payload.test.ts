// src/lib/editorial/publishing/__tests__/payload.test.ts
//
// EIC Block 10 — deterministic Studio → insights payload builder.

import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))

import type { StudioDocument } from '@/lib/studio/types'
import type { EvidencePack } from '@/lib/editorial/research/types'
import { studioProjectToInsightPayload } from '../payload'

function makeStudio(overrides: Partial<StudioDocument> = {}): StudioDocument {
  return {
    version: 1,
    headline: 'August 2026 Pokemon TCG Market Report',
    intro: 'A tight month.',
    themeKey: 'market',
    themeLabel: 'Market',
    authorName: 'Luke',
    seo: { title: '', description: '' },
    heroImage: null,
    bodyDoc: {
      type: 'doc', content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'What happened' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '62,645 cards.' }] },
        { type: 'dataBlock', attrs: { variant: 'stat_callout', payload: { value: '62,645', label: 'cards', mode: 'snapshot' } } },
        { type: 'dataBlock', attrs: { variant: 'card_block',   payload: { card: { cardSlug: '849998', cardName: 'Charmeleon', setName: 'Base Set' }, show: { raw: true, psa10: true }, mode: 'live' } } },
        { type: 'dataBlock', attrs: { variant: 'card_grid',    payload: { cards: [{ card: { cardSlug: '850113', cardName: 'Charmeleon-RH', setName: 'Base Set' } }], mode: 'live' } } },
      ],
    } as any,
    updatedAt: '2026-09-07T00:00:00Z',
    ...overrides,
  }
}
const emptyPack: EvidencePack = {
  version: 1, recipe: 'monthly_market_report',
  project: { id: 1, title: 't', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
  generatedAt: '2026-09-07T00:00:00Z', dataAsOf: '2026-08-31',
  methodology: { summary: '', filters: [], excludedGroups: [], dedupKey: '' },
  verifiedFacts: [], derivedFindings: [], dataTables: [],
  internalSources: [], externalSources: [], internalLinks: [], visualOpportunities: [],
  warnings: [], researchGaps: [], rejectedClaims: [], notes: [], quarantinedRows: [],
  quality: { status: 'ok', dataStrength: 'strong', sampleSize: 0, freshness: { asOf: '2026-08-31', daysOld: 0, isStale: false }, publishable: true, reasons: [] },
}

describe('studioProjectToInsightPayload', () => {
  it('populates NOT NULL insights columns', () => {
    const { payload } = studioProjectToInsightPayload({ studio: makeStudio(), writer: null, pack: emptyPack, preferredSlug: 'august-2026-report', status: 'draft' })
    expect(payload.slug).toBe('august-2026-report')
    expect(payload.headline).toContain('August')
    expect(payload.theme_label).toBe('Market')
    expect(payload.meta_title).toBeTruthy()
    expect(payload.meta_description).toBeTruthy()
    expect(payload.hero_image_query).toBe('')
    expect(payload.body_json.blocks.length).toBeGreaterThan(0)
    expect(payload.status).toBe('draft')
  })

  it('falls back to headline for seo_title and intro for seo_description', () => {
    const s = makeStudio({ seo: { title: '', description: '' } })
    const { payload, warnings } = studioProjectToInsightPayload({ studio: s, writer: null, pack: emptyPack, preferredSlug: 'x-2', status: 'draft' })
    expect(payload.seo_title).toBe(s.headline)
    expect(payload.seo_description).toBe(s.intro)
    expect(warnings.length).toBeGreaterThanOrEqual(2)
  })

  it('derives card_refs from card_block + card_grid + ranking_table without inventing from prose', () => {
    const { payload } = studioProjectToInsightPayload({ studio: makeStudio(), writer: null, pack: emptyPack, preferredSlug: 'derived-refs', status: 'draft' })
    expect(payload.card_refs.sort()).toEqual(['849998', '850113'])
  })

  it('derives set_refs from card blocks + card grid + optional set_block', () => {
    const { payload } = studioProjectToInsightPayload({ studio: makeStudio(), writer: null, pack: emptyPack, preferredSlug: 'derived-sets', status: 'draft' })
    expect(payload.set_refs).toContain('Base Set')
  })

  it('surfaces adapter warnings for unsupported nodes so preflight can veto', () => {
    const studio = makeStudio({
      bodyDoc: { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1' }] }] } as any,
    })
    const { adapterWarnings } = studioProjectToInsightPayload({ studio, writer: null, pack: emptyPack, preferredSlug: 'x-3', status: 'draft' })
    expect(adapterWarnings.some(w => w.kind === 'unsupported_node')).toBe(true)
  })
})
