'use client'
import Link from 'next/link'
import { useState } from 'react'

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)

  const navLinks = [
    { label: 'Insights', href: '/insights' },
    { label: 'Cards & Sets', href: '/browse' },
    { label: 'Contact', href: '/contact' },
  ]

  return (
    <nav style={{
      background: 'var(--primary)',
      padding: '0 24px',
      height: 58,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      borderBottom: '3px solid var(--accent)',
    }}>
      {/* Mobile hamburger - left side */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          background: 'none', border: 'none', color: '#fff',
          fontSize: 22, cursor: 'pointer', padding: '4px 8px',
          display: 'none',
        }}
        className="mobile-menu-btn"
      >
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* Spacer for mobile centering */}
      <div style={{ width: 40 }} className="mobile-spacer" />

      {/* Logo - centered */}
      <Link href="/" style={{
        display: 'flex', alignItems: 'center', gap: 10,
        textDecoration: 'none', position: 'absolute', left: '50%', transform: 'translateX(-50%)',
      }}>
        {/* Pokeball-style logo */}
        <div style={{
          width: 34, height: 34, borderRadius: '50%',
          background: 'linear-gradient(to bottom, var(--red) 48%, #333 48%, #333 52%, #fff 52%)',
          border: '2px solid #fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{
            width: 12, height: 12, borderRadius: '50%',
            background: 'var(--accent)', border: '2px solid #fff',
            zIndex: 1, fontWeight: 800, fontSize: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--primary)',
          }}>P</div>
        </div>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 19, letterSpacing: -0.5 }}>
          Poke<span style={{ color: 'var(--accent)' }}>Prices</span>
        </span>
        <span style={{
          background: 'rgba(255,203,5,0.2)', color: 'var(--accent)',
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
          marginLeft: 2, letterSpacing: 1,
        }}>BETA</span>
      </Link>

      {/* Desktop links - right side */}
      <div style={{ display: 'flex', gap: 28, alignItems: 'center', marginLeft: 'auto' }} className="desktop-nav">
        {navLinks.map((item) => (
          <Link key={item.label} href={item.href} style={{
            color: 'rgba(255,255,255,0.75)', textDecoration: 'none',
            fontSize: 14, fontWeight: 500, transition: 'color 0.2s',
          }}>{item.label}</Link>
        ))}
      </div>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div style={{
          position: 'absolute', top: 58, left: 0, right: 0,
          background: 'var(--primary-dark)', padding: '12px 24px 16px',
          borderBottom: '2px solid var(--accent)',
          zIndex: 99,
        }}>
          {navLinks.map((item) => (
            <Link key={item.label} href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'block', color: 'rgba(255,255,255,0.85)',
                textDecoration: 'none', padding: '10px 0', fontSize: 15,
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}>{item.label}</Link>
          ))}
        </div>
      )}

      <style jsx>{`
        @media (min-width: 768px) {
          .mobile-menu-btn { display: none !important; }
          .mobile-spacer { display: none !important; }
        }
        @media (max-width: 767px) {
          .mobile-menu-btn { display: block !important; }
          .desktop-nav { display: none !important; }
          .mobile-spacer { display: block !important; }
        }
      `}</style>
    </nav>
  )
}
