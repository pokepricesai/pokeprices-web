// app/games/guess-the-card/page.tsx
// Block 5A-W-47E-B — server metadata for the Guess the Card game.
import GuessTheCardClient from './GuessTheCardClient'

export const metadata = {
  title: 'Guess the Pokémon Card | PokePrices',
  description:
    'Identify Pokémon cards from obscured artwork, reveal clues after each guess and build your streak.',
  alternates: { canonical: 'https://www.pokeprices.io/games/guess-the-card' },
  openGraph: {
    title: 'Guess the Pokémon Card',
    description:
      'Identify Pokémon cards from obscured artwork, reveal clues after each guess and build your streak.',
    url: 'https://www.pokeprices.io/games/guess-the-card',
    siteName: 'PokePrices',
    type: 'website',
  },
}

export default function GuessTheCardPage() {
  return <GuessTheCardClient />
}
