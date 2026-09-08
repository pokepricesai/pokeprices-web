// src/app/api/admin/editorial/research/[projectId]/route.ts
//
// EIC Block 6 — Research & Evidence Engine API.
//
//   GET  /api/admin/editorial/research/[projectId]
//     Return the current evidence_pack + analysis (or null both).
//
//   POST /api/admin/editorial/research/[projectId]
//     Dispatcher. Body: { action: string, ...payload }
//     Actions:
//       * build                 — first-time build; fails if a pack exists
//       * rebuild               — rebuild; refuses to overwrite an
//                                 approved pack unless force=true
//       * analyze               — run AI Research Analyst on the current pack
//       * approve               — human approval gate. refuses blocked packs
//       * revoke                — revoke approval
//       * add_external_source   — { url, title, publisher?, publicationDate?, note?, supportsFactId? }
//       * remove_external_source — { sourceId }
//       * add_note              — { body }
//       * remove_note           — { noteId }

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'
import {
  fetchProject, fetchResearch,
  buildResearchForProject, analyzeResearchForProject,
  approveResearch, revokeResearchApproval,
  addExternalSource, removeExternalSource,
  addResearchNote, removeResearchNote,
  approveLargeMover, revokeLargeMover,
  researchWebForProject, clearDiscoveredSources,
  reExtractFactsForProject,
} from '@/lib/editorial/research/serverActions'
import { chooseRecipe } from '@/lib/editorial/research/dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_NAMESPACE = 'api/admin/editorial/research'
const RATE_LIMIT     = 60
const RATE_WINDOW_MS = 5 * 60 * 1000

type Ctx = { params: Promise<{ projectId: string }> }

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status })
}

function parseProjectId(raw: string): number | null {
  if (!/^\d{1,12}$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

export async function GET(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  const { projectId: raw } = await ctx.params
  const projectId = parseProjectId(raw)
  if (projectId == null) return bad(400, 'invalid projectId')

  try {
    const project  = await fetchProject(projectId)
    if (!project) return bad(404, 'project not found')
    const research = await fetchResearch(projectId)
    const recipe   = chooseRecipe({
      id: project.id, title: project.title, angle: project.angle,
      articleType: project.article_type, targetPublishAt: project.target_publish_at,
    })
    return NextResponse.json({ ok: true, project, research, chosenRecipe: recipe })
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown')
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  const rate = checkAdminRateLimit(RATE_NAMESPACE, admin.email, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.ok) return NextResponse.json({ ok: false, error: `Rate limit exceeded. Try again in ${rate.retryAfter}s.` }, { status: 429, headers: { 'retry-after': String(rate.retryAfter) } })

  const { projectId: raw } = await ctx.params
  const projectId = parseProjectId(raw)
  if (projectId == null) return bad(400, 'invalid projectId')

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> }
  catch { return bad(400, 'Invalid JSON') }

  const action = typeof body.action === 'string' ? body.action : ''
  try {
    switch (action) {
      case 'build': {
        const r = await buildResearchForProject(projectId, { rebuild: false, today: strOrUndef(body.today) })
        return NextResponse.json({ ok: true, research: r.row, recipe: r.recipe })
      }
      case 'rebuild': {
        const r = await buildResearchForProject(projectId, { rebuild: true, force: body.force === true, today: strOrUndef(body.today) })
        return NextResponse.json({ ok: true, research: r.row, recipe: r.recipe })
      }
      case 'analyze': {
        const r = await analyzeResearchForProject(projectId, admin.email)
        return NextResponse.json({ ok: true, research: r.row, analysis: r.analysis, styleRepairFired: r.styleRepairFired, usage: r.usage })
      }
      case 'approve': {
        const row = await approveResearch(projectId, admin.email)
        return NextResponse.json({ ok: true, research: row })
      }
      case 'revoke': {
        const row = await revokeResearchApproval(projectId)
        return NextResponse.json({ ok: true, research: row })
      }
      case 'add_external_source': {
        const source = {
          url:             strOrEmpty(body.url),
          title:           strOrEmpty(body.title),
          publisher:       strOrUndef(body.publisher),
          publicationDate: strOrUndef(body.publicationDate),
          note:            strOrUndef(body.note),
          supportsFactId:  strOrUndef(body.supportsFactId),
        }
        const row = await addExternalSource(projectId, source, admin.email)
        return NextResponse.json({ ok: true, research: row })
      }
      case 'remove_external_source': {
        const sourceId = strOrEmpty(body.sourceId)
        if (!sourceId) return bad(400, 'sourceId required')
        const row = await removeExternalSource(projectId, sourceId)
        return NextResponse.json({ ok: true, research: row })
      }
      case 'add_note': {
        const noteBody = strOrEmpty(body.body)
        if (!noteBody.trim()) return bad(400, 'body required')
        const row = await addResearchNote(projectId, noteBody, admin.email)
        return NextResponse.json({ ok: true, research: row })
      }
      case 'remove_note': {
        const noteId = strOrEmpty(body.noteId)
        if (!noteId) return bad(400, 'noteId required')
        const row = await removeResearchNote(projectId, noteId)
        return NextResponse.json({ ok: true, research: row })
      }
      case 'research_web': {
        const maxSearches = typeof body.maxSearches === 'number' ? body.maxSearches : undefined
        const r = await researchWebForProject(projectId, admin.email, { maxSearches })
        return NextResponse.json({
          ok: true,
          research: r.row,
          discovered: r.discovered,
          facts: r.facts,
          contradictions: r.contradictions,
          cost: r.cost,
        })
      }
      case 'clear_discovered_sources': {
        const row = await clearDiscoveredSources(projectId)
        return NextResponse.json({ ok: true, research: row })
      }
      case 're_extract_facts': {
        const r = await reExtractFactsForProject(projectId, admin.email)
        return NextResponse.json({
          ok: true,
          research: r.row,
          facts: r.facts,
          contradictions: r.contradictions,
          costUsd: r.costUsd,
          usedPrimaryText: r.usedPrimaryText,
        })
      }
      case 'approve_large_mover': {
        const cardSlug = strOrEmpty(body.cardSlug)
        if (!cardSlug) return bad(400, 'cardSlug required')
        const row = await approveLargeMover(projectId, cardSlug)
        return NextResponse.json({ ok: true, research: row })
      }
      case 'revoke_large_mover': {
        const cardSlug = strOrEmpty(body.cardSlug)
        if (!cardSlug) return bad(400, 'cardSlug required')
        const row = await revokeLargeMover(projectId, cardSlug)
        return NextResponse.json({ ok: true, research: row })
      }
      default:
        return bad(400, `unknown action: ${action || '(missing)'}`)
    }
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown')
  }
}

function strOrEmpty(v: unknown): string { return typeof v === 'string' ? v : '' }
function strOrUndef(v: unknown): string | undefined { return typeof v === 'string' && v.trim() ? v : undefined }
