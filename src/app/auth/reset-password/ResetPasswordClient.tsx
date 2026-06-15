'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'

export default function ResetPasswordClient() {
  const router = useRouter()
  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [pw, setPw]             = useState('')
  const [confirm, setConfirm]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [done, setDone]         = useState(false)

  // Confirm a recovery session exists before exposing the password form.
  // The callback should already have established one; if it has not, the
  // user is shown a clear next step instead of a useless form.
  useEffect(() => {
    let live = true
    supabase.auth.getSession().then(({ data }) => {
      if (!live) return
      setHasSession(!!data.session)
    })
    return () => { live = false }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (pw.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (pw !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true)
    const { error: updErr } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (updErr) {
      setError(updErr.message || 'Could not update password.')
      return
    }
    trackEvent('password_reset_completed', { source_component: 'reset_password_form' })
    setDone(true)
    // Brief pause so the success state is visible, then redirect.
    setTimeout(() => router.replace('/dashboard'), 1500)
  }

  if (hasSession === null) return null

  const shellStyle: React.CSSProperties = {
    minHeight: '80vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  }
  const cardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 400,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 20,
    padding: 28,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    fontSize: 14,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: "'Figtree', sans-serif",
    outline: 'none',
    boxSizing: 'border-box',
    marginBottom: 10,
  }
  const primaryBtn: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    borderRadius: 10,
    border: 'none',
    background: 'var(--primary)',
    color: '#fff',
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "'Figtree', sans-serif",
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }

  if (!hasSession) {
    return (
      <div style={shellStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 10px', color: 'var(--text)' }}>
            Reset link no longer valid
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 18px', lineHeight: 1.6 }}>
            This password reset link has expired or has already been used. Request a new one from the sign-in page.
          </p>
          <button
            onClick={() => router.push('/dashboard/login')}
            style={primaryBtn}
          >
            Back to sign in
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={shellStyle}>
        <div style={{ ...cardStyle, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 6px', color: 'var(--text)' }}>
            Password updated
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
            Redirecting you to your dashboard…
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 10px', color: 'var(--text)' }}>
          Choose a new password
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 18px', lineHeight: 1.6 }}>
          Pick something only you would use. At least 8 characters.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            style={inputStyle}
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            style={inputStyle}
          />
          {error && (
            <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '4px 0 10px' }}>
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !pw || !confirm}
            style={primaryBtn}
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
