// src/lib/studio/__tests__/adapter.test.ts
//
// EIC Block 7 — Studio (TipTap doc) → Insights body adapter tests.

import { describe, it, expect } from 'vitest'
import { studioDocumentToInsightBody } from '../adapter'

function doc(...content: any[]) {
  return { type: 'doc', content }
}
function p(...inline: any[]) { return { type: 'paragraph', content: inline } }
function h(level: number, text: string) { return { type: 'heading', attrs: { level }, content: [t(text)] } }
function t(text: string, ...marks: any[]) { return { type: 'text', text, marks } }
function mark(type: string, attrs?: any) { return attrs ? { type, attrs } : { type } }

describe('studioDocumentToInsightBody — basic nodes', () => {
  it('converts a simple paragraph', () => {
    const { body, warnings } = studioDocumentToInsightBody(doc(p(t('Hello world.'))))
    expect(warnings).toEqual([])
    expect(body.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'Hello world.' }] }])
  })

  it('drops trailing empty paragraphs (TipTap adds these liberally)', () => {
    const { body } = studioDocumentToInsightBody(doc(p(t('First.')), p()))
    expect(body.blocks).toHaveLength(1)
  })

  it('maps H2 without a level and H3 with level=3', () => {
    const { body } = studioDocumentToInsightBody(doc(h(2, 'Big'), h(3, 'Smaller')))
    expect(body.blocks).toEqual([
      { type: 'heading', text: 'Big' },
      { type: 'heading', text: 'Smaller', level: 3 },
    ])
  })

  it('emits an hr block', () => {
    const { body } = studioDocumentToInsightBody(doc({ type: 'horizontalRule' }))
    expect(body.blocks).toEqual([{ type: 'hr' }])
  })

  it('emits an image block with src/alt/caption', () => {
    const { body } = studioDocumentToInsightBody(doc({ type: 'image', attrs: { src: 'https://cdn.example/x.jpg', alt: 'A', caption: 'A cap' } }))
    expect(body.blocks).toEqual([{ type: 'image', src: 'https://cdn.example/x.jpg', alt: 'A', caption: 'A cap' }])
  })
})

describe('studioDocumentToInsightBody — inline marks', () => {
  it('preserves bold + italic + link (safe href)', () => {
    const { body, warnings } = studioDocumentToInsightBody(doc(p(
      t('normal '),
      t('bold ',   mark('bold')),
      t('italic ', mark('italic')),
      t('linked',  mark('link', { href: '/insights/foo' })),
    )))
    expect(warnings).toEqual([])
    expect(body.blocks).toEqual([{
      type: 'paragraph',
      content: [
        { text: 'normal ' },
        { text: 'bold ',   bold:   true },
        { text: 'italic ', italic: true },
        { text: 'linked',  href:   '/insights/foo' },
      ],
    }])
  })

  it('drops unsafe link hrefs but keeps the text (with warning)', () => {
    const { body, warnings } = studioDocumentToInsightBody(doc(p(
      t('click', mark('link', { href: 'javascript:alert(1)' })),
    )))
    expect(body.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'click' }] }])
    expect(warnings.some(w => w.kind === 'unsafe_href')).toBe(true)
  })

  it('coalesces adjacent segments with identical formatting', () => {
    const { body } = studioDocumentToInsightBody(doc(p(
      t('ab', mark('bold')),
      t('cd', mark('bold')),
    )))
    expect(body.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'abcd', bold: true }] }])
  })

  it('turns hardBreak into a space so plain-text stays readable', () => {
    const { body } = studioDocumentToInsightBody(doc(p(t('A'), { type: 'hardBreak' }, t('B'))))
    expect(body.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'A B' }] }])
  })
})

describe('studioDocumentToInsightBody — lists + blockquote', () => {
  it('converts bulletList into an unordered list block', () => {
    const { body } = studioDocumentToInsightBody(doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(t('One'))] },
        { type: 'listItem', content: [p(t('Two', mark('bold')))] },
      ],
    }))
    expect(body.blocks).toEqual([{
      type: 'list',
      ordered: false,
      items: [[{ text: 'One' }], [{ text: 'Two', bold: true }]],
    }])
  })

  it('converts orderedList and preserves ordered=true', () => {
    const { body } = studioDocumentToInsightBody(doc({
      type: 'orderedList',
      content: [{ type: 'listItem', content: [p(t('Step 1'))] }],
    }))
    expect(body.blocks).toEqual([{ type: 'list', ordered: true, items: [[{ text: 'Step 1' }]] }])
  })

  it('converts a blockquote wrapping paragraphs into a quote block', () => {
    const { body } = studioDocumentToInsightBody(doc({
      type: 'blockquote',
      content: [p(t('Line one.')), p(t('Line two.'))],
    }))
    expect(body.blocks).toEqual([{
      type: 'quote',
      content: [{ text: 'Line one.' }, { text: ' ' }, { text: 'Line two.' }],
    }])
  })
})

describe('studioDocumentToInsightBody — unsupported content is not silent', () => {
  it('warns when the doc root is malformed', () => {
    const { body, warnings } = studioDocumentToInsightBody({ notADoc: true } as any)
    expect(body.blocks).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  it('warns and drops unsupported node types', () => {
    const { body, warnings } = studioDocumentToInsightBody(doc({ type: 'codeBlock', content: [t('const x = 1')] }))
    expect(body.blocks).toEqual([])
    expect(warnings.some(w => w.kind === 'unsupported_node')).toBe(true)
  })

  it('warns on unsupported inline marks', () => {
    const { body, warnings } = studioDocumentToInsightBody(doc(p(t('sub', mark('subscript' as any)))))
    expect(body.blocks).toEqual([{ type: 'paragraph', content: [{ text: 'sub' }] }])
    expect(warnings.some(w => w.kind === 'unsupported_mark')).toBe(true)
  })

  it('emits data_block placeholder unchanged for Block 8 payloads', () => {
    const { body } = studioDocumentToInsightBody(doc({ type: 'dataBlock', attrs: { variant: 'ranking_table', payload: { rows: 5 } } }))
    expect(body.blocks).toEqual([{ type: 'data_block', variant: 'ranking_table', payload: { rows: 5 } }])
  })
})

describe('legacy-article safety', () => {
  // The adapter is a ONE-WAY converter: TipTap → insight body. It
  // never runs against the existing 8 articles. The renderer is
  // extended additively; a paragraph without `content` or a heading
  // without `level` renders exactly as before. This test locks the
  // shape the adapter produces so future rendering changes do not
  // regress the byte-invariant guarantee.
  it('generates block shapes that a paragraph-only legacy renderer already accepts', () => {
    const { body } = studioDocumentToInsightBody(doc(p(t('hello'))))
    const block = body.blocks[0] as any
    expect(block.type).toBe('paragraph')
    // Every paragraph the adapter emits carries `content`. Legacy
    // paragraphs (no `content`, only `text`) are unchanged; the
    // renderer prefers `content` when present but falls back to
    // `text`, which keeps existing articles byte-invariant.
    expect(Array.isArray(block.content)).toBe(true)
    // Verify the shape does NOT include a legacy `text` field that
    // could shadow `content` in an old renderer.
    expect('text' in block).toBe(false)
  })
})
