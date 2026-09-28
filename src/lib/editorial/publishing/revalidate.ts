// src/lib/editorial/publishing/revalidate.ts
//
// EIC Block 10 — cache revalidation + IndexNow notification after
// publish/update/unpublish.
//
// All failures here are non-fatal: publish must not roll back
// because a cache purge or a search-engine ping failed. Each failure
// returns a `PostPublishWarning` the caller can attach to the
// response.
//
// Stage 6A — IndexNow submission now goes through the persistent queue
// (src/lib/indexnow/queue.ts) instead of firing a direct HTTP request.
// This gives us retries, dedupe, audit history, and — crucially — makes
// the publish action fast (a DB insert, not a network round-trip).

import 'server-only'
import { revalidatePath } from 'next/cache'
import { CANONICAL_HOST } from '@/lib/indexnow/submitter.mjs'
import { enqueueUrl } from '@/lib/indexnow/queue'
import { hashInsightSignature } from '@/lib/indexnow/hash'

export type PostPublishWarning = { kind: 'revalidate' | 'indexnow'; detail: string }

export type PostPublishOptions = {
  slug:              string
  wasFirstPublish:   boolean
  /** Optional fields that materially affect what search engines see —
   *  used to compute a stable content hash so unchanged republishes do
   *  not re-notify Bing. Callers pass whatever they have; missing
   *  fields are hashed as empty strings, which is safe. */
  hashInput?: {
    headline?:         string | null
    intro?:            string | null
    meta_title?:       string | null
    meta_description?: string | null
    status?:           string | null
    published_at?:     string | null
    body_hash?:        string | null
  }
}

/** Fire cache invalidation for the article + hub + sitemap, then
 *  enqueue the article URL for IndexNow submission. Never throws. */
export async function runPostPublish(opts: PostPublishOptions): Promise<{ warnings: PostPublishWarning[] }> {
  const warnings: PostPublishWarning[] = []
  const articlePath = `/insights/${opts.slug}`
  const canonicalUrl = `https://${CANONICAL_HOST}${articlePath}`

  // 1. Invalidate. Each call is wrapped so one bad path can't stop
  //    the rest.
  const paths = [articlePath, '/insights', '/', '/sitemap-insights.xml']
  for (const p of paths) {
    try { revalidatePath(p) }
    catch (e) { warnings.push({ kind: 'revalidate', detail: `${p}: ${e instanceof Error ? e.message : 'unknown'}` }) }
  }

  // 2. IndexNow — enqueue with priority 0 (new content). The scheduled
  //    worker will drain the row on the next tick. If the DB is
  //    momentarily unavailable, the warning surfaces and the operator
  //    can requeue manually; publish still succeeds.
  try {
    const contentHash = hashInsightSignature({
      slug:             opts.slug,
      headline:         opts.hashInput?.headline         ?? null,
      intro:            opts.hashInput?.intro            ?? null,
      meta_title:       opts.hashInput?.meta_title       ?? null,
      meta_description: opts.hashInput?.meta_description ?? null,
      status:           opts.hashInput?.status           ?? (opts.wasFirstPublish ? 'published' : 'published'),
      published_at:     opts.hashInput?.published_at     ?? null,
      body_hash:        opts.hashInput?.body_hash        ?? null,
    })
    const enq = await enqueueUrl({
      url:         canonicalUrl,
      contentHash,
      pageFamily:  'insight',
      entityId:    opts.slug,
      priority:    0,
      reason:      opts.wasFirstPublish ? 'created' : 'updated',
    })
    if (enq.ok === false) {
      const fail = enq as { ok: false; reason: string; detail?: string }
      warnings.push({ kind: 'indexnow', detail: `enqueue: ${fail.reason}${fail.detail ? ` — ${fail.detail}` : ''}` })
    }
  } catch (e) {
    warnings.push({ kind: 'indexnow', detail: e instanceof Error ? e.message : 'unknown' })
  }

  return { warnings }
}

/** Revalidation only — used by prepareDraft and updatePublished when
 *  the caller does not want to ping IndexNow (draft rows are hidden
 *  from search engines anyway). */
export function revalidateInsightPaths(slug: string): PostPublishWarning[] {
  const warnings: PostPublishWarning[] = []
  const paths = [`/insights/${slug}`, '/insights', '/sitemap-insights.xml']
  for (const p of paths) {
    try { revalidatePath(p) }
    catch (e) { warnings.push({ kind: 'revalidate', detail: `${p}: ${e instanceof Error ? e.message : 'unknown'}` }) }
  }
  return warnings
}
