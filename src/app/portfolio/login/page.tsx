// src/app/portfolio/login/page.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

export default function PortfolioLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleMagicLink() {
    if (!email.trim()) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/portfolio`,
      },
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/portfolio` },
    })
  }

  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🃏</div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 8px', color: 'var(--text)' }}>
            Track your collection
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
            Free portfolio tracker — see what your cards are worth, track performance, get insights.
          </p>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 28 }}>
          {sent ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 8px', color: 'var(--text)' }}>Check your email</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
                We sent a login link to {email}. Click it to open your portfolio.
              </p>
            </div>
          ) : (
            <>
              {/* Google */}
              <button onClick={handleGoogle}
                style={{ width: '100%', padding: '12px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 14, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              {/* Magic link */}
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleMagicLink()}
                placeholder="your@email.com"
                style={{ width: '100%', padding: '12px 14px', fontSize: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
              />
              {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '0 0 10px' }}>{error}</p>}
              <button onClick={handleMagicLink} disabled={!email.trim() || loading}
                style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: !email.trim() || loading ? 'not-allowed' : 'pointer', opacity: !email.trim() || loading ? 0.6 : 1 }}>
                {loading ? 'Sending...' : 'Send login link'}
              </button>

              <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', margin: '16px 0 0', lineHeight: 1.5 }}>
                Free forever. No card required. No spam.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
