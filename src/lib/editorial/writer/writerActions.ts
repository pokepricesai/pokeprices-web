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

import {
  WRITER_SYSTEM_PROMPT, buildWriterUserTurn, buildWriterRepairUserTurn, parseWriterResponse,
  // Block 9C — split-Writer helpers
  WRITER_PLAN_SYSTEM_PROMPT, buildWriterPlanUserTurn, parseWriterPlanResponse,
  WRITER_PART_SYSTEM_PROMPT, buildWriterPartUserTurn, parseWriterPartResponse,
  assembleDraftFromPlanAndParts,
} from './writerPrompt'
// EIC — simplified external-research Writer path
import {
  EXTERNAL_WRITER_SYSTEM_PROMPT,
  buildExternalArticleUserTurn,
  parseExternalArticleResponse,
  buildStudioDocFromExternalArticle,
} from './externalWriter'
// EIC two-stage external Writer — the current normal path
import {
  RESEARCH_AND_WRITE_SYSTEM_PROMPT,
  buildResearchAndWriteUserTurn,
  parseResearchAndWriteResponse,
  pickInternalLinkCandidates,
} from './researchAndWrite'
import {
  CHECK_AND_FIX_SYSTEM_PROMPT,
  buildCheckAndFixUserTurn,
  parseCheckAndFixResponse,
} from './checkAndFix'
import { markdownToStudioBodyDoc } from './externalWriter'
import { STUDIO_DOCUMENT_VERSION } from '@/lib/studio/types'
import { chooseRecipe } from '../research/dispatch'
import { assembleStudioFromDraft } from './assembler'
import { auditStudioNumerics } from './numericAudit'
import {
  FACT_CHECKER_SYSTEM_PROMPT, buildFactCheckerUserTurn, parseFactCheckerResponse,
  EXTERNAL_FACT_CHECKER_SYSTEM_PROMPT, buildExternalFactCheckerUserTurn,
} from './factCheckerPrompt'
import { hashStudioBody } from './hash'
import type {
  WriterDraft, WriterMetadata, WriterUsage, WriterClaimTrace, BlockIntent,
  FactCheckResult, GenerationRun, GenerationStage, NumericAuditResult,
} from './types'
import { WRITER_METADATA_VERSION } from './types'

const WRITER_MODEL       = 'claude-sonnet-4-6'
const WRITER_MAX_TOKENS  = 8000
const CHECKER_MAX_TOKENS = 4000
// Block 9C — each split Writer sub-stage targets a smaller output
// so a single Claude call comfortably lands under Cloudflare's
// ~100s edge idle limit even on a heavy 44-source external
// article. Plan is small (structure only); each part drafts half
// the article.
const WRITER_PLAN_MAX_TOKENS = 3000
const WRITER_PART_MAX_TOKENS = 5000
// External Writer — one Sonnet call producing ~700-1,200 words of
// Markdown wrapped in a tiny JSON envelope. ~1,500-2,500 output
// tokens comfortably lands in 30-45s.
const WRITER_EXTERNAL_MAX_TOKENS = 4500
// EIC two-stage — Stage 1 does research + drafting in one call
// (web_search enabled). Stage 2 checks + fixes with a bounded
// web_search budget. Both use Sonnet 4.6.
const RESEARCH_AND_WRITE_MAX_TOKENS = 5000
const RESEARCH_AND_WRITE_MAX_SEARCHES = 5
const CHECK_AND_FIX_MAX_TOKENS = 5000
const CHECK_AND_FIX_MAX_SEARCHES = 3

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

  // EIC two-stage — external SEO/news articles do NOT require an
  // approved EvidencePack. Live web_search inside research_and_write
  // is the sole research surface. Internal-data articles still need
  // the strict approval + pack flow because their numeric truth
  // comes from deterministic PokePrices data.
  const projectRef = {
    id: project.id, title: project.title, angle: project.angle,
    articleType: project.article_type, targetPublishAt: project.target_publish_at,
  }
  const isExternal = chooseRecipe(projectRef) === 'external_research'

  let research: Awaited<ReturnType<typeof fetchResearch>> = null
  if (!isExternal) {
    research = await fetchResearch(projectId)
    ensureResearchApproved(research)
  }

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

  const startingStage: GenerationStage = isExternal ? 'research_and_write' : 'writer_plan'
  const startingLabel = isExternal ? 'Researching & writing' : 'Planning article'

  const run: GenerationRun = {
    id:        `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stage:     startingStage,
    stageLabel: startingLabel,
    usage:     emptyUsage(),
    styleRepairFired: false,
    repairFired: false,
    stageTimings: {},
  }

  const nextWriter: WriterMetadata = {
    version:              WRITER_METADATA_VERSION,
    generatedAt:          new Date().toISOString(),
    model:                WRITER_MODEL,
    researchId:           research?.id ? Number(research.id) : undefined,
    researchGeneratedAt:  research?.evidence_json ? (research.evidence_json as EvidencePack).generatedAt : undefined,
    packRecipe:           research?.evidence_json ? (research.evidence_json as EvidencePack).recipe : (isExternal ? 'external_research' : undefined),
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

  // EIC two-stage — external articles skip the approved-EvidencePack
  // gate. Internal-data articles still require it. Legacy in-flight
  // external runs (writer_external / style / fact_check) may still
  // read a pack when one exists; we tolerate its absence for the
  // new research_and_write / check_and_fix stages.
  const projectRef = {
    id: project.id, title: project.title, angle: project.angle,
    articleType: project.article_type, targetPublishAt: project.target_publish_at,
  }
  const isExternal = chooseRecipe(projectRef) === 'external_research'
  let pack:     EvidencePack     | null = null
  let analysis: ResearchAnalysis | null = null
  const research = await fetchResearch(projectId).catch(() => null)
  if (!isExternal) {
    ensureResearchApproved(research)
    pack     = research!.evidence_json as EvidencePack
    analysis = (research!.analyst_json ?? null) as ResearchAnalysis | null
  } else if (research?.evidence_json) {
    pack     = research.evidence_json as EvidencePack
    analysis = (research.analyst_json ?? null) as ResearchAnalysis | null
  }

  const { data: pRow } = await supa.from('editorial_projects').select('studio_json, writer_json').eq('id', projectId).maybeSingle()
  const currentStudio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  let writer = ((pRow as any)?.writer_json ?? null) as WriterMetadata | null
  if (!writer?.currentRun) throw new Error('no active generation — call start first')
  if (writer.currentRun.stage === 'complete' || writer.currentRun.stage === 'failed') {
    return { ok: true, writer, studio: currentStudio, factCheck: writer.factCheck ?? null }
  }

  const stageStartMs = Date.now()
  const stageAtEntry = writer.currentRun.stage
  try {
    switch (writer.currentRun.stage) {
      case 'queued': {
        // External → research_and_write (two-stage). Internal → writer_plan.
        const nextStage: GenerationStage = isExternal ? 'research_and_write' : 'writer_plan'
        const nextLabel = isExternal ? 'Researching & writing' : 'Planning article'
        writer = advance(writer, nextStage, nextLabel, stageStartMs)
        break
      }
      // EIC two-stage external path
      case 'research_and_write':
        writer = await stageResearchAndWrite(writer, project, adminEmail, stageStartMs)
        break
      case 'check_and_fix':
        writer = await stageCheckAndFix(writer, project, adminEmail, stageStartMs)
        break
      // Internal-data path (unchanged) — pack is guaranteed non-null
      // by the ensureResearchApproved gate above.
      case 'writer':
        writer = await stageWriter(writer, project, pack!, analysis, adminEmail, stageStartMs)
        break
      case 'writer_plan':
        writer = await stageWriterPlan(writer, project, pack!, analysis, adminEmail, stageStartMs)
        break
      case 'writer_part1':
        writer = await stageWriterPart(writer, project, pack!, analysis, 'part1', adminEmail, stageStartMs)
        break
      case 'writer_part2':
        writer = await stageWriterPart(writer, project, pack!, analysis, 'part2', adminEmail, stageStartMs)
        break
      case 'writer_assemble':
        writer = stageWriterAssemble(writer, stageStartMs)
        break
      // Legacy external one-shot path — kept for in-flight runs
      // created before the two-stage split shipped. Requires a pack.
      case 'writer_external':
        writer = await stageWriterExternal(writer, project, pack!, adminEmail, stageStartMs)
        break
      case 'style':
        writer = await stageStyleAndAssemble(writer, project, pack!, adminEmail, stageStartMs)
        break
      case 'fact_check':
        writer = await stageFactCheck(writer, projectId, pack!, adminEmail, stageStartMs)
        break
      case 'repair':
        writer = await stageRepair(writer, project, pack!, adminEmail, stageStartMs)
        break
      case 'finalize':
        writer = await stageFinalize(writer, projectId, pack!, adminEmail, stageStartMs)
        break
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    writer = fail(writer, message, stageAtEntry)
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

// ─────────────────────────────────────────────────────────────────
// Block 9C — split-Writer stage handlers
// ─────────────────────────────────────────────────────────────────
//
// stageWriterPlan  — small planning call. Model produces a
//                    WriterPlan (headline + sections outline +
//                    evidence assignment). Persists plan on the
//                    run so parts can consume it.
// stageWriterPart  — one Claude call per part; sees only the
//                    evidence subset referenced by its assigned
//                    sections + the other part's headings for
//                    continuity. Persists per-part sections so a
//                    failed part2 does not re-run part1.
// stageWriterAssemble — deterministic. Merges plan + parts into a
//                    single WriterDraft, serialises it into
//                    rawWriterText, hands off to the existing
//                    style stage (which reparses rawWriterText).
//                    No AI call.

async function stageWriterPlan(writer: WriterMetadata, project: any, pack: EvidencePack, analysis: ResearchAnalysis | null, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const context = await buildEditorialContext()
  const bundle = {
    project: { id: Number(project.id), title: String(project.title), angle: project.angle ?? null, articleType: String(project.article_type), targetPublishAt: project.target_publish_at ?? null },
    pack, analysis, context,
  }
  const userTurn = buildWriterPlanUserTurn(bundle)
  const call = await callAnthropicAndLog({
    feature: 'editorial_writer_plan',
    model: WRITER_MODEL, system: WRITER_PLAN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userTurn }],
    max_tokens: WRITER_PLAN_MAX_TOKENS, temperature: 0.3, cacheSystem: true,
    adminEmail, sessionId: `writer-plan-${project.id}-${Date.now()}`,
  })
  if (!call.ok) throw new Error(`writer_plan call failed: ${call.error || 'unknown'}`)
  const plan = parseWriterPlanResponse(call.text)
  if (!plan) throw new Error('writer_plan produced no parsable plan')
  // Belt-and-braces: ensure the plan actually assigns sections to
  // both parts. If the model put everything on part1 we split by
  // section index at the median to keep both drafting calls small.
  const rebalanced = ensurePartBalance(plan)

  const usage = mergeCallUsage(writer.currentRun!.usage, call)
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'writer_part1', stageLabel: 'Drafting part 1 of 2',
    plan: rebalanced,
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, writer_plan: Date.now() - stageStartMs },
  }
  return { ...writer, generationCost: usage, currentRun: run }
}

async function stageWriterPart(writer: WriterMetadata, project: any, pack: EvidencePack, analysis: ResearchAnalysis | null, part: 'part1' | 'part2', adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const plan = writer.currentRun?.plan
  if (!plan) throw new Error(`${part} stage: no plan on run — plan stage must run first`)

  const context = await buildEditorialContext()
  const bundle = {
    project: { id: Number(project.id), title: String(project.title), angle: project.angle ?? null, articleType: String(project.article_type), targetPublishAt: project.target_publish_at ?? null },
    pack, analysis, context,
  }

  const otherPart: 'part1' | 'part2' = part === 'part1' ? 'part2' : 'part1'
  const otherHeadings = plan.sections
    .filter(s => s.assignedTo === otherPart)
    .map(s => s.heading ?? s.id)

  const userTurn = buildWriterPartUserTurn({ bundle, plan, part, otherPartHeadings: otherHeadings })
  const call = await callAnthropicAndLog({
    feature: `editorial_writer_${part}`,
    model: WRITER_MODEL, system: WRITER_PART_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userTurn }],
    max_tokens: WRITER_PART_MAX_TOKENS, temperature: 0.4, cacheSystem: true,
    adminEmail, sessionId: `writer-${part}-${project.id}-${Date.now()}`,
  })
  if (!call.ok) throw new Error(`writer_${part} call failed: ${call.error || 'unknown'}`)
  const parsed = parseWriterPartResponse(call.text)
  if (!parsed) throw new Error(`writer_${part} produced no parsable draft`)

  const usage = mergeCallUsage(writer.currentRun!.usage, call)
  const nextStage: GenerationStage = part === 'part1' ? 'writer_part2' : 'writer_assemble'
  const nextLabel = part === 'part1' ? 'Drafting part 2 of 2' : 'Assembling draft'
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: nextStage, stageLabel: nextLabel,
    // Persist the part-specific data — used by assemble AND
    // gives a failed part2 the chance to retry without re-running
    // part1.
    ...(part === 'part1'
      ? { part1Sections: parsed.sections }
      : { part2Sections: parsed.sections }),
    // We also stash the parsed part's link intents + evidenceTrace
    // + conclusion for the assembler to consume. Simplest: keep
    // them on rawWriterText as a serialised JSON blob keyed by part.
    // Cleaner: attach to the run via helper below.
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, [`writer_${part}`]: Date.now() - stageStartMs },
  }
  // Merge the part's link intents + conclusion + evidenceTrace back
  // into a hidden "assemble scratchpad" stored on rawWriterText as
  // JSON. This survives across the part1 → part2 stages.
  const scratchpad = readScratchpad(writer.currentRun!.rawWriterText)
  const nextScratchpad = { ...scratchpad, [part]: {
    conclusion:          parsed.conclusion,
    internalLinkIntents: parsed.internalLinkIntents,
    externalLinkIntents: parsed.externalLinkIntents,
    evidenceTrace:       parsed.evidenceTrace,
  } }
  run.rawWriterText = JSON.stringify(nextScratchpad)
  return { ...writer, generationCost: usage, currentRun: run }
}

function stageWriterAssemble(writer: WriterMetadata, stageStartMs: number): WriterMetadata {
  const run = writer.currentRun!
  if (!run.plan) throw new Error('writer_assemble stage: no plan on run')

  const scratchpad = readScratchpad(run.rawWriterText)
  const part1 = {
    sections:            run.part1Sections ?? [],
    conclusion:          scratchpad.part1?.conclusion ?? null,
    internalLinkIntents: scratchpad.part1?.internalLinkIntents ?? [],
    externalLinkIntents: scratchpad.part1?.externalLinkIntents ?? [],
    evidenceTrace:       scratchpad.part1?.evidenceTrace ?? [],
  }
  const part2 = {
    sections:            run.part2Sections ?? [],
    conclusion:          scratchpad.part2?.conclusion ?? null,
    internalLinkIntents: scratchpad.part2?.internalLinkIntents ?? [],
    externalLinkIntents: scratchpad.part2?.externalLinkIntents ?? [],
    evidenceTrace:       scratchpad.part2?.evidenceTrace ?? [],
  }

  const draft = assembleDraftFromPlanAndParts(run.plan, part1, part2)

  // Serialise the assembled WriterDraft into rawWriterText as a
  // JSON code block, so the existing stageStyleAndAssemble reader
  // (parseWriterResponse) can consume it without changes.
  const asFence = '```json\n' + JSON.stringify(draft) + '\n```'
  const nextRun: GenerationRun = {
    ...run,
    stage: 'style', stageLabel: 'Applying house style',
    rawWriterText: asFence,
    updatedAt: new Date().toISOString(),
    stageTimings: { ...run.stageTimings, writer_assemble: Date.now() - stageStartMs },
  }
  return { ...writer, currentRun: nextRun }
}

/** If the plan didn't split sections into both parts, split by index
 *  at the median so both drafting calls stay bounded in output. */
function ensurePartBalance(plan: any): any {
  const p1 = plan.sections.filter((s: any) => s.assignedTo === 'part1')
  const p2 = plan.sections.filter((s: any) => s.assignedTo === 'part2')
  if (p1.length > 0 && p2.length > 0) return plan
  const half = Math.ceil(plan.sections.length / 2)
  const rebalanced = plan.sections.map((s: any, i: number) => ({ ...s, assignedTo: i < half ? 'part1' : 'part2' }))
  return { ...plan, sections: rebalanced }
}

type Scratchpad = {
  part1?: { conclusion: string | null; internalLinkIntents: any[]; externalLinkIntents: any[]; evidenceTrace: any[] }
  part2?: { conclusion: string | null; internalLinkIntents: any[]; externalLinkIntents: any[]; evidenceTrace: any[] }
}
function readScratchpad(rawText: string | undefined): Scratchpad {
  if (!rawText || rawText.startsWith('```')) return {}
  try { const j = JSON.parse(rawText); return (j && typeof j === 'object') ? j as Scratchpad : {} }
  catch { return {} }
}

// ─────────────────────────────────────────────────────────────────
// EIC two-stage external Writer (the current normal path)
// ─────────────────────────────────────────────────────────────────
//
// Stage 1 — research_and_write. ONE Sonnet call with web_search
// enabled. Model researches live and drafts the article in the
// same call. Output is a tiny JSON envelope; salvaged from
// Markdown if malformed. Deterministic Markdown → TipTap builds
// the StudioDocument.
//
// Stage 2 — check_and_fix. ONE Sonnet call with a small bounded
// web_search budget. Directly fixes meaningful factual risks and
// returns the corrected article. Short correctionsSummary is
// persisted; NO forensic issue list.

async function stageResearchAndWrite(writer: WriterMetadata, project: any, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const today = new Date().toISOString().slice(0, 10)
  // Best-effort — fetch existing published PokePrices insights and
  // pick up to ~10 keyword-matched candidates the model may weave
  // into the article as natural internal links. Failure is silent
  // (zero candidates is a fine result per the prompt).
  let internalLinks: Array<{ title: string; url: string }> = []
  try {
    const ctx = await buildEditorialContext()
    internalLinks = pickInternalLinkCandidates({
      project:  { title: String(project.title), angle: project.angle ?? null, articleType: String(project.article_type) },
      articles: ctx.articles,
      limit:    10,
    })
  } catch (e) {
    console.warn('[writer_research_and_write] internal-link candidate fetch failed, continuing without:', e instanceof Error ? e.message : 'unknown')
  }
  const userTurn = buildResearchAndWriteUserTurn({
    project: { id: Number(project.id), title: String(project.title), angle: project.angle ?? null, articleType: String(project.article_type) },
    today,
    internalLinks,
  })

  const call = await callAnthropicAndLog({
    feature: 'editorial_writer_research_and_write',
    model: WRITER_MODEL, system: RESEARCH_AND_WRITE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userTurn }],
    max_tokens: RESEARCH_AND_WRITE_MAX_TOKENS,
    temperature: 0.55,
    cacheSystem: true,
    webSearch: { max_uses: RESEARCH_AND_WRITE_MAX_SEARCHES },
    adminEmail, sessionId: `writer-r+w-${project.id}-${Date.now()}`,
  })
  if (!call.ok) throw new Error(`research_and_write call failed: ${call.error || 'unknown'}`)

  const parsed = parseResearchAndWriteResponse(call.text)
  if (!parsed) throw new Error('research_and_write produced no parsable article (even after salvage)')

  // Build a permissive external-URL allowlist from the sources
  // the model returned, so [anchor](href) links to those URLs
  // survive markdown → tiptap conversion.
  const allowed = new Set<string>()
  for (const s of parsed.sources) if (/^https:\/\//i.test(s.url)) allowed.add(s.url)
  const bodyDoc = markdownToStudioBodyDoc(parsed.bodyMarkdown, allowed)

  const studio: StudioDocument = {
    version:    STUDIO_DOCUMENT_VERSION,
    headline:   parsed.title,
    intro:      deriveIntroFromMarkdown(parsed.bodyMarkdown, parsed.metaDescription),
    themeKey:   'market',
    themeLabel: 'Market',
    authorName: 'PokePrices',
    seo:        { title: parsed.metaTitle || parsed.title, description: parsed.metaDescription },
    heroImage:  null,
    bodyDoc,
    updatedAt:  new Date().toISOString(),
  }

  // Persist studio_json immediately so a mid-flow browser refresh
  // sees the drafted article before the checker runs.
  const supa = getSupabaseServiceClient()
  await supa.from('editorial_projects').update({ studio_json: studio }).eq('id', project.id)

  const usage = mergeCallUsage(writer.currentRun!.usage, call)
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'check_and_fix', stageLabel: 'Checking & fixing',
    rawWriterText: call.text,   // preserved so checker can reference the model's original response
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, research_and_write: Date.now() - stageStartMs },
  }
  return {
    ...writer,
    claimTrace:       [],
    blockIntents:     [],
    assemblyWarnings: [],
    generationCost:   usage,
    externalSourceUrls: parsed.sources.map(s => s.url),
    currentRun:       run,
  }
}

async function stageCheckAndFix(writer: WriterMetadata, project: any, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const today = new Date().toISOString().slice(0, 10)
  const supa = getSupabaseServiceClient()
  const { data: pRow } = await supa.from('editorial_projects').select('studio_json').eq('id', project.id).maybeSingle()
  const studio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  if (!studio) throw new Error('check_and_fix: no studio_json to check')

  const article = {
    title:           studio.headline,
    metaTitle:       studio.seo.title,
    metaDescription: studio.seo.description,
    bodyMarkdown:    studioBodyDocToMarkdown(studio.bodyDoc),
    sources:         (writer.externalSourceUrls ?? []).map(url => ({ url })),
  }

  const call = await callAnthropicAndLog({
    feature: 'editorial_writer_check_and_fix',
    model: WRITER_MODEL, system: CHECK_AND_FIX_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildCheckAndFixUserTurn({ article, today }) }],
    max_tokens: CHECK_AND_FIX_MAX_TOKENS,
    temperature: 0.2,
    cacheSystem: true,
    webSearch: { max_uses: CHECK_AND_FIX_MAX_SEARCHES },
    adminEmail, sessionId: `writer-check-${project.id}-${Date.now()}`,
  })

  const usage = mergeCallUsage(writer.currentRun!.usage, call)
  const studioHash = hashStudioBody(studio.bodyDoc)

  // If the checker call itself failed, keep the drafted article
  // as-is and record a soft review-required factCheck so the human
  // knows to re-check manually. Do NOT nuke the draft.
  if (!call.ok) {
    const softFc: FactCheckResult = {
      version: 1, status: 'review_required', checkedAt: new Date().toISOString(),
      packRecipe: writer.packRecipe,
      issues: [{ kind: 'other', severity: 'minor', claim: 'Check & fix stage errored — draft preserved', reason: call.error ?? 'unknown', evidenceRefs: [] }],
      numericAudit: { status: 'pass', checked: 0, matched: 0, issues: [] },
      checkedStudioHash: studioHash, autoCheck: true,
    }
    const run: GenerationRun = {
      ...writer.currentRun!, stage: 'complete', stageLabel: 'Ready',
      usage, updatedAt: new Date().toISOString(),
      stageTimings: { ...writer.currentRun!.stageTimings, check_and_fix: Date.now() - stageStartMs },
    }
    return { ...writer, factCheck: softFc, checkedStudioHash: studioHash, correctionsSummary: 'Check & fix stage errored — draft preserved.', generationCost: usage, currentRun: run }
  }

  const parsed = parseCheckAndFixResponse(call.text)
  // Also tolerate a null parse — keep the drafted article and set
  // status review_required with a note.
  if (!parsed) {
    const softFc: FactCheckResult = {
      version: 1, status: 'review_required', checkedAt: new Date().toISOString(),
      packRecipe: writer.packRecipe,
      issues: [{ kind: 'other', severity: 'minor', claim: 'Checker output could not be parsed', reason: 'salvage failed', evidenceRefs: [] }],
      numericAudit: { status: 'pass', checked: 0, matched: 0, issues: [] },
      checkedStudioHash: studioHash, autoCheck: true,
    }
    const run: GenerationRun = {
      ...writer.currentRun!, stage: 'complete', stageLabel: 'Ready',
      usage, updatedAt: new Date().toISOString(),
      stageTimings: { ...writer.currentRun!.stageTimings, check_and_fix: Date.now() - stageStartMs },
    }
    return { ...writer, factCheck: softFc, checkedStudioHash: studioHash, correctionsSummary: 'Checker output could not be parsed — draft preserved.', generationCost: usage, currentRun: run }
  }

  // Rebuild the studio document from the corrected article. The
  // allowlist merges the pre-existing sources with any new URLs
  // the checker returned so its edits can add / drop / adjust
  // links without them being dropped.
  const allowed = new Set<string>()
  for (const url of writer.externalSourceUrls ?? []) if (/^https:\/\//i.test(url)) allowed.add(url)
  for (const s of parsed.sources) if (/^https:\/\//i.test(s.url)) allowed.add(s.url)
  const bodyDoc = markdownToStudioBodyDoc(parsed.bodyMarkdown, allowed)
  const nextStudio: StudioDocument = {
    ...studio,
    headline:  parsed.title || studio.headline,
    intro:     deriveIntroFromMarkdown(parsed.bodyMarkdown, parsed.metaDescription || studio.seo.description),
    seo:       { title: parsed.metaTitle || studio.seo.title, description: parsed.metaDescription || studio.seo.description },
    bodyDoc,
    updatedAt: new Date().toISOString(),
  }
  await supa.from('editorial_projects').update({ studio_json: nextStudio }).eq('id', project.id)

  const nextHash = hashStudioBody(nextStudio.bodyDoc)
  const factCheck: FactCheckResult = {
    version: 1, status: 'pass', checkedAt: new Date().toISOString(),
    packRecipe: writer.packRecipe,
    issues: [],
    numericAudit: { status: 'pass', checked: 0, matched: 0, issues: [] },
    checkedStudioHash: nextHash, autoCheck: true,
  }
  const nextUrls = Array.from(new Set([...(writer.externalSourceUrls ?? []), ...parsed.sources.map(s => s.url)]))
  const run: GenerationRun = {
    ...writer.currentRun!, stage: 'complete', stageLabel: 'Ready',
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, check_and_fix: Date.now() - stageStartMs },
  }
  return {
    ...writer,
    factCheck,
    checkedStudioHash: nextHash,
    correctionsSummary: parsed.correctionsSummary || 'No changes needed.',
    externalSourceUrls: nextUrls,
    generationCost: usage,
    currentRun: run,
  }
}

/** Shared with stageWriterExternal — derive the article deck from
 *  the first body paragraph, falling back to metaDescription when
 *  the body opens with a heading. */
function deriveIntroFromMarkdown(markdown: string, fallback: string): string {
  const blocks = (markdown ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  for (const block of blocks) {
    if (block.startsWith('#')) break
    if (/^\s*([-*]|\d+\.)\s+/.test(block)) break
    return block.replace(/[*_`>]/g, '').slice(0, 500)
  }
  return (fallback || '').slice(0, 500)
}

/** Inverse of markdownToStudioBodyDoc — flatten a TipTap bodyDoc
 *  back to Markdown for the checker stage. Preserves headings,
 *  paragraphs, and bullet/ordered lists. */
function studioBodyDocToMarkdown(bodyDoc: unknown): string {
  const parts: string[] = []
  const b: any = bodyDoc
  if (!b || !Array.isArray(b.content)) return ''
  for (const node of b.content) {
    if (!node) continue
    if (node.type === 'heading') {
      const level = Math.min(3, Math.max(2, Number(node.attrs?.level ?? 2)))
      parts.push(`${'#'.repeat(level)} ${flattenInline(node.content)}`)
    } else if (node.type === 'paragraph') {
      const text = flattenInline(node.content)
      if (text.trim()) parts.push(text)
    } else if (node.type === 'bulletList') {
      for (const li of node.content ?? []) parts.push(`- ${flattenListItem(li)}`)
    } else if (node.type === 'orderedList') {
      (node.content ?? []).forEach((li: any, i: number) => parts.push(`${i + 1}. ${flattenListItem(li)}`))
    } else if (node.type === 'blockquote') {
      parts.push(`> ${flattenInline(node.content?.[0]?.content ?? node.content)}`)
    }
  }
  return parts.join('\n\n')
}
function flattenListItem(li: any): string {
  const para = li?.content?.[0]
  if (para?.type === 'paragraph') return flattenInline(para.content)
  return flattenInline(li?.content)
}
function flattenInline(content: any[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content.map((c: any) => {
    if (typeof c?.text !== 'string') return Array.isArray(c?.content) ? flattenInline(c.content) : ''
    const text = c.text as string
    const linkMark = (c.marks ?? []).find((m: any) => m.type === 'link')
    if (linkMark && linkMark.attrs?.href) return `[${text}](${linkMark.attrs.href})`
    if ((c.marks ?? []).some((m: any) => m.type === 'bold'))   return `**${text}**`
    if ((c.marks ?? []).some((m: any) => m.type === 'italic')) return `*${text}*`
    return text
  }).join('')
}

// ─────────────────────────────────────────────────────────────────
// EIC — legacy simplified external-research Writer path (v5)
// ─────────────────────────────────────────────────────────────────
//
// ONE Sonnet call. Tiny JSON output. Deterministic Markdown-to-
// TipTap conversion. If JSON extraction fails but usable prose was
// returned, salvage it. No block intents / evidence traces / claim
// traces / plan / parts. Skips the style-repair AI call and the
// numeric audit (both were designed for internal-data articles).
// After this stage, the run advances straight to fact_check.
// Kept for in-flight runs from before the two-stage split shipped.

async function stageWriterExternal(writer: WriterMetadata, project: any, pack: EvidencePack, adminEmail: string, stageStartMs: number): Promise<WriterMetadata> {
  const userTurn = buildExternalArticleUserTurn({
    project: { id: Number(project.id), title: String(project.title), angle: project.angle ?? null, articleType: String(project.article_type) },
    pack,
  })

  const call = await callAnthropicAndLog({
    feature: 'editorial_writer_external',
    model: WRITER_MODEL, system: EXTERNAL_WRITER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userTurn }],
    max_tokens: WRITER_EXTERNAL_MAX_TOKENS, temperature: 0.55, cacheSystem: true,
    adminEmail, sessionId: `writer-ext-${project.id}-${Date.now()}`,
  })
  if (!call.ok) throw new Error(`writer_external call failed: ${call.error || 'unknown'}`)

  const parsed = parseExternalArticleResponse(call.text)
  if (!parsed) throw new Error('writer_external produced no parsable article (even after salvage)')

  const studio = buildStudioDocFromExternalArticle({ parsed, pack })

  // Persist immediately so a browser refresh mid-flow sees the draft.
  const supa = getSupabaseServiceClient()
  await supa.from('editorial_projects').update({ studio_json: studio }).eq('id', project.id)

  const usage = mergeCallUsage(writer.currentRun!.usage, call)
  // Stash the raw response text on the run so the Fact Checker
  // stage can consult it for verification if needed.
  const run: GenerationRun = {
    ...writer.currentRun!,
    stage: 'fact_check', stageLabel: 'Checking facts',
    rawWriterText: call.text,
    usage, updatedAt: new Date().toISOString(),
    stageTimings: { ...writer.currentRun!.stageTimings, writer_external: Date.now() - stageStartMs },
  }
  return {
    ...writer,
    // External articles do not carry per-claim evidence traces or
    // block intents. Reset these arrays so the Fact Checker doesn't
    // reference stale data from a prior generation.
    claimTrace:       [],
    blockIntents:     [],
    assemblyWarnings: [],
    generationCost:   usage,
    currentRun:       run,
  }
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

  // EIC — external_research skips the numeric audit entirely. It
  // was designed for internal-data articles where every price and
  // count is provable line-by-line. For external SEO pieces it
  // produced noise like "Unsupported 128. Did you mean 44?".
  const isExternal = pack.recipe === 'external_research'
  const numericAudit: NumericAuditResult = isExternal
    ? { status: 'pass', checked: 0, matched: 0, issues: [] }
    : auditStudioNumerics(studio, pack, writer.blockIntents)
  const usage = writer.currentRun!.usage
  const studioHash = hashStudioBody(studio.bodyDoc)
  const factCheck  = isExternal
    ? await runExternalFactChecker(pack, studio, {
        checkedStudioHash: studioHash, autoCheck: true, adminEmail,
        sessionId: `factcheck-ext-${projectId}-${Date.now()}`, usage,
      })
    : await runFactChecker(pack, studio, writer.claimTrace, writer.blockIntents, numericAudit, {
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
function fail(writer: WriterMetadata | null, error: string, failedStage?: GenerationStage): WriterMetadata {
  const run: GenerationRun = writer?.currentRun ? {
    ...writer.currentRun, stage: 'failed', stageLabel: 'Failed',
    error, failedStage: failedStage ?? writer.currentRun.stage,
    updatedAt: new Date().toISOString(),
  } : {
    id: `run_failed_${Date.now()}`, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    stage: 'failed', stageLabel: 'Failed', error, failedStage, usage: emptyUsage(),
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

// EIC — lightweight external-research Fact Checker call. Uses the
// smaller EXTERNAL_FACT_CHECKER_SYSTEM_PROMPT and skips the
// per-claim / numeric machinery. Caps returned issues at 5 as a
// belt-and-braces guard against a chatty model.

async function runExternalFactChecker(
  pack: EvidencePack, studio: StudioDocument,
  opts: { checkedStudioHash: string; autoCheck: boolean; adminEmail: string; sessionId: string; usage: WriterUsage },
): Promise<FactCheckResult> {
  const articleText = flattenStudioToPlainText(studio.bodyDoc)
  const userTurn = buildExternalFactCheckerUserTurn({
    articleText,
    headline:       studio.headline,
    seoTitle:       studio.seo.title,
    seoDescription: studio.seo.description,
    pack,
  })
  const call = await callAnthropicAndLog({
    feature:  'editorial_writer_fact_check_external',
    model:    WRITER_MODEL, system: EXTERNAL_FACT_CHECKER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userTurn }],
    max_tokens: 2000, temperature: 0.15, cacheSystem: true,
    adminEmail: opts.adminEmail, sessionId: opts.sessionId,
  })
  const empty: NumericAuditResult = { status: 'pass', checked: 0, matched: 0, issues: [] }
  if (!call.ok) {
    return {
      version: 1, status: 'review_required', checkedAt: new Date().toISOString(),
      packRecipe: pack.recipe,
      issues: [{ kind: 'other', severity: 'major', claim: 'External Fact Checker call failed', reason: call.error ?? 'unknown', evidenceRefs: [] }],
      numericAudit: empty, checkedStudioHash: opts.checkedStudioHash, autoCheck: opts.autoCheck,
    }
  }
  addCallUsage(opts.usage, call)
  const parsed = parseFactCheckerResponse(call.text, pack, empty, { checkedStudioHash: opts.checkedStudioHash, autoCheck: opts.autoCheck })
  // Cap issue count at 5 for external — Fact Checker was told not
  // to produce more, but we don't rely on that alone.
  const rank = { critical: 0, major: 1, minor: 2 } as const
  parsed.issues = parsed.issues.slice().sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 5)
  return parsed
}

/** Flatten a TipTap bodyDoc into readable plain text for the
 *  Fact Checker. Preserves paragraph breaks + heading structure. */
function flattenStudioToPlainText(bodyDoc: unknown): string {
  const out: string[] = []
  const walk = (node: any) => {
    if (!node) return
    if (node.type === 'heading') {
      const text = collectText(node.content)
      out.push('\n## ' + text + '\n')
      return
    }
    if (node.type === 'paragraph') {
      const text = collectText(node.content)
      if (text.trim()) out.push(text)
      return
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      for (const li of node.content ?? []) {
        const text = collectText(li.content?.[0]?.content ?? li.content ?? [])
        if (text.trim()) out.push('- ' + text)
      }
      return
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c)
  }
  walk(bodyDoc)
  return out.join('\n\n')
}
function collectText(content: any[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content.map(c => (typeof c?.text === 'string' ? c.text : (Array.isArray(c?.content) ? collectText(c.content) : ''))).join('')
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
