'use client'
// Block 5A-W-47F — reusable dashboard nav content. Rendered by the
// persistent desktop sidebar AND by the mobile drawer inside
// DashboardShell. Kept text-only per the block brief: no emojis, no
// new icon library, no invented decorative glyphs. The routes here
// map 1:1 to the real customer-dashboard pages surfaced in the W47F
// audit.

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { DASHBOARD_NAV, isNavItemActive } from './dashboardNav'

// ── Component ────────────────────────────────

/** Nav content used both in the desktop sidebar and the mobile
 *  drawer. `onNavigate` is invoked when a link is clicked so the
 *  drawer wrapper can close itself; the desktop sidebar leaves it
 *  as a no-op. */
export default function DashboardSidebar({
  onNavigate,
}: {
  onNavigate?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [email, setEmail] = useState<string | null>(null)

  // Match the Navbar's approach — read the session on mount and stay
  // in sync with future sign-in / sign-out via the auth listener.
  // This is independent of the per-page requireAuthUser server check,
  // which continues to gate the actual routes.
  useEffect(() => {
    let unsub: (() => void) | null = null
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setEmail(session?.user?.email ?? null)
    })
    unsub = () => sub.subscription.unsubscribe()
    return () => { if (unsub) unsub() }
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    onNavigate?.()
    router.push('/')
  }

  return (
    <nav
      aria-label="Dashboard navigation"
      style={{
        display: 'flex', flexDirection: 'column',
        height: '100%',
        padding: '20px 14px 18px',
        boxSizing: 'border-box',
        fontFamily: "'Figtree', sans-serif",
        gap: 4,
      }}
    >
      {/* Brand row */}
      <div style={{ padding: '0 8px 14px', borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
        <div style={{
          fontFamily: "'Outfit', sans-serif",
          fontSize: 15, fontWeight: 800,
          color: 'var(--text)', lineHeight: 1.15,
        }}>
          PokePrices
        </div>
        <div style={{
          fontSize: 10, fontWeight: 700,
          letterSpacing: 1.5, textTransform: 'uppercase',
          color: 'var(--text-muted)', marginTop: 2,
        }}>
          Dashboard
        </div>
      </div>

      {/* Groups */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {DASHBOARD_NAV.map((group, gi) => (
          <div key={group.label ?? `g${gi}`}>
            {group.label && (
              <div style={{
                padding: '4px 10px 4px',
                fontSize: 10, fontWeight: 800,
                letterSpacing: 1.5, textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}>
                {group.label}
              </div>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {group.items.map(item => {
                const active = isNavItemActive(item, pathname)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => onNavigate?.()}
                      aria-current={active ? 'page' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center',
                        // Left rail: solid on active, transparent otherwise.
                        // Provides a non-colour affordance for the active
                        // state (per the a11y requirement).
                        borderLeft: active
                          ? '3px solid var(--primary)'
                          : '3px solid transparent',
                        padding: '8px 10px 8px 12px',
                        borderRadius: 6,
                        background: active ? 'rgba(26,95,173,0.10)' : 'transparent',
                        color:      active ? 'var(--primary)' : 'var(--text)',
                        fontSize: 13,
                        fontWeight: active ? 800 : 500,
                        textDecoration: 'none',
                        transition: 'background 0.12s, color 0.12s',
                      }}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer — session context + escape hatches */}
      <div style={{
        marginTop: 14, paddingTop: 12,
        borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {email && (
          <div
            title={email}
            style={{
              fontSize: 11, color: 'var(--text-muted)',
              padding: '0 10px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {email}
          </div>
        )}
        <Link
          href="/"
          onClick={() => onNavigate?.()}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 10px',
            fontSize: 12, fontWeight: 700, color: 'var(--text-muted)',
            textDecoration: 'none', borderRadius: 6,
            border: '1px solid var(--border)', background: 'transparent',
          }}
        >
          <span aria-hidden="true">←</span>
          Back to PokePrices
        </Link>
        {email && (
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              padding: '7px 10px',
              fontSize: 12, fontWeight: 700,
              color: 'var(--text-muted)',
              background: 'transparent',
              border: '1px solid var(--border)', borderRadius: 6,
              cursor: 'pointer', textAlign: 'left',
              fontFamily: "'Figtree', sans-serif",
            }}
          >
            Log out
          </button>
        )}
      </div>
    </nav>
  )
}
