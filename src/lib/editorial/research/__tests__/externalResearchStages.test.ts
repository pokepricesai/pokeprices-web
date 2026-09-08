// src/lib/editorial/research/__tests__/externalResearchStages.test.ts
//
// External Research Fix v3 — stage-machine regression tests.
//
// Verifies:
//   * each stage advances by exactly one step and persists
//   * a browser refresh mid-run resumes at the current stage
//     (does NOT re-run completed stages)
//   * a failed stage can be retried without repeating successful
//     web searches
//   * total web-search budget stays at 6 across the full run
//   * facts + contradictions + questions are extracted from the
//     combined primary + supporting prose
//   * discovered sources' tiers/citations are preserved
//   * manual sources survive a full staged run

import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('server-only', () => ({}))

// ─── Fake Anthropic (records calls, returns scripted responses) ──
type FakeCall = {
  feature: string
  system:  string
  messages: any
  webSearch?: any
  text: string
  cost: number
  searches: number
  citations?: Array<{ url: string; title?: string; publisher?: string }>
}
const callLog: FakeCall[] = []
const scriptedResponses: FakeCall[] = []

vi.mock('@/lib/ai/anthropic', () => ({
  callAnthropicAndLog: vi.fn(async (input: any) => {
    const script = scriptedResponses.shift()
    if (!script) throw new Error(`Unexpected AI call to ${input.feature} — no script queued`)
    const entry: FakeCall = { ...script, feature: input.feature, system: input.system, messages: input.messages, webSearch: input.webSearch }
    callLog.push(entry)
    return {
      ok: true,
      text: entry.text,
      model: 'test-model',
      usage: { input_tokens: 100, output_tokens: 200, cache_creation_tokens: 0, cache_read_tokens: 0 },
      cost_usd: entry.cost,
      latency_ms: 10,
      stop_reason: 'end_turn',
      status: 200,
      error: '', detail: '',
      webSearch: entry.webSearch ? { searchesUsed: entry.searches, searchCostUsd: entry.searches * 0.01 } : undefined,
      citations: entry.citations ?? [],
    }
  }),
}))

// ─── Fake Supabase (in-memory row backed by a Map) ────────────
let db: Record<string, any> = {}
vi.mock('@/lib/supabaseService', () => ({
  getSupabaseServiceClient: () => ({
    from(_table: string) {
      let selectFilter: { col?: string; val?: any } = {}
      let pendingUpdate: any = null
      const api: any = {
        select: (_c?: string) => api,
        eq: (col: string, val: any) => { selectFilter = { col, val }; return api },
        maybeSingle: async () => {
          const key = `${selectFilter.col}:${selectFilter.val}`
          return { data: db[key] ?? null, error: null }
        },
        single: async () => {
          const key = `${selectFilter.col}:${selectFilter.val}`
          if (pendingUpdate) {
            db[key] = { ...(db[key] ?? {}), ...pendingUpdate }
            pendingUpdate = null
          }
          return { data: db[key] ?? null, error: null }
        },
        update: (patch: any) => { pendingUpdate = patch; return api },
      }
      return api
    },
  }),
}))

import {
  startExternalResearchRun,
  advanceExternalResearchRun,
  retryExternalResearchRun,
} from '../externalResearchStages'
import type { EvidencePack } from '../types'
import { runExternalResearchRecipe } from '../externalResearch'

const PROJECT_ID = 999
const PROJECT = { id: PROJECT_ID, title: 'Celebration Collection: everything we know so far', angle: null, articleType: 'external_research', targetPublishAt: null }

async function seedPack(overrides: Partial<EvidencePack> = {}): Promise<EvidencePack> {
  const base = await runExternalResearchRecipe(PROJECT, { today: '2026-09-08' })
  const pack: EvidencePack = { ...base, ...overrides }
  db[`project_id:${PROJECT_ID}`] = { project_id: PROJECT_ID, evidence_json: pack, status: 'review_required' }
  return pack
}

beforeEach(() => {
  db = {}
  callLog.length = 0
  scriptedResponses.length = 0
})

// ─────────────────────────────────────────────────────────────────
// 1. Each stage advances by exactly one step and persists
// ─────────────────────────────────────────────────────────────────

describe('stage machine: advances exactly one stage per call', () => {
  it('start → advance × 5 lands on complete, one Claude call per non-deterministic stage', async () => {
    await seedPack()

    // Script the two discovery stages + one extraction stage.
    scriptedResponses.push(
      { feature: 'primary', text: 'Primary prose. [1] Official announcement.', cost: 0.12, searches: 3, citations: [
        { url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Official' },
        { url: 'https://tcg.pokemon.com/en-us/expansions/celebration/', title: 'Expansion page' },
      ], webSearch: {} },
      { feature: 'supporting', text: 'Supporting prose. Retailer coverage [1].', cost: 0.10, searches: 3, citations: [
        { url: 'https://www.tcgplayer.com/product/xyz', title: 'Preorder listing' },
      ], webSearch: {} },
      // Extractor emits structured JSON referring back to discovered ids.
      { feature: 'extract', text: '```json\n' + JSON.stringify({
        researchQuestions: ['Is the release date confirmed?', 'What products are included?'],
        discoveredSources: [],
        verifiedFacts: [
          { id: 'fact-official', statement: 'Set has an official expansion page.', status: 'confirmed', sourceTier: 1, evidenceRefs: ['__DISCOVERED_1__', '__DISCOVERED_2__'] },
          { id: 'fact-preorder', statement: 'Preorders are live at TCGplayer.', status: 'reported', sourceTier: 2, evidenceRefs: ['__DISCOVERED_3__'] },
          { id: 'fact-announced', statement: 'The Pokémon Company has announced the set.', status: 'confirmed', sourceTier: 1, evidenceRefs: ['__DISCOVERED_1__'] },
        ],
        contradictions: [],
        researchGaps: ['Exact card count not yet published.'],
      }) + '\n```', cost: 0.008, searches: 0 },
    )

    // Start the run.
    const started = await startExternalResearchRun(PROJECT_ID, 'e@x')
    expect(started.run.stage).toBe('queued')

    // 1st advance: queued → researching_primary (deterministic, no AI call).
    const a1 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    expect(a1.run.stage).toBe('researching_primary')
    expect(callLog).toHaveLength(0)

    // 2nd advance: runs Stage A (primary), lands on researching_supporting.
    const a2 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    expect(a2.run.stage).toBe('researching_supporting')
    expect(callLog.map(c => c.feature)).toEqual(['editorial_external_research_primary'])
    expect(a2.run.discoveredSources).toHaveLength(2)
    expect(a2.run.searchesUsed).toBe(3)
    expect(a2.run.primaryText).toBeTruthy()

    // 3rd advance: runs Stage B (supporting), lands on extracting.
    const a3 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    expect(a3.run.stage).toBe('extracting')
    expect(callLog.map(c => c.feature)).toEqual(['editorial_external_research_primary', 'editorial_external_research_supporting'])
    expect(a3.run.discoveredSources.length).toBeGreaterThanOrEqual(3)
    expect(a3.run.searchesUsed).toBe(6)                    // budget ceiling
    expect(a3.run.supportingText).toBeTruthy()

    // Now we know the actual discovered ids — patch the extractor
    // script's fact refs to point at them.
    const discIds = a3.run.discoveredSources.map(s => s.id)
    scriptedResponses[0].text = scriptedResponses[0].text
      .replace('__DISCOVERED_1__', discIds[0])
      .replace('__DISCOVERED_2__', discIds[1])
      .replace('__DISCOVERED_3__', discIds[2])
      .replace('__DISCOVERED_1__', discIds[0])   // second occurrence

    // 4th advance: runs Stage C (extraction), lands on finalizing.
    const a4 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    expect(a4.run.stage).toBe('finalizing')
    expect(callLog.map(c => c.feature)).toEqual(['editorial_external_research_primary', 'editorial_external_research_supporting', 'editorial_external_research_extract'])
    expect(a4.run.extractedFacts?.length).toBe(3)
    expect(a4.run.extractedQuestions?.length).toBe(2)

    // 5th advance: deterministic finalize, lands on complete.
    const a5 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    expect(a5.run.stage).toBe('complete')
    expect(a5.finished).toBe(true)
    // NO additional AI call in finalize.
    expect(callLog).toHaveLength(3)

    // Pack was updated: 3 web-discovered sources, 3 facts + 1 bootstrap.
    expect(a5.pack.externalSources).toHaveLength(3)
    expect(a5.pack.externalSources.every(s => (s.origin ?? 'manual') === 'web')).toBe(true)
    expect(a5.pack.verifiedFacts).toHaveLength(4)   // bootstrap + 3 extracted
    expect(a5.pack.webResearch?.searchesUsed).toBe(6)
    expect(a5.pack.quality.publishable).toBe(true)   // 6 sources incl. Tier-1, 3+ facts
  })
})

// ─────────────────────────────────────────────────────────────────
// 2. Browser refresh mid-run resumes at current stage
// ─────────────────────────────────────────────────────────────────

describe('stage machine: mid-run refresh resumes at current stage', () => {
  it('startExternalResearchRun on an in-flight run returns existing run without doing work', async () => {
    await seedPack()

    scriptedResponses.push({ feature: 'primary', text: 'Prose', cost: 0.05, searches: 3, citations: [], webSearch: {} })
    await startExternalResearchRun(PROJECT_ID, 'e@x')
    await advanceExternalResearchRun(PROJECT_ID, 'e@x')  // queued → researching_primary
    await advanceExternalResearchRun(PROJECT_ID, 'e@x')  // primary → researching_supporting

    // Now simulate a browser refresh. Start again — should not
    // reset, should not consume budget, should return current run.
    const restart = await startExternalResearchRun(PROJECT_ID, 'e@x')
    expect(restart.resumed).toBe(true)
    expect(restart.run.stage).toBe('researching_supporting')
    expect(restart.run.searchesUsed).toBe(3)
    expect(callLog).toHaveLength(1)   // still only the one primary call
  })
})

// ─────────────────────────────────────────────────────────────────
// 3. Failed stage can be retried; successful stages are not repeated
// ─────────────────────────────────────────────────────────────────

describe('stage machine: failed stage retries without repeating work', () => {
  it('when Stage B fails, retry runs only Stage B (not Stage A again)', async () => {
    await seedPack()

    // Script: primary succeeds, supporting FAILS by throwing (empty script).
    scriptedResponses.push(
      { feature: 'primary', text: 'Primary prose', cost: 0.10, searches: 3, citations: [
        { url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Official' },
      ], webSearch: {} },
      // No script for supporting — will throw "Unexpected AI call"
    )

    await startExternalResearchRun(PROJECT_ID, 'e@x')
    await advanceExternalResearchRun(PROJECT_ID, 'e@x')   // queued → primary
    await advanceExternalResearchRun(PROJECT_ID, 'e@x')   // primary runs, → supporting
    const failed = await advanceExternalResearchRun(PROJECT_ID, 'e@x')   // supporting throws → failed
    expect(failed.run.stage).toBe('failed')
    expect(failed.run.failedStage).toBe('researching_supporting')

    // Retry — script a successful supporting call this time.
    scriptedResponses.push(
      { feature: 'supporting', text: 'Retry prose', cost: 0.09, searches: 3, citations: [], webSearch: {} },
    )
    const retryResult = await retryExternalResearchRun(PROJECT_ID, 'e@x')
    // retry advances exactly one stage from the failed point.
    expect(retryResult.run.stage).toBe('extracting')
    // Primary was NOT re-called — callLog only shows the retry supporting.
    expect(callLog.map(c => c.feature)).toEqual(['editorial_external_research_primary', 'editorial_external_research_supporting'])
    expect(retryResult.run.searchesUsed).toBe(6)   // still bounded to 6 (3 primary + 3 supporting)
  })
})

// ─────────────────────────────────────────────────────────────────
// 4. Web-search budget stays capped at 6
// ─────────────────────────────────────────────────────────────────

describe('stage machine: total web-search budget capped', () => {
  it('primary and supporting stages each request max_uses=3, extractor requests no web_search', async () => {
    await seedPack()

    scriptedResponses.push(
      { feature: 'primary',    text: 'p', cost: 0.05, searches: 3, citations: [], webSearch: {} },
      { feature: 'supporting', text: 's', cost: 0.05, searches: 3, citations: [], webSearch: {} },
      { feature: 'extract',    text: '```json\n{"verifiedFacts":[],"discoveredSources":[],"contradictions":[],"researchQuestions":[],"researchGaps":[]}\n```', cost: 0.008, searches: 0 },
    )
    await startExternalResearchRun(PROJECT_ID, 'e@x')
    for (let i = 0; i < 6; i++) await advanceExternalResearchRun(PROJECT_ID, 'e@x')

    expect(callLog[0].webSearch).toBeTruthy()
    expect(callLog[0].webSearch.max_uses).toBe(3)
    expect(callLog[1].webSearch).toBeTruthy()
    expect(callLog[1].webSearch.max_uses).toBe(3)
    // Extractor MUST NOT have webSearch configured.
    expect(callLog[2].webSearch).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────
// 5. Manual sources survive a full staged run
// ─────────────────────────────────────────────────────────────────

describe('stage machine: manual sources survive staged run', () => {
  it('manual source present at start is present after complete', async () => {
    const seeded = await seedPack()
    seeded.externalSources = [
      ...seeded.externalSources,
      { id: 'ext-manual-tcg', kind: 'external', url: 'https://www.tcgplayer.com/content/x', title: 'TCG Buyer\'s Guide', addedAt: '2026-09-08T00:00:00Z', origin: 'manual', sourceTier: 2 },
    ]
    db[`project_id:${PROJECT_ID}`].evidence_json = seeded

    scriptedResponses.push(
      { feature: 'primary',    text: 'p', cost: 0.05, searches: 3, citations: [
        { url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Official' },
      ], webSearch: {} },
      { feature: 'supporting', text: 's', cost: 0.05, searches: 3, citations: [], webSearch: {} },
      { feature: 'extract',    text: '```json\n{"verifiedFacts":[],"discoveredSources":[],"contradictions":[],"researchQuestions":[],"researchGaps":[]}\n```', cost: 0.008, searches: 0 },
    )

    await startExternalResearchRun(PROJECT_ID, 'e@x')
    for (let i = 0; i < 6; i++) await advanceExternalResearchRun(PROJECT_ID, 'e@x')

    const finalPack = db[`project_id:${PROJECT_ID}`].evidence_json as EvidencePack
    expect(finalPack.externalSources.some(s => s.id === 'ext-manual-tcg')).toBe(true)
    expect(finalPack.externalSources.some(s => (s.origin ?? 'manual') === 'manual')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// 6. Discovered source tiers preserved through stages
// ─────────────────────────────────────────────────────────────────

describe('stage machine: source tiers preserved end-to-end', () => {
  it('tier assignments (via classifySourceTier) survive the finalize merge', async () => {
    await seedPack()

    scriptedResponses.push(
      { feature: 'primary', text: 'p', cost: 0.05, searches: 3, citations: [
        { url: 'https://www.pokemon.com/us/pokemon-news/x', title: 'T1 official' },   // Tier 1
        { url: 'https://www.reddit.com/r/pokemontcg/y',    title: 'T3 reddit'    },   // Tier 3
      ], webSearch: {} },
      { feature: 'supporting', text: 's', cost: 0.05, searches: 3, citations: [
        { url: 'https://www.tcgplayer.com/z', title: 'T2 tcgplayer' },                // Tier 2
      ], webSearch: {} },
      { feature: 'extract', text: '```json\n{"verifiedFacts":[],"discoveredSources":[],"contradictions":[],"researchQuestions":[],"researchGaps":[]}\n```', cost: 0.008, searches: 0 },
    )

    await startExternalResearchRun(PROJECT_ID, 'e@x')
    for (let i = 0; i < 6; i++) await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    const finalPack = db[`project_id:${PROJECT_ID}`].evidence_json as EvidencePack
    const tiers = finalPack.externalSources.map(s => s.sourceTier).sort()
    expect(tiers).toEqual([1, 2, 3])
  })
})
