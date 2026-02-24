import Link from 'next/link'

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

      <div style={{
        display: 'flex', justifyContent: 'center', gap: 24,
        marginBottom: 14, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Home', href: '/' },
          { label: 'Insights', href: '/insights' },
          { label: 'Cards & Sets', href: '/browse' },
          { label: 'Contact', href: '/contact' },
        ].map((link) => (
          <Link key={link.label} href={link.href} style={{
            color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 13,
            fontWeight: 600,
          }}>{link.label}</Link>
        ))}
      </div>

      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '0 auto 6px', maxWidth: 500 }}>
        Built by collectors, for collectors. Not affiliated with or endorsed by Nintendo, The Pokemon Company, or any grading service.
      </p>
      <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>
        Data sourced from public marketplaces. Prices are informational only.
      </p>
    </footer>
  )
}
