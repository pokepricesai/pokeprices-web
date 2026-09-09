// src/lib/editorial/publishing/__tests__/preflightOverride.test.ts
//
// EIC — editorial override behavior in publication preflight.
//
// Covers the human-override path added so admins can consciously
// publish an internal article whose automated fact/numeric checks
// have not fully signed off, WITHOUT weakening the other gates
// (research approval, CMS essentials, slug validity, adapter
// conversion). External articles must be unaffected.

import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))

// ── Mocks ─────────────────────────────────────────────────────────
// Fake supa client that returns the current per-test payload for
// editorial_projects + returns null for the slug uniqueness check.
const state: { studio: any; writer: any; insightsId: string | null; status: string; slugTaken: boolean } = {
  studio: null, writer: null, insightsId: null, status: 'drafting', slugTaken: false,
}
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({
    from(table: string) {
      if (table === 'editorial_projects') {
        return {
          select(_cols: string) { return {
            eq(_col: string, _val: any) { return {
              maybeSingle: async () => ({ data: { studio_json: state.studio, writer_json: state.writer, insights_id: state.insightsId, status: state.status }, error: null }),
            } },
          } }
        }
      }
      if (table === 'insights') {
        return {
          select(_cols: string) { return {
            eq(_col: string, _val: any) { return {
              maybeSingle: async () => ({ data: state.slugTaken ? { id: 'other-uuid', status: 'published' } : null, error: null }),
            } },
          } }
        }
      }
      throw new Error(`unmocked table ${table}`)
    },
  }),
}))

vi.mock('../../research/serverActions', () => ({
  fetchProject: vi.fn(async (_id: number) => ({
    id: 42, title: 'August 2026 Pokémon Card Market Report', angle: null,
    article_type: 'monthly_market_report', status: state.status, target_publish_at: null,
    insights_id: state.insightsId, updated_at: '2026-09-08T00:00:00Z',
  })),
  fetchResearch: vi.fn(async (_id: number) => ({
    id: 42, project_id: 42, status: 'approved', analyst_json: null,
    evidence_json: makePack(),
  })),
}))

import { runPublicationPreflight } from '../preflight'
import { hashStudioBody } from '@/lib/editorial/writer/hash'
import type { WriterMetadata, EditorialOverride, FactCheckResult } from '@/lib/editorial/writer/types'
import type { EvidencePack } from '@/lib/editorial/research/types'

// ── Fixtures ──────────────────────────────────────────────────────

function makeStudio() {
  return {
    version: 1,
    headline: 'August 2026 Pokémon Card Market Report',
    intro: 'A quiet month with one loud outlier.',
    themeKey: 'market', themeLabel: 'Market',
    authorName: 'PokePrices',
    seo: { title: 'August 2026 Market Report', description: 'A tight month across the tracked sample.' },
    heroImage: null,
    bodyDoc: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Where the month landed' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The median was ~0.4% and the tails carried the story.' }] },
    ] } as any,
    updatedAt: '2026-09-08T00:00:00Z',
  }
}

function makePack(): EvidencePack {
  return {
    version: 1, recipe: 'monthly_market_report',
    project: { id: 42, title: 't', articleType: 'monthly_market_report', angle: null, targetPublishAt: null },
    generatedAt: '2026-09-08T00:00:00Z', dataAsOf: '2026-08-31',
    methodology: { summary: '', filters: [], excludedGroups: [], dedupKey: '' },
    verifiedFacts: [], derivedFindings: [], dataTables: [],
    internalSources: [], externalSources: [], internalLinks: [], visualOpportunities: [],
    warnings: [], researchGaps: [], rejectedClaims: [], notes: [], quarantinedRows: [],
    quality: { status: 'ok', dataStrength: 'strong', sampleSize: 62_403, freshness: { asOf: '2026-08-31', daysOld: 8, isStale: false }, publishable: true, reasons: ['ok'] },
  } as unknown as EvidencePack
}

function makeWriter(fcOverrides: Partial<FactCheckResult> = {}, overrideAgainstBody?: any): WriterMetadata {
  const studioBody = overrideAgainstBody ?? makeStudio().bodyDoc
  const factCheck: FactCheckResult = {
    version: 1,
    status: 'review_required',
    checkedAt: '2026-09-08T00:01:00Z',
    packRecipe: 'monthly_market_report',
    issues: [{ kind: 'unsupported_numeric_claim', severity: 'minor', claim: '18%', reason: 'not in evidence', evidenceRefs: [] }],
    numericAudit: { status: 'review_required', checked: 20, matched: 15, issues: [
      { token: { raw: '18%', value: 18, kind: 'percent', location: 'paragraph' }, reason: 'not in evidence' } as any,
      { token: { raw: '$999', value: 999, kind: 'currency', location: 'paragraph' }, reason: 'not in evidence' } as any,
    ] },
    checkedStudioHash: hashStudioBody(studioBody),
    autoCheck: true,
    ...fcOverrides,
  }
  return {
    version: 1,
    generatedAt: '2026-09-08T00:00:00Z',
    model: 'claude-sonnet-4-6',
    packRecipe: 'monthly_market_report',
    claimTrace: [], blockIntents: [], assemblyWarnings: [],
    generationCost: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0 },
    factCheck,
    checkedStudioHash: factCheck.checkedStudioHash,
  } as WriterMetadata
}

function withOverride(w: WriterMetadata, bodyDoc: any): WriterMetadata {
  const override: EditorialOverride = {
    active: true,
    overriddenAt: '2026-09-08T09:00:00Z',
    overriddenBy: 'luke@pokeprices.io',
    reason: 'manual_editorial_review',
    overriddenBodyHash: hashStudioBody(bodyDoc),
    factCheckStatusAtOverride: 'review_required',
    unresolvedIssueCount: 3,
    numericIssueCount: 2,
  }
  return { ...w, editorialOverride: override }
}

// ── Tests ────────────────────────────────────────────────────────

describe('runPublicationPreflight — editorial override (internal)', () => {
  beforeEach(() => {
    state.studio = makeStudio()
    state.writer = makeWriter()
    state.insightsId = null
    state.status = 'drafting'
    state.slugTaken = false
  })

  it('BLOCKS by default when factcheck.status !== pass (no override)', async () => {
    const pf = await runPublicationPreflight(42)
    expect(pf.status).toBe('blocked')
    const factBlockers = pf.checks.filter(c => c.severity === 'blocker' && c.id.startsWith('factcheck.'))
    expect(factBlockers.length).toBeGreaterThan(0)
    expect(pf.editorialOverride).toBeNull()
  })

  it('PASSES when a matching-hash override is present — factcheck.* downgraded to warnings', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    const pf = await runPublicationPreflight(42)
    expect(pf.status).toBe('pass')
    for (const c of pf.checks.filter(c => c.id.startsWith('factcheck.'))) {
      expect(c.severity).not.toBe('blocker')
    }
    // Override attribution surfaced in warnings.
    const attrib = pf.warnings.find(w => w.id === 'factcheck.override')
    expect(attrib?.detail).toMatch(/luke@pokeprices\.io/)
    expect(pf.editorialOverride?.boundToCurrentDraft).toBe(true)
  })

  it('does NOT honor override when body hash has drifted since the override', async () => {
    // Override was recorded against a DIFFERENT body — simulate a
    // regenerate/validate_and_fix rewrite by binding the override to
    // a mutated body doc.
    const otherBody = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'different' }] }] }
    state.writer = withOverride(makeWriter(), otherBody)
    const pf = await runPublicationPreflight(42)
    expect(pf.status).toBe('blocked')
    // Blocker still present because the override is not bound to the current draft.
    expect(pf.checks.some(c => c.id.startsWith('factcheck.') && c.severity === 'blocker')).toBe(true)
    // Preflight surfaces the drift via boundToCurrentDraft=false so
    // UI can hide the "active override" banner.
    expect(pf.editorialOverride?.boundToCurrentDraft).toBe(false)
  })

  it('override does NOT bypass invalid slug', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    state.slugTaken = true
    const pf = await runPublicationPreflight(42)
    expect(pf.status).toBe('blocked')
    expect(pf.checks.some(c => c.id === 'slug.unique' && c.severity === 'blocker')).toBe(true)
  })

  it('override does NOT bypass missing headline', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    state.studio = { ...makeStudio(), headline: '   ' }
    const pf = await runPublicationPreflight(42)
    expect(pf.status).toBe('blocked')
    expect(pf.checks.some(c => c.id === 'studio.headline' && c.severity === 'blocker')).toBe(true)
  })

  it('override does NOT bypass empty body', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    state.studio = { ...makeStudio(), bodyDoc: { type: 'doc', content: [] } }
    // The override hash was bound to the OLD body, so it won't be
    // bound to the current (empty) doc either — but even if it were,
    // studio.body would still block.
    const pf = await runPublicationPreflight(42)
    expect(pf.status).toBe('blocked')
    expect(pf.checks.some(c => c.id === 'studio.body' && c.severity === 'blocker')).toBe(true)
  })

  it('numeric-audit issues become warning (not blocker) under override', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    const pf = await runPublicationPreflight(42)
    const num = pf.checks.find(c => c.id === 'factcheck.numeric')
    expect(num?.severity).toBe('warning')
  })

  it('records unresolved issue count in the override attribution warning', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    const pf = await runPublicationPreflight(42)
    const attrib = pf.warnings.find(w => w.id === 'factcheck.override')
    expect(attrib?.detail).toMatch(/3 unresolved issue/)
  })
})

// ── External articles are unchanged ──────────────────────────────

describe('runPublicationPreflight — external articles unaffected', () => {
  beforeEach(() => {
    state.studio = makeStudio()
    state.writer = null       // external doesn't run internal factcheck
    state.insightsId = null
    state.status = 'drafting'
    state.slugTaken = false
  })

  it('does NOT emit factcheck.* checks for external articles', async () => {
    // Redirect fetchProject to return an external article type.
    const mod = await import('../../research/serverActions')
    ;(mod.fetchProject as any).mockImplementationOnce(async () => ({
      id: 42, title: 'Everything We Know: New Set', angle: null,
      article_type: 'external_research', status: 'drafting', target_publish_at: null,
      insights_id: null, updated_at: '2026-09-08T00:00:00Z',
    }))
    ;(mod.fetchResearch as any).mockImplementationOnce(async () => null)
    const pf = await runPublicationPreflight(42)
    expect(pf.checks.every(c => !c.id.startsWith('factcheck.'))).toBe(true)
    // And no editorial override attribution for externals.
    expect(pf.warnings.every(w => w.id !== 'factcheck.override')).toBe(true)
  })
})
