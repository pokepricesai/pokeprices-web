// src/lib/editorial/publishing/actions.ts
//
// EIC Block 10 — server-side publication actions.
//
// Every action rebuilds preflight immediately before mutating the
// database. Clients only send { projectId, action, slugOverride? };
// the server constructs the actual payload from trusted
// studio_json + writer_json + research state.
//
// Every mutation goes through the eic_finalize_article RPC so the
// insights row + editorial_projects row change atomically.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { runPublicationPreflight, type PreflightResult } from './preflight'
import type { InsightPayload } from './payload'
import { runPostPublish, revalidateInsightPaths, type PostPublishWarning } from './revalidate'
import { hashStudioBody } from '@/lib/editorial/writer/hash'
import type { StudioDocument } from '@/lib/studio/types'
import type { WriterMetadata, EditorialOverride } from '@/lib/editorial/writer/types'
import { getEditorialMode } from '../editorialMode'
import { fetchProject } from '../research/serverActions'

export type PublicationActionKind =
  | 'prepare_draft'
  | 'publish'
  | 'update_published'
  | 'unpublish'
  | 'mark_ready'
  /** Admin has manually reviewed the article and is consciously
   *  overriding the automated fact-check / numeric-audit gates so
   *  the article can proceed to Ready. Internal projects only. */
  | 'override_checks'
  /** Admin is retracting an active override — the normal automated
   *  gates apply again. */
  | 'clear_override'

export type ActionResult = {
  ok:        true
  action:    PublicationActionKind
  preflight: PreflightResult
  insightsId?: string | null
  slug?:     string
  warnings?: PostPublishWarning[]
}

export async function runPublicationAction(
  projectId: number,
  action: PublicationActionKind,
  opts: { slugOverride?: string; adminEmail: string } = { adminEmail: '' },
): Promise<ActionResult> {
  const supa = getSupabaseServiceClient()

  // ── override_checks — internal only; admin manually attests that
  //    the article is publishable despite unresolved automated
  //    checks. Records who / when / against which body hash so the
  //    override is auto-cleared if the article is regenerated. Does
  //    NOT bypass research approval, CMS essentials, slug validity,
  //    or adapter conversion — see preflight.ts. ──
  if (action === 'override_checks' || action === 'clear_override') {
    const project = await fetchProject(projectId)
    if (!project) throw new Error('project not found')
    const isExternal = getEditorialMode({ article_type: project.article_type, title: project.title, angle: project.angle }) === 'external'
    if (isExternal) throw new Error('editorial override is only supported on internal projects')

    const { data: pRow } = await supa.from('editorial_projects').select('studio_json, writer_json').eq('id', projectId).maybeSingle()
    const studio = ((pRow as any)?.studio_json ?? null) as StudioDocument | null
    if (!studio) throw new Error('no studio_json — cannot override checks on an empty draft')
    const writer = ((pRow as any)?.writer_json ?? null) as WriterMetadata | null
    if (!writer) throw new Error('no writer_json — generate an article first')

    let nextWriter: WriterMetadata
    if (action === 'override_checks') {
      const fc = writer.factCheck
      const bodyHash = hashStudioBody(studio.bodyDoc)
      const override: EditorialOverride = {
        active:                true,
        overriddenAt:          new Date().toISOString(),
        overriddenBy:          opts.adminEmail || 'unknown',
        reason:                'manual_editorial_review',
        overriddenBodyHash:    bodyHash,
        factCheckStatusAtOverride: fc?.status,
        unresolvedIssueCount:  (fc?.issues?.length ?? 0) + (fc?.numericAudit?.issues?.length ?? 0),
        numericIssueCount:     fc?.numericAudit?.issues?.length,
      }
      nextWriter = { ...writer, editorialOverride: override }
    } else {
      // clear_override — drop the field entirely.
      const { editorialOverride: _drop, ...rest } = writer
      nextWriter = rest as WriterMetadata
    }

    const { error } = await supa.from('editorial_projects')
      .update({ writer_json: nextWriter, updated_at: new Date().toISOString() })
      .eq('id', projectId)
    if (error) throw new Error(error.message)

    const pf = await runPublicationPreflight(projectId, { slugOverride: opts.slugOverride })
    return { ok: true, action, preflight: pf }
  }

  // ── mark_ready — the only action that does NOT touch insights ──
  if (action === 'mark_ready') {
    const pf = await runPublicationPreflight(projectId, { slugOverride: opts.slugOverride })
    if (pf.status !== 'pass') throw new Error(`preflight failed; cannot mark ready: ${firstBlocker(pf)}`)
    const { error } = await supa.from('editorial_projects')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .eq('id', projectId)
    if (error) throw new Error(error.message)
    return { ok: true, action, preflight: pf }
  }

  // ── unpublish — no re-preflight required (we are lowering
  //    visibility, not making a fresh publication claim). ──
  if (action === 'unpublish') {
    const { data: row } = await supa.from('editorial_projects').select('insights_id, studio_json').eq('id', projectId).maybeSingle()
    const linked = (row as any)?.insights_id as string | null
    if (!linked) throw new Error('project has no linked insight to unpublish')
    // Build a minimal payload for the RPC using the existing
    // insights row's data — call the RPC with just the slug.
    const { data: art } = await supa.from('insights').select('*').eq('id', linked).maybeSingle()
    if (!art) throw new Error('linked insight not found')
    const { error } = await supa.rpc('eic_finalize_article', {
      p_project_id: projectId,
      p_action:     'unpublished',
      p_payload:    articleRowToRpcPayload(art),
    })
    if (error) throw new Error(`eic_finalize_article: ${error.message}`)
    const warnings = revalidateInsightPaths((art as any).slug)
    const pf = await runPublicationPreflight(projectId, { slugOverride: opts.slugOverride })
    return { ok: true, action, preflight: pf, insightsId: linked, slug: (art as any).slug, warnings }
  }

  // ── prepare_draft / publish / update_published all go through
  //    preflight → payload → RPC. ──
  const pf = await runPublicationPreflight(projectId, { slugOverride: opts.slugOverride })
  if (!pf.payloadPreview) throw new Error('preflight produced no payload preview')

  // Publishing gates are strict: 'pass' required.
  const requiresPass = action === 'publish' || action === 'update_published'
  if (requiresPass && pf.status !== 'pass') {
    throw new Error(`preflight failed; cannot ${action}: ${firstBlocker(pf)}`)
  }
  // Draft preparation may proceed with warnings but not with the
  // critical Studio-level blockers (missing headline/intro/body,
  // invalid slug). The preflight already tags those as blockers.
  if (action === 'prepare_draft' && pf.status !== 'pass') {
    const criticalIds = ['studio.exists', 'studio.headline', 'studio.intro', 'studio.body', 'slug.valid', 'slug.unique', 'adapter.clean']
    const criticalBlock = pf.checks.find(c => c.severity === 'blocker' && criticalIds.includes(c.id))
    if (criticalBlock) throw new Error(`cannot prepare draft: ${criticalBlock.detail ?? criticalBlock.label}`)
  }

  const payload: InsightPayload = pf.payloadPreview
  // Force the right status for the target action; preflight always
  // built a draft-shaped payload.
  payload.status = action === 'publish' || action === 'update_published' ? 'published' : 'draft'
  payload.slug   = opts.slugOverride?.trim() || payload.slug

  const rpcAction = payload.status === 'published' ? 'published' : 'draft'
  const wasFirstPublish = !pf.linkedInsightsId && action === 'publish'

  const { data: rpcData, error: rpcErr } = await supa.rpc('eic_finalize_article', {
    p_project_id: projectId,
    p_action:     rpcAction,
    p_payload:    payloadToRpcJson(payload),
  })
  if (rpcErr) throw new Error(`eic_finalize_article: ${rpcErr.message}`)
  const insightsId = (rpcData as any)?.insights_id ?? pf.linkedInsightsId ?? null

  // Revalidation + IndexNow.
  const warnings: PostPublishWarning[] = payload.status === 'published'
    ? (await runPostPublish({ slug: payload.slug, wasFirstPublish })).warnings
    : revalidateInsightPaths(payload.slug)

  // Refresh preflight to reflect the new linkage.
  const finalPf = await runPublicationPreflight(projectId, { slugOverride: payload.slug })
  return { ok: true, action, preflight: finalPf, insightsId, slug: payload.slug, warnings }
}

function firstBlocker(pf: PreflightResult): string {
  const b = pf.checks.find(c => c.severity === 'blocker')
  return b ? `${b.label} — ${b.detail ?? ''}`.trim() : 'unknown blocker'
}

function payloadToRpcJson(p: InsightPayload): Record<string, unknown> {
  return {
    slug:             p.slug,
    headline:         p.headline,
    intro:            p.intro,
    theme:            p.theme ?? '',
    theme_label:      p.theme_label,
    meta_title:       p.meta_title,
    meta_description: p.meta_description,
    hero_image_query: p.hero_image_query,
    body_json:        p.body_json,
    image_url:        p.image_url ?? '',
    author:           p.author ?? '',
    read_time_mins:   p.read_time_mins != null ? String(p.read_time_mins) : '',
    seo_title:        p.seo_title ?? '',
    seo_description:  p.seo_description ?? '',
    card_refs:        p.card_refs,
    set_refs:         p.set_refs,
  }
}

function articleRowToRpcPayload(row: any): Record<string, unknown> {
  return {
    slug:             row.slug,
    headline:         row.headline,
    intro:            row.intro,
    theme:            row.theme ?? '',
    theme_label:      row.theme_label,
    meta_title:       row.meta_title,
    meta_description: row.meta_description,
    hero_image_query: row.hero_image_query,
    body_json:        row.body_json,
    image_url:        row.image_url ?? '',
    author:           row.author ?? '',
    read_time_mins:   row.read_time_mins != null ? String(row.read_time_mins) : '',
    seo_title:        row.seo_title ?? '',
    seo_description:  row.seo_description ?? '',
    card_refs:        row.card_refs ?? [],
    set_refs:         row.set_refs  ?? [],
  }
}
