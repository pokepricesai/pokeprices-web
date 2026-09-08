// src/lib/editorial/writer/writerActions.ts
//
// EIC Block 9 + 9B — server orchestrator for the AI Writer + Fact
// Checker pipeline.
//
// Block 9B refactors the single-request pipeline (which blew past
// Vercel's synchronous HTTP ceiling on the first real Preview run,
// 504) into a resumable stage machine. Each stage does AT MOST one
// Claude call. Studio polls the same POST endpoint; each call runs
// the next stage and returns updated run state. No queues, no
// workers — just a stateful column and idempotent stage functions.
//
// Stages (see types.GenerationStage):
//   queued → writer → style → fact_check → [repair → finalize] → complete
//
// State survives crashes: writer_json.currentRun carries the raw
// Writer output between calls; studio_json is written as soon as
// the first Studio-ready draft exists, so a browser refresh mid-run
// still shows the article being assembled.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { callAnthropicAndLog, type AnthropicMessage } from '@/lib/ai/anthropic'
import type { EvidencePack, ResearchAnalysis, EditorialResearchRow } from '../research/types'
import { fetchProject, fetchResearch } from '../research/serverActions'
import { buildEditorialContext } from '../context'
import type { EditorialContext } from '../context'
import type { StudioDocument } from '@/lib/studio/types'
import { auditFieldMap, buildStyleRepairUserTurn } from '../styleGuard'
import { applyStyleFixesToDraft } from '../styleFix'
import type { CardIdentity } from '@/lib/studio/dataBlocks/types'

import { WRITER_SYSTEM_PROMPT, buildWriterUserTurn, buildWriterRepairUserTurn, parseWriterResponse } from './writerPrompt'
import { assembleStudioFromDraft } from './assembler'
import { auditStudioNumerics } from './numericAudit'
import { FACT_CHECKER_SYSTEM_PROMPT, buildFactCheckerUserTurn, parseFactCheckerResponse } from './factCheckerPrompt'
import { hashStudioBody } from './hash'
import type {
  WriterDraft, WriterMetadata, WriterUsage, WriterClaimTrace, BlockIntent,
  FactCheckResult, GenerationRun, GenerationStage, NumericAuditResult,
} from './types'
import { WRITER_METADATA_VERSION } from './types'

const WRITER_MODEL       = 'claude-sonnet-4-6'
const WRITER_MAX_TOKENS  = 8000
const CHECKER_MAX_TOKENS = 4000

// ─────────────────────────────────────────────────────────────────
// Public entry points
// ─────────────────────────────────────────────────────────────────

export type GenerateOptions = {
  today?:             string
  overwriteExisting?: boolean
}

export type GenerateStartResult = {
  ok:        true
  writer:    WriterMetadata
  studio:    StudioDocument | null
  factCheck: FactCheckResult | null
}

/**
 * Start (or restart) a generation. Creates the run, does the
 * approval gate, and returns immediately. The client then polls
 * runNextStage() until stage is 'complete' or 'failed'.
 */
export async function startGeneration(projectId: number, adminEmail: string, opts: GenerateOptions = {}): Promise<GenerateStartResult> {
  const project = await fetchProject(projectId)
  if (!project) throw new Error('project not found')
  const research = await fetchResearch(projectId)
  ensureResearchApproved(research)

  const supa = getSupabaseServiceClient()
  const { data: pRow } = await supa.from('editorial_projects').select('studio_json, writer_json').eq('id', projectId).maybeSingle()
  const existingStudio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  const prevWriter    = ((pRow as any)?.writer_json ?? null) as WriterMetadata | null

  const inFlight = prevWriter?.currentRun && prevWriter.currentRun.stage !== 'complete' && prevWriter.currentRun.stage !== 'failed'
  if (inFlight && !opts.overwriteExisting) {
    // Resume the existing in-progress run instead of double-starting.
    return { ok: true, writer: prevWriter!, studio: existingStudio, factCheck: prevWriter!.factCheck ?? null }
  }

  const isMeaningful = hasMeaningfulBody(existingStudio)
  if (isMeaningful && !opts.overwriteExisting) {
    throw new Error('existing draft has meaningful content; call with overwriteExisting=true to replace')
  }

  const run: GenerationRun = {
    id:        `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stage:     'writer',
    stageLabel: 'Writing draft',
    usage:     emptyUsage(),
    styleRepairFired: false,
    repairFired: false,
    stageTimings: {},
  }

  const nextWriter: WriterMetadata = {
    version:              WRITER_METADATA_VERSION,
    generatedAt:          new Date().toISOString(),
    model:                WRITER_MODEL,
    researchId:           Number(research!.id),
    researchGeneratedAt:  (research!.evidence_json as EvidencePack).generatedAt,
    packRecipe:           (research!.evidence_json as EvidencePack).recipe,
    claimTrace:           [],
    blockIntents:         [],
    assemblyWarnings:     [],
    generationCost:       emptyUsage(),
    currentRun:           run,
  }

  await supa.from('editorial_projects').update({
    writer_json: nextWriter,
    updated_at:  new Date().toISOString(),
  }).eq('id', projectId)

  return { ok: true, writer: nextWriter, studio: existingStudio, factCheck: null }
}

/**
 * Run one stage of the in-flight generation and return the updated
 * writer metadata. Callers (Studio) POST this repeatedly until
 * stage is 'complete' or 'failed'. Each invocation makes AT MOST
 * one Claude call so any Vercel plan can serve it.
 */
export async function runNextStage(projectId: number, adminEmail: string): Promise<GenerateStartResult> {
  const supa = getSupabaseServiceClient()

  const project = await fetchProject(projectId)
  if (!project) throw new Error('project not found')
  const research = await fetchResearch(projectId)
  ensureResearchApproved(research)
  const pack = research!.evidence_json as EvidencePack
  const analysis = (research!.analyst_json ?? null) as ResearchAnalysis | null

  const { data: pRow } = await supa.from('editorial_projects').select('studio_json, writer_json').eq('id', projectId).maybeSingle()
  const currentStudio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  let writer = ((pRow as any)?.writer_json ?? null) as WriterMetadata | null
  if (!writer?.currentRun) throw new Error('no active generation — call start first')
  if (writer.currentRun.stage === 'complete' || writer.currentRun.stage === 'failed') {
    return { ok: true, writer, studio: currentStudio, factCheck: writer.factCheck ?? null }
  }

  const stageStartMs = Date.now()
  try {
    switch (writer.currentRun.stage) {
      case 'queued':
        writer = advance(writer, 'writer', 'Writing draft', stageStartMs)
        break
      case 'writer':
        writer = await stageWriter(writer, project, pack, analysis, adminEmail, stageStartMs)
        break
      case 'style':
        writer = await stageStyleAndAssemble(writer, project, pack, adminEmail, stageStartMs)
        break
      case 'fact_check':
        writer = await stageFactCheck(writer, projectId, pack, adminEmail, stageStartMs)
        break
      case 'repair':
        writer = await stageRepair(writer, project, pack, adminEmail, stageStartMs)
        break
      case 'finalize':
        writer = await stageFinalize(writer, projectId, pack, adminEmail, stageStartMs)
        break
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    writer = fail(writer, message)
  }

  await supa.from('editorial_projects').update({
    writer_json: writer,
    updated_at:  new Date().toISOString(),
  }).eq('id', projectId)

  // Fetch the possibly-updated studio_json (stages may write it).
  const { data: pAfter } = await supa.from('editorial_projects').select('studio_json').eq('id', projectId).maybeSingle()
  const studioAfter = ((pAfter as any)?.studio_json ?? null) as StudioDocument | null
  return { ok: true, writer, studio: studioAfter, factCheck: writer.factCheck ?? null }
}

/**
 * Explicit user action: "Fix with AI" from the WriterPanel. Runs a
 * single Writer repair pass against the currently persisted studio +
 * fact check, then a fresh Fact Check on the repaired draft. Charges
 * ~2 additional Claude calls; only invoked when the human clicks it.
 */
export async function runManualRepair(projectId: number, adminEmail: string): Promise<{ ok: true; writer: WriterMetadata; studio: StudioDocument | null; factCheck: FactCheckResult | null }> {
  const supa = getSupabaseServiceClient()
  const project = await fetchProject(projectId)
  if (!project) throw new Error('project not found')
  const research = await fetchResearch(projectId)
  ensureResearchApproved(research)
  const pack = research!.evidence_json as EvidencePack

  const { data: pRow } = await supa.from('editorial_projects').select('studio_json, writer_json').eq('id', projectId).maybeSingle()
  let writer = ((pRow as any)?.writer_json ?? null) as WriterMetadata | null
  const studio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  if (!writer || !writer.factCheck || !writer.currentRun) throw new Error('no completed writer run to repair')
  if (writer.currentRun.repairFired) throw new Error('a repair has already been applied for this draft; regenerate to retry')
  if (!studio) throw new Error('no studio_json to repair')

  // Reset the currentRun into the repair sequence so stage handlers
  // work exactly as they did in the old auto-repair path.
  const run: GenerationRun = {
    ...writer.currentRun,
    stage: 'repair',
    stageLabel: 'Repairing draft',
    updatedAt: new Date().toISOString(),
  }
  writer = { ...writer, currentRun: run }
  await supa.from('editorial_projects').update({ writer_json: writer }).eq('id', projectId)

  // Advance through repair → finalize (2 stage calls, ≤2 Claude calls total).
  writer = await stageRepair(writer, project, pack, adminEmail, Date.now())
  await supa.from('editorial_projects').update({ writer_json: writer, updated_at: new Date().toISOString() }).eq('id', projectId)
  writer = await stageFinalize(writer, projectId, pack, adminEmail, Date.now())
  await supa.from('editorial_projects').update({ writer_json: writer, updated_at: new Date().toISOString() }).eq('id', projectId)

  const { data: pAfter } = await supa.from('editorial_projects').select('studio_json').eq('id', projectId).maybeSingle()
  return { ok: true, writer, studio: ((pAfter as any)?.studio_json ?? null) as StudioDocument | null, factCheck: writer.factCheck ?? null }
}

/**
 * Standalone manual fact check (Studio "Run fact check" button).
 * Runs against the current studio_json + research evidence and
 * updates writer_json.factCheck + checkedStudioHash.
 */
export async function factCheckCurrentDraft(projectId: number, adminEmail: string): Promise<FactCheckResult> {
  const project = await fetchProject(projectId)
  if (!project) throw new Error('project not found')
  const research = await fetchResearch(projectId)
  if (!research || !research.evidence_json) throw new Error('no research evidence to check against')
  const pack = research.evidence_json as EvidencePack
  const studio = (project as any).studio_json as StudioDocument | null
  if (!studio) throw new Error('no draft to fact check')

  const supa = getSupabaseServiceClient()
  const { data: pRow } = await supa.from('editorial_projects').select('writer_json').eq('id', projectId).maybeSingle()
  const prevWriter = (pRow as any)?.writer_json as WriterMetadata | null
  const claimTrace: WriterClaimTrace[] = prevWriter?.claimTrace   ?? []
  const blocksBuilt: BlockIntent[]     = prevWriter?.blockIntents ?? []

  const numericAudit = auditStudioNumerics(studio, pack, blocksBuilt)
  const usage = emptyUsage()
  const studioHash = hashStudioBody(studio.bodyDoc)
  const factCheck  = await runFactChecker(pack, studio, claimTrace, blocksBuilt, numericAudit, { checkedStudioHash: studioHash, autoCheck: false, adminEmail, sessionId: `factcheck-${projectId}-manual-${Date.now()}`, usage })

  const nextMeta: WriterMetadata = {
    ...(prevWriter ?? {
      version: WRITER_METADATA_VERSION, generatedAt: new Date().toISOString(), model: 'manual',
      claimTrace: [], blockIntents: [], assemblyWarnings: [],
      generationCost: emptyUsage(),
    }),
    factCheck,
    checkedStudioHash: studioHash,
  } as WriterMetadata
  nextMeta.generationCost = mergeUsage(nextMeta.generationCost, usage)
  await supa.from('editorial_projects').update({ writer_json: nextMeta, updated_at: new Date().toISOString() }).eq('id', projectId)
  return factCheck
}

// ─────────────────────────────────────────────────────────────────
// Stage handlers — each is idempotent for its stage and advances
// the currentRun.stage to the next value on success.
// ─────────────────────────────────────────────────────────────────

async function stageWriter(writer: WriterMetadata, project: any, pack: EvidencePack, analysis: ResearchAnalysis | null, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const context = await buildEditorialContext()
  const bundle = {
    project: { id: Number(project.id), title: String(project.title), angle: project.angle ?? null, articleType: String(project.article_type), targetPublishAt: project.target_publish_at ?? null },
    pack, analysis, context,
  }
  const userTurn = buildWriterUserTurn(bundle)
  const call = await callAnthropicAndLog({
    feature: 'editorial_writer_generate',
    model: WRITER_MODEL, system: WRITER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userTurn }],
    max_tokens: WRITER_MAX_TOKENS, temperature: 0.4, cacheSystem: true,
    adminEmail, sessionId: `writer-${project.id}-${Date.now()}`,
  })
  if (!call.ok) throw new Error(`writer call failed: ${call.error || 'unknown'}`)
  const parsed = parseWriterResponse(call.text)
  if (!parsed) throw new Error('writer produced no parsable draft')
  const usage = mergeCallUsage(writer.currentRun!.usage, call)
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'style', stageLabel: 'Applying house style',
    rawWriterText: call.text,
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, writer: Date.now() - stageStartMs },
  }
  return { ...writer, generationCost: usage, currentRun: run }
}

async function stageStyleAndAssemble(writer: WriterMetadata, project: any, pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const rawText = writer.currentRun!.rawWriterText
  if (!rawText) throw new Error('style stage: missing rawWriterText')
  let draft = parseWriterResponse(rawText)
  if (!draft) throw new Error('style stage: previous Writer output failed to reparse')

  const usage = writer.currentRun!.usage
  let styleRepairFired = writer.currentRun!.styleRepairFired
  let workingRaw = rawText

  // Final Cleanup — deterministic style repair replaces the auto AI
  // repair. Em dashes, British spellings, and stray whitespace are
  // fixed in-place without a Claude call. Only if trope-level
  // violations REMAIN after the deterministic pass does an AI repair
  // fire — and even then, only if strictly necessary.
  const detFix = applyStyleFixesToDraft(draft)
  if (detFix.changed > 0) {
    draft = detFix.draft as WriterDraft
    styleRepairFired = true   // deterministic path counts as a repair firing for telemetry
  }
  const audit = auditFieldMap(styleAuditFields(draft))
  if (audit.hasViolations) {
    // The remaining violations are trope-level (or a British
    // spelling we did not enumerate). Try a bounded AI repair as
    // a fallback — but only ONCE, and only if truly needed.
    const repair = await callAnthropicAndLog({
      feature: 'editorial_writer_style_repair',
      model: WRITER_MODEL, system: WRITER_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: 'MODE=generate\nOriginal generation was rejected by the style guard. Reproduce your JSON in full but with every style violation fixed.' },
        { role: 'assistant', content: rawText },
        { role: 'user', content: buildStyleRepairUserTurn(rawText, audit) },
      ],
      max_tokens: WRITER_MAX_TOKENS, temperature: 0.2, cacheSystem: true,
      adminEmail, sessionId: `writer-${project.id}-style-${Date.now()}`,
    })
    if (repair.ok) {
      const repaired = parseWriterResponse(repair.text)
      const second   = repaired ? auditFieldMap(styleAuditFields(repaired)) : { hasViolations: true, violations: [] as any[] }
      styleRepairFired = true
      addCallUsage(usage, repair)
      if (repaired && !second.hasViolations) {
        draft = repaired
        workingRaw = repair.text
      }
    }
  }

  const cardIndex = buildCardIndex(pack)
  const assembly = assembleStudioFromDraft({
    draft, pack, cardIndex,
    themeKey: pack.recipe === 'monthly_market_report' ? 'market' : pack.recipe === 'population_scarcity' ? 'grading' : 'market',
    themeLabel: pack.recipe === 'monthly_market_report' ? 'Market' : pack.recipe === 'population_scarcity' ? 'Grading' : 'Market',
  })
  const numericAudit = auditStudioNumerics(assembly.studio, pack, assembly.blocksBuilt)

  // Persist the first Studio-ready draft immediately so a browser
  // refresh mid-run sees the article. Save studio_json alongside
  // the writer_json update in the caller.
  const supa = getSupabaseServiceClient()
  await supa.from('editorial_projects').update({ studio_json: assembly.studio }).eq('id', project.id)

  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'fact_check', stageLabel: 'Checking facts',
    rawWriterText: workingRaw,
    styleRepairFired,
    usage,
    updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, style: Date.now() - stageStartMs },
  }
  const nextMeta: WriterMetadata = {
    ...writer,
    claimTrace:       draft.evidenceTrace,
    blockIntents:     assembly.blocksBuilt,
    assemblyWarnings: assembly.warnings,
    generationCost:   usage,
    styleRepairFired,
    currentRun:       run,
  }
  // Numeric audit lives on the factCheck at fact_check stage; we
  // stash it via a temporary field on currentRun? No — recompute in
  // fact_check from the persisted studio_json. Cheap + deterministic.
  return nextMeta
}

async function stageFactCheck(writer: WriterMetadata, projectId: number, pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const supa = getSupabaseServiceClient()
  const { data: pRow } = await supa.from('editorial_projects').select('studio_json').eq('id', projectId).maybeSingle()
  const studio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  if (!studio) throw new Error('fact_check stage: no studio_json to check')

  const numericAudit = auditStudioNumerics(studio, pack, writer.blockIntents)
  const usage = writer.currentRun!.usage
  const studioHash = hashStudioBody(studio.bodyDoc)
  const factCheck  = await runFactChecker(pack, studio, writer.claimTrace, writer.blockIntents, numericAudit, {
    checkedStudioHash: studioHash, autoCheck: true, adminEmail,
    sessionId: `factcheck-${projectId}-${Date.now()}`, usage,
  })

  // Final Cleanup — do NOT automatically fire a Writer repair.
  // Studio surfaces the remaining issues + a "Fix with AI" button;
  // the human decides whether to spend the extra Claude calls.
  const nextStage: GenerationStage = 'complete'
  const nextLabel  = 'Saving draft'

  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: nextStage, stageLabel: nextLabel,
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, fact_check: Date.now() - stageStartMs },
  }
  const nextMeta: WriterMetadata = {
    ...writer,
    factCheck,
    checkedStudioHash: studioHash,
    generationCost:    usage,
    currentRun:        run,
  }
  if (nextStage === 'complete') return maybeFinalize(nextMeta, projectId)
  return nextMeta
}

async function stageRepair(writer: WriterMetadata, project: any, pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const supa = getSupabaseServiceClient()
  const rawText = writer.currentRun!.rawWriterText
  if (!rawText) throw new Error('repair stage: missing rawWriterText')

  const { data: pRow } = await supa.from('editorial_projects').select('studio_json').eq('id', project.id).maybeSingle()
  const studio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  if (!studio) throw new Error('repair stage: no studio_json')

  const numericAudit = auditStudioNumerics(studio, pack, writer.blockIntents)
  const factCheck    = writer.factCheck
  if (!factCheck) throw new Error('repair stage: no factCheck to repair against')

  const factSummary = factCheck.issues.map((i, k) => `  ${k + 1}. [${i.severity}] ${i.kind} — ${i.claim} :: ${i.reason}${i.suggestedCorrection ? ` (suggest: ${i.suggestedCorrection})` : ''}`).join('\n') || '  (none)'
  const numSummary  = numericAudit.issues.map((i, k) => `  ${k + 1}. "${i.token.raw}" at ${i.token.location}${i.nearest ? ` — nearest allowed ${i.nearest.value} (${i.nearest.source})` : ''}`).join('\n') || '  (none)'

  const rep = await callAnthropicAndLog({
    feature: 'editorial_writer_repair',
    model: WRITER_MODEL, system: WRITER_SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: 'MODE=generate\nInitial draft.' },
      { role: 'assistant', content: rawText },
      { role: 'user', content: buildWriterRepairUserTurn(rawText, factSummary, numSummary) },
    ],
    max_tokens: WRITER_MAX_TOKENS, temperature: 0.3, cacheSystem: true,
    adminEmail, sessionId: `writer-${project.id}-repair-${Date.now()}`,
  })
  const usage = mergeCallUsage(writer.currentRun!.usage, rep)

  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'finalize', stageLabel: 'Saving draft',
    rawWriterText: rep.ok ? rep.text : rawText,
    repairFired: true,
    usage,
    updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, repair: Date.now() - stageStartMs },
  }
  return { ...writer, generationCost: usage, currentRun: run, repairFired: true }
}

async function stageFinalize(writer: WriterMetadata, projectId: number, pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const supa = getSupabaseServiceClient()
  const rawText = writer.currentRun!.rawWriterText
  const repairedDraft = rawText ? parseWriterResponse(rawText) : null
  const { data: pRow } = await supa.from('editorial_projects').select('studio_json').eq('id', projectId).maybeSingle()
  const currentStudio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  if (!currentStudio) throw new Error('finalize stage: no studio_json')

  let acceptedStudio = currentStudio
  let acceptedFactCheck = writer.factCheck!
  let acceptedNumericAudit = writer.factCheck!.numericAudit
  let acceptedTrace = writer.claimTrace
  let acceptedIntents = writer.blockIntents
  let acceptedWarnings = writer.assemblyWarnings

  if (repairedDraft) {
    const cardIndex = buildCardIndex(pack)
    const repAssembly = assembleStudioFromDraft({
      draft: repairedDraft, pack, cardIndex,
      themeKey: currentStudio.themeKey, themeLabel: currentStudio.themeLabel,
    })
    const repAudit  = auditStudioNumerics(repAssembly.studio, pack, repAssembly.blocksBuilt)
    const repHash   = hashStudioBody(repAssembly.studio.bodyDoc)
    const repCheck  = await runFactChecker(pack, repAssembly.studio, repairedDraft.evidenceTrace, repAssembly.blocksBuilt, repAudit, {
      checkedStudioHash: repHash, autoCheck: true, adminEmail,
      sessionId: `factcheck-${projectId}-final-${Date.now()}`, usage: writer.currentRun!.usage,
    })
    const before = writer.factCheck!.issues.length + writer.factCheck!.numericAudit.issues.length
    const after  = repCheck.issues.length + repAudit.issues.length
    if (after <= before) {
      // Accept repair.
      acceptedStudio = repAssembly.studio
      acceptedFactCheck = repCheck
      acceptedNumericAudit = repAudit
      acceptedTrace = repairedDraft.evidenceTrace
      acceptedIntents = repAssembly.blocksBuilt
      acceptedWarnings = repAssembly.warnings
      await supa.from('editorial_projects').update({ studio_json: acceptedStudio }).eq('id', projectId)
    }
    // else keep the previously-persisted studio + factCheck.
  }

  const usage = writer.currentRun!.usage
  const nextStatus = await promoteProjectStatus(projectId)
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'complete', stageLabel: 'Complete',
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, finalize: Date.now() - stageStartMs },
  }
  return {
    ...writer,
    claimTrace: acceptedTrace,
    blockIntents: acceptedIntents,
    assemblyWarnings: acceptedWarnings,
    factCheck: acceptedFactCheck,
    checkedStudioHash: hashStudioBody(acceptedStudio.bodyDoc),
    generationCost: usage,
    currentRun: run,
  }
}

async function maybeFinalize(writer: WriterMetadata, projectId: number): Promise<WriterMetadata> {
  await promoteProjectStatus(projectId)
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'complete', stageLabel: 'Complete',
    updatedAt: new Date().toISOString(),
  }
  return { ...writer, currentRun: run }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function advance(writer: WriterMetadata, nextStage: GenerationStage, label: string, stageStartMs: number): WriterMetadata {
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: nextStage, stageLabel: label,
    updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, [writer.currentRun!.stage]: Date.now() - stageStartMs },
  }
  return { ...writer, currentRun: run }
}
function fail(writer: WriterMetadata | null, error: string): WriterMetadata {
  const run: GenerationRun = writer?.currentRun ? {
    ...writer.currentRun, stage: 'failed', stageLabel: 'Failed',
    error, updatedAt: new Date().toISOString(),
  } : {
    id: `run_failed_${Date.now()}`, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    stage: 'failed', stageLabel: 'Failed', error, usage: emptyUsage(),
    styleRepairFired: false, repairFired: false, stageTimings: {},
  }
  return {
    version: WRITER_METADATA_VERSION, generatedAt: new Date().toISOString(), model: WRITER_MODEL,
    claimTrace: [], blockIntents: [], assemblyWarnings: [], generationCost: emptyUsage(),
    ...(writer ?? {}),
    currentRun: run,
  }
}

function ensureResearchApproved(row: EditorialResearchRow | null): void {
  if (!row) throw new Error('approved research required')
  if (row.status !== 'approved') throw new Error(`approved research required (status: ${row.status})`)
}

function hasMeaningfulBody(doc: StudioDocument | null): boolean {
  if (!doc) return false
  const b = doc.bodyDoc as any
  if (!b || !Array.isArray(b.content)) return false
  return b.content.some((n: any) => n?.type === 'heading' || n?.type === 'dataBlock' || (n?.type === 'paragraph' && Array.isArray(n.content) && n.content.some((c: any) => typeof c?.text === 'string' && c.text.trim().length > 0)))
    || (doc.headline?.trim().length ?? 0) > 0
    || (doc.intro?.trim().length ?? 0) > 0
}

function styleAuditFields(draft: WriterDraft): Record<string, string | string[]> {
  const paragraphs: string[] = []
  for (const s of draft.sections) {
    if (s.heading) paragraphs.push(s.heading)
    paragraphs.push(...s.paragraphs)
  }
  if (draft.conclusion) paragraphs.push(draft.conclusion)
  return {
    'headline':        draft.headline,
    'intro':           draft.intro,
    'seoTitle':        draft.seoTitle,
    'seoDescription':  draft.seoDescription,
    'paragraphs':      paragraphs,
  }
}

function emptyUsage(): WriterUsage {
  return { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, cost_usd: 0, latency_ms: 0 }
}
function addCallUsage(base: WriterUsage, more: { usage: any; cost_usd: number; latency_ms: number }): void {
  base.input_tokens          += more.usage.input_tokens          ?? 0
  base.output_tokens         += more.usage.output_tokens         ?? 0
  base.cache_creation_tokens += more.usage.cache_creation_tokens ?? 0
  base.cache_read_tokens     += more.usage.cache_read_tokens     ?? 0
  base.cost_usd              += more.cost_usd                    ?? 0
  base.latency_ms             = Math.max(base.latency_ms, more.latency_ms ?? 0)
}
function mergeCallUsage(base: WriterUsage, more: { usage: any; cost_usd: number; latency_ms: number }): WriterUsage {
  const copy: WriterUsage = { ...base }
  addCallUsage(copy, more)
  return copy
}
function mergeUsage(a: WriterUsage, b: WriterUsage): WriterUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_tokens: a.cache_creation_tokens + b.cache_creation_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cost_usd: a.cost_usd + b.cost_usd,
    latency_ms: Math.max(a.latency_ms, b.latency_ms),
  }
}

async function promoteProjectStatus(projectId: number): Promise<string> {
  const supa = getSupabaseServiceClient()
  const { data: p } = await supa.from('editorial_projects').select('status').eq('id', projectId).maybeSingle()
  const cur = (p as any)?.status as string | undefined
  const next = (cur === 'planned' || cur === 'idea') ? 'drafting' : (cur ?? 'drafting')
  if (next !== cur) await supa.from('editorial_projects').update({ status: next }).eq('id', projectId)
  return next
}

async function runFactChecker(
  pack: EvidencePack, studio: StudioDocument, claimTrace: WriterClaimTrace[], blocksBuilt: BlockIntent[], numericAudit: NumericAuditResult,
  opts: { checkedStudioHash: string; autoCheck: boolean; adminEmail: string; sessionId: string; usage: WriterUsage },
): Promise<FactCheckResult> {
  const userTurn = buildFactCheckerUserTurn({ pack, studio, claimTrace, blocksBuilt, numericAudit })
  const call = await callAnthropicAndLog({
    feature:  'editorial_writer_fact_check',
    model:    WRITER_MODEL, system: FACT_CHECKER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userTurn }],
    max_tokens: CHECKER_MAX_TOKENS, temperature: 0.2, cacheSystem: true,
    adminEmail: opts.adminEmail, sessionId: opts.sessionId,
  })
  if (!call.ok) {
    return {
      version: 1, status: 'review_required', checkedAt: new Date().toISOString(),
      packRecipe: pack.recipe,
      issues: [{ kind: 'other', severity: 'major', claim: 'Fact Checker call failed', reason: call.error ?? 'unknown', evidenceRefs: [] }],
      numericAudit, checkedStudioHash: opts.checkedStudioHash, autoCheck: opts.autoCheck,
    }
  }
  addCallUsage(opts.usage, call)
  return parseFactCheckerResponse(call.text, pack, numericAudit, { checkedStudioHash: opts.checkedStudioHash, autoCheck: opts.autoCheck })
}

function buildCardIndex(pack: EvidencePack): Map<string, CardIdentity> {
  const map = new Map<string, CardIdentity>()
  for (const t of pack.dataTables) {
    for (const row of t.rows) {
      const slug = String(row.cardSlug ?? row.card_slug ?? row.urlSlug ?? '')
      const name = String(row.cardName ?? row.card ?? row.name ?? '')
      const setName = String(row.setName ?? row.set_name ?? '')
      const num  = row.cardNumber != null ? String(row.cardNumber) : String(row.card_number ?? row['#'] ?? '')
      const url  = String(row.urlSlug ?? row.url_slug ?? '')
      if (!name) continue
      const key = slug || (url ? url.replace(/^pc-/, '') : `${setName}|${num}`)
      if (!key) continue
      if (!map.has(key)) map.set(key, {
        cardSlug: slug || (url ? url.replace(/^pc-/, '') : ''),
        cardName: name, setName: setName || undefined,
        cardNumber: num || undefined, urlSlug: url || undefined,
      })
    }
  }
  return map
}
