import DailyPickClient from './DailyPickClient'

export const metadata = {
  title: "Today's Pick | PokePrices Games",
  description: "Vote in today's PokePrices community matchup. See what other collectors picked.",
  alternates: { canonical: 'https://www.pokeprices.io/games/daily-pick' },
}

export default function Page() { return <DailyPickClient /> }
