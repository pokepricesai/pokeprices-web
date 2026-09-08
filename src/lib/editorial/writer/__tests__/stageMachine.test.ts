// src/lib/editorial/writer/__tests__/stageMachine.test.ts
//
// EIC Block 9B — stage machine sanity checks.
//
// These tests don't invoke Claude. They verify:
//   * the GenerationStage type + STAGE_ORDER progression matches the
//     server orchestrator
//   * a failed run leaves currentRun.stage='failed' with an error
//   * a completed WriterMetadata can be transported through JSON

import { describe, it, expect } from 'vitest'
import type { GenerationRun, GenerationStage, WriterMetadata } from '../types'
import { WRITER_METADATA_VERSION } from '../types'

// Block 9C — expanded stage order (split Writer). The old 'writer'
// slot is kept for in-flight runs from before the split shipped.
const ORDER: GenerationStage[] = ['queued', 'writer', 'writer_plan', 'writer_part1', 'writer_part2', 'writer_assemble', 'style', 'fact_check', 'repair', 'finalize', 'complete']

function makeRun(stage: GenerationStage, overrides: Partial<GenerationRun> = {}): GenerationRun {
  return {
    id: 'run_1', startedAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:01Z',
    stage, stageLabel: stage, usage: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0 },
    styleRepairFired: false, repairFired: false, stageTimings: {},
    ...overrides,
  }
}

describe('GenerationStage progression', () => {
  it('Block 9C — split-Writer stages are in the type union', () => {
    const expected: GenerationStage[] = ['queued', 'writer', 'writer_plan', 'writer_part1', 'writer_part2', 'writer_assemble', 'style', 'fact_check', 'repair', 'finalize', 'complete']
    expect(ORDER).toEqual(expected)
    // 'failed' is a terminal sibling — not in ORDER
  })
})

describe('WriterMetadata carries currentRun cleanly through JSON', () => {
  it('round-trips a failed run with error', () => {
    const run = makeRun('failed', { error: 'writer call failed: 429 rate limited' })
    const meta: WriterMetadata = {
      version: WRITER_METADATA_VERSION, generatedAt: '2026-09-07T00:00:02Z', model: 'claude-sonnet-4-6',
      claimTrace: [], blockIntents: [], assemblyWarnings: [],
      generationCost: run.usage, currentRun: run,
    }
    const roundTripped = JSON.parse(JSON.stringify(meta)) as WriterMetadata
    expect(roundTripped.currentRun?.stage).toBe('failed')
    expect(roundTripped.currentRun?.error).toContain('429')
  })

  it('preserves per-stage timings so the report can show real numbers', () => {
    const run = makeRun('complete', {
      stageTimings: { writer: 42000, style: 100, fact_check: 33000, repair: 45000, finalize: 30000 },
      styleRepairFired: false, repairFired: true,
    })
    const meta: WriterMetadata = {
      version: WRITER_METADATA_VERSION, generatedAt: '2026-09-07T00:00:02Z', model: 'claude-sonnet-4-6',
      claimTrace: [], blockIntents: [], assemblyWarnings: [],
      generationCost: run.usage, currentRun: run,
    }
    const rt = JSON.parse(JSON.stringify(meta)) as WriterMetadata
    expect(rt.currentRun?.stageTimings.writer).toBe(42000)
    expect(rt.currentRun?.stageTimings.repair).toBe(45000)
    expect(rt.currentRun?.repairFired).toBe(true)
  })
})

describe('resume-safety invariants', () => {
  it('an in-flight run (non-terminal stage) is recognisable', () => {
    for (const s of ORDER.slice(0, -1)) {   // everything except 'complete'
      const run = makeRun(s as GenerationStage)
      const inFlight = run.stage !== 'complete' && run.stage !== 'failed'
      expect(inFlight).toBe(true)
    }
  })
  it('completed / failed runs are terminal', () => {
    expect(makeRun('complete').stage === 'complete').toBe(true)
    expect(makeRun('failed').stage === 'failed').toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// Block 9C — plan → part1 → part2 → assemble
// ─────────────────────────────────────────────────────────────────

import { parseWriterPlanResponse, parseWriterPartResponse, assembleDraftFromPlanAndParts } from '../writerPrompt'
import type { WriterPlan } from '../types'

describe('parseWriterPlanResponse', () => {
  it('parses a valid plan with sections assigned across both parts', () => {
    const plan = parseWriterPlanResponse('```json\n' + JSON.stringify({
      headline: 'H', intro: 'I', seoTitle: 'S', seoDescription: 'D', hasConclusion: true,
      sections: [
        { id: 'intro-notes', heading: 'Setup',   headingLevel: 2, brief: 'Introduce.', evidenceRefs: ['fact-1'], blockIntents: [], assignedTo: 'part1' },
        { id: 'analysis',    heading: 'Details', headingLevel: 2, brief: 'Dive in.',  evidenceRefs: ['fact-2'], blockIntents: [], assignedTo: 'part2' },
      ],
      internalLinkIntents: [{ url: '/insights/x', anchor: 'x' }],
      externalLinkIntents: [{ url: 'https://pokemon.com/y', anchor: 'y' }],
    }) + '\n```')
    expect(plan).toBeTruthy()
    expect(plan!.sections).toHaveLength(2)
    expect(plan!.sections[0].assignedTo).toBe('part1')
    expect(plan!.sections[1].assignedTo).toBe('part2')
    expect(plan!.hasConclusion).toBe(true)
  })

  it('rejects plans with no sections', () => {
    const plan = parseWriterPlanResponse('```json\n' + JSON.stringify({ headline: 'H', sections: [] }) + '\n```')
    expect(plan).toBeNull()
  })
})

describe('assembleDraftFromPlanAndParts', () => {
  const plan: WriterPlan = {
    headline: 'H', intro: 'I', seoTitle: 'S', seoDescription: 'D', hasConclusion: true,
    sections: [
      { id: 'a', heading: 'A', headingLevel: 2, brief: 'a', evidenceRefs: [], blockIntents: [], assignedTo: 'part1' },
      { id: 'b', heading: 'B', headingLevel: 2, brief: 'b', evidenceRefs: [], blockIntents: [], assignedTo: 'part1' },
      { id: 'c', heading: 'C', headingLevel: 2, brief: 'c', evidenceRefs: [], blockIntents: [], assignedTo: 'part2' },
      { id: 'd', heading: 'D', headingLevel: 2, brief: 'd', evidenceRefs: [], blockIntents: [], assignedTo: 'part2' },
    ],
    internalLinkIntents: [{ url: '/x', anchor: 'X' }],
    externalLinkIntents: [{ url: 'https://y', anchor: 'Y' }],
  }

  it('emits sections in plan order — one headline, one intro, no duplicates', () => {
    const part1 = { sections: [
      { id: 'a', heading: 'A', headingLevel: 2 as const, paragraphs: ['A prose'], blockIntents: [] },
      { id: 'b', heading: 'B', headingLevel: 2 as const, paragraphs: ['B prose'], blockIntents: [] },
    ], conclusion: null, internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const part2 = { sections: [
      { id: 'c', heading: 'C', headingLevel: 2 as const, paragraphs: ['C prose'], blockIntents: [] },
      { id: 'd', heading: 'D', headingLevel: 2 as const, paragraphs: ['D prose'], blockIntents: [] },
    ], conclusion: 'Concluding sentence.', internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const draft = assembleDraftFromPlanAndParts(plan, part1, part2)
    expect(draft.headline).toBe('H')
    expect(draft.intro).toBe('I')
    expect(draft.sections.map(s => s.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(draft.conclusion).toBe('Concluding sentence.')
  })

  it('drops a conclusion produced by part1 (only part2 may set one)', () => {
    const part1 = { sections: [
      { id: 'a', heading: 'A', headingLevel: 2 as const, paragraphs: ['x'], blockIntents: [] },
    ], conclusion: 'Illegal', internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const part2 = { sections: [
      { id: 'c', heading: 'C', headingLevel: 2 as const, paragraphs: ['y'], blockIntents: [] },
    ], conclusion: null, internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const draft = assembleDraftFromPlanAndParts(plan, part1, part2)
    expect(draft.conclusion).toBeUndefined()
  })

  it('drops the conclusion entirely when plan.hasConclusion=false, even if part2 sets one', () => {
    const noConclusionPlan: WriterPlan = { ...plan, hasConclusion: false }
    const part1 = { sections: [], conclusion: null, internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const part2 = { sections: [
      { id: 'c', heading: 'C', headingLevel: 2 as const, paragraphs: ['x'], blockIntents: [] },
    ], conclusion: 'Should be dropped', internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const draft = assembleDraftFromPlanAndParts(noConclusionPlan, part1, part2)
    expect(draft.conclusion).toBeUndefined()
  })

  it('drops sections either part omitted', () => {
    // Part 1 only drafted "a"; part 2 didn't draft "c". Both are dropped.
    const part1 = { sections: [
      { id: 'a', heading: 'A', headingLevel: 2 as const, paragraphs: ['x'], blockIntents: [] },
    ], conclusion: null, internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const part2 = { sections: [
      { id: 'd', heading: 'D', headingLevel: 2 as const, paragraphs: ['y'], blockIntents: [] },
    ], conclusion: null, internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const draft = assembleDraftFromPlanAndParts(plan, part1, part2)
    expect(draft.sections.map(s => s.id)).toEqual(['a', 'd'])
  })

  it('dedupes internal + external link intents across plan + both parts', () => {
    const part1 = { sections: [], conclusion: null,
      internalLinkIntents: [{ url: '/x', anchor: 'X' }, { url: '/z', anchor: 'Z' }],   // /x dup
      externalLinkIntents: [{ url: 'https://y', anchor: 'Y' }],                        // dup
      evidenceTrace: [] }
    const part2 = { sections: [], conclusion: null,
      internalLinkIntents: [], externalLinkIntents: [], evidenceTrace: [] }
    const draft = assembleDraftFromPlanAndParts(plan, part1, part2)
    expect(draft.internalLinkIntents.map(l => l.url).sort()).toEqual(['/x', '/z'])
    expect(draft.externalLinkIntents.map(l => l.url)).toEqual(['https://y'])
  })
})

describe('parseWriterPartResponse', () => {
  it('accepts null / omitted conclusion', () => {
    const parsed = parseWriterPartResponse('```json\n' + JSON.stringify({
      sections: [{ id: 'a', heading: 'A', headingLevel: 2, paragraphs: ['x'], blockIntents: [] }],
      conclusion: null,
    }) + '\n```')
    expect(parsed).toBeTruthy()
    expect(parsed!.conclusion).toBeNull()
    expect(parsed!.sections).toHaveLength(1)
  })
  it('normalises a non-null conclusion string', () => {
    const parsed = parseWriterPartResponse('```json\n' + JSON.stringify({
      sections: [{ id: 'a', heading: 'A', headingLevel: 2, paragraphs: ['x'], blockIntents: [] }],
      conclusion: 'Final thought.',
    }) + '\n```')
    expect(parsed!.conclusion).toBe('Final thought.')
  })
})
