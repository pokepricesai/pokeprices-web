// src/app/creators/submit/layout.tsx
// Block 5A-W-32 — the /creators/submit page is a client component and
// could not declare its own metadata. This layout supplies a noindex
// directive + self-referencing canonical so submit forms cannot be
// indexed as alternate versions of the creator directory.
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title:       'Submit a Creator | PokePrices',
  description: 'Add a Pokémon TCG creator to the PokePrices creator directory.',
  robots:      { index: false, follow: false },
  alternates:  { canonical: 'https://www.pokeprices.io/creators/submit' },
}

export default function CreatorsSubmitLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
