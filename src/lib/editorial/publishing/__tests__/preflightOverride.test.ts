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

  // Simplified-HQ policy: internal fact-check / research-approval /
  // numeric-audit issues surface as WARNINGS but never block. The
  // "editorial override" mechanism is preserved for backward-compat
  // (older drafts may still carry the field, and the attribution
  // warning still fires) but is no longer required for publish.

  it('never emits factcheck.* BLOCKERS on internal projects (simplified HQ)', async () => {
    // A brand-new internal project with no fact check whatsoever
    // must still be publishable when the CMS essentials are present.
    // The old workflow blocked here; the new workflow surfaces
    // warnings and lets the admin decide.
    const pf = await runPublicationPreflight(42)
    const factBlockers = pf.checks.filter(c => c.severity === 'blocker' && c.id.startsWith('factcheck.'))
    expect(factBlockers.length).toBe(0)
    const researchBlockers = pf.checks.filter(c => c.severity === 'blocker' && c.id.startsWith('research.'))
    expect(researchBlockers.length).toBe(0)
    // Warnings still show the issues so Studio can surface them.
    const factWarnings = pf.warnings.filter(w => w.id.startsWith('factcheck.'))
    expect(factWarnings.length).toBeGreaterThan(0)
    expect(pf.status).toBe('pass')
  })

  it('publishes cleanly when a matching-hash override is also present (override attribution surfaces)', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    const pf = await runPublicationPreflight(42)
    expect(pf.status).toBe('pass')
    // Every factcheck signal is now a warning at most.
    for (const c of pf.checks.filter(c => c.id.startsWith('factcheck.'))) {
      expect(c.severity).not.toBe('blocker')
    }
    // Override attribution warning is still emitted for audit.
    const attrib = pf.warnings.find(w => w.id === 'factcheck.override')
    expect(attrib?.detail).toMatch(/luke@pokeprices\.io/)
    expect(pf.editorialOverride?.boundToCurrentDraft).toBe(true)
  })

  it('does NOT block when a body-hash-drifted override is present (override no longer needed to publish)', async () => {
    const otherBody = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'different' }] }] }
    state.writer = withOverride(makeWriter(), otherBody)
    const pf = await runPublicationPreflight(42)
    // Simplified HQ: publish succeeds regardless. Preflight still
    // exposes boundToCurrentDraft=false so UI can hide the "active
    // override" banner when the draft has drifted.
    expect(pf.status).toBe('pass')
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

  it('numeric-audit issues surface as warnings (never blockers) under simplified HQ', async () => {
    state.writer = withOverride(makeWriter(), makeStudio().bodyDoc)
    const pf = await runPublicationPreflight(42)
    // Warnings collection carries the numeric-audit signal now — the
    // old blocker in `pf.checks` is gone.
    const num = pf.warnings.find(w => w.id === 'factcheck.numeric')
    expect(num?.severity).toBe('warning')
    // No blocker with this id in checks any more.
    expect(pf.checks.some(c => c.id === 'factcheck.numeric' && c.severity === 'blocker')).toBe(false)
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
