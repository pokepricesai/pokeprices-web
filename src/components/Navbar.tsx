'use client'
import Link from 'next/link'
import { useState } from 'react'

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <nav style={{
      background: 'var(--primary)',
      padding: '0 24px',
      height: 56,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 16, color: 'var(--primary)',
          fontFamily: "'DM Serif Display', serif",
        }}>P</div>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 18, letterSpacing: -0.5 }}>
          Poke<span style={{ color: 'var(--accent)' }}>Prices</span>
        </span>
        <span style={{
          background: 'rgba(232,183,48,0.2)', color: 'var(--accent)',
          fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
          marginLeft: 4, letterSpacing: 1,
        }}>BETA</span>
      </Link>

      {/* Desktop links */}
      <div style={{ display: 'flex', gap: 28, alignItems: 'center' }} className="hidden md:flex">
        {[
          { label: 'Insights', href: '/insights' },
          { label: 'Cards & Sets', href: '/browse' },
          { label: 'Contact', href: '/contact' },
        ].map((item) => (
          <Link key={item.label} href={item.href} style={{
            color: 'rgba(255,255,255,0.75)', textDecoration: 'none',
            fontSize: 14, fontWeight: 500, transition: 'color 0.2s',
          }}>{item.label}</Link>
        ))}
      </div>

      {/* Mobile hamburger */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="md:hidden"
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer' }}
      >
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{
          position: 'absolute', top: 56, left: 0, right: 0,
          background: 'var(--primary)', padding: '16px 24px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }} className="md:hidden">
          {[
            { label: 'Insights', href: '/insights' },
            { label: 'Cards & Sets', href: '/browse' },
            { label: 'Contact', href: '/contact' },
          ].map((item) => (
            <Link key={item.label} href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'block', color: 'rgba(255,255,255,0.85)',
                textDecoration: 'none', padding: '10px 0', fontSize: 15,
              }}>{item.label}</Link>
          ))}
        </div>
      )}
    </nav>
  )
}
