'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface Counts {
  portfolio: number | null
  watchlist: number | null
  alerts: number | null
  alertsTriggered: number | null
}

export default function DashboardHubClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<Counts>({ portfolio: null, watchlist: null, alerts: null, alertsTriggered: null })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/dashboard/login'); return }
      setUser(session.user)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/dashboard/login')
      else setUser(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!user) return
    async function safeCount(table: string, build: (q: any) => any): Promise<number | null> {
      try {
        const q = build(supabase.from(table).select('id', { count: 'exact', head: true }).eq('user_id', user.id))
        const { count, error } = await q
        if (error) return null
        return count ?? 0
      } catch {
        return null
      }
    }
    async function loadCounts() {
      const [portfolio, watchlist, alerts, alertsTriggered] = await Promise.all([
        safeCount('portfolio_items', (q: any) => q),
        safeCount('watchlist',       (q: any) => q),
        safeCount('user_alerts',     (q: any) => q.eq('is_active', true)),
        safeCount('user_alerts',     (q: any) => q.not('triggered_at', 'is', null)),
      ])
      setCounts({ portfolio, watchlist, alerts, alertsTriggered })
    }
    loadCounts()
  }, [user])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) {
    return (
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '40px 24px' }}>
        <div className="skeleton" style={{ height: 40, width: '40%', marginBottom: 24, borderRadius: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton" style={{ height: 130, borderRadius: 16 }} />)}
        </div>
      </div>
    )
  }

  const tools = [
    {
      id: 'portfolio',
      title: 'Portfolio',
      desc: 'Track what you own — collection value, P&L, grading insights.',
      href: '/dashboard/portfolio',
      count: counts.portfolio,
      countLabel: 'cards',
      icon: '📊',
      colour: '#3b82f6',
    },
    {
      id: 'watchlist',
      title: 'Watchlist',
      desc: 'Cards you are watching — current value, 7d / 30d change, PSA premium.',
      href: '/dashboard/watchlist',
      count: counts.watchlist,
      countLabel: 'watching',
      icon: '👁',
      colour: '#a78bfa',
    },
    {
      id: 'sets',
      title: 'Set Completion',
      desc: 'Track which sets you are working on. Cheapest path to finish, biggest gaps, value owned.',
      href: '/dashboard/sets',
      count: null,
      countLabel: '',
      icon: '🧩',
      colour: '#22c55e',
    },
    {
      id: 'grading',
      title: 'Grading Calculator',
      desc: 'Should you grade it? Expected ROI by service, breakeven price, best candidates from your raw cards.',
      href: '/dashboard/grading',
      count: null,
      countLabel: '',
      icon: '🏷️',
      colour: '#f59e0b',
    },
    {
      id: 'trade',
      title: 'Trade Evaluator',
      desc: 'Build two stacks side-by-side, see fair value with cash / trade / blended modes.',
      href: '/dealer',
      count: null,
      countLabel: '',
      icon: '🔁',
      colour: '#06b6d4',
    },
    {
      id: 'alerts',
      title: 'Smart Alerts',
      desc: 'Get notified when a card hits your target price.',
      href: '/dashboard/alerts',
      count: null,
      countLabel: '',
      icon: '🔔',
      colour: '#94a3b8',
      highlight: false,
      comingSoon: true,
    },
    {
      id: 'settings',
      title: 'Settings',
      desc: 'Email preferences, weekly digest, account.',
      href: '/dashboard/settings',
      count: null,
      countLabel: '',
      icon: '⚙️',
      colour: '#94a3b8',
    },
  ]

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 16px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30, margin: '0 0 4px', color: 'var(--text)' }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
            {user?.email}
          </p>
        </div>
        <button onClick={handleSignOut} style={{
          padding: '8px 14px', borderRadius: 10,
          border: '1px solid var(--border)', background: 'transparent',
          color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
          fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
        }}>
          Sign out
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
        {tools.map(t => (
          <Link key={t.id} href={t.href} style={{ textDecoration: 'none' }}>
            <div style={{
              background: 'var(--card)',
              border: t.highlight ? `1px solid ${t.colour}` : '1px solid var(--border)',
              borderRadius: 16,
              padding: '20px 18px',
              height: '100%',
              boxSizing: 'border-box',
              transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
              cursor: 'pointer',
              position: 'relative',
              boxShadow: t.highlight ? `0 0 0 4px ${t.colour}1a` : 'none',
            }}
              onMouseEnter={e => {
                const el = e.currentTarget as HTMLDivElement
                el.style.transform = 'translateY(-2px)'
                el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)'
                el.style.borderColor = t.colour
              }}
              onMouseLeave={e => {
                const el = e.currentTarget as HTMLDivElement
                el.style.transform = ''
                el.style.boxShadow = t.highlight ? `0 0 0 4px ${t.colour}1a` : 'none'
                el.style.borderColor = t.highlight ? t.colour : 'var(--border)'
              }}
            >
              {(t as any).comingSoon && (
                <span style={{
                  position: 'absolute', top: 12, right: 12,
                  fontSize: 9, fontWeight: 800,
                  padding: '3px 8px', borderRadius: 12,
                  background: 'rgba(245,158,11,0.14)', color: '#b45309',
                  textTransform: 'uppercase', letterSpacing: 0.7,
                  fontFamily: "'Figtree', sans-serif",
                }}>Coming soon</span>
              )}
              <div style={{ fontSize: 26, marginBottom: 10, lineHeight: 1 }}>{t.icon}</div>
              <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 6px', color: 'var(--text)' }}>
                {t.title}
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px', lineHeight: 1.5 }}>
                {t.desc}
              </p>
              {t.count != null && (
                <div style={{ fontSize: 11, color: t.highlight ? t.colour : 'var(--text-muted)', fontWeight: 700, fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {t.count} {t.countLabel}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', margin: '32px 0 0', lineHeight: 1.6 }}>
        Free forever. No tracking. No data sold. Ever.
      </p>
    </div>
  )
}
