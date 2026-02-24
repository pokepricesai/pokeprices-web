import Link from 'next/link'

export default function Footer() {
  return (
    <footer style={{
      background: 'var(--primary)',
      padding: '32px 24px 24px',
      textAlign: 'center',
      borderTop: '3px solid var(--accent)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 8, marginBottom: 14,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          background: 'linear-gradient(to bottom, var(--red) 48%, #333 48%, #333 52%, #fff 52%)',
          border: '1.5px solid #fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'var(--accent)', border: '1.5px solid #fff',
            zIndex: 1,
          }} />
        </div>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>
          Poke<span style={{ color: 'var(--accent)' }}>Prices</span>
        </span>
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
            color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: 13,
            transition: 'color 0.15s',
          }}>{link.label}</Link>
        ))}
      </div>

      <div style={{
        width: 60, height: 2, background: 'var(--accent)', opacity: 0.3,
        margin: '0 auto 14px', borderRadius: 1,
      }} />

      <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '0 auto 6px', maxWidth: 500 }}>
        Built by collectors, for collectors. PokePrices is not affiliated with or endorsed by Nintendo, The Pokemon Company, or any grading service.
      </p>
      <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>
        Data sourced from public marketplaces. Prices are informational only.
      </p>
    </footer>
  )
}
