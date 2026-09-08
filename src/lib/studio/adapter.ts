// src/lib/studio/adapter.ts
//
// EIC Block 7 — Studio (TipTap) doc  →  Insights body block model.
//
// The Studio internal format is a TipTap document tree
// ({ type: 'doc', content: [...] }). The public article renderer
// expects `{ blocks: [ ... ] }` where each block is a plain object.
// This module is the ONLY place that knows both sides of that
// boundary. Every conversion is deterministic, JSON-safe, and never
// emits raw HTML.
//
// Design principles:
//   * Every supported TipTap node has a deterministic mapping to
//     an existing (or minimally-extended) insights block type.
//   * Unsupported nodes never silently disappear — they generate a
//     `ConversionWarning` and the offending node is dropped from
//     the output.
//   * The rich `ParagraphSegment` shape used by the existing
//     renderer is preserved (text / bold / italic / href).
//   * Legacy `insights.body_json` shapes remain byte-invariant
//     because the adapter never modifies them; only new-Studio
//     documents flow through here.

import type { ParagraphSegment } from '@/lib/insights/richText'
import { isSafeArticleHref } from '@/lib/insights/richText'

// ─────────────────────────────────────────────────────────────────
// Public insights block model — extended additively for Studio.
// ─────────────────────────────────────────────────────────────────

export type ExtendedParagraphSegment = ParagraphSegment & {
  /** Optional italic mark. New in Block 7. Renderer treats missing
   *  as false so legacy segments render identically. */
  italic?: boolean
}

export type InsightHeadingBlock = {
  type: 'heading'
  text: string
  /** New in Block 7. Defaults to 2 when absent (legacy behaviour). */
  level?: 2 | 3
}
export type InsightParagraphBlock = {
  type:    'paragraph'
  content: ExtendedParagraphSegment[]
  text?:   string   // legacy fallback
}
export type InsightListBlock = {
  type:    'list'
  ordered: boolean
  items:   ExtendedParagraphSegment[][]
}
export type InsightQuoteBlock = {
  type:    'quote'
  content: ExtendedParagraphSegment[]
}
export type InsightHrBlock = {
  type: 'hr'
}
export type InsightImageBlock = {
  type:     'image'
  src:      string
  alt:      string
  caption?: string
}
export type InsightDataBlock = {
  /** Placeholder for Block 8 custom data blocks. */
  type:     'data_block'
  variant:  string
  payload:  Record<string, unknown>
}

export type InsightBlock =
  | InsightHeadingBlock
  | InsightParagraphBlock
  | InsightListBlock
  | InsightQuoteBlock
  | InsightHrBlock
  | InsightImageBlock
  | InsightDataBlock

export type InsightBody = { blocks: InsightBlock[] }

// ─────────────────────────────────────────────────────────────────
// Conversion result
// ─────────────────────────────────────────────────────────────────

export type ConversionWarning = {
  /** e.g. 'unsupported_node', 'unsupported_mark', 'unsafe_href', 'empty_link' */
  kind:  string
  path:  string   // dotted path into the TipTap doc tree
  detail: string
}

export type ConversionResult = {
  body:     InsightBody
  warnings: ConversionWarning[]
}

// ─────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────

const SUPPORTED_NODES = new Set([
  'doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
  'blockquote', 'horizontalRule', 'image', 'hardBreak', 'text', 'dataBlock',
])

const SUPPORTED_MARKS = new Set(['bold', 'italic', 'link'])

export function studioDocumentToInsightBody(doc: unknown): ConversionResult {
  const warnings: ConversionWarning[] = []
  const blocks: InsightBlock[] = []

  if (!doc || typeof doc !== 'object') {
    return { body: { blocks: [] }, warnings: [{ kind: 'invalid_doc', path: '', detail: 'Document is not an object.' }] }
  }
  const d = doc as any
  if (d.type !== 'doc' || !Array.isArray(d.content)) {
    return { body: { blocks: [] }, warnings: [{ kind: 'invalid_doc', path: '', detail: 'Root node is not { type: "doc", content: [] }.' }] }
  }

  d.content.forEach((node: any, i: number) => convertBlockNode(node, `content[${i}]`, blocks, warnings))
  return { body: { blocks }, warnings }
}

function convertBlockNode(node: any, path: string, out: InsightBlock[], warnings: ConversionWarning[]): void {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return
  if (!SUPPORTED_NODES.has(node.type)) {
    warnings.push({ kind: 'unsupported_node', path, detail: `Node type "${node.type}" is not supported by the public renderer and was dropped.` })
    return
  }
  switch (node.type) {
    case 'paragraph': {
      const segments = flattenInlineToSegments(Array.isArray(node.content) ? node.content : [], path, warnings)
      // Trailing empty paragraphs are frequent in TipTap output; drop them.
      if (segments.length === 0) return
      out.push({ type: 'paragraph', content: segments })
      return
    }
    case 'heading': {
      const level = coerceLevel(node.attrs?.level)
      const text  = plainText(node.content ?? [])
      if (!text) return
      const block: InsightHeadingBlock = { type: 'heading', text }
      if (level === 3) block.level = 3
      out.push(block)
      return
    }
    case 'bulletList':
    case 'orderedList': {
      const items = collectListItems(Array.isArray(node.content) ? node.content : [], path, warnings)
      if (items.length === 0) return
      out.push({ type: 'list', ordered: node.type === 'orderedList', items })
      return
    }
    case 'blockquote': {
      // Flatten every inline in the blockquote's children into a single
      // segment array. Nested block-level content inside a blockquote
      // is out of scope for the current renderer and is warned.
      const segs: ExtendedParagraphSegment[] = []
      for (let i = 0; i < (node.content ?? []).length; i++) {
        const child = node.content[i]
        if (child?.type === 'paragraph') {
          const inner = flattenInlineToSegments(child.content ?? [], `${path}.content[${i}]`, warnings)
          if (segs.length > 0 && inner.length > 0) segs.push({ text: ' ' })
          segs.push(...inner)
        } else if (child?.type) {
          warnings.push({ kind: 'unsupported_node', path: `${path}.content[${i}]`, detail: `Block "${child.type}" nested inside blockquote was dropped; only paragraphs are supported in blockquotes.` })
        }
      }
      if (segs.length === 0) return
      out.push({ type: 'quote', content: segs })
      return
    }
    case 'horizontalRule':
      out.push({ type: 'hr' })
      return
    case 'image': {
      const src = String(node.attrs?.src ?? '')
      const alt = String(node.attrs?.alt ?? '')
      const cap = node.attrs?.caption ? String(node.attrs.caption) : undefined
      if (!src) { warnings.push({ kind: 'invalid_image', path, detail: 'Image node has no src; dropped.' }); return }
      const block: InsightImageBlock = { type: 'image', src, alt }
      if (cap) block.caption = cap
      out.push(block)
      return
    }
    case 'dataBlock': {
      // Placeholder for Block 8. Preserved as-is inside the pack so
      // a later block-specific renderer can consume it. Reviewer
      // sees a data_block placeholder in preview until Block 8 lands.
      const variant = String(node.attrs?.variant ?? 'unknown')
      const payload = (node.attrs?.payload && typeof node.attrs.payload === 'object') ? node.attrs.payload : {}
      out.push({ type: 'data_block', variant, payload })
      return
    }
    default:
      warnings.push({ kind: 'unsupported_node', path, detail: `Node "${node.type}" was not converted.` })
  }
}

function collectListItems(children: any[], path: string, warnings: ConversionWarning[]): ExtendedParagraphSegment[][] {
  const items: ExtendedParagraphSegment[][] = []
  children.forEach((child: any, i: number) => {
    if (child?.type !== 'listItem') {
      warnings.push({ kind: 'unsupported_node', path: `${path}.content[${i}]`, detail: `Non-listItem "${child?.type}" inside a list was dropped.` })
      return
    }
    // A listItem usually wraps one paragraph. Flatten every inline
    // node into a single segment array per item.
    const segs: ExtendedParagraphSegment[] = []
    const kids = Array.isArray(child.content) ? child.content : []
    kids.forEach((sub: any, j: number) => {
      if (sub?.type === 'paragraph') {
        const inner = flattenInlineToSegments(sub.content ?? [], `${path}.content[${i}].content[${j}]`, warnings)
        if (segs.length > 0 && inner.length > 0) segs.push({ text: ' ' })
        segs.push(...inner)
      } else if (sub?.type) {
        warnings.push({ kind: 'unsupported_node', path: `${path}.content[${i}].content[${j}]`, detail: `Nested block "${sub.type}" inside a list item was dropped; only paragraphs are supported.` })
      }
    })
    if (segs.length > 0) items.push(coalesceSegments(segs))
  })
  return items
}

function flattenInlineToSegments(children: any[], path: string, warnings: ConversionWarning[]): ExtendedParagraphSegment[] {
  const out: ExtendedParagraphSegment[] = []
  children.forEach((node: any, i: number) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'text' && typeof node.text === 'string' && node.text.length > 0) {
      const seg: ExtendedParagraphSegment = { text: node.text }
      const marks: any[] = Array.isArray(node.marks) ? node.marks : []
      for (const m of marks) {
        if (!m || typeof m !== 'object' || typeof m.type !== 'string') continue
        if (!SUPPORTED_MARKS.has(m.type)) {
          warnings.push({ kind: 'unsupported_mark', path: `${path}[${i}]`, detail: `Mark "${m.type}" was dropped; text preserved.` })
          continue
        }
        if (m.type === 'bold')   seg.bold = true
        if (m.type === 'italic') seg.italic = true
        if (m.type === 'link') {
          const href = m.attrs?.href
          if (typeof href === 'string' && isSafeArticleHref(href)) {
            seg.href = href
          } else {
            warnings.push({ kind: 'unsafe_href', path: `${path}[${i}]`, detail: `Link href "${String(href).slice(0, 100)}" rejected; text preserved without link.` })
          }
        }
      }
      out.push(seg)
      return
    }
    if (node.type === 'hardBreak') {
      // Represent as a whitespace break for the plain-text renderer.
      out.push({ text: ' ' })
      return
    }
    // Any unexpected inline node is warned; text-only fallback.
    if (typeof node.type === 'string') {
      warnings.push({ kind: 'unsupported_inline', path: `${path}[${i}]`, detail: `Inline node "${node.type}" was dropped.` })
    }
  })
  return coalesceSegments(out)
}

function plainText(children: any[]): string {
  const parts: string[] = []
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      if (!n) continue
      if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text)
      else if (Array.isArray(n.content)) walk(n.content)
    }
  }
  walk(children)
  return parts.join('').trim()
}

function coerceLevel(v: unknown): 2 | 3 {
  return v === 3 ? 3 : 2
}

// Duplicate of the coalescer in richText.ts so this module can be
// tested without pulling the client-only file into a server test env.
function coalesceSegments(segments: readonly ExtendedParagraphSegment[]): ExtendedParagraphSegment[] {
  const out: ExtendedParagraphSegment[] = []
  for (const seg of segments) {
    if (!seg.text) continue
    const last = out[out.length - 1]
    if (last
      && !!last.bold   === !!seg.bold
      && !!last.italic === !!seg.italic
      && (last.href || '') === (seg.href || '')
    ) {
      last.text = last.text + seg.text
      continue
    }
    const copy: ExtendedParagraphSegment = { text: seg.text }
    if (seg.bold)   copy.bold   = true
    if (seg.italic) copy.italic = true
    if (seg.href)   copy.href   = seg.href
    out.push(copy)
  }
  return out
}
