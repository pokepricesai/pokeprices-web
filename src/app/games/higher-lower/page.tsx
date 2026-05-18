import HigherLowerClient from './HigherLowerClient'

export const metadata = {
  title: 'Higher or Lower — Pokémon Card Streak Game | PokePrices Games',
  description: 'Two Pokémon cards on screen. Pick which sold for more. Chain the streak as far as you can — fresh shuffle every game.',
  alternates: { canonical: 'https://www.pokeprices.io/games/higher-lower' },
}

export default function Page() { return <HigherLowerClient /> }
