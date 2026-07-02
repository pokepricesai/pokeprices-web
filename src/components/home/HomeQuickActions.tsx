'use client'

// src/components/home/HomeQuickActions.tsx
// Block 5A-W-40B — six clean text pills placed directly under the
// hero search. Auth-aware: swaps between logged-out browse+signup
// intent and logged-in browse+dashboard intent once the Supabase
// session resolves. Initial render is the logged-out set so anonymous
// visitors never see a logged-in flash.
//
// Design constraints (W40 brief):
//   * No emoji glyphs on any label.
//   * Clean pill styling that reads on the hero's blue gradient.
//   * Same 6-item grid for both auth states so there's no layout
//     shift when the session flips in.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

type Variant = 'primary' | 'accent'

type Action = {
  label:   string
  href:    string
  variant: Variant
}

// Logged-out visitors — browse + one accent Sign-up CTA. Six items
// so the grid dimensions match the logged-in variant below.
export const LOGGED_OUT_ACTIONS: readonly Action[] = [
  { label: 'Browse Cards & Sets',   href: '/browse',                        variant: 'primary' },
  { label: 'Browse Pokémon',        href: '/pokemon',                       variant: 'primary' },
  { label: 'Market Movers',         href: '#market-movers',                 variant: 'primary' },
  { label: 'View Insights',         href: '/insights',                      variant: 'primary' },
  { label: 'Ask the AI Assistant',  href: '/ai-assistant',                  variant: 'primary' },
  { label: 'Sign up free',          href: '/dashboard/login?mode=signup',   variant: 'accent'  },
]

export const LOGGED_IN_ACTIONS: readonly Action[] = [
  { label: 'Browse Cards & Sets',   href: '/browse',                       variant: 'primary' },
  { label: 'Browse Pokémon',        href: '/pokemon',                      variant: 'primary' },
  { label: 'Market Movers',         href: '#market-movers',                variant: 'primary' },
  { label: 'My Dashboard',          href: '/dashboard',                    variant: 'accent'  },
  { label: 'My Watchlist',          href: '/dashboard/watchlist-alerts',   variant: 'primary' },
  { label: 'My Portfolio',          href: '/dashboard/portfolio',          variant: 'primary' },
]

function pillStyle(variant: Variant): React.CSSProperties {
  const base: React.CSSProperties = {
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '10px 16px',
    borderRadius:   999,
    fontSize:       13,
    fontWeight:     700,
    fontFamily:     "'Figtree', sans-serif",
    textDecoration: 'none',
    whiteSpace:     'nowrap',
    letterSpacing:  0.2,
    transition:     'transform 0.15s, background 0.15s, box-shadow 0.15s',
  }
  if (variant === 'accent') {
    return {
      ...base,
      background: 'var(--accent)',
      color:      '#1a1a1a',
      border:     '1px solid var(--accent)',
      boxShadow:  '0 4px 14px rgba(255,203,5,0.30)',
    }
  }
  return {
    ...base,
    background: 'rgba(255,255,255,0.14)',
    color:      '#fff',
    border:     '1px solid rgba(255,255,255,0.24)',
    backdropFilter: 'blur(6px)',
  }
}

export default function HomeQuickActions() {
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

  const actions = isAuthed ? LOGGED_IN_ACTIONS : LOGGED_OUT_ACTIONS

  return (
    <div
      aria-label="Homepage quick actions"
      style={{
        marginTop:     18,
        display:       'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap:           8,
        maxWidth:      640,
        marginLeft:    'auto',
        marginRight:   'auto',
      }}
    >
      {actions.map(a => (
        <Link
          key={a.label}
          href={a.href}
          style={pillStyle(a.variant)}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLAnchorElement
            el.style.transform = 'translateY(-1px)'
            if (a.variant === 'accent') {
              el.style.boxShadow = '0 6px 18px rgba(255,203,5,0.40)'
            } else {
              el.style.background = 'rgba(255,255,255,0.22)'
            }
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLAnchorElement
            el.style.transform = ''
            if (a.variant === 'accent') {
              el.style.boxShadow = '0 4px 14px rgba(255,203,5,0.30)'
            } else {
              el.style.background = 'rgba(255,255,255,0.14)'
            }
          }}
        >
          {a.label}
        </Link>
      ))}
    </div>
  )
}
