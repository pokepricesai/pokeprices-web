import Link from 'next/link'

const topSets = [
  'Base Set',
  'Jungle',
  'Fossil',
  'Team Rocket',
  'Neo Genesis',
  'Celestial Storm',
  'Hidden Fates',
  'Evolving Skies',
]

export default function Footer() {
  return (
    <footer style={{
      background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
      padding: '32px 24px 24px',
      textAlign: 'center',
    }}>
      <div style={{ marginBottom: 14 }}>
        <img src="/logo.png" alt="PokePrices" style={{ height: 34, margin: '0 auto' }} />
      </div>

      {/* Main nav links */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 24,
        marginBottom: 20, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Home', href: '/' },
          { label: 'Insights', href: '/insights' },
          { label: 'Cards & Sets', href: '/browse' },
          { label: 'Contact', href: '/contact' },
        ].map((link) => (
          <Link key={link.label} href={link.href} style={{
            color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13,
            fontWeight: 600,
          }}>{link.label}</Link>
        ))}
      </div>

      {/* Popular sets */}
      <div style={{ marginBottom: 20 }}>
        <p style={{
          color: 'rgba(255,255,255,0.35)', fontSize: 11, marginBottom: 8,
          textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700,
        }}>Popular Sets</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
          {topSets.map((set) => (
            <Link key={set} href={`/set/${encodeURIComponent(set)}`} style={{
              color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: 12,
              fontWeight: 500,
              transition: 'color 0.15s',
            }}>{set}</Link>
          ))}
        </div>
      </div>

      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '0 auto 6px', maxWidth: 500 }}>
        Built by collectors, for collectors. Not affiliated with or endorsed by Nintendo, The Pokémon Company, or any grading service.
      </p>
      <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>
        Prices sourced from public marketplaces and displayed in USD. Informational only.
      </p>
    </footer>
  )
}
