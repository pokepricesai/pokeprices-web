// ArticleSchema — emits schema.org Article for insights posts.
// Earns author byline + date treatment in SERPs and feeds Google Discover.

const SECTION_LABELS: Record<string, string> = {
  grading:    'Grading & PSA',
  collecting: 'Collecting Strategy',
  market:     'Market Analysis',
  vintage:    'Vintage Cards',
  modern:     'Modern Sets',
  investing:  'Investing',
  community:  'Community',
}

function approxWordCount(article: any): number | undefined {
  try {
    if (article.body_text && typeof article.body_text === 'string') {
      return article.body_text.trim().split(/\s+/).filter(Boolean).length
    }
    if (article.body_json && typeof article.body_json === 'string') {
      const parsed = JSON.parse(article.body_json)
      const blocks = Array.isArray(parsed?.blocks) ? parsed.blocks : []
      const text = blocks
        .map((b: any) => (b?.text || b?.content || '').toString())
        .join(' ')
      const wc = text.trim().split(/\s+/).filter(Boolean).length
      return wc > 0 ? wc : undefined
    }
  } catch { /* ignore */ }
  return undefined
}

export default function ArticleSchema({ article }: { article: any }) {
  if (!article) return null

  const url = `https://www.pokeprices.io/insights/${article.slug}`
  const headline = article.headline || article.title || article.seo_title
  const description = article.seo_description || article.excerpt || ''
  const author = article.author || 'PokePrices'
  const section = article.theme_label || SECTION_LABELS[article.theme] || undefined
  const keywords = [
    'Pokémon TCG',
    'Pokémon card prices',
    section,
    article.theme,
  ].filter(Boolean)
  const wordCount = approxWordCount(article)

  const schema: any = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${url}#article`,
    headline,
    description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: article.image_url || 'https://www.pokeprices.io/og-image.png',
    datePublished: article.published_at || undefined,
    dateModified: article.updated_at || article.published_at || undefined,
    author: { '@type': 'Person', name: author },
    publisher: { '@id': 'https://www.pokeprices.io/#org' },
    inLanguage: 'en-GB',
    articleSection: section,
    keywords,
    wordCount,
  }

  // Strip undefined values
  const clean = JSON.parse(JSON.stringify(schema))

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(clean) }}
    />
  )
}
