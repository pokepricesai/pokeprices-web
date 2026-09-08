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
// Scripted responses provide the model output; feature/system/messages
// are filled in by the fake call handler when the actual call fires.
type FakeCall = {
  feature?:  string
  system?:   string
  messages?: any
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
  refinalizeExternalResearch,
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

describe('stage machine v5: default happy path skips auto-extraction', () => {
  it('start → advance × 4 lands on complete with researchSummary but zero mandatory extraction', async () => {
    await seedPack()

    // v5 default flow: primary → supporting → finalizing → complete.
    // No auto-extractor call in the queue.
    scriptedResponses.push(
      { text: 'Primary prose. [1] Officially announced. [2] Expansion page live.', cost: 0.12, searches: 3, citations: [
        { url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Official' },
        { url: 'https://tcg.pokemon.com/en-us/expansions/celebration/', title: 'Expansion page' },
      ], webSearch: {} },
      { text: 'Supporting prose. Retailer coverage [1] indicates preorders.', cost: 0.10, searches: 3, citations: [
        { url: 'https://www.tcgplayer.com/product/xyz', title: 'Preorder listing' },
      ], webSearch: {} },
    )

    await startExternalResearchRun(PROJECT_ID, 'e@x')
    await advanceExternalResearchRun(PROJECT_ID, 'e@x')  // queued → researching_primary
    const a2 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')  // primary runs → researching_supporting
    expect(a2.run.stage).toBe('researching_supporting')

    const a3 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')  // supporting runs → FINALIZING (not extracting)
    expect(a3.run.stage).toBe('finalizing')
    expect(callLog.map(c => c.feature)).toEqual(['editorial_external_research_primary', 'editorial_external_research_supporting'])

    const a4 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')  // finalize → complete
    expect(a4.run.stage).toBe('complete')
    expect(a4.finished).toBe(true)

    // Exactly 2 AI calls total (both Sonnet discovery). No Haiku
    // extractor unless the user explicitly runs "Extract structured
    // facts" from Advanced.
    expect(callLog).toHaveLength(2)
    expect(callLog.every(c => c.feature !== 'editorial_external_research_extract')).toBe(true)

    // Pack has researchSummary populated from the discovery prose.
    expect(a4.pack.researchSummary).toBeTruthy()
    expect(a4.pack.researchSummary!.length).toBeGreaterThan(0)
    expect(a4.pack.researchSummary).toContain('Primary prose')
    expect(a4.pack.researchSummary).toContain('Supporting prose')

    // Publishable — Tier-1 source authority + summary present, no
    // ≥3-facts requirement.
    expect(a4.pack.quality.publishable).toBe(true)
    expect(a4.pack.verifiedFacts.length).toBeLessThanOrEqual(1)  // only the bootstrap fact-project
    expect(a4.pack.externalSources.length).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────
// 2. Browser refresh mid-run resumes at current stage
// ─────────────────────────────────────────────────────────────────

describe('stage machine: mid-run refresh resumes at current stage', () => {
  it('startExternalResearchRun on an in-flight run returns existing run without doing work', async () => {
    await seedPack()

    scriptedResponses.push({ text: 'Prose', cost: 0.05, searches: 3, citations: [], webSearch: {} })
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
  it('when Stage B fails, retry runs only Stage B (not Stage A again) — v5 lands on finalizing', async () => {
    await seedPack()

    // Script: primary succeeds, supporting FAILS by throwing (empty script).
    scriptedResponses.push(
      { text: 'Primary prose', cost: 0.10, searches: 3, citations: [
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
      { text: 'Retry prose', cost: 0.09, searches: 3, citations: [], webSearch: {} },
    )
    const retryResult = await retryExternalResearchRun(PROJECT_ID, 'e@x')
    // v5: retry advances exactly one stage from the failed point,
    // and supporting now feeds straight into finalizing (no
    // extracting in the default flow).
    expect(retryResult.run.stage).toBe('finalizing')
    // Primary was NOT re-called — callLog only shows the retry supporting.
    expect(callLog.map(c => c.feature)).toEqual(['editorial_external_research_primary', 'editorial_external_research_supporting'])
    expect(retryResult.run.searchesUsed).toBe(6)   // still bounded to 6 (3 primary + 3 supporting)
  })
})

// ─────────────────────────────────────────────────────────────────
// 4. Web-search budget stays capped at 6
// ─────────────────────────────────────────────────────────────────

describe('stage machine v5: total web-search budget capped, no auto-extractor', () => {
  it('primary + supporting each request max_uses=3, total budget stays at 6, no extractor call in the default happy path', async () => {
    await seedPack()

    // Only 2 scripts — v5 default flow has no extractor.
    scriptedResponses.push(
      { text: 'p', cost: 0.05, searches: 3, citations: [], webSearch: {} },
      { text: 's', cost: 0.05, searches: 3, citations: [], webSearch: {} },
    )
    await startExternalResearchRun(PROJECT_ID, 'e@x')
    for (let i = 0; i < 6; i++) await advanceExternalResearchRun(PROJECT_ID, 'e@x')

    expect(callLog.length).toBe(2)
    expect(callLog[0].webSearch).toBeTruthy()
    expect(callLog[0].webSearch.max_uses).toBe(3)
    expect(callLog[1].webSearch).toBeTruthy()
    expect(callLog[1].webSearch.max_uses).toBe(3)
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
      { text: 'p', cost: 0.05, searches: 3, citations: [
        { url: 'https://www.pokemon.com/us/pokemon-news/celebration', title: 'Official' },
      ], webSearch: {} },
      { text: 's', cost: 0.05, searches: 3, citations: [], webSearch: {} },
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

// ─────────────────────────────────────────────────────────────────
// v4 — extractor uses stable src_NNN ids; facts survive translation
// ─────────────────────────────────────────────────────────────────

// Helper: run through primary+supporting to accumulate discovered
// sources, then force stage back to 'extracting' so we can drive
// stageExtract directly (v5 default flow skips it).
async function seedAndForceExtracting() {
  await seedPack()
  scriptedResponses.push(
    { text: 'Primary prose citing Tier-1 and Tier-3.', cost: 0.10, searches: 3, citations: [
      { url: 'https://www.pokemon.com/us/celebration', title: 'Official' },
      { url: 'https://www.reddit.com/r/pokemontcg/x',  title: 'Community' },
    ], webSearch: {} },
    { text: 'Supporting prose citing Tier-2.', cost: 0.10, searches: 3, citations: [
      { url: 'https://www.tcgplayer.com/product/xyz', title: 'Preorder' },
    ], webSearch: {} },
  )
  await startExternalResearchRun(PROJECT_ID, 'e@x')
  await advanceExternalResearchRun(PROJECT_ID, 'e@x') // queued → primary
  await advanceExternalResearchRun(PROJECT_ID, 'e@x') // primary → supporting
  await advanceExternalResearchRun(PROJECT_ID, 'e@x') // supporting → finalizing (v5)
  // Force the stage back to 'extracting' to exercise stageExtract.
  const row = db[`project_id:${PROJECT_ID}`]
  row.evidence_json.externalResearchRun.stage = 'extracting'
  row.evidence_json.externalResearchRun.stageLabel = 'Building structured evidence (advanced)'
}

describe('stage machine v4: stable src_NNN ids let facts survive (extract path still callable)', () => {
  it('extractor prompt uses src_NNN ids; parser translates refs back to persistent ids', async () => {
    await seedAndForceExtracting()

    // Now Haiku returns facts using src_001/002/003 — exactly the
    // ids v4 gives it.
    scriptedResponses.push({
      text: '```json\n' + JSON.stringify({
        researchQuestions: ['Is it official?'],
        verifiedFacts: [
          { id: 'fact-official', statement: 'Officially announced.', status: 'confirmed', sourceTier: 1, evidenceRefs: ['src_001'] },
          { id: 'fact-preorder', statement: 'Preorders live.',       status: 'reported',  sourceTier: 2, evidenceRefs: ['src_003'] },
        ],
        contradictions: [],
        researchGaps: [],
      }) + '\n```',
      cost: 0.008, searches: 0,
    })
    const a4 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    expect(a4.run.stage).toBe('finalizing')
    expect(a4.run.extractedFacts?.length).toBe(2)

    // Refs were translated back from src_001/003 to the pack's
    // persistent src-cite-... ids.
    const extractedRefs = a4.run.extractedFacts!.flatMap(f => f.evidenceRefs)
    expect(extractedRefs.some(r => r.startsWith('src-cite-'))).toBe(true)
    expect(extractedRefs.every(r => !r.startsWith('src_'))).toBe(true)

    // Diagnostics recorded.
    expect(a4.run.extractionDiagnostics).toBeTruthy()
    expect(a4.run.extractionDiagnostics!.extractorRawFactCount).toBe(2)
    expect(a4.run.extractionDiagnostics!.extractorAcceptedFactCount).toBe(2)
    expect(a4.run.extractionDiagnostics!.extractorRejectedFactCount).toBe(0)
    expect(a4.run.extractionDiagnostics!.idMap.length).toBe(3)
    // idMap first entry is src_001 → the first discovered source's persistent id.
    expect(a4.run.extractionDiagnostics!.idMap[0].stableId).toBe('src_001')
    expect(a4.run.extractionDiagnostics!.idMap[2].stableId).toBe('src_003')
  })

  it('diagnostics record rejections when Haiku mistypes a src_NNN id', async () => {
    await seedAndForceExtracting()

    // Model emits ONE valid fact + ONE fact with a bogus ref (src_099).
    scriptedResponses.push({
      text: '```json\n' + JSON.stringify({
        verifiedFacts: [
          { id: 'fact-ok',      statement: 'Real', status: 'confirmed', sourceTier: 1, evidenceRefs: ['src_001'] },
          { id: 'fact-bad-ref', statement: 'Fake', status: 'confirmed', sourceTier: 1, evidenceRefs: ['src_099'] },
        ],
      }) + '\n```', cost: 0.008, searches: 0,
    })
    const a4 = await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    expect(a4.run.extractedFacts?.length).toBe(1)
    const d = a4.run.extractionDiagnostics!
    expect(d.extractorRawFactCount).toBe(2)
    expect(d.extractorAcceptedFactCount).toBe(1)
    expect(d.extractorRejectedFactCount).toBe(1)
    expect(d.rejectionReasons[0].refs).toContain('src_099')
    expect(d.rejectionReasons[0].reason).toMatch(/src_NNN mapping/)
  })
})

// ─────────────────────────────────────────────────────────────────
// v5 — refinalize an old pack without new AI cost (project 12 fix)
// ─────────────────────────────────────────────────────────────────

describe('refinalize: recovers a pack finalized under the old ≥3-facts rule', () => {
  it('a completed run with 0 extracted facts becomes publishable via refinalize (no AI cost)', async () => {
    await seedPack()

    // Simulate the project-12 shape: run reached 'complete' under
    // v4 with 3 discovered sources (2 Tier-1, 1 Tier-2) but zero
    // extracted facts. The pack was blocked by the old ≥3-facts gate.
    const row = db[`project_id:${PROJECT_ID}`]
    const pack = row.evidence_json
    pack.externalResearchRun = {
      id: 'legacy-run',
      stage: 'complete',
      stageLabel: 'Complete',
      startedAt: '2026-09-08T10:00:00Z',
      updatedAt: '2026-09-08T11:00:00Z',
      searchesUsed: 6,
      costUsd: 0.25,
      tokens: { input: 500, output: 5000 },
      primaryText: 'Primary research prose with cited Tier-1 official Pokémon sources establishing the set.',
      supportingText: 'Supporting prose corroborating with retailer listings.',
      discoveredSources: [
        { id: 'src-cite-1-abc', kind: 'external', url: 'https://www.pokemon.com/us/celebration', title: 'Official', addedAt: '2026-09-08', origin: 'web', sourceTier: 1 },
        { id: 'src-cite-2-def', kind: 'external', url: 'https://tcg.pokemon.com/en-us/expansions/celebration/', title: 'Expansion', addedAt: '2026-09-08', origin: 'web', sourceTier: 1 },
        { id: 'src-cite-3-ghi', kind: 'external', url: 'https://tcgplayer.com/x', title: 'Preorder', addedAt: '2026-09-08', origin: 'web', sourceTier: 2 },
      ],
      extractedFacts: [],
      extractedContradictions: [],
      extractedQuestions: [],
      extractedGaps: [],
      stageTimings: {},
    }
    pack.externalSources = pack.externalSources.concat(pack.externalResearchRun.discoveredSources)
    // Force stale-style quality — pre-v5 output.
    pack.quality = {
      status: 'needs_review',
      dataStrength: 'medium',
      sampleSize: 3,
      freshness: { asOf: '2026-09-08', daysOld: 0, isStale: false },
      publishable: false,
      reasons: ['Fewer than 3 externally-sourced facts (currently 0).'],
    }
    pack.researchSummary = undefined
    row.evidence_json = pack

    // Trigger refinalize — no AI, no destructive changes.
    const before = callLog.length
    const result = await refinalizeExternalResearch(PROJECT_ID, 'e@x')
    expect(callLog.length).toBe(before) // no Claude calls fired

    // Now publishable — has Tier-1 sources + research summary, no
    // ≥3-facts gate.
    expect(result.pack.quality.publishable).toBe(true)
    expect(result.pack.researchSummary).toBeTruthy()
    expect(result.pack.researchSummary!.length).toBeGreaterThan(0)
    expect(result.pack.researchSummary).toContain('Primary research prose')
    expect(result.pack.researchSummary).toContain('Supporting prose')
    // Sources and run data untouched (non-destructive).
    expect(result.pack.externalSources.length).toBe(pack.externalSources.length)
    expect(result.pack.externalResearchRun!.discoveredSources.length).toBe(3)
    expect(result.pack.externalResearchRun!.primaryText).toBe('Primary research prose with cited Tier-1 official Pokémon sources establishing the set.')
  })

  it('refinalize is idempotent — running twice produces the same pack shape', async () => {
    await seedPack()
    const row = db[`project_id:${PROJECT_ID}`]
    row.evidence_json.externalResearchRun = {
      id: 'r',
      stage: 'complete',
      stageLabel: 'Complete',
      startedAt: '2026-09-08T10:00:00Z',
      updatedAt: '2026-09-08T11:00:00Z',
      searchesUsed: 6,
      costUsd: 0.20,
      tokens: { input: 100, output: 100 },
      primaryText: 'p',
      supportingText: 's',
      discoveredSources: [
        { id: 'src-1', kind: 'external', url: 'https://pokemon.com/x', title: 'x', addedAt: '2026-09-08', origin: 'web', sourceTier: 1 },
      ],
      stageTimings: {},
    }
    row.evidence_json.externalSources.push(row.evidence_json.externalResearchRun.discoveredSources[0])
    row.evidence_json.researchSummary = undefined

    const r1 = await refinalizeExternalResearch(PROJECT_ID, 'e@x')
    const r2 = await refinalizeExternalResearch(PROJECT_ID, 'e@x')
    expect(r2.pack.quality.publishable).toBe(r1.pack.quality.publishable)
    expect(r2.pack.researchSummary).toBe(r1.pack.researchSummary)
    expect(r2.pack.externalSources.length).toBe(r1.pack.externalSources.length)
  })
})

describe('stage machine: source tiers preserved end-to-end', () => {
  it('tier assignments (via classifySourceTier) survive the finalize merge', async () => {
    await seedPack()

    scriptedResponses.push(
      { text: 'p', cost: 0.05, searches: 3, citations: [
        { url: 'https://www.pokemon.com/us/pokemon-news/x', title: 'T1 official' },   // Tier 1
        { url: 'https://www.reddit.com/r/pokemontcg/y',    title: 'T3 reddit'    },   // Tier 3
      ], webSearch: {} },
      { text: 's', cost: 0.05, searches: 3, citations: [
        { url: 'https://www.tcgplayer.com/z', title: 'T2 tcgplayer' },                // Tier 2
      ], webSearch: {} },
    )

    await startExternalResearchRun(PROJECT_ID, 'e@x')
    for (let i = 0; i < 6; i++) await advanceExternalResearchRun(PROJECT_ID, 'e@x')
    const finalPack = db[`project_id:${PROJECT_ID}`].evidence_json as EvidencePack
    const tiers = finalPack.externalSources.map(s => s.sourceTier).sort()
    expect(tiers).toEqual([1, 2, 3])
  })
})
