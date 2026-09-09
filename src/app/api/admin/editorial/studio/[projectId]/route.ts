// src/app/api/admin/editorial/studio/[projectId]/route.ts
//
// EIC Block 7 — Article Studio load + autosave endpoints.
//
//   GET  /api/admin/editorial/studio/[projectId]
//     Returns { ok, project, studioDocument, research }.
//     `studioDocument` is null if none exists yet; callers seed a
//     blank draft from the project title.
//
//   POST /api/admin/editorial/studio/[projectId]
//     Body: { studioDocument: StudioDocument, statusHint?: 'drafting' }.
//     Overwrites the single draft in editorial_projects.studio_json.
//     Optionally nudges project.status from 'planned' to 'drafting'
//     on the first save — but never overrides an explicit
//     'review'/'ready'/'published' state.
//
// Both endpoints go through requireAdmin (Bearer token from the
// browser Supabase session). Writes use the service-role client.

import 'server-only'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { checkAdminRateLimit } from '@/lib/adminRateLimit'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { fetchResearch } from '@/lib/editorial/research/serverActions'
import type { StudioDocument } from '@/lib/studio/types'
import { STUDIO_DOCUMENT_VERSION } from '@/lib/studio/types'
import { materialContentChanged } from '@/lib/editorial/publishing/signOff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_NAMESPACE = 'api/admin/editorial/studio'
const RATE_LIMIT     = 240                    // autosave-heavy endpoint
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

// ── GET ─────────────────────────────────────────────────────────

export async function GET(req: Request, ctx: Ctx) {
  const admin = await requireAdmin(req)
  if (!admin.ok) return bad(admin.status, admin.error)
  const { projectId: raw } = await ctx.params
  const projectId = parseProjectId(raw)
  if (projectId == null) return bad(400, 'invalid projectId')

  try {
    const supa = getSupabaseServiceClient()
    const { data: project, error } = await supa
      .from('editorial_projects')
      .select('id, title, angle, article_type, status, priority, target_publish_at, notes, insights_id, studio_json, created_at, updated_at')
      .eq('id', projectId)
      .maybeSingle()
    if (error) return bad(500, error.message)
    if (!project) return bad(404, 'project not found')

    const research = await fetchResearch(projectId)
    return NextResponse.json({
      ok: true,
      project,
      studioDocument: (project as any).studio_json ?? null,
      research,
    })
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown')
  }
}

// ── POST (autosave) ────────────────────────────────────────────

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

  const doc = sanitiseStudioDocument(body.studioDocument)
  if (!doc) return bad(400, 'studioDocument missing or invalid')

  const statusHint = typeof body.statusHint === 'string' ? body.statusHint : null

  try {
    const supa = getSupabaseServiceClient()

    // Look at the current project so we know whether to bump status
    // AND whether to clear a stale sign-off. Simplified-HQ policy:
    // when material CMS content (headline / intro / body / seo
    // title / seo description) changes on an already-signed-off
    // draft, the sign-off is stale and must be revoked. Scheduled
    // timestamp is preserved intentionally — the admin's publish
    // intent survives an edit, but the cron won't fire until the
    // article is signed off again.
    const { data: current, error: getErr } = await supa
      .from('editorial_projects')
      .select('status, studio_json, signed_off_at')
      .eq('id', projectId)
      .maybeSingle()
    if (getErr) return bad(500, getErr.message)
    if (!current) return bad(404, 'project not found')

    const prevDoc = (current as any).studio_json as StudioDocument | null
    const wasSignedOff = !!(current as any).signed_off_at
    const shouldClearSignOff = wasSignedOff && materialContentChanged(prevDoc, doc)

    const nextStatus = (
      statusHint === 'drafting' && (current.status === 'planned' || current.status === 'idea')
    ) ? 'drafting' : current.status

    const patch: Record<string, unknown> = {
      studio_json: doc,
      updated_at:  new Date().toISOString(),
    }
    if (nextStatus !== current.status) patch.status = nextStatus
    if (shouldClearSignOff) {
      patch.signed_off_at = null
      patch.signed_off_by = null
    }

    const { data, error } = await supa
      .from('editorial_projects')
      .update(patch)
      .eq('id', projectId)
      .select('id, status, updated_at, studio_json, signed_off_at, signed_off_by, scheduled_publish_at')
      .single()
    if (error) return bad(500, error.message)

    return NextResponse.json({
      ok:               true,
      project:          data,
      savedAt:          (data as any).updated_at,
      statusChangedTo:  nextStatus !== current.status ? nextStatus : null,
      signOffCleared:   shouldClearSignOff,
    })
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : 'unknown')
  }
}

// ─────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────

const MAX_HEADLINE_CHARS   = 500
const MAX_INTRO_CHARS      = 4000
const MAX_SEO_TITLE_CHARS  = 200
const MAX_SEO_DESC_CHARS   = 400
const MAX_THEME_CHARS      = 60
const MAX_AUTHOR_CHARS     = 120
const MAX_BODY_DOC_BYTES   = 512 * 1024   // 512 KB per draft doc — plenty for a 3k-word article

function sanitiseStudioDocument(v: unknown): StudioDocument | null {
  if (!v || typeof v !== 'object') return null
  const raw = v as any
  const headline   = clampStr(raw.headline,   MAX_HEADLINE_CHARS)
  const intro      = clampStr(raw.intro,      MAX_INTRO_CHARS)
  const themeKey   = clampStr(raw.themeKey,   MAX_THEME_CHARS)
  const themeLabel = clampStr(raw.themeLabel, MAX_THEME_CHARS)
  const authorName = clampStr(raw.authorName, MAX_AUTHOR_CHARS)
  const seoTitle   = clampStr(raw.seo?.title,       MAX_SEO_TITLE_CHARS)
  const seoDesc    = clampStr(raw.seo?.description, MAX_SEO_DESC_CHARS)
  const hero = sanitiseHero(raw.heroImage)
  const bodyDoc = raw.bodyDoc && typeof raw.bodyDoc === 'object' ? raw.bodyDoc : { type: 'doc', content: [{ type: 'paragraph' }] }
  // Cheap serialization-size guard.
  try {
    const size = JSON.stringify(bodyDoc).length
    if (size > MAX_BODY_DOC_BYTES) return null
  } catch { return null }
  return {
    version:    STUDIO_DOCUMENT_VERSION,
    headline, intro, themeKey, themeLabel, authorName,
    seo:       { title: seoTitle, description: seoDesc },
    heroImage: hero,
    bodyDoc,
    updatedAt: new Date().toISOString(),
  }
}

function sanitiseHero(v: unknown): StudioDocument['heroImage'] {
  if (!v || typeof v !== 'object') return null
  const r = v as any
  const url = typeof r.url === 'string' && /^https:\/\//.test(r.url) ? r.url : ''
  if (!url) return null
  return {
    url,
    alt:      clampStr(r.alt,      400),
    caption:  r.caption ? clampStr(r.caption, 400) : undefined,
  }
}
function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}
