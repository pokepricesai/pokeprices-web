// ArticleSchema — emits schema.org Article for insights posts
// Earns author byline + date treatment in SERPs
export default function ArticleSchema({ article }: { article: any }) {
  if (!article) return null

  const url = `https://www.pokeprices.io/insights/${article.slug}`
  const headline = article.headline || article.title || article.seo_title
  const description = article.seo_description || article.excerpt || ''
  const author = article.author || 'PokePrices'

  const schema = {
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
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}
