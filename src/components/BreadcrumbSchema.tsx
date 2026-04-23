// src/components/BreadcrumbSchema.tsx
// Breadcrumb schema for all page types
// Usage:
//   Card page:    <BreadcrumbSchema items={[{name:'Sets',url:'/browse'},{name:setName,url:`/set/${slug}`},{name:cardName}]} />
//   Set page:     <BreadcrumbSchema items={[{name:'Sets',url:'/browse'},{name:setName}]} />
//   Pokemon page: <BreadcrumbSchema items={[{name:'Pokémon',url:'/pokemon'},{name:pokemonName}]} />
//   Article page: <BreadcrumbSchema items={[{name:'Guides',url:'/insights'},{name:articleTitle}]} />

interface BreadcrumbItem {
  name: string
  url?: string
}

export default function BreadcrumbSchema({ items }: { items: BreadcrumbItem[] }) {
  if (!items || items.length === 0) return null

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'PokePrices',
        item: 'https://www.pokeprices.io',
      },
      ...items.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 2,
        name: item.name,
        ...(item.url ? { item: `https://www.pokeprices.io${item.url}` } : {}),
      })),
    ],
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  )
}