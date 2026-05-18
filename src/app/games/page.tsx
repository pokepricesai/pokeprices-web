// app/games/page.tsx
import Link from 'next/link'
import DailyPickClient from './daily-pick/DailyPickClient'

export const metadata = {
  title: 'Pokémon Card Games & Daily Pick | PokePrices',
  description: 'Vote in today\'s collector matchup, then play the anytime price quiz and higher-or-lower streak game. Free, no login.',
  alternates: { canonical: 'https://www.pokeprices.io/games' },
}

const ANYTIME_GAMES = [
  {
    href: '/games/guess-price',
    kind: 'Anytime quiz',
    title: 'Guess the Price',
    blurb: 'Real Pokémon card on screen. Guess what it sold for. Play as many rounds as you like.',
    accent: 'linear-gradient(135deg, #1a5fad 0%, #2874c8 100%)',
    emoji: '🎯',
  },
  {
    href: '/games/higher-lower',
    kind: 'Streak game',
    title: 'Higher or Lower',
    blurb: 'Two cards, pick the more valuable one. Chain as far as you can before you miss. Start over any time.',
    accent: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
    emoji: '📈',
  },
]

export default function GamesLanding() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.10)', padding: '4px 12px', borderRadius: 14, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          Free · No login
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 36, margin: '0 0 8px', color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Pokémon Games & Polls
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
          A daily community matchup plus a couple of anytime games built on real PokePrices sales data.
        </p>
      </div>

      {/* Today's Pick — daily matchup, embedded inline so it's the centrepiece. */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 18,
        padding: '22px 18px', marginBottom: 32,
      }}>
        <DailyPickClient embedded />
      </div>

      {/* Anytime games */}
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 4px', color: 'var(--text)' }}>
          Play anytime
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
          These two reset every game — play as many rounds as you like, no waiting for tomorrow.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {ANYTIME_GAMES.map(g => (
          <Link key={g.href} href={g.href}
            style={{
              display: 'flex', flexDirection: 'column', textDecoration: 'none',
              background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)',
              overflow: 'hidden', transition: 'transform 0.15s, box-shadow 0.15s',
            }}>
            <div style={{
              background: g.accent, color: '#fff',
              padding: '28px 20px', display: 'flex', flexDirection: 'column',
              alignItems: 'flex-start', gap: 8, minHeight: 130,
            }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, opacity: 0.85 }}>
                {g.kind}
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Outfit', sans-serif", lineHeight: 1.1 }}>
                {g.title}
              </div>
              <div style={{ marginTop: 'auto', fontSize: 26 }}>{g.emoji}</div>
            </div>
            <div style={{ padding: '16px 18px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 12px' }}>
                {g.blurb}
              </p>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 'auto' }}>
                Play →
              </span>
            </div>
          </Link>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 36, lineHeight: 1.6 }}>
        Today's Pick refreshes once a day, voted on by the whole community.<br />
        Built on real sold-listing data — no asking prices, no guesses.
      </p>
    </div>
  )
}
