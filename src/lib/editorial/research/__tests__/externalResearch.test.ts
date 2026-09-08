// src/lib/editorial/research/__tests__/externalResearch.test.ts
//
// External Research Fix — regression tests for spec §17.
//
// These tests exercise the recipe + analyst parser + merge logic
// directly, without hitting the network or Supabase. The recipe is
// deterministic (no network); the analyst response is fed in as
// canned JSON.

import { describe, it, expect, vi } from 'vitest'
// Recipe + parser modules are server-only imported; stub the module
// so vitest can load them.
vi.mock('server-only', () => ({}))
// serverActions.ts pulls in supabase — stub the client factory so
// merely importing the module doesn't try to connect.
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }),
}))
import { runExternalResearchRecipe, computeExternalQuality, classifySourceTier, buildExternalMethodology } from '../externalResearch'
import { parseExternalResearchResponse, mergeExternalResearchIntoPack, extractJsonObject } from '../externalResearchAnalyst'
import { mergeManualEvidenceIntoRebuiltPack } from '../serverActions'
import type { EvidencePack, ExternalSource, VerifiedFact } from '../types'

const PROJECT = {
  id: 42,
  title: 'Celebration Collection: Everything We Know So Far',
  angle: 'Draw together what has been announced or leaked about the anniversary set and separate rumor from confirmation.',
  articleType: 'external_research',
  targetPublishAt: null,
}

const TODAY = '2026-09-08'

function manualSource(overrides: Partial<ExternalSource> = {}): ExternalSource {
  return {
    id:       overrides.id ?? 'ext-manual-1',
    kind:     'external',
    url:      overrides.url ?? 'https://www.pokemon.com/us/pokemon-news/celebration',
    title:    overrides.title ?? 'Pokémon Celebration announcement',
    publisher: overrides.publisher ?? 'The Pokémon Company',
    addedAt:  overrides.addedAt ?? TODAY,
    addedBy:  overrides.addedBy ?? 'editor@pokeprices.io',
    origin:   overrides.origin ?? 'manual',
    sourceTier: overrides.sourceTier,
    note:     overrides.note,
  }
}

// ─────────────────────────────────────────────────────────────────
// Spec §17.1 — manual external sources survive Build/Rebuild
// ─────────────────────────────────────────────────────────────────

describe('external_research recipe: manual survives rebuild', () => {
  it('preserves manually-attached sources when the pack is rebuilt', async () => {
    const first = await runExternalResearchRecipe(PROJECT, { today: TODAY })
    const withManual: EvidencePack = {
      ...first,
      externalSources: [
        ...first.externalSources,
        manualSource({ id: 'ext-pkm', url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Pokémon Celebration' }),
        manualSource({ id: 'ext-tcg', url: 'https://www.tcgplayer.com/product/1234', title: 'Celebration ETB preorder', origin: 'manual', sourceTier: 2 }),
      ],
      notes: [
        { id: 'note-1', addedAt: TODAY, addedBy: 'editor@pokeprices.io', body: 'Retailer preorders live; official date TBC.' },
      ],
      researchQuestions: ['Is the release date confirmed?', 'What products are included?'],
    }
    const rebuilt = await runExternalResearchRecipe(PROJECT, { today: TODAY, previous: withManual })
    const ids = rebuilt.externalSources.map(s => s.id)
    expect(ids).toContain('ext-pkm')
    expect(ids).toContain('ext-tcg')
    expect(rebuilt.notes.some(n => n.id === 'note-1')).toBe(true)
    expect(rebuilt.researchQuestions).toEqual(['Is the release date confirmed?', 'What products are included?'])
  })

  it('cross-recipe safety net: mergeManualEvidenceIntoRebuiltPack splices manual sources into an internal-recipe rebuild', () => {
    const internalRebuild: EvidencePack = {
      version: 1, recipe: 'monthly_market_report', project: { ...PROJECT, articleType: 'monthly_market_report' },
      generatedAt: TODAY, dataAsOf: TODAY,
      methodology: { summary: 'x', filters: [], excludedGroups: [], dedupKey: 'x' },
      verifiedFacts: [], derivedFindings: [], dataTables: [], internalSources: [],
      externalSources: [],
      internalLinks: [], visualOpportunities: [], warnings: [], researchGaps: [], rejectedClaims: [], notes: [],
      quarantinedRows: [],
      quality: { status: 'ok', dataStrength: 'strong', sampleSize: 1500, freshness: { asOf: TODAY, daysOld: 0, isStale: false }, publishable: true, reasons: [] },
    }
    const previous: EvidencePack = {
      ...internalRebuild,
      externalSources: [
        manualSource({ id: 'ext-manual-attached', origin: 'manual' }),
      ],
      notes: [{ id: 'note-x', addedAt: TODAY, body: 'manual note' }],
    }
    const merged = mergeManualEvidenceIntoRebuiltPack(internalRebuild, previous)
    expect(merged.externalSources.map(s => s.id)).toContain('ext-manual-attached')
    expect(merged.notes.some(n => n.id === 'note-x')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.2 — discovered sources refresh without deleting manual
// ─────────────────────────────────────────────────────────────────

describe('external_research recipe: discovery preserves manual', () => {
  it('merging a fresh discovery replaces web sources but leaves manual sources intact', async () => {
    const base = await runExternalResearchRecipe(PROJECT, { today: TODAY })
    const withManualAndWeb: EvidencePack = {
      ...base,
      externalSources: [
        manualSource({ id: 'ext-manual-1', origin: 'manual', sourceTier: 1 }),
        { ...manualSource({ id: 'ext-web-old' }), origin: 'web', addedBy: 'web_search' },
      ],
    }
    const parsed = parseExternalResearchResponse(
      '```json\n' + JSON.stringify({
        researchQuestions: ['Q1'],
        discoveredSources: [
          { id: 'src-web-1', url: 'https://tcgplayer.com/x', title: 'Fresh preorder', publisher: 'TCGplayer', sourceTier: 2 },
        ],
        verifiedFacts: [
          { id: 'fact-preorder', statement: 'Preorders live on TCGplayer.', status: 'reported', sourceTier: 2, evidenceRefs: ['src-web-1'] },
        ],
        contradictions: [],
        researchGaps: [],
      }) + '\n```',
      { knownManualSourceIds: ['ext-manual-1'], citationsFromApi: [], now: TODAY + 'T00:00:00Z', adminEmail: 'e@x' },
    )
    const merged = mergeExternalResearchIntoPack(withManualAndWeb, parsed)
    const ids = merged.externalSources.map(s => s.id)
    expect(ids).toContain('ext-manual-1')                // manual preserved
    expect(ids).not.toContain('ext-web-old')             // stale web source removed
    expect(ids).toContain('src-web-1')                   // fresh web source added
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.3 — external-only research can become publishable
// ─────────────────────────────────────────────────────────────────

describe('external_research quality: external-only can be publishable', () => {
  it('publishable when 1 Tier-1 source + 3 supported facts', () => {
    const sources: ExternalSource[] = [
      { id: 'a', kind: 'external', url: 'https://pokemon.com/x', title: 'Announcement', addedAt: TODAY, sourceTier: 1, origin: 'manual' },
    ]
    const facts: VerifiedFact[] = [
      { id: 'f1', type: 'verified_fact', statement: 'Set exists', evidenceRefs: ['a'], sourceTier: 1, status: 'confirmed' },
      { id: 'f2', type: 'verified_fact', statement: 'Set has X cards', evidenceRefs: ['a'], sourceTier: 1, status: 'confirmed' },
      { id: 'f3', type: 'verified_fact', statement: 'Set releases in Y', evidenceRefs: ['a'], sourceTier: 1, status: 'confirmed' },
    ]
    const q = computeExternalQuality({ externalSources: sources, verifiedFacts: facts, hasWebResearch: false, today: TODAY })
    expect(q.publishable).toBe(true)
  })

  it('publishable when 2 Tier-2 domains + 3 facts', () => {
    const sources: ExternalSource[] = [
      { id: 'a', kind: 'external', url: 'https://tcgplayer.com/x', title: 'A', addedAt: TODAY, sourceTier: 2, origin: 'web' },
      { id: 'b', kind: 'external', url: 'https://pokebeach.com/x', title: 'B', addedAt: TODAY, sourceTier: 2, origin: 'web' },
    ]
    const facts: VerifiedFact[] = [
      { id: 'f1', type: 'verified_fact', statement: '1', evidenceRefs: ['a'] },
      { id: 'f2', type: 'verified_fact', statement: '2', evidenceRefs: ['b'] },
      { id: 'f3', type: 'verified_fact', statement: '3', evidenceRefs: ['a', 'b'] },
    ]
    const q = computeExternalQuality({ externalSources: sources, verifiedFacts: facts, hasWebResearch: true, today: TODAY })
    expect(q.publishable).toBe(true)
  })

  it('NOT publishable with only community-tier sources', () => {
    const sources: ExternalSource[] = [
      { id: 'a', kind: 'external', url: 'https://reddit.com/r/pokemon/x', title: 'A', addedAt: TODAY, sourceTier: 3, origin: 'web' },
      { id: 'b', kind: 'external', url: 'https://reddit.com/r/pokemontcg/y', title: 'B', addedAt: TODAY, sourceTier: 3, origin: 'web' },
    ]
    const facts: VerifiedFact[] = [
      { id: 'f1', type: 'verified_fact', statement: '1', evidenceRefs: ['a'] },
      { id: 'f2', type: 'verified_fact', statement: '2', evidenceRefs: ['b'] },
      { id: 'f3', type: 'verified_fact', statement: '3', evidenceRefs: ['a', 'b'] },
    ]
    const q = computeExternalQuality({ externalSources: sources, verifiedFacts: facts, hasWebResearch: true, today: TODAY })
    expect(q.publishable).toBe(false)
  })

  it('NOT publishable with strong sources but only 2 facts', () => {
    const sources: ExternalSource[] = [
      { id: 'a', kind: 'external', url: 'https://pokemon.com/x', title: 'A', addedAt: TODAY, sourceTier: 1, origin: 'manual' },
    ]
    const facts: VerifiedFact[] = [
      { id: 'f1', type: 'verified_fact', statement: '1', evidenceRefs: ['a'] },
      { id: 'f2', type: 'verified_fact', statement: '2', evidenceRefs: ['a'] },
    ]
    const q = computeExternalQuality({ externalSources: sources, verifiedFacts: facts, hasWebResearch: false, today: TODAY })
    expect(q.publishable).toBe(false)
    expect(q.reasons.join(' ')).toMatch(/Fewer than 3/)
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.4 — every external verifiedFact has a source
// ─────────────────────────────────────────────────────────────────

describe('external_research parser: no source → no fact', () => {
  it('drops facts with empty evidenceRefs', () => {
    const parsed = parseExternalResearchResponse(
      JSON.stringify({
        researchQuestions: [],
        discoveredSources: [{ id: 'src-1', url: 'https://pokemon.com/x', title: 'X', sourceTier: 1 }],
        verifiedFacts: [
          { id: 'fact-groundless', statement: 'X', status: 'confirmed', sourceTier: 1, evidenceRefs: [] },
          { id: 'fact-cited',      statement: 'Y', status: 'confirmed', sourceTier: 1, evidenceRefs: ['src-1'] },
        ],
        contradictions: [],
        researchGaps: [],
      }),
      { knownManualSourceIds: [], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    expect(parsed.verifiedFacts.map(f => f.id)).toEqual(['fact-cited'])
  })

  it('drops facts whose evidenceRefs point to unknown ids', () => {
    const parsed = parseExternalResearchResponse(
      JSON.stringify({
        researchQuestions: [],
        discoveredSources: [{ id: 'src-1', url: 'https://pokemon.com/x', title: 'X', sourceTier: 1 }],
        verifiedFacts: [
          { id: 'fact-fake-ref', statement: 'Z', status: 'confirmed', sourceTier: 1, evidenceRefs: ['src-does-not-exist'] },
        ],
        contradictions: [],
        researchGaps: [],
      }),
      { knownManualSourceIds: [], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    expect(parsed.verifiedFacts).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.5 — rumor cannot become confirmed fact
// ─────────────────────────────────────────────────────────────────

describe('external_research parser: rumor cannot become confirmed', () => {
  it('downgrades Tier-3-only claims to rumored even when Analyst says confirmed', () => {
    const parsed = parseExternalResearchResponse(
      JSON.stringify({
        researchQuestions: [],
        discoveredSources: [
          { id: 'src-reddit', url: 'https://reddit.com/r/pokemontcg/x', title: 'Reddit', sourceTier: 3 },
        ],
        verifiedFacts: [
          { id: 'fact-hype', statement: 'Release confirmed for October.', status: 'confirmed', sourceTier: 3, evidenceRefs: ['src-reddit'] },
        ],
        contradictions: [],
        researchGaps: [],
      }),
      { knownManualSourceIds: [], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    expect(parsed.verifiedFacts[0].status).toBe('rumored')
    expect(parsed.verifiedFacts[0].sourceTier).toBe(3)
  })

  it('downgrades single-Tier-2-source "confirmed" claims to "reported"', () => {
    const parsed = parseExternalResearchResponse(
      JSON.stringify({
        researchQuestions: [],
        discoveredSources: [
          { id: 'src-tcg', url: 'https://tcgplayer.com/product/1', title: 'TCG', sourceTier: 2 },
        ],
        verifiedFacts: [
          { id: 'fact-single', statement: 'Preorder is live.', status: 'confirmed', sourceTier: 2, evidenceRefs: ['src-tcg'] },
        ],
        contradictions: [],
        researchGaps: [],
      }),
      { knownManualSourceIds: [], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    expect(parsed.verifiedFacts[0].status).toBe('reported')
  })

  it('preserves confirmed when a Tier-1 source is present', () => {
    const parsed = parseExternalResearchResponse(
      JSON.stringify({
        researchQuestions: [],
        discoveredSources: [
          { id: 'src-p', url: 'https://pokemon.com/x', title: 'Official', sourceTier: 1 },
        ],
        verifiedFacts: [
          { id: 'fact-official', statement: 'Set officially announced.', status: 'confirmed', sourceTier: 1, evidenceRefs: ['src-p'] },
        ],
        contradictions: [],
        researchGaps: [],
      }),
      { knownManualSourceIds: [], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    expect(parsed.verifiedFacts[0].status).toBe('confirmed')
    expect(parsed.verifiedFacts[0].sourceTier).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.6 — contradictory sources produce a contradiction entry
// ─────────────────────────────────────────────────────────────────

describe('external_research parser: contradictions survive parsing', () => {
  it('keeps a well-formed contradiction with 2+ positions each grounded in real sources', () => {
    const parsed = parseExternalResearchResponse(
      JSON.stringify({
        researchQuestions: [],
        discoveredSources: [
          { id: 'src-p', url: 'https://pokemon.com/x', title: 'Official', sourceTier: 1 },
          { id: 'src-r', url: 'https://retailer.example/x', title: 'Retailer', sourceTier: 3 },
        ],
        verifiedFacts: [],
        contradictions: [{
          id: 'contradiction-date',
          claim: 'Release date',
          positions: [
            { statement: 'Not yet announced.', evidenceRefs: ['src-p'] },
            { statement: 'Retailer listing shows November.', evidenceRefs: ['src-r'] },
          ],
        }],
        researchGaps: [],
      }),
      { knownManualSourceIds: [], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    expect(parsed.contradictions).toHaveLength(1)
    expect(parsed.contradictions[0].positions).toHaveLength(2)
  })

  it('drops malformed contradictions (single position, or refs to unknown sources)', () => {
    const parsed = parseExternalResearchResponse(
      JSON.stringify({
        researchQuestions: [],
        discoveredSources: [{ id: 'src-p', url: 'https://pokemon.com/x', title: 'Official', sourceTier: 1 }],
        verifiedFacts: [],
        contradictions: [
          { id: 'x', claim: 'lonely', positions: [{ statement: 'only one', evidenceRefs: ['src-p'] }] },
          { id: 'y', claim: 'orphan',   positions: [{ statement: 'a', evidenceRefs: ['src-missing'] }, { statement: 'b', evidenceRefs: ['src-missing'] }] },
        ],
        researchGaps: [],
      }),
      { knownManualSourceIds: [], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    expect(parsed.contradictions).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.7 — Writer receives only approved external URLs
// ─────────────────────────────────────────────────────────────────

describe('Writer compact: sees only pack externalSources', () => {
  it('every URL in the compacted externalSources maps 1:1 to a pack source', async () => {
    const { compactWriterInputs } = await import('../../writer/writerPrompt')
    const base = await runExternalResearchRecipe(PROJECT, { today: TODAY })
    const pack: EvidencePack = {
      ...base,
      externalSources: [
        manualSource({ id: 'a', url: 'https://pokemon.com/x' }),
        { ...manualSource({ id: 'b', url: 'https://tcgplayer.com/y' }), origin: 'web', addedBy: 'web_search', sourceTier: 2 },
      ],
    }
    const compact: any = compactWriterInputs({
      project: { id: pack.project.id, title: pack.project.title, angle: pack.project.angle, articleType: pack.project.articleType, targetPublishAt: pack.project.targetPublishAt },
      pack, analysis: null, context: null,
    })
    const urls = compact.pack.externalSources.map((s: any) => s.url).sort()
    expect(urls).toEqual(['https://pokemon.com/x', 'https://tcgplayer.com/y'])
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.8 — source-tier classifier
// ─────────────────────────────────────────────────────────────────

describe('classifySourceTier', () => {
  it.each([
    ['https://www.pokemon.com/en-gb/anything', 1],
    ['https://pokemoncenter.com/product/x',    1],
    ['https://psacard.com/pop/x',              1],
    ['https://www.tcgplayer.com/product/x',    2],
    ['https://bulbapedia.bulbagarden.net/x',   2],
    ['https://pokebeach.com/x',                2],
    ['https://www.reddit.com/r/pokemontcg/x',  3],
    ['https://youtube.com/watch',              3],
    ['https://some-random-blog.example/x',     3],
  ] as const)('classifies %s as tier %i', (url, tier) => {
    expect(classifySourceTier(url)).toBe(tier)
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.9 — build is fully deterministic (no network)
// ─────────────────────────────────────────────────────────────────

describe('external_research recipe: build is deterministic', () => {
  it('two builds with the same inputs produce equivalent packs', async () => {
    const a = await runExternalResearchRecipe(PROJECT, { today: TODAY })
    const b = await runExternalResearchRecipe(PROJECT, { today: TODAY })
    expect(a.recipe).toBe('external_research')
    expect(b.recipe).toBe('external_research')
    // Ignore generatedAt (wallclock) but compare everything else.
    const norm = (p: EvidencePack) => ({ ...p, generatedAt: 'X' })
    expect(norm(a)).toEqual(norm(b))
  })
})

// ─────────────────────────────────────────────────────────────────
// Spec §17.10 — dispatch routes correctly
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// External Research Fix v2 — parser resilience against prose replies
// ─────────────────────────────────────────────────────────────────

describe('extractJsonObject: resilient JSON extraction', () => {
  it('parses a fenced ```json block', () => {
    expect(extractJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 })
  })
  it('parses an unlabeled ``` fence around an object', () => {
    expect(extractJsonObject('```\n{"b": 2}\n```')).toEqual({ b: 2 })
  })
  it('parses whole-text JSON (no fence)', () => {
    expect(extractJsonObject('{"c": 3}')).toEqual({ c: 3 })
  })
  it('parses a balanced object embedded in prose', () => {
    expect(extractJsonObject('Sure, here is the object:\n{"d": 4}\nThat is the answer.')).toEqual({ d: 4 })
  })
  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('The set has been announced.')).toBeNull()
  })
  it('tolerates escaped quotes and nested braces', () => {
    expect(extractJsonObject('preface\n{"x": {"y": "he said \\"hi\\""}}\nsuffix')).toEqual({ x: { y: 'he said "hi"' } })
  })
})

describe('parseExternalResearchResponse: prose-only response yields empty facts (fallback trigger)', () => {
  it('when the model writes cited prose without a JSON block, verifiedFacts = 0 and citations are captured', () => {
    // Simulates the live-run bug: Claude wrote a summary with inline
    // citations but no JSON code block. The parser used to hit this
    // path and produce 0 sources, 0 facts.
    const parsed = parseExternalResearchResponse(
      'The Celebration set has been officially announced by The Pokémon Company [1]. TCGplayer is showing preorders live [2].',
      {
        knownManualSourceIds: [],
        citationsFromApi: [
          { url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Official announcement' },
          { url: 'https://www.tcgplayer.com/product/xyz',                title: 'Preorder listing' },
        ],
        now: TODAY, adminEmail: 'e@x',
      },
    )
    // No structured facts (the pre-v2 bug), but sources ARE captured
    // via the API citations path — this pack is now ready for the
    // Haiku fallback to extract facts without new web calls.
    expect(parsed.verifiedFacts).toHaveLength(0)
    expect(parsed.discoveredSources).toHaveLength(2)
    expect(parsed.discoveredSources.every(s => s.origin === 'web')).toBe(true)
  })
})

describe('buildExternalMethodology: reflects post-web state', () => {
  it('"Last web research" shows the timestamp + searches + cost after a run', () => {
    const meth = buildExternalMethodology({
      project: { id: 12, title: 'Celebration', angle: null, articleType: 'upcoming_set', targetPublishAt: null },
      manualSources: [manualSource({ id: 'ext-manual-1', origin: 'manual' })],
      allSources: [
        manualSource({ id: 'ext-manual-1', origin: 'manual' }),
        { id: 'src-w-1', kind: 'external', url: 'https://pokemon.com/x', title: 'X', addedAt: TODAY, origin: 'web', sourceTier: 1 },
      ],
      notes: [{ id: 'note-1' }],
      webResearch: { researchedAt: '2026-09-08T11:01:04.904Z', searchesUsed: 4, costUsd: 0.2573 },
    })
    const filters = meth.filters.reduce<Record<string, string>>((acc, f) => { acc[f.label] = f.value; return acc }, {})
    expect(filters['Last web research']).toMatch(/2026-09-08.*4 searches.*0\.2573/)
    expect(filters['Discovered (web)']).toBe('1 source(s)')
    expect(filters['Preserved manual']).toBe('1 source(s), 1 note(s)')
  })
  it('"(never)" when webResearch is undefined', () => {
    const meth = buildExternalMethodology({
      project: { id: 12, title: 'Celebration', angle: null, articleType: 'upcoming_set', targetPublishAt: null },
      manualSources: [],
      allSources: [],
      notes: [],
      webResearch: undefined,
    })
    const filters = meth.filters.reduce<Record<string, string>>((acc, f) => { acc[f.label] = f.value; return acc }, {})
    expect(filters['Last web research']).toBe('(never)')
    expect(filters['Discovered (web)']).toBe('0 source(s)')
  })
})

// ─────────────────────────────────────────────────────────────────
// Regression lock (spec §6): manual → Research web → Rebuild → still
// there
// ─────────────────────────────────────────────────────────────────

describe('regression lock: manual source survives a full simulated cycle', () => {
  it('manual source + Research-web merge + Rebuild → manual still present', async () => {
    // Step 1: bootstrap external pack.
    const bootstrap = await runExternalResearchRecipe(PROJECT, { today: TODAY })
    // Step 2: admin attaches a manual source.
    const withManual: EvidencePack = {
      ...bootstrap,
      externalSources: [...bootstrap.externalSources, manualSource({ id: 'ext-manual-tcg', url: 'https://www.tcgplayer.com/content/x', title: 'TCG Buyer\'s Guide' })],
    }
    // Step 3: Research web merges in a fresh discovery.
    const parsed = parseExternalResearchResponse(
      '```json\n' + JSON.stringify({
        researchQuestions: ['q1'],
        discoveredSources: [
          { id: 'src-w-official', url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Official announcement', publisher: 'The Pokémon Company', sourceTier: 1 },
        ],
        verifiedFacts: [
          { id: 'fact-1', statement: 'Set officially announced.', status: 'confirmed', sourceTier: 1, evidenceRefs: ['src-w-official'] },
        ],
        contradictions: [],
        researchGaps: [],
      }) + '\n```',
      { knownManualSourceIds: ['ext-manual-tcg'], citationsFromApi: [], now: TODAY, adminEmail: 'e@x' },
    )
    const afterWeb = mergeExternalResearchIntoPack(withManual, parsed)
    expect(afterWeb.externalSources.some(s => s.id === 'ext-manual-tcg')).toBe(true)   // manual still present
    // Step 4: admin clicks Rebuild evidence — recipe runs again with
    // `previous = afterWeb`. Manual source AND web-discovered
    // source AND web-derived fact all need appropriate handling.
    const afterRebuild = await runExternalResearchRecipe(PROJECT, { today: TODAY, previous: afterWeb })
    expect(afterRebuild.externalSources.some(s => s.id === 'ext-manual-tcg')).toBe(true)   // regression lock
  })
})

describe('dispatch: article types that should route to external_research', () => {
  it.each([
    ['upcoming_set', 'Prismatic Evolutions preview'],
    ['new_set',      'Some New Set release'],
    ['news',         'Something happening'],
    ['product_announcement', 'ETB coming soon'],
    ['data_study',   'Everything We Know So Far'],           // by title match
    ['data_study',   'Set X preview and preorder guide'],    // by title match
  ] as const)('routes %s "%s" to external_research', async (articleType, title) => {
    const { chooseRecipe } = await import('../dispatch')
    expect(chooseRecipe({ id: 1, title, angle: null, articleType, targetPublishAt: null })).toBe('external_research')
  })

  it('does NOT route a monthly market report to external_research', async () => {
    const { chooseRecipe } = await import('../dispatch')
    expect(chooseRecipe({ id: 1, title: 'Pokemon Card Market Report - August 2026', angle: null, articleType: 'monthly_market_report', targetPublishAt: null })).toBe('monthly_market_report')
  })

  it('does NOT route a population scarcity study to external_research', async () => {
    const { chooseRecipe } = await import('../dispatch')
    expect(chooseRecipe({ id: 1, title: 'Rarest PSA 10 populations under 200', angle: null, articleType: 'data_study', targetPublishAt: null })).toBe('population_scarcity')
  })
})
