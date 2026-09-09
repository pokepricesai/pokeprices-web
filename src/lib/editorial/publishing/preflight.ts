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
import type { WriterMetadata, FactCheckResult, EditorialOverride } from '@/lib/editorial/writer/types'
import type { EvidencePack } from '../research/types'
import { studioProjectToInsightPayload, type InsightPayload } from './payload'
import { generateSlug, isValidSlug } from './slug'
import { hashStudioBody } from '@/lib/editorial/writer/hash'
import { getEditorialMode } from '../editorialMode'

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
  /** Present when the admin has recorded an editorial override for
   *  the current draft. Studio UI uses this to render the
   *  attribution banner + suppress "Override" affordances when
   *  already overridden. Internal projects only. */
  editorialOverride?: (EditorialOverride & { boundToCurrentDraft: boolean }) | null
  /** Simplified-HQ scheduling state. The Studio Publication panel
   *  reads these to decide whether to show Sign Off, Publish Now +
   *  Schedule, or a Scheduled banner. */
  signedOffAt?:        string | null
  signedOffBy?:        string | null
  scheduledPublishAt?: string | null
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

  // EIC cleanup — canonical mode routing. External SEO / news / new-
  // set articles are researched and written externally (Deep Research)
  // and only need CMS essentials at publish time; they must not be
  // blocked by internal EvidencePack / writer / factcheck gates.
  const mode = getEditorialMode({
    article_type: project.article_type,
    title:        project.title,
    angle:        project.angle,
  })
  const isExternal = mode === 'external'

  // ── Research approved (INTERNAL ONLY) ──
  //
  // Simplified-HQ policy: automated Research approval + pack quality
  // no longer block publication. The admin decides. These checks
  // still surface as informational warnings so the Studio UI can
  // display whatever the pipeline learned, but they cannot veto
  // Publish. External articles remain unaffected (they never ran
  // these checks in the first place).
  const research = isExternal ? null : await fetchResearch(projectId)
  if (!isExternal) {
    if (!research || research.status !== 'approved') {
      warnings.push({ id: 'research.approved', label: 'Research is approved', severity: 'warning', detail: `status: ${research?.status ?? 'not_started'}` })
    }
    // No "ok" check emitted — this is a warning-only signal now.
  }
  const pack = (research?.evidence_json ?? null) as EvidencePack | null
  if (!isExternal) {
    if (pack && !pack.quality.publishable) {
      warnings.push({ id: 'research.publishable', label: 'Research pack is publishable', severity: 'warning', detail: pack.quality.reasons.join(' · ').slice(0, 300) })
    }
  }

  // ── Studio present + meaningful ──
  const supa = getSupabaseServiceClient()
  const { data: pRow } = await supa.from('editorial_projects').select('studio_json, writer_json, insights_id, status, signed_off_at, signed_off_by, scheduled_publish_at').eq('id', projectId).maybeSingle()
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

  // ── Fact check present, pass, and current (INTERNAL ONLY) ──
  //
  // Simplified-HQ policy: automated fact/numeric checks are advisory
  // for internal projects. They surface as warnings so the Studio UI
  // can still show what the checker learned, but they NEVER veto
  // Publish. The editorial override is honoured for backward-
  // compatibility (older drafts may still carry it) but is no longer
  // required. External articles are unaffected — they don't run
  // these checks at all.
  const fc = writer?.factCheck ?? null
  const currentStudioHash = hashStudioBody(studio.bodyDoc)
  const override = writer?.editorialOverride ?? null
  const overrideActive = !!(override && override.active && override.overriddenBodyHash === currentStudioHash)
  const overrideNote  = overrideActive ? ` — overridden by ${override!.overriddenBy} on ${override!.overriddenAt.slice(0, 10)}` : ''
  if (!isExternal) {
    if (!fc) {
      warnings.push({ id: 'factcheck.present', label: 'Fact check has been run', severity: 'warning', detail: `no fact check recorded${overrideNote}` })
    } else {
      if (fc.status !== 'pass') {
        warnings.push({ id: 'factcheck.pass', label: 'Fact check status = pass', severity: 'warning', detail: `status: ${fc.status}${overrideNote}` })
      }
      if (writer?.checkedStudioHash && writer.checkedStudioHash !== currentStudioHash) {
        warnings.push({ id: 'factcheck.current', label: 'Fact check matches current draft', severity: 'warning', detail: `Fact check is out of date — draft has changed since the last check${overrideNote}` })
      }
      if (fc.numericAudit.issues.length > 0) {
        warnings.push({ id: 'factcheck.numeric', label: '0 unsupported numeric claims', severity: 'warning', detail: `${fc.numericAudit.issues.length} numeric issue(s) unresolved${overrideNote}` })
      }
    }
    if (overrideActive) {
      warnings.push({
        id: 'factcheck.override',
        label: `Automated checks overridden`,
        severity: 'warning',
        detail: `${override!.overriddenBy} on ${override!.overriddenAt.slice(0, 10)}${override!.unresolvedIssueCount ? ` — ${override!.unresolvedIssueCount} unresolved issue(s) at time of override` : ''}. Override is bound to the current draft; regenerating the article will clear it.`,
      })
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

  // External Research Fix — freshness warning for release/news pieces.
  // Rules stay simple + article-type aware:
  //   * external_research + upcoming_set/new_set/news → warn > 7d
  //   * external_research otherwise (evergreen)       → warn > 60d
  //   * other recipes                                 → no warning
  if (pack?.recipe === 'external_research' && pack.webResearch?.researchedAt) {
    const researchedDays = Math.floor((Date.now() - Date.parse(pack.webResearch.researchedAt)) / (24 * 60 * 60 * 1000))
    const t = (project.article_type ?? '').toLowerCase()
    const currentEvent = t === 'upcoming_set' || t === 'new_set' || t === 'release_news' || t === 'news' || t === 'product_announcement' || t === 'set_preview'
    const staleThreshold = currentEvent ? 7 : 60
    if (researchedDays > staleThreshold) {
      warnings.push({
        id: 'research.stale',
        label: 'Web research is stale',
        severity: 'warning',
        detail: `Web research last ran ${researchedDays} days ago (threshold ${staleThreshold}d for ${currentEvent ? 'release/news' : 'evergreen'}). Consider "Refresh web research" before publishing.`,
      })
    }
  }
  if (pack?.contradictions && pack.contradictions.length > 0) {
    warnings.push({
      id: 'research.contradictions',
      label: 'Unresolved source contradictions',
      severity: 'warning',
      detail: `${pack.contradictions.length} contradiction(s) in the evidence. Confirm the article surfaces every disagreement in prose.`,
    })
  }

  const blocked = checks.some(c => c.severity === 'blocker')
  return {
    status: blocked ? 'blocked' : 'pass',
    checks, warnings,
    payloadPreview: built.payload,
    linkedInsightsId,
    suggestedSlug,
    currentStudioHash,
    editorialOverride: override ? { ...override, boundToCurrentDraft: overrideActive } : null,
    signedOffAt:        (pRow as any)?.signed_off_at        ?? null,
    signedOffBy:        (pRow as any)?.signed_off_by        ?? null,
    scheduledPublishAt: (pRow as any)?.scheduled_publish_at ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function earlyReturn(checks: PreflightCheck[], warnings: PreflightCheck[], payload: InsightPayload | null, linked: string | null, slug: string, hash: string): PreflightResult {
  const blocked = checks.some(c => c.severity === 'blocker')
  return { status: blocked ? 'blocked' : 'pass', checks, warnings, payloadPreview: payload, linkedInsightsId: linked, suggestedSlug: slug, currentStudioHash: hash, editorialOverride: null }
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
