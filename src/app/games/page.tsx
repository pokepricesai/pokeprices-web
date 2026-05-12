// app/games/page.tsx
import Link from 'next/link'

export const metadata = {
  title: 'Daily Pokémon Games & Quizzes | PokePrices',
  description: 'Three quick daily games for Pokémon TCG collectors. Guess the price, run a higher-or-lower streak, and vote in today\'s pick. Free, no login.',
}

const GAMES = [
  {
    href: '/games/guess-price',
    kind: 'Daily Quiz',
    title: 'Guess the Price',
    blurb: 'One real Pokémon card a day. Guess what it sold for. See how close you got. Share the score.',
    accent: 'linear-gradient(135deg, #1a5fad 0%, #2874c8 100%)',
    emoji: '🎯',
  },
  {
    href: '/games/higher-lower',
    kind: 'Streak Game',
    title: 'Higher or Lower',
    blurb: 'Two cards, pick the more valuable one. Chain it as far as you can before you miss. Wordle for collectors.',
    accent: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
    emoji: '📈',
  },
  {
    href: '/games/daily-pick',
    kind: 'Community Vote',
    title: "Today's Pick",
    blurb: 'A new matchup every day. Vote your side, see what the rest of the collector community said. Share your verdict.',
    accent: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
    emoji: '🗳️',
  },
]

export default function GamesLanding() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '36px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.10)', padding: '4px 12px', borderRadius: 14, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          Daily · Free · No login
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 36, margin: '0 0 8px', color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Pokémon Games & Polls
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
          Three quick games built on real PokePrices sales data. Fresh ones every day, played by everyone at the same time. Beat your streak and post the result.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {GAMES.map(g => (
          <Link key={g.href} href={g.href}
            style={{
              display: 'flex', flexDirection: 'column', textDecoration: 'none',
              background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)',
              overflow: 'hidden', transition: 'transform 0.15s, box-shadow 0.15s',
            }}>
            <div style={{
              background: g.accent, color: '#fff',
              padding: '36px 22px', display: 'flex', flexDirection: 'column',
              alignItems: 'flex-start', gap: 10, minHeight: 160,
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, opacity: 0.85 }}>
                {g.kind}
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, fontFamily: "'Outfit', sans-serif", lineHeight: 1.1 }}>
                {g.title}
              </div>
              <div style={{ marginTop: 'auto', fontSize: 32 }}>{g.emoji}</div>
            </div>
            <div style={{ padding: '18px 20px 22px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 14px' }}>
                {g.blurb}
              </p>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 'auto' }}>
                Play today's →
              </span>
            </div>
          </Link>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 36, lineHeight: 1.6 }}>
        Everyone plays the same daily card / streak / matchup. Results reset at midnight UTC.<br />
        Built on real sold-listing data — no asking prices, no guesses.
      </p>
    </div>
  )
}
