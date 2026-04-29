// CreatorSchema — emits ProfilePage + Person schema for creator profiles.
// `sameAs` includes their public platform links (YouTube, X, etc.) — important for E-E-A-T.

interface Creator {
  slug: string
  name: string
  description?: string | null
  avatar_url?: string | null
  banner_url?: string | null
  platforms?: { name: string; url: string }[] | null
  primary_focus?: string | null
}

export default function CreatorSchema({ creator }: { creator: Creator }) {
  if (!creator) return null

  const url = `https://www.pokeprices.io/creators/${creator.slug}`
  const sameAs = (creator.platforms || []).map(p => p.url).filter(Boolean)

  const graph: any = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${url}#profile`,
        url,
        name: `${creator.name} — Pokémon TCG creator`,
        description: creator.description || `Pokémon TCG creator ${creator.name} listed in the PokePrices community directory.`,
        mainEntity: { '@id': `${url}#person` },
        isPartOf: { '@id': 'https://www.pokeprices.io/#website' },
      },
      {
        '@type': 'Person',
        '@id': `${url}#person`,
        name: creator.name,
        url,
        description: creator.description || undefined,
        image: creator.avatar_url || undefined,
        sameAs: sameAs.length > 0 ? sameAs : undefined,
        knowsAbout: creator.primary_focus
          ? [creator.primary_focus, 'Pokémon TCG']
          : ['Pokémon TCG'],
      },
    ],
  }

  const clean = JSON.parse(JSON.stringify(graph))

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(clean) }}
    />
  )
}
