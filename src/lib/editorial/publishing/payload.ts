// src/lib/editorial/publishing/payload.ts
//
// EIC Block 10 — deterministic Studio + Writer → insights payload.
//
// This is the ONLY sanctioned way an EIC-authored article turns
// into an insights row. Every field is derived from trusted server-
// side state (studio_json, writer_json, editorial_research). Browser
// input is limited to a slug override; nothing else crosses the
// boundary.
//
// Body conversion goes through the Block 7 adapter, so unknown
// TipTap nodes surface as conversion warnings the preflight can
// veto rather than silently disappear.

import type { StudioDocument } from '@/lib/studio/types'
import type { WriterMetadata } from '@/lib/editorial/writer/types'
import { studioDocumentToInsightBody } from '@/lib/studio/adapter'
import type { InsightBlock } from '@/lib/studio/adapter'
import type { EvidencePack } from '@/lib/editorial/research/types'
import { generateSlug } from './slug'
import { stripDashesFromText, stripDashesFromInsightBody } from './dashGuard'

// ─────────────────────────────────────────────────────────────────
// Insights payload shape
// ─────────────────────────────────────────────────────────────────

export type InsightPayload = {
  slug:             string
  headline:         string
  intro:            string
  theme:            string | null
  theme_label:      string
  meta_title:       string
  meta_description: string
  hero_image_query: string   // legacy NOT NULL column; safe default when unused
  body_json:        { blocks: InsightBlock[] }
  status:           'draft' | 'published'
  image_url:        string | null
  author:           string | null
  read_time_mins:   number | null
  seo_title:        string | null
  seo_description:  string | null
  card_refs:        string[]
  set_refs:         string[]
}

export type PayloadBuildInput = {
  studio:          StudioDocument
  writer:          WriterMetadata | null
  pack:            EvidencePack | null
  /** Preferred slug from admin override or slugify(headline). Never
   *  invented server-side without a source. */
  preferredSlug:   string
  /** 'draft' or 'published'. Preflight decides which. */
  status:          'draft' | 'published'
}

export type PayloadBuildResult = {
  payload:  InsightPayload
  warnings: string[]
  /** Set when the Studio → insight adapter dropped something. Preflight
   *  MUST veto publication when this is non-empty and material. */
  adapterWarnings: Array<{ kind: string; path: string; detail: string }>
}

export function studioProjectToInsightPayload(input: PayloadBuildInput): PayloadBuildResult {
  const warnings: string[] = []
  const { studio, writer, pack } = input

  // 1. Body via the Block 7 adapter (no second conversion path).
  //    Then run the deterministic dash guard so em / en dashes can
  //    never reach the published body — belt-and-braces against a
  //    writer that ignored the prompt rule. Ordinary hyphens inside
  //    compound words are preserved.
  const conversion = studioDocumentToInsightBody(studio.bodyDoc)
  const body = stripDashesFromInsightBody(conversion.body) as typeof conversion.body

  // 2. SEO fallbacks — never publish empty <title>/description. The
  //    dash guard applies to headline / intro / seo fields too, so
  //    the fallbacks stay clean even when they inherit from the
  //    article title.
  const cleanHeadline = stripDashesFromText(studio.headline)
  const cleanIntro    = stripDashesFromText(studio.intro)
  const seoTitleRaw   = stripDashesFromText(studio.seo?.title?.trim() ?? '')
  const seoDescRaw    = stripDashesFromText(studio.seo?.description?.trim() ?? '')
  const seoTitle      = seoTitleRaw || cleanHeadline || 'PokePrices Insight'
  const seoDesc       = seoDescRaw  || cleanIntro    || 'PokePrices market intelligence.'
  if (!seoTitleRaw) warnings.push('seo_title was empty; falling back to article headline')
  if (!seoDescRaw)  warnings.push('seo_description was empty; falling back to article intro')

  // 3. Theme label — must be non-empty (NOT NULL in DB).
  const themeKey   = studio.themeKey?.trim() || 'market'
  const themeLabel = studio.themeLabel?.trim() || fallbackThemeLabel(themeKey)

  // 4. Card / set refs derived from structured blocks and the pack's
  //    internal-link seeds. Never invented from arbitrary text.
  const cardRefs = collectCardRefs(body.blocks, writer)
  const setRefs  = collectSetRefs(body.blocks, pack)

  // 5. Read time — reuse the Studio estimate if we have it, otherwise
  //    compute from plain-text word count.
  const readTime = writer?.generationCost && writer?.claimTrace?.length
    ? estimateReadTimeFromBlocks(body.blocks, studio.headline, studio.intro)
    : estimateReadTimeFromBlocks(body.blocks, studio.headline, studio.intro)

  const payload: InsightPayload = {
    slug:              input.preferredSlug,
    headline:          cleanHeadline.trim(),
    intro:             cleanIntro.trim(),
    theme:             themeKey,
    theme_label:       themeLabel,
    meta_title:        seoTitle,
    meta_description:  seoDesc,
    hero_image_query:  '',                // legacy field, safe default
    body_json:         body,
    status:            input.status,
    image_url:         studio.heroImage?.url ?? null,
    author:            studio.authorName?.trim() || null,
    read_time_mins:    readTime,
    seo_title:         seoTitle,
    seo_description:   seoDesc,
    card_refs:         cardRefs,
    set_refs:          setRefs,
  }

  return { payload, warnings, adapterWarnings: conversion.warnings }
}

// ─────────────────────────────────────────────────────────────────
// Ref derivation
// ─────────────────────────────────────────────────────────────────

function collectCardRefs(blocks: readonly InsightBlock[], writer: WriterMetadata | null): string[] {
  const set = new Set<string>()
  for (const b of blocks) {
    if (b.type !== 'data_block') continue
    const payload: any = (b as any).payload
    if (b.variant === 'card_block' && payload?.card?.cardSlug) set.add(String(payload.card.cardSlug))
    if (b.variant === 'card_grid'  && Array.isArray(payload?.cards))       for (const c of payload.cards) if (c?.card?.cardSlug) set.add(String(c.card.cardSlug))
    if (b.variant === 'raw_psa_comparison' && Array.isArray(payload?.rows)) for (const r of payload.rows) if (r?.card?.cardSlug) set.add(String(r.card.cardSlug))
    if (b.variant === 'price_chart' && payload?.card?.cardSlug) set.add(String(payload.card.cardSlug))
    if (b.variant === 'ranking_table' && Array.isArray(payload?.rows)) {
      for (const r of payload.rows) if (r?.card?.cardSlug) set.add(String(r.card.cardSlug))
    }
  }
  // Writer's claim trace may mention card slugs (rare) — trust only
  // slugs that already appear on structured cards, ignore free text.
  return Array.from(set).sort().slice(0, 200)
}

function collectSetRefs(blocks: readonly InsightBlock[], pack: EvidencePack | null): string[] {
  const set = new Set<string>()
  for (const b of blocks) {
    if (b.type !== 'data_block') continue
    const payload: any = (b as any).payload
    if (b.variant === 'set_block' && payload?.set?.setName) set.add(String(payload.set.setName))
    if (b.variant === 'card_block' && payload?.card?.setName) set.add(String(payload.card.setName))
    if (b.variant === 'card_grid' && Array.isArray(payload?.cards)) for (const c of payload.cards) if (c?.card?.setName) set.add(String(c.card.setName))
    if (b.variant === 'ranking_table' && Array.isArray(payload?.rows)) for (const r of payload.rows) if (r?.card?.setName) set.add(String(r.card.setName))
  }
  // Also inherit pack.related sets when present in internalLinks that
  // resolve to /set/<name>. Deliberately conservative.
  if (pack) {
    for (const link of pack.internalLinks) {
      const m = /^\/set\/([^/]+)$/.exec(String(link.url ?? ''))
      if (m) set.add(decodeURIComponent(m[1]).replace(/-/g, ' '))
    }
  }
  return Array.from(set).sort().slice(0, 100)
}

function estimateReadTimeFromBlocks(blocks: readonly InsightBlock[], headline: string, intro: string): number {
  const parts: string[] = [headline, intro]
  for (const b of blocks) {
    if (b.type === 'paragraph' && Array.isArray((b as any).content)) {
      for (const seg of (b as any).content) if (seg?.text) parts.push(seg.text)
    } else if (b.type === 'heading') {
      parts.push((b as any).text ?? '')
    } else if (b.type === 'quote' && Array.isArray((b as any).content)) {
      for (const seg of (b as any).content) if (seg?.text) parts.push(seg.text)
    } else if (b.type === 'list' && Array.isArray((b as any).items)) {
      for (const item of (b as any).items) if (Array.isArray(item)) for (const seg of item) if (seg?.text) parts.push(seg.text)
    }
  }
  const words = parts.join(' ').trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 220))
}

function fallbackThemeLabel(key: string): string {
  const map: Record<string, string> = {
    grading: 'Grading', market: 'Market', investing: 'Investing', community: 'Community',
    collecting: 'Collecting', vintage: 'Vintage', modern: 'Modern',
  }
  return map[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}
