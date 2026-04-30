'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'

// Smart Alerts is currently shown as "coming soon". The DB tables, RPC and
// edge functions still exist — we'll bring the UI back once the threshold
// model and email cadence are settled.
export default function AlertsClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/dashboard/login'); return }
      setUser(session.user)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/dashboard/login')
      else setUser(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="alerts" email={user?.email} />

      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '56px 28px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 44, marginBottom: 14 }}>🔔</div>
        <div style={{
          display: 'inline-block',
          padding: '4px 12px',
          borderRadius: 20,
          background: 'rgba(245, 158, 11, 0.12)',
          color: '#b45309',
          fontSize: 11,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: 1.2,
          fontFamily: "'Figtree', sans-serif",
          marginBottom: 14,
        }}>
          Coming soon
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 10px', color: 'var(--text)' }}>
          Smart Alerts
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 auto 24px', maxWidth: 460, lineHeight: 1.6 }}>
          Get pinged when a card crosses a price threshold or when a graded copy
          hits a target. We&apos;re finalising the trigger logic and email cadence
          to make sure alerts feel useful, not noisy.
        </p>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 auto 28px', maxWidth: 460, lineHeight: 1.6 }}>
          In the meantime, the <strong style={{ color: 'var(--text)' }}>Watchlist</strong> already
          tracks 7d / 30d movement and PSA premium for any card you&apos;re following.
        </p>
        <Link href="/dashboard/watchlist" style={{
          display: 'inline-block',
          padding: '11px 22px',
          borderRadius: 12,
          background: 'var(--primary)',
          color: '#fff',
          fontSize: 14,
          fontWeight: 700,
          fontFamily: "'Figtree', sans-serif",
          textDecoration: 'none',
        }}>
          Open watchlist
        </Link>
      </div>
    </div>
  )
}
