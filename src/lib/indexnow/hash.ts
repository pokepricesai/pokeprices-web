// src/lib/indexnow/hash.ts
// ============================================================================
// Change-detection hashing for the IndexNow queue.
//
// The rule: hash ONLY fields that materially change what a search engine
// would see if it re-crawled the URL. Do NOT include:
//   * internal updated_at / scraped_at timestamps
//   * volatile counters (view_count, ratings, etc. that don't ship in HTML)
//   * random request-id-ish fields
//
// Rationale: every field we include in the hash is a reason IndexNow will
// re-notify Bing. Over-including drowns Bing in duplicate submits (the
// Aug-2026 amplification pattern) and burns their crawl budget on pages
// that did not actually change.
//
// Two helpers:
//   `hashCardSignature`     — for card pages
//   `hashInsightSignature`  — for editorial articles
//   `hashGenericSignature`  — everything else
//
// All return a stable 40-char hex hash (SHA-1 truncated: it does not need
// to be cryptographic, just content-addressable and short).
// ============================================================================

import { createHash } from 'node:crypto'

/** Fields on a card row that would show up in the rendered HTML. Kept
 *  narrow on purpose: everything here is user-visible, none of it is
 *  internal bookkeeping. */
export type CardHashInput = {
  card_slug:            string
  card_url_slug:        string
  card_name:            string | null
  set_name:             string | null
  card_number_display:  string | null
  headline_price_cents: number | null   // the "big price" in the H1
  psa10_price_cents:    number | null
  psa9_price_cents:     number | null
  raw_price_cents:      number | null
  image_url:            string | null
}

export function hashCardSignature(c: CardHashInput): string {
  // Bucket prices to the nearest 10 cents so ordinary £0.01 float noise
  // does not churn the hash on every daily refresh.
  const bucket = (v: number | null | undefined): number | null =>
    v == null ? null : Math.round(v / 10) * 10
  const material: Record<string, unknown> = {
    slug:   c.card_slug,
    url:    c.card_url_slug,
    name:   c.card_name ?? '',
    set:    c.set_name ?? '',
    num:    c.card_number_display ?? '',
    price:  bucket(c.headline_price_cents),
    psa10:  bucket(c.psa10_price_cents),
    psa9:   bucket(c.psa9_price_cents),
    raw:    bucket(c.raw_price_cents),
    image:  c.image_url ?? '',
  }
  return sha1Hex(JSON.stringify(material))
}

export type InsightHashInput = {
  slug:              string
  headline:          string | null
  intro:             string | null
  meta_title:        string | null
  meta_description:  string | null
  status:            string | null   // 'published' | 'draft'
  published_at:      string | null   // ISO; only the calendar date matters here
  body_hash:         string | null   // if the caller already has one, pass it through
}

export function hashInsightSignature(a: InsightHashInput): string {
  const material: Record<string, unknown> = {
    slug:      a.slug,
    headline:  a.headline ?? '',
    intro:     a.intro ?? '',
    title:     a.meta_title ?? '',
    desc:      a.meta_description ?? '',
    status:    a.status ?? '',
    pubdate:   a.published_at ? a.published_at.slice(0, 10) : '',
    body:      a.body_hash ?? '',
  }
  return sha1Hex(JSON.stringify(material))
}

/** Everything else — sets, Pokémon species, creators, vendors, card-shows.
 *  Callers pass whatever narrow set of fields are user-visible for their
 *  family. Keep it tight. */
export function hashGenericSignature(pageFamily: string, fields: Record<string, unknown>): string {
  const sorted = Object.keys(fields).sort()
  const material: Record<string, unknown> = { _family: pageFamily }
  for (const k of sorted) material[k] = fields[k]
  return sha1Hex(JSON.stringify(material))
}

/** SHA-1 truncated to 40 chars. Non-cryptographic use — just a
 *  content-addressable short id for change detection. */
export function sha1Hex(input: string): string {
  return createHash('sha1').update(input).digest('hex')
}

/** Convenience for URLs — a shorter form of sha1(url) so queue rows can
 *  join back to seo_pages without dragging the full URL every time. */
export function urlHash(canonicalUrl: string): string {
  return sha1Hex(canonicalUrl)
}
