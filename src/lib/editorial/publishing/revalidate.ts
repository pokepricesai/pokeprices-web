// src/lib/editorial/publishing/revalidate.ts
//
// EIC Block 10 — cache revalidation + IndexNow notification after
// publish/update/unpublish.
//
// All failures here are non-fatal: publish must not roll back
// because a cache purge or a search-engine ping failed. Each failure
// returns a `PostPublishWarning` the caller can attach to the
// response.

import 'server-only'
import { revalidatePath } from 'next/cache'
import { CANONICAL_HOST, MAX_BATCH_SIZE, buildPayload, classifyStatus, safeLogBody } from '@/lib/indexnow/submitter.mjs'

const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'a8f92c1d7e4b49d2b7c5e913f4aa8179'
const KEY_LOCATION = `https://${CANONICAL_HOST}/${INDEXNOW_KEY}.txt`

export type PostPublishWarning = { kind: 'revalidate' | 'indexnow'; detail: string }

export type PostPublishOptions = {
  slug:          string
  wasFirstPublish: boolean
}

/** Fire cache invalidation for the article + hub + sitemap, then
 *  submit the article URL to IndexNow. Never throws. */
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

  // 2. IndexNow — best-effort. First publications get notified;
  //    updates can also submit, though the IndexNow protocol allows
  //    but does not require it.
  try {
    const payload = buildPayload([canonicalUrl], { key: INDEXNOW_KEY, keyLocation: KEY_LOCATION })
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const cls = classifyStatus(res.status)
    if (cls !== 'ok' && cls !== 'accepted') {
      const text = await res.text().catch(() => '')
      warnings.push({ kind: 'indexnow', detail: `${cls} (HTTP ${res.status}): ${safeLogBody(text, INDEXNOW_KEY)}` })
    }
  } catch (e) {
    warnings.push({ kind: 'indexnow', detail: e instanceof Error ? e.message : 'unknown' })
  }

  void opts.wasFirstPublish  // future: differentiate submission strategy
  void MAX_BATCH_SIZE
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
