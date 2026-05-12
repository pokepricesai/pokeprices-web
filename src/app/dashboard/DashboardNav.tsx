'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import ComingSoonBadge from '@/components/ComingSoonBadge'

type ToolId = 'portfolio' | 'watchlist' | 'sets' | 'grading' | 'card-shows' | 'alerts' | 'settings'

type Tool = { id: ToolId; label: string; href: string; icon: string; soon?: boolean }
type Group = { label: string; tools: Tool[] }

const GROUPS: Group[] = [
  {
    label: 'Track',
    tools: [
      { id: 'portfolio', label: 'Portfolio',  href: '/dashboard/portfolio',  icon: '💼' },
      { id: 'watchlist', label: 'Watchlist',  href: '/dashboard/watchlist',  icon: '👁' },
      { id: 'sets',      label: 'Sets',       href: '/dashboard/sets',       icon: '🧩' },
      { id: 'alerts',    label: 'Alerts',     href: '/dashboard/alerts',     icon: '🔔', soon: true },
    ],
  },
  {
    label: 'Tools',
    tools: [
      { id: 'grading',    label: 'Grading',    href: '/dashboard/grading',    icon: '🎯' },
      { id: 'card-shows', label: 'Card Shows', href: '/dashboard/card-shows', icon: '📍' },
    ],
  },
  {
    label: 'Account',
    tools: [
      { id: 'settings', label: 'Settings', href: '/dashboard/settings', icon: '⚙️' },
    ],
  },
]

export default function DashboardNav({
  current,
  email,
}: {
  current?: ToolId
  email?: string | null
}) {
  const router = useRouter()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div style={{
      position: 'sticky', top: 60, zIndex: 50,
      background: 'var(--bg)',
      borderBottom: '1px solid var(--border)',
      marginBottom: 24,
      paddingTop: 8, paddingBottom: 12,
      marginLeft: -16, marginRight: -16,
      paddingLeft: 16, paddingRight: 16,
    }}>
      {/* Header row: back link + email + sign out */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
        <Link href="/dashboard" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
          textDecoration: 'none', fontFamily: "'Figtree', sans-serif",
          textTransform: 'uppercase', letterSpacing: 1.2,
        }}>
          <span>←</span>
          Dashboard
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {email ? (
            <>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {email}
              </span>
              <button onClick={handleSignOut} style={{
                padding: '5px 10px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-muted)', fontSize: 11, fontWeight: 700,
                fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
                letterSpacing: 0.5,
              }}>
                Sign out
              </button>
            </>
          ) : (
            <Link href="/dashboard/login" style={{
              padding: '5px 10px', borderRadius: 8,
              border: '1px solid var(--primary)', background: 'rgba(26,95,173,0.08)',
              color: 'var(--primary)', fontSize: 11, fontWeight: 800,
              fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
              letterSpacing: 0.5,
            }}>
              Sign in
            </Link>
          )}
        </div>
      </div>

      {/* Tab strip: groups separated by thin dividers, horizontal scroll on overflow */}
      <div
        className="dashnav-strip"
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          overflowX: 'auto', overflowY: 'hidden',
          paddingBottom: 2,
        }}
      >
        {GROUPS.map((group, gi) => (
          <div key={group.label} style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            {gi > 0 && (
              <span aria-hidden style={{
                width: 1, height: 18, background: 'var(--border)', display: 'inline-block',
              }} />
            )}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {group.tools.map(t => {
                const active = current === t.id
                return (
                  <Link key={t.id} href={t.href} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: 18,
                    border: active ? '1px solid var(--primary)' : '1px solid transparent',
                    background: active ? 'rgba(26,95,173,0.10)' : 'transparent',
                    color: active ? 'var(--primary)' : 'var(--text-muted)',
                    fontSize: 12, fontWeight: 700,
                    fontFamily: "'Figtree', sans-serif",
                    textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
                    transition: 'background 0.12s, color 0.12s',
                  }}>
                    <span style={{ fontSize: 13, lineHeight: 1 }}>{t.icon}</span>
                    {t.label}
                    {t.soon && <ComingSoonBadge label="Soon" />}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
