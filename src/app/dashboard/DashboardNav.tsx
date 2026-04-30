'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// Shared sub-nav for every dashboard tool page.
// Pass `current` to highlight the active tool, or omit on the hub page.
export default function DashboardNav({
  current,
  email,
}: {
  current?: 'portfolio' | 'watchlist' | 'alerts' | 'settings'
  email?: string | null
}) {
  const router = useRouter()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  const tools = [
    { id: 'portfolio', label: 'Portfolio', href: '/dashboard/portfolio' },
    { id: 'watchlist', label: 'Watchlist', href: '/dashboard/watchlist' },
    { id: 'alerts',    label: 'Alerts',    href: '/dashboard/alerts', soon: true },
    { id: 'settings',  label: 'Settings',  href: '/dashboard/settings' },
  ] as const

  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
      marginBottom: 24,
      paddingBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <Link href="/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 700, color: 'var(--text-muted)',
          textDecoration: 'none', fontFamily: "'Figtree', sans-serif",
        }}>
          <span style={{ fontSize: 14 }}>←</span>
          Dashboard
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {email && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              {email}
            </span>
          )}
          <button onClick={handleSignOut} style={{
            padding: '6px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
            fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
          }}>
            Sign out
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tools.map(t => {
          const active = current === t.id
          return (
            <Link key={t.id} href={t.href} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 20,
              border: active ? '1px solid var(--primary)' : '1px solid var(--border)',
              background: active ? 'rgba(26,95,173,0.08)' : 'transparent',
              color: active ? 'var(--primary)' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700,
              fontFamily: "'Figtree', sans-serif",
              textDecoration: 'none',
            }}>
              {t.label}
              {(t as any).soon && (
                <span style={{
                  fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 10,
                  background: 'rgba(245, 158, 11, 0.14)', color: '#b45309',
                  textTransform: 'uppercase', letterSpacing: 0.6,
                }}>soon</span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
