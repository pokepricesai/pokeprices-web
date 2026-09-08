// src/app/api/admin/editorial/deep-research-prompt/[projectId]/route.ts
//
// EIC — Deep Research prompt generator endpoint.
//
// External / news / upcoming-set editorial no longer runs an AI
// research or writer stage inside the EIC. Admin opens Editorial
// HQ, sees the opportunity, and gets a clean prompt to paste into
// ChatGPT Deep Research. This endpoint returns that prompt.
//
// Pure derivation — no DB writes, no AI calls. Uses existing
// editorial-context infrastructure + the internal-link pickers we
// already have.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchProject } from '@/lib/editorial/research/serverActions'
import { buildEditorialContext } from '@/lib/editorial/context'
import { buildDeepResearchPrompt } from '@/lib/editorial/deepResearchPrompt'
import {
  pickInternalLinkCandidates,
  pickSetPageCandidates,
  mergeInternalLinkCandidates,
} from '@/lib/editorial/writer/researchAndWrite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const project = await fetchProject(projectId)
    if (!project) return bad(404, 'project not found')

    // Best-effort context; failure is silent (empty links list is fine).
    let internalLinks: Array<{ title: string; url: string }> = []
    try {
      const editorialCtx = await buildEditorialContext()
      const projectRef = { title: project.title, angle: project.angle ?? null, articleType: project.article_type }
      const articleCandidates = pickInternalLinkCandidates({ project: projectRef, articles: editorialCtx.articles, limit: 10 })
      const setCandidates     = pickSetPageCandidates({ project: projectRef, release: editorialCtx.release, limit: 5 })
      internalLinks = mergeInternalLinkCandidates(articleCandidates, setCandidates, 10)
    } catch (e) {
      console.warn('[deep-research-prompt] context fetch failed, continuing without internal links:', e instanceof Error ? e.message : 'unknown')
    }

    const today = new Date().toISOString().slice(0, 10)
    const prompt = buildDeepResearchPrompt({
      project: {
        id:              project.id,
        title:           project.title,
        angle:           project.angle ?? null,
        articleType:     project.article_type,
        targetPublishAt: project.target_publish_at ?? null,
      },
      today,
      internalLinks,
    })

    return NextResponse.json({
      ok:              true,
      prompt,
      project: {
        id:              project.id,
        title:           project.title,
        articleType:     project.article_type,
        targetPublishAt: project.target_publish_at,
      },
      internalLinkCount: internalLinks.length,
      generatedAt:      new Date().toISOString(),
    })
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown')
  }
}
