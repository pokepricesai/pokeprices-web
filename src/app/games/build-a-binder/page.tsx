// app/games/build-a-binder/page.tsx
// Block 5A-W-47E — server metadata for Build a Binder.
import BuildABinderClient from './BuildABinderClient'

export const metadata = {
  title: 'Build a Binder — Pokémon Card Game | PokePrices',
  description:
    'Pick 5 Pokémon cards without going over your budget. Real market prices. Free to play, no login.',
  alternates: { canonical: 'https://www.pokeprices.io/games/build-a-binder' },
  openGraph: {
    title: 'Build a Binder — Pokémon Card Game',
    description:
      'Pick 5 Pokémon cards without going over your budget. Real market prices. Free to play, no login.',
    url: 'https://www.pokeprices.io/games/build-a-binder',
    siteName: 'PokePrices',
    type: 'website',
  },
}

export default function BuildABinderPage() {
  return <BuildABinderClient />
}
