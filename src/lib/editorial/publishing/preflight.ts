// src/lib/editorial/publishing/preflight.ts
//
// EIC Block 10 — publication preflight.
//
// Deterministic server-side gate. Nothing here calls an AI model.
// Every failure has a specific check id so the Studio UI can render
// exactly what needs fixing.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { fetchProject, fetchResearch } from '../research/serverActions'
import type { StudioDocument } from '@/lib/studio/types'
import type { WriterMetadata, FactCheckResult } from '@/lib/editorial/writer/types'
import type { EvidencePack } from '../research/types'
import { studioProjectToInsightPayload, type InsightPayload } from './payload'
import { generateSlug, isValidSlug } from './slug'
import { hashStudioBody } from '@/lib/editorial/writer/hash'

// ─────────────────────────────────────────────────────────────────
// Result shapes
// ─────────────────────────────────────────────────────────────────

export type PreflightSeverity = 'blocker' | 'warning' | 'ok'

export type PreflightCheck = {
  id:       string
  label:    string
  severity: PreflightSeverity
  detail?:  string
}

export type PreflightResult = {
  status:  'pass' | 'blocked'
  checks:  PreflightCheck[]
  warnings: PreflightCheck[]
  payloadPreview: InsightPayload | null
  linkedInsightsId: string | null
  suggestedSlug: string
  currentStudioHash: string
}

// ─────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────

export type PreflightOptions = {
  /** Admin-provided slug override. Defaults to slugify(headline). */
  slugOverride?: string
  /** True when preflight is being run in "update published article"
   *  mode — an existing insights_id is expected. */
  expectingUpdate?: boolean
}

export async function runPublicationPreflight(projectId: number, opts: PreflightOptions = {}): Promise<PreflightResult> {
  const checks:   PreflightCheck[] = []
  const warnings: PreflightCheck[] = []

  const project = await fetchProject(projectId)
  if (!project) {
    return {
      status: 'blocked',
      checks: [{ id: 'project.exists', label: 'Project exists', severity: 'blocker', detail: 'project not found' }],
      warnings: [], payloadPreview: null, linkedInsightsId: null, suggestedSlug: '', currentStudioHash: '',
    }
  }

  // ── Research approved ──
  const research = await fetchResearch(projectId)
  if (!research || research.status !== 'approved') {
    checks.push({ id: 'research.approved', label: 'Research is approved', severity: 'blocker', detail: `status: ${research?.status ?? 'not_started'}` })
  } else {
    checks.push({ id: 'research.approved', label: 'Research is approved', severity: 'ok' })
  }
  const pack = (research?.evidence_json ?? null) as EvidencePack | null
  if (pack && !pack.quality.publishable) {
    checks.push({ id: 'research.publishable', label: 'Research pack is publishable', severity: 'blocker', detail: pack.quality.reasons.join(' · ').slice(0, 300) })
  } else if (pack) {
    checks.push({ id: 'research.publishable', label: 'Research pack is publishable', severity: 'ok' })
  }

  // ── Studio present + meaningful ──
  const supa = getSupabaseServiceClient()
  const { data: pRow } = await supa.from('editorial_projects').select('studio_json, writer_json, insights_id, status').eq('id', projectId).maybeSingle()
  const studio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
  const writer = ((pRow as any)?.writer_json ?? null) as WriterMetadata | null
  const linkedInsightsId = (pRow as any)?.insights_id as string | null

  if (!studio) {
    checks.push({ id: 'studio.exists', label: 'Studio draft exists', severity: 'blocker', detail: 'no studio_json' })
    return earlyReturn(checks, warnings, null, linkedInsightsId, '', '')
  }
  checks.push({ id: 'studio.exists', label: 'Studio draft exists', severity: 'ok' })

  if (!studio.headline?.trim()) checks.push({ id: 'studio.headline',      label: 'Headline present', severity: 'blocker', detail: 'headline is empty' })
  else                          checks.push({ id: 'studio.headline',      label: 'Headline present', severity: 'ok' })
  if (!studio.intro?.trim())    checks.push({ id: 'studio.intro',         label: 'Intro present',    severity: 'blocker', detail: 'intro is empty' })
  else                          checks.push({ id: 'studio.intro',         label: 'Intro present',    severity: 'ok' })

  const bodyMeaningful = hasMeaningfulBody(studio)
  if (!bodyMeaningful) checks.push({ id: 'studio.body', label: 'Meaningful body present', severity: 'blocker', detail: 'body has no headings, blocks, or non-empty paragraphs' })
  else                 checks.push({ id: 'studio.body', label: 'Meaningful body present', severity: 'ok' })

  // ── Slug ──
  const suggestedSlug = opts.slugOverride?.trim() || generateSlug(studio.headline)
  if (!isValidSlug(suggestedSlug)) {
    checks.push({ id: 'slug.valid', label: 'Slug format valid', severity: 'blocker', detail: `slug "${suggestedSlug}" fails validation` })
  } else {
    checks.push({ id: 'slug.valid', label: 'Slug format valid', severity: 'ok' })
  }
  // Uniqueness: excluding the currently linked insights_id.
  const { data: slugRow } = await supa.from('insights').select('id, status').eq('slug', suggestedSlug).maybeSingle()
  if (slugRow && (slugRow as any).id !== linkedInsightsId) {
    checks.push({ id: 'slug.unique', label: 'Slug is available', severity: 'blocker', detail: `slug already used by another article (id ${(slugRow as any).id.slice(0, 8)}…)` })
  } else {
    checks.push({ id: 'slug.unique', label: 'Slug is available', severity: 'ok' })
  }

  // ── Fact check present, pass, and current ──
  const fc = writer?.factCheck ?? null
  const currentStudioHash = hashStudioBody(studio.bodyDoc)
  if (!fc) {
    checks.push({ id: 'factcheck.present', label: 'Fact check has been run', severity: 'blocker', detail: 'no fact check recorded' })
  } else {
    checks.push({ id: 'factcheck.present', label: 'Fact check has been run', severity: 'ok' })
    if (fc.status !== 'pass') {
      checks.push({ id: 'factcheck.pass', label: 'Fact check status = pass', severity: 'blocker', detail: `status: ${fc.status}` })
    } else {
      checks.push({ id: 'factcheck.pass', label: 'Fact check status = pass', severity: 'ok' })
    }
    if (writer?.checkedStudioHash && writer.checkedStudioHash !== currentStudioHash) {
      checks.push({ id: 'factcheck.current', label: 'Fact check matches current draft', severity: 'blocker', detail: 'Fact check is out of date — draft has changed since the last check' })
    } else {
      checks.push({ id: 'factcheck.current', label: 'Fact check matches current draft', severity: 'ok' })
    }
    if (fc.numericAudit.issues.length > 0) {
      checks.push({ id: 'factcheck.numeric', label: '0 unsupported numeric claims', severity: 'blocker', detail: `${fc.numericAudit.issues.length} numeric issue(s) unresolved` })
    } else {
      checks.push({ id: 'factcheck.numeric', label: '0 unsupported numeric claims', severity: 'ok' })
    }
  }

  // ── Payload assembly ──
  const status: 'draft' | 'published' = 'draft'   // preview always builds a draft-shaped payload
  const built = studioProjectToInsightPayload({ studio, writer, pack, preferredSlug: suggestedSlug, status })

  // ── Adapter conversion issues ──
  const criticalConversion = built.adapterWarnings.filter(w => w.kind === 'invalid_doc' || w.kind === 'unsupported_node')
  if (criticalConversion.length > 0) {
    checks.push({ id: 'adapter.clean', label: 'Studio → body conversion clean', severity: 'blocker', detail: `${criticalConversion.length} unsupported node(s) would be dropped from the published body` })
  } else {
    checks.push({ id: 'adapter.clean', label: 'Studio → body conversion clean', severity: 'ok' })
  }
  for (const w of built.adapterWarnings.filter(w => w.kind !== 'invalid_doc' && w.kind !== 'unsupported_node')) {
    warnings.push({ id: 'adapter.warning', label: `Adapter warning: ${w.kind}`, severity: 'warning', detail: `${w.path}: ${w.detail}` })
  }

  // ── Evidence restrictions on the built body ──
  if (pack) {
    const bodyString = JSON.stringify(built.payload.body_json)
    // Reject any quarantined row that leaked into the body (by
    // comparing rowSnapshot to the built rows). Belt-and-braces:
    // the factories already exclude them, but a hand-authored data
    // block could theoretically slip past.
    for (const q of pack.quarantinedRows) {
      const rowKey = JSON.stringify(q.rowSnapshot)
      if (bodyString.includes(rowKey)) {
        checks.push({ id: 'evidence.quarantined', label: 'No quarantined evidence in body', severity: 'blocker', detail: `quarantined row ${q.id} appears in the body` })
        break
      }
    }
    if (!checks.some(c => c.id === 'evidence.quarantined')) checks.push({ id: 'evidence.quarantined', label: 'No quarantined evidence in body', severity: 'ok' })

    // Reject-claim detection — string-substring against the body prose.
    let rejectedHit: string | null = null
    for (const r of pack.rejectedClaims) {
      const needle = r.claim.replace(/[.,;:!?()\-]/g, '').toLowerCase()
      const hay    = plainTextFromBody(built.payload.body_json).replace(/[.,;:!?()\-]/g, '').toLowerCase()
      if (needle.length > 15 && hay.includes(needle.slice(0, Math.min(needle.length, 60)))) { rejectedHit = r.claim; break }
    }
    if (rejectedHit) {
      checks.push({ id: 'evidence.rejected', label: 'No rejected claim used in body', severity: 'blocker', detail: `rejected claim detected: "${rejectedHit.slice(0, 120)}"` })
    } else {
      checks.push({ id: 'evidence.rejected', label: 'No rejected claim used in body', severity: 'ok' })
    }
  }

  // ── SEO ──
  if (!built.payload.seo_title)       checks.push({ id: 'seo.title',       label: 'SEO title present',       severity: 'blocker', detail: 'seo_title fallback also empty' })
  else                                checks.push({ id: 'seo.title',       label: 'SEO title present',       severity: 'ok' })
  if (!built.payload.seo_description) checks.push({ id: 'seo.description', label: 'Meta description present', severity: 'blocker', detail: 'seo_description fallback also empty' })
  else                                checks.push({ id: 'seo.description', label: 'Meta description present', severity: 'ok' })

  // ── Warnings ──
  if (!built.payload.image_url)       warnings.push({ id: 'hero.missing', label: 'Hero image missing', severity: 'warning', detail: 'article renders without a hero; consider uploading one' })
  for (const w of built.warnings)     warnings.push({ id: 'payload.warning', label: 'Payload warning', severity: 'warning', detail: w })

  const blocked = checks.some(c => c.severity === 'blocker')
  return {
    status: blocked ? 'blocked' : 'pass',
    checks, warnings,
    payloadPreview: built.payload,
    linkedInsightsId,
    suggestedSlug,
    currentStudioHash,
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function earlyReturn(checks: PreflightCheck[], warnings: PreflightCheck[], payload: InsightPayload | null, linked: string | null, slug: string, hash: string): PreflightResult {
  const blocked = checks.some(c => c.severity === 'blocker')
  return { status: blocked ? 'blocked' : 'pass', checks, warnings, payloadPreview: payload, linkedInsightsId: linked, suggestedSlug: slug, currentStudioHash: hash }
}

function hasMeaningfulBody(doc: StudioDocument | null): boolean {
  if (!doc) return false
  const b: any = doc.bodyDoc
  if (!b || !Array.isArray(b.content)) return false
  return b.content.some((n: any) => {
    if (n?.type === 'heading' || n?.type === 'dataBlock' || n?.type === 'blockquote' || n?.type === 'bulletList' || n?.type === 'orderedList') return true
    if (n?.type === 'paragraph' && Array.isArray(n.content)) return n.content.some((c: any) => typeof c?.text === 'string' && c.text.trim().length > 0)
    return false
  })
}

function plainTextFromBody(body: { blocks: any[] }): string {
  const parts: string[] = []
  for (const b of body.blocks) {
    if (b.type === 'paragraph' && Array.isArray(b.content)) for (const s of b.content) if (s?.text) parts.push(s.text)
    if (b.type === 'heading') parts.push(String(b.text ?? ''))
    if (b.type === 'quote' && Array.isArray(b.content)) for (const s of b.content) if (s?.text) parts.push(s.text)
    if (b.type === 'list'  && Array.isArray(b.items))   for (const item of b.items) if (Array.isArray(item)) for (const s of item) if (s?.text) parts.push(s.text)
  }
  return parts.join(' ')
}
