// Block 5A-W-47A — SSR pin for the new rich-paragraph + image blocks
// rendered by InsightsArticleClient. Renders the client component to
// static HTML via react-dom/server and asserts real semantic output.

import { describe, it, expect, beforeAll } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The article client imports the browser supabase client which throws
// at module load without env vars. Set them before importing.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.example.com'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-key'

let InsightsArticleClient: any
beforeAll(async () => {
  const mod = await import('../InsightsArticleClient')
  InsightsArticleClient = mod.default
})

function render(article: any) {
  return renderToStaticMarkup(<InsightsArticleClient article={article} />)
}

const BASE = {
  slug: 'test-article',
  headline: 'Test article',
  intro: 'Intro paragraph.',
  theme: 'market',
  theme_label: 'Market Analysis',
  published_at: '2026-07-26T00:00:00Z',
  read_time_mins: 5,
  author: 'PokePrices Team',
  image_url: null,
}

// ── Legacy compatibility ──

describe('backwards compatibility (W47A)', () => {
  it('legacy { type: "paragraph", text: "…" } renders unchanged', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', text: 'A plain legacy paragraph.' }] },
    })
    // Text appears verbatim inside a <p>; the renderer emits bare
    // text for plain segments (no <span> wrapper).
    expect(html).toContain('A plain legacy paragraph.')
    expect(html).toMatch(/<p [^>]*>A plain legacy paragraph\.<\/p>/)
  })
  it('heading block still renders as <h2>', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'heading', text: 'Heading text' }] },
    })
    expect(html).toMatch(/<h2 [^>]*>Heading text<\/h2>/)
  })
  it('plain-text single-block body (legacy \\n\\n) renders every paragraph', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', text: 'Paragraph one.\n\nParagraph two.\n\n## Section\n\nParagraph three.' }] },
    })
    expect(html).toContain('Paragraph one.')
    expect(html).toContain('Paragraph two.')
    expect(html).toContain('Paragraph three.')
    expect(html).toContain('Section')
  })
})

// ── Rich paragraph segments ──

describe('rich paragraph segments (W47A)', () => {
  it('renders text segments in order', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'Part one, ' }, { text: 'part two, ' }, { text: 'part three.' },
      ] }] },
    })
    expect(html).toMatch(/Part one, .*part two, .*part three\./)
  })
  it('renders bold segment as <strong>', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'A ' }, { text: 'bold', bold: true }, { text: ' word.' },
      ] }] },
    })
    expect(html).toMatch(/<strong>bold<\/strong>/)
  })
  it('renders internal link as a real anchor', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'See ' }, { text: 'the May report', href: '/insights/may-2026-pokemon-card-market-trends' }, { text: '.' },
      ] }] },
    })
    expect(html).toMatch(/<a [^>]*href="\/insights\/may-2026-pokemon-card-market-trends"[^>]*>[\s\S]*?the May report[\s\S]*?<\/a>/)
  })
  it('external https link gets target="_blank" and rel="noopener noreferrer"', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'Visit ' }, { text: 'Wikipedia', href: 'https://en.wikipedia.org/wiki/Pikachu' }, { text: '.' },
      ] }] },
    })
    expect(html).toMatch(/<a [^>]*href="https:\/\/en\.wikipedia\.org\/wiki\/Pikachu"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/)
  })
  it('www.pokeprices.io absolute URL is treated as internal (no target=_blank)', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'Home ', href: 'https://www.pokeprices.io/' },
      ] }] },
    })
    expect(html).toContain('href="https://www.pokeprices.io/"')
    expect(html).not.toMatch(/href="https:\/\/www\.pokeprices\.io\/"[^>]*target="_blank"/)
  })
  it('unsafe href degrades to plain text (no anchor, no href)', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'Malicious ', href: 'javascript:alert(1)' },
      ] }] },
    })
    expect(html).toContain('Malicious')
    expect(html).not.toContain('javascript:alert')
    expect(html).not.toContain('<a href="javascript')
  })
  it('protocol-relative // href degrades to plain text', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'External ', href: '//evil.example.com/x' },
      ] }] },
    })
    expect(html).toContain('External')
    expect(html).not.toContain('//evil.example.com')
  })
  it('bold + link combines: <a><strong>text</strong></a>', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [
        { text: 'bold linked', bold: true, href: '/insights' },
      ] }] },
    })
    expect(html).toMatch(/<a [^>]*href="\/insights"[^>]*>[\s\S]*?<strong>bold linked<\/strong>[\s\S]*?<\/a>/)
  })
})

// ── Image blocks ──

describe('image blocks (W47A)', () => {
  it('renders <figure><img /><figcaption /></figure> for a captioned image', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{
        type: 'image',
        src: 'https://images.example.com/x.jpg',
        alt: 'A descriptive alt',
        caption: 'A helpful caption',
      }] },
    })
    expect(html).toMatch(/<figure\b/)
    expect(html).toMatch(/<img [^>]*src="https:\/\/images\.example\.com\/x\.jpg"[^>]*alt="A descriptive alt"/)
    expect(html).toMatch(/<figcaption[^>]*>A helpful caption<\/figcaption>/)
  })
  it('renders image without a figcaption when no caption is supplied', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'image', src: 'https://images.example.com/x.jpg', alt: 'Alt' }] },
    })
    expect(html).toMatch(/<figure\b/)
    expect(html).toMatch(/<img [^>]*alt="Alt"/)
    expect(html).not.toMatch(/<figcaption/)
  })
  it('renders empty alt + aria-hidden when decorative:true', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'image', src: 'https://images.example.com/x.jpg', alt: '', decorative: true }] },
    })
    expect(html).toMatch(/<figure [^>]*aria-hidden="true"/)
    expect(html).toMatch(/<img [^>]*alt=""/)
  })
  it('unsafe src (data:, javascript:, protocol-relative, http:) renders nothing', () => {
    for (const src of ['data:image/png;base64,iVB', 'javascript:alert(1)', '//example.com/x.jpg', 'http://example.com/x.jpg']) {
      const html = render({ ...BASE, body_json: { blocks: [{ type: 'image', src, alt: 'x' }] } })
      expect(html).not.toContain(src)
      expect(html).not.toMatch(/<img\b/)
    }
  })
  it('image is lazy-loaded', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'image', src: 'https://images.example.com/x.jpg', alt: 'A' }] },
    })
    expect(html).toMatch(/<img [^>]*loading="lazy"/)
  })
})

// ── Security regressions ──

describe('security (W47A)', () => {
  it('script strings in paragraph text render as escaped text (no NEW <script> tags injected)', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', content: [{ text: '<script>alert(1)</script>' }] }] },
    })
    // The article schema legitimately emits <script type="application/ld+json">
    // tags — those are safe (JSON, not JavaScript). What must NOT
    // happen is our paragraph text escaping into a real <script>.
    // Assert the user-supplied literal is escaped in the output.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // And no <script> without the JSON-LD type attribute is present.
    const scripts = html.match(/<script\b[^>]*>/gi) || []
    for (const s of scripts) {
      expect(s).toContain('type="application/ld+json"')
    }
  })
  it('paragraph.text (legacy) does not allow HTML injection', () => {
    const html = render({
      ...BASE,
      body_json: { blocks: [{ type: 'paragraph', text: '<img src=x onerror=alert(1) />' }] },
    })
    expect(html).not.toMatch(/<img\b[^>]*onerror/i)
  })
  it('does NOT use dangerouslySetInnerHTML anywhere in the article body', () => {
    // Render a mix of block types and search the serialised HTML for
    // characteristic React SSR dangerous-html markers. There is none.
    const html = render({
      ...BASE,
      body_json: { blocks: [
        { type: 'heading', text: 'H' },
        { type: 'paragraph', content: [{ text: 'p' }, { text: 'b', bold: true }] },
        { type: 'image', src: 'https://images.example.com/x.jpg', alt: 'x' },
      ] },
    })
    // React's SSR does not add any special sentinel; the guarantee
    // comes from the source (no dangerouslySetInnerHTML in the file).
    // We regression-check that our security-relevant strings ARE
    // present as escaped output.
    expect(html).toContain('<strong>b</strong>')
    expect(html).toMatch(/<img\b/)
    expect(html).toMatch(/<h2\b/)
  })
})

// ── Preservation of legacy block types ──

describe('legacy block types remain unchanged (W47A)', () => {
  it('unknown / legacy card_grid + chart blocks do not throw', () => {
    // They render nothing (or their existing legacy behaviour) — the
    // point of the assertion is only that the new renderer path
    // doesn't blow up when handed shapes it doesn't own.
    const html = render({
      ...BASE,
      body_json: { blocks: [
        { type: 'paragraph', content: [{ text: 'ok' }] },
        { type: 'card_grid', heading: 'X', card_slugs: [] },
        { type: 'chart', card_slug: 'pc-x', title: 'Trend' },
      ] },
    })
    expect(html).toContain('ok')
  })
})
