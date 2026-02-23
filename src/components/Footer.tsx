import Link from 'next/link'

export default function Footer() {
  return (
    <footer style={{ background: 'var(--primary)', padding: '36px 24px 28px', textAlign: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 12, color: 'var(--primary)',
          fontFamily: "'DM Serif Display', serif",
        }}>P</div>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>
          Poke<span style={{ color: 'var(--accent)' }}>Prices</span>
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Home', href: '/' },
          { label: 'Insights', href: '/insights' },
          { label: 'Cards & Sets', href: '/browse' },
          { label: 'Contact', href: '/contact' },
        ].map((link) => (
          <Link key={link.label} href={link.href} style={{
            color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: 13,
          }}>{link.label}</Link>
        ))}
      </div>

      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '0 auto 8px', maxWidth: 500 }}>
        Built by collectors, for collectors. PokePrices is not affiliated with or endorsed by Nintendo, The Pokemon Company, or any grading service.
      </p>
      <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>
        Data sourced from public marketplaces. Prices are informational only.
      </p>
    </footer>
  )
}
