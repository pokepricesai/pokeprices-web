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
      background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
      padding: '0 24px',
      height: 60,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      boxShadow: '0 2px 15px rgba(26,95,173,0.3)',
    }}>
      {/* Mobile hamburger */}
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

      <div style={{ width: 40 }} className="mobile-spacer" />

      {/* Logo centered */}
      <Link href="/" style={{
        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
        textDecoration: 'none',
      }}>
        <img src="/logo.png" alt="PokePrices" style={{ height: 42 }} />
      </Link>

      {/* Desktop links */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginLeft: 'auto' }} className="desktop-nav">
        {navLinks.map((item) => (
          <Link key={item.label} href={item.href} style={{
            color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
            fontSize: 14, fontWeight: 700, transition: 'color 0.2s',
            letterSpacing: 0.3,
          }}>{item.label}</Link>
        ))}
      </div>

      {menuOpen && (
        <div style={{
          position: 'absolute', top: 60, left: 0, right: 0,
          background: 'linear-gradient(135deg, #15509a, #2268b8)',
          padding: '12px 24px 16px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
          zIndex: 99,
        }}>
          {navLinks.map((item) => (
            <Link key={item.label} href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'block', color: 'rgba(255,255,255,0.9)',
                textDecoration: 'none', padding: '10px 0', fontSize: 15,
                fontWeight: 700,
                borderBottom: '1px solid rgba(255,255,255,0.1)',
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
