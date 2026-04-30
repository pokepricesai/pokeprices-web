'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Mode = 'signin' | 'signup' | 'magic'

export default function PortfolioLoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [signupSent, setSignupSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')

  // If a session is already live, skip the login screen.
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/dashboard')
    })
  }, [router])

  function clearMessages() { setError(''); setInfo('') }

  async function handleGoogle() {
    clearMessages()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    })
  }

  async function handleSignIn() {
    clearMessages()
    if (!email.trim() || !password) return
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setLoading(false)
    if (error) {
      // Friendlier copy for the most common case.
      setError(/invalid login credentials/i.test(error.message)
        ? 'Email or password is incorrect.'
        : error.message)
      return
    }
    router.push('/dashboard')
  }

  async function handleSignUp() {
    clearMessages()
    if (!email.trim() || !password) return
    if (password.length < 8) {
      setError('Password must be at least 8 characters.'); return
    }
    if (password !== confirm) {
      setError('Passwords don\'t match.'); return
    }
    setLoading(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    // If email confirmations are enabled, no session is returned and the
    // user needs to click the link in the confirmation email.
    if (!data.session) {
      setSignupSent(true)
    } else {
      router.push('/dashboard')
    }
  }

  async function handleMagicLink() {
    clearMessages()
    if (!email.trim()) return
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setMagicSent(true)
  }

  async function handleForgotPassword() {
    clearMessages()
    if (!email.trim()) {
      setError('Enter your email first, then tap "Forgot password" again.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/dashboard/login`,
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setInfo('Password reset link sent — check your inbox.')
  }

  // Reset transient state when switching mode
  function setModeAndReset(next: Mode) {
    setMode(next)
    clearMessages()
    setMagicSent(false)
    setSignupSent(false)
    setPassword('')
    setConfirm('')
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px', fontSize: 14, borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
    fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box',
    marginBottom: 10,
  }
  const primaryBtn = (disabled: boolean): React.CSSProperties => ({
    width: '100%', padding: '12px', borderRadius: 10, border: 'none',
    background: 'var(--primary)', color: '#fff',
    fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  })
  const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0,
    color: 'var(--primary)', fontSize: 12, fontWeight: 600,
    fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
  }

  // ── Confirmation screens ──────────────────────────────────────────────────
  if (magicSent || signupSent) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 8px', color: 'var(--text)' }}>
            {signupSent ? 'Confirm your email' : 'Check your email'}
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
            {signupSent
              ? <>We sent a confirmation link to <strong style={{ color: 'var(--text)' }}>{email}</strong>. Click it to finish creating your account.</>
              : <>We sent a login link to <strong style={{ color: 'var(--text)' }}>{email}</strong>. Click it to open your portfolio.</>}
          </p>
          <button onClick={() => setModeAndReset(mode)} style={{ ...linkBtn, marginTop: 20 }}>← Back to sign in</button>
        </div>
      </Shell>
    )
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <Shell>
      {/* Google — always primary */}
      <button onClick={handleGoogle}
        style={{
          width: '100%', padding: '12px', borderRadius: 12,
          border: '1px solid var(--border)', background: 'var(--bg-light)',
          color: 'var(--text)', fontSize: 14, fontWeight: 600,
          fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, marginBottom: 16,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

      <Divider label="or" />

      {/* Mode tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-light)', borderRadius: 10, marginBottom: 16 }}>
        {([
          ['signin', 'Sign in'],
          ['signup', 'Sign up'],
          ['magic',  'Magic link'],
        ] as const).map(([m, label]) => (
          <button key={m} onClick={() => setModeAndReset(m)}
            style={{
              flex: 1, padding: '8px 6px', borderRadius: 7, border: 'none',
              background: mode === m ? 'var(--card)' : 'transparent',
              color: mode === m ? 'var(--text)' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
              cursor: 'pointer',
              boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
            }}
          >{label}</button>
        ))}
      </div>

      <input
        type="email" autoComplete="email" value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="your@email.com"
        style={inputStyle}
      />

      {(mode === 'signin' || mode === 'signup') && (
        <input
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (mode === 'signin' ? handleSignIn() : null)}
          placeholder={mode === 'signup' ? 'Create a password (min 8 characters)' : 'Password'}
          style={inputStyle}
        />
      )}

      {mode === 'signup' && (
        <input
          type="password" autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSignUp()}
          placeholder="Confirm password"
          style={inputStyle}
        />
      )}

      {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '4px 0 10px' }}>{error}</p>}
      {info  && <p style={{ fontSize: 12, color: '#22c55e', fontFamily: "'Figtree', sans-serif", margin: '4px 0 10px' }}>{info}</p>}

      {mode === 'signin' && (
        <>
          <button onClick={handleSignIn} disabled={!email.trim() || !password || loading} style={primaryBtn(!email.trim() || !password || loading)}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button onClick={handleForgotPassword} style={linkBtn}>Forgot password?</button>
            <button onClick={() => setModeAndReset('signup')} style={linkBtn}>Create an account</button>
          </div>
        </>
      )}

      {mode === 'signup' && (
        <>
          <button onClick={handleSignUp} disabled={!email.trim() || !password || !confirm || loading} style={primaryBtn(!email.trim() || !password || !confirm || loading)}>
            {loading ? 'Creating…' : 'Create account'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', margin: '12px 0 0', lineHeight: 1.5 }}>
            Already have an account? <button onClick={() => setModeAndReset('signin')} style={{ ...linkBtn, fontSize: 11 }}>Sign in</button>
          </p>
        </>
      )}

      {mode === 'magic' && (
        <>
          <button onClick={handleMagicLink} disabled={!email.trim() || loading} style={primaryBtn(!email.trim() || loading)}>
            {loading ? 'Sending…' : 'Send login link'}
          </button>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', margin: '12px 0 0', lineHeight: 1.5 }}>
            We&apos;ll email you a one-tap link — no password needed.
          </p>
        </>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', margin: '20px 0 0', lineHeight: 1.5 }}>
        Free forever. No card required. No spam.
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🃏</div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 8px', color: 'var(--text)' }}>
            Track your collection
          </h1>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
            Free portfolio tracker — see what your cards are worth, track performance, get insights.
          </p>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 20, padding: 28 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}
