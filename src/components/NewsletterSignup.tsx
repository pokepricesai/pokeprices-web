'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function NewsletterSignup({ source = 'website', dark = false }: { source?: string; dark?: boolean }) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error' | 'duplicate'>('idle')

  const handleSubmit = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return

    setState('loading')

    const { error } = await supabase
      .from('newsletter_signups')
      .insert([{ email: trimmed, source }])

    if (!error) {
      setState('success')
      setEmail('')
    } else if (error.code === '23505') {
      // Unique constraint — already signed up
      setState('duplicate')
    } else {
      setState('error')
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit()
  }

  if (state === 'success') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
        color: dark ? 'rgba(255,255,255,0.8)' : 'var(--green)',
        fontFamily: "'Figtree', sans-serif", fontSize: 14, fontWeight: 600,
      }}>
        <span style={{ fontSize: 16 }}>✓</span> You're in — first issue coming soon.
      </div>
    )
  }

  if (state === 'duplicate') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
        color: dark ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)',
        fontFamily: "'Figtree', sans-serif", fontSize: 14,
      }}>
        <span style={{ fontSize: 16 }}>👋</span> You're already signed up!
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 400 }}>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={handleKey}
          placeholder="your@email.com"
          disabled={state === 'loading'}
          style={{
            flex: 1,
            padding: '10px 14px',
            fontSize: 14,
            borderRadius: 10,
            border: dark ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--border)',
            background: dark ? 'rgba(255,255,255,0.1)' : 'var(--card)',
            color: dark ? '#fff' : 'var(--text)',
            fontFamily: "'Figtree', sans-serif",
            outline: 'none',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={state === 'loading' || !email.trim()}
          style={{
            padding: '10px 18px',
            borderRadius: 10,
            border: 'none',
            background: 'var(--accent)',
            color: '#1a3a6b',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "'Figtree', sans-serif",
            cursor: state === 'loading' || !email.trim() ? 'not-allowed' : 'pointer',
            opacity: state === 'loading' || !email.trim() ? 0.6 : 1,
            whiteSpace: 'nowrap',
            transition: 'opacity 0.15s',
          }}
        >
          {state === 'loading' ? '...' : 'Subscribe'}
        </button>
      </div>
      {state === 'error' && (
        <p style={{ color: '#ef4444', fontSize: 12, margin: 0, fontFamily: "'Figtree', sans-serif" }}>
          Something went wrong — try again in a moment.
        </p>
      )}
    </div>
  )
}
