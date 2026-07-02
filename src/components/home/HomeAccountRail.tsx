'use client'

// src/components/home/HomeAccountRail.tsx
// Block 5A-W-41A — right-rail account panel on the homepage
// dashboard opening. Auth-aware via the existing Supabase session
// pattern already used by Navbar + HomeQuickActions.
//
// Design goals:
//   * one small panel per auth state, same wrapper dimensions so
//     the layout doesn't shift when the session flips in;
//   * text-only labels (no emoji);
//   * for logged-out visitors, the accent Sign-up-free button is
//     the only visually loud element — everything else stays quiet;
//   * for logged-in visitors, a simple list of the three account
//     entry points (dashboard / watchlist / portfolio) with the
//     dashboard highlighted as the primary destination.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

export const LOGGED_OUT_LINKS = [
  { label: 'Sign up free', href: '/dashboard/login?mode=signup', variant: 'accent'  as const },
  { label: 'Log in',       href: '/dashboard/login',             variant: 'text'    as const },
]

export const LOGGED_IN_LINKS = [
  { label: 'My Dashboard', href: '/dashboard',                     variant: 'accent' as const },
  { label: 'My Watchlist', href: '/dashboard/watchlist-alerts',    variant: 'quiet'  as const },
  { label: 'My Portfolio', href: '/dashboard/portfolio',           variant: 'quiet'  as const },
]

const panelStyle: React.CSSProperties = {
  background:   'var(--card)',
  border:       '1px solid var(--border)',
  borderRadius: 16,
  padding:      '18px 20px',
  fontFamily:   "'Figtree', sans-serif",
}

const kickerStyle: React.CSSProperties = {
  fontSize:       10,
  fontWeight:     800,
  letterSpacing:  1.5,
  textTransform:  'uppercase',
  color:          'var(--text-muted)',
  margin:         '0 0 6px',
}

const headingStyle: React.CSSProperties = {
  fontSize:  16,
  fontWeight:800,
  margin:    '0 0 6px',
  color:     'var(--text)',
  fontFamily:"'Outfit', sans-serif",
}

const copyStyle: React.CSSProperties = {
  fontSize:  12.5,
  color:     'var(--text-muted)',
  margin:    '0 0 12px',
  lineHeight:1.55,
}

function accentBtnStyle(): React.CSSProperties {
  return {
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '9px 14px',
    borderRadius:   999,
    fontSize:       13,
    fontWeight:     800,
    color:          '#1a1a1a',
    background:     'var(--accent)',
    border:         '1px solid var(--accent)',
    textDecoration: 'none',
    boxShadow:      '0 4px 14px rgba(255,203,5,0.30)',
  }
}
function quietRowStyle(): React.CSSProperties {
  return {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '8px 12px',
    borderRadius:   10,
    fontSize:       13,
    fontWeight:     700,
    color:          'var(--text)',
    background:     'var(--bg-light)',
    border:         '1px solid var(--border)',
    textDecoration: 'none',
  }
}
function textLinkStyle(): React.CSSProperties {
  return {
    display:        'inline-block',
    padding:        '8px 0 0',
    fontSize:       12,
    fontWeight:     700,
    color:          'var(--text-muted)',
    textDecoration: 'none',
  }
}

export default function HomeAccountRail() {
  const [isAuthed, setIsAuthed] = useState(false)

  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (live) setIsAuthed(!!session)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (live) setIsAuthed(!!session)
    })
    return () => { live = false; subscription.unsubscribe() }
  }, [])

  if (isAuthed) {
    return (
      <aside aria-label="Your account" style={panelStyle}>
        <p style={kickerStyle}>Account</p>
        <h3 style={headingStyle}>Your account</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {LOGGED_IN_LINKS.map(link => (
            <Link
              key={link.label}
              href={link.href}
              style={link.variant === 'accent' ? accentBtnStyle() : quietRowStyle()}
            >
              {link.variant === 'accent' ? link.label : <>
                <span>{link.label}</span>
                <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: 12 }}>→</span>
              </>}
            </Link>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside aria-label="Track your collection" style={panelStyle}>
      <p style={kickerStyle}>Free account</p>
      <h3 style={headingStyle}>Track your collection</h3>
      <p style={copyStyle}>
        Create a free account to save cards, build a portfolio and watch price movement.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Link href={LOGGED_OUT_LINKS[0]!.href} style={accentBtnStyle()}>
          {LOGGED_OUT_LINKS[0]!.label}
        </Link>
        <Link href={LOGGED_OUT_LINKS[1]!.href} style={textLinkStyle()}>
          {LOGGED_OUT_LINKS[1]!.label}
        </Link>
      </div>
    </aside>
  )
}
