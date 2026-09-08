// src/lib/editorial/context.ts
//
// EIC Block 3 — the compact, JSON-serialisable snapshot future AI
// features will consume. One call:
//
//   const ctx = await buildEditorialContext()
//
// returns the entire editorial world the copilot needs to reason:
// what we've published, what's planned, what's coming, and what
// coverage gaps exist. Deliberately compact — this is designed to
// be pasted into a prompt without blowing token budget.
//
// Non-goals: no embeddings, no vector store, no separate content-index
// table. At this scale the article corpus fits in a prompt.

import 'server-only'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { bodyJsonToPlainText } from './plainText'
import { fetchReleaseContext, type ReleaseContext } from './releaseContext'
import type { EditorialProject } from './projects'

// ── Output shape ─────────────────────────────────────────────────

export type EditorialContextArticle = {
  id:          string
  slug:        string
  headline:    string
  intro:       string | null
  publishedAt: string | null
  theme:       string | null
  themeLabel:  string | null
  seoTitle:    string | null
  seoDescription: string | null
  setRefs:     readonly string[] | null
  cardRefs:    readonly string[] | null
  wordCount:   number
  /** First N chars of plain-text body. Kept bounded so this object
   *  stays prompt-safe. Full text remains available on demand from
   *  the DB when needed. */
  bodyExcerpt: string
  publicUrl:   string
}

export type EditorialContextProject = {
  id:               number
  title:            string
  angle:            string | null
  articleType:      string
  status:           string
  priority:         number
  targetPublishAt:  string | null
  notes:            string | null
  insightsId:       string | null
  createdAt:        string
  updatedAt:        string
}

export type EditorialContext = {
  meta: {
    today:              string
    generatedAt:        string
    articleBodyExcerptChars: number
  }
  articles:  readonly EditorialContextArticle[]
  projects:  readonly EditorialContextProject[]
  release:   ReleaseContext
  summary: {
    totalArticles:              number
    articlesPublishedThisMonth: number
    activeProjects:             number
    ideasInBacklog:             number
    upcomingReleases:           number
    recentReleases:             number
    releasesWithoutCoverage:    number
  }
}

// ── Constants ────────────────────────────────────────────────────

const ARTICLE_BODY_EXCERPT_CHARS = 1500  // bounded per-article body cap
const MAX_ARTICLES = 200                 // catalog is tiny; hard cap in case
const MAX_PROJECTS = 500

// ── Public: build the context ────────────────────────────────────

export async function buildEditorialContext(now: Date = new Date()): Promise<EditorialContext> {
  const supa = getSupabaseServiceClient()
  const todayIso = now.toISOString().slice(0, 10)

  // Everything in parallel — no dependencies between fetches.
  const [insightsRes, projectsRes, release] = await Promise.all([
    supa.from('insights')
      .select('id, slug, headline, intro, published_at, theme, theme_label, seo_title, seo_description, set_refs, card_refs, body_json, status')
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(MAX_ARTICLES),
    supa.from('editorial_projects')
      .select('id, title, angle, article_type, status, priority, target_publish_at, notes, insights_id, created_at, updated_at')
      .order('target_publish_at', { ascending: true, nullsFirst: false })
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(MAX_PROJECTS),
    fetchReleaseContext(now),
  ])
  if (insightsRes.error) throw new Error(`editorialContext: insights ${insightsRes.error.message}`)
  if (projectsRes.error) throw new Error(`editorialContext: editorial_projects ${projectsRes.error.message}`)

  const insightsRaw = (insightsRes.data ?? []) as any[]

  const articles: EditorialContextArticle[] = insightsRaw.map(r => {
    const bodyFull = bodyJsonToPlainText(r.body_json, { maxChars: 0 })
    const bodyExcerpt = bodyJsonToPlainText(r.body_json, { maxChars: ARTICLE_BODY_EXCERPT_CHARS })
    return {
      id:            r.id,
      slug:          r.slug,
      headline:      r.headline,
      intro:         r.intro ?? null,
      publishedAt:   r.published_at ?? null,
      theme:         r.theme ?? null,
      themeLabel:    r.theme_label ?? null,
      seoTitle:      r.seo_title ?? null,
      seoDescription: r.seo_description ?? null,
      setRefs:       Array.isArray(r.set_refs)  ? r.set_refs  : null,
      cardRefs:      Array.isArray(r.card_refs) ? r.card_refs : null,
      wordCount:     bodyFull ? bodyFull.split(/\s+/).filter(Boolean).length : 0,
      bodyExcerpt,
      publicUrl:     `https://www.pokeprices.io/insights/${r.slug}`,
    }
  })

  const projects: EditorialContextProject[] = (projectsRes.data as EditorialProject[] | null ?? []).map(p => ({
    id:              p.id,
    title:           p.title,
    angle:           p.angle ?? null,
    articleType:     p.article_type,
    status:          p.status,
    priority:        p.priority,
    targetPublishAt: p.target_publish_at ?? null,
    notes:           p.notes ?? null,
    insightsId:      p.insights_id ?? null,
    createdAt:       p.created_at,
    updatedAt:       p.updated_at,
  }))

  // Summary numbers derived from the same data so nothing can drift.
  const thisMonthPublished = articles.filter(a => {
    if (!a.publishedAt) return false
    const d = new Date(a.publishedAt)
    return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth()
  }).length
  const activeProjects = projects.filter(p => !['published', 'archived'].includes(p.status)).length
  const ideasInBacklog = projects.filter(p => p.status === 'idea').length
  const releasesWithoutCoverage =
      [...release.recent, ...release.upcoming].filter(r => r.coverage.status === 'none').length

  return {
    meta: {
      today:                   todayIso,
      generatedAt:             now.toISOString(),
      articleBodyExcerptChars: ARTICLE_BODY_EXCERPT_CHARS,
    },
    articles,
    projects,
    release,
    summary: {
      totalArticles:              articles.length,
      articlesPublishedThisMonth: thisMonthPublished,
      activeProjects,
      ideasInBacklog,
      upcomingReleases:           release.upcoming.length,
      recentReleases:             release.recent.length,
      releasesWithoutCoverage,
    },
  }
}
