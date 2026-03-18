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
          { label: 'Vendor Directory', href: '/vendors' },
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
      <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: '0 0 14px' }}>
        Prices sourced from public marketplaces and displayed in USD. Informational only.
      </p>
      {/* Legal + social links */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 14, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <Link href="/terms" style={{
          color: 'rgba(255,255,255,0.3)', textDecoration: 'none', fontSize: 11,
          fontWeight: 500,
        }}>
          Terms of Service
        </Link>
        <a href="https://x.com/PokePricesIO" target="_blank" rel="noopener noreferrer" style={{
          color: 'rgba(255,255,255,0.3)', textDecoration: 'none', fontSize: 11,
          fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
          </svg>
          @PokePricesIO
        </a>
      </div>
    </footer>
  )
}
