import GuessPriceClient from './GuessPriceClient'

export const metadata = {
  title: 'Guess the Price — Pokémon TCG Quiz | PokePrices Games',
  description: 'Anytime Pokémon card price quiz. Guess what real cards actually sold for, play as many rounds as you like.',
  alternates: { canonical: 'https://www.pokeprices.io/games/guess-price' },
}

export default function Page() { return <GuessPriceClient /> }
