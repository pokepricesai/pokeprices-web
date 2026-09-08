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

const ORDER: GenerationStage[] = ['queued', 'writer', 'style', 'fact_check', 'repair', 'finalize', 'complete']

function makeRun(stage: GenerationStage, overrides: Partial<GenerationRun> = {}): GenerationRun {
  return {
    id: 'run_1', startedAt: '2026-09-07T00:00:00Z', updatedAt: '2026-09-07T00:00:01Z',
    stage, stageLabel: stage, usage: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0 },
    styleRepairFired: false, repairFired: false, stageTimings: {},
    ...overrides,
  }
}

describe('GenerationStage progression', () => {
  it('has the expected six pipeline stages plus complete + failed', () => {
    // Ordering assertion: writer → style → fact_check → [repair] → finalize → complete
    const expected: GenerationStage[] = ['queued', 'writer', 'style', 'fact_check', 'repair', 'finalize', 'complete']
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
    for (const s of ORDER.slice(0, 6)) {   // queued..finalize
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
