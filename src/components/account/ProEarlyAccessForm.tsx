'use client'

// src/components/account/ProEarlyAccessForm.tsx
// Block 5A-W-28 — inline early-access capture form rendered inside
// AccountPlanBadge's free CTA panel.
//
// State machine:
//   * idle       — primary "Join early access" button is visible;
//                  the message field is hidden behind it.
//   * editing    — user clicked the button; message field is
//                  visible; submit button switches to "Send".
//   * submitting — POST in flight; button shows "Sending…".
//   * success    — server returned ok; we swap the form for a
//                  short confirmation line. The mailto fallback is
//                  NOT shown here — the row already lists them.
//   * error      — server returned non-ok OR the network failed;
//                  retry button + the mailto fallback are both
//                  visible so a busted API never deadlocks the
//                  user out of joining.
//
// The form posts to `/api/account/pro-early-access`, which:
//   * verifies the user's Bearer JWT
//   * dedupes within 24h (returns alreadyRegistered=true on a hit)
//
// We render the alreadyRegistered case the same as a fresh success
// because the user-visible answer is identical: "you're on the list".

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { UPGRADE_CTA } from './accountPlanCopy'

export type ProEarlyAccessSource =
  | 'dashboard'
  | 'watchlist_alerts'
  | 'portfolio'
  | 'settings'
  | 'limit_block'
  | 'unknown'

type FormState = 'idle' | 'editing' | 'submitting' | 'success' | 'error'

export default function ProEarlyAccessForm({ source }: { source: ProEarlyAccessSource }) {
  const [state,   setState]   = useState<FormState>('idle')
  const [message, setMessage] = useState('')
  const [error,   setError]   = useState<string | null>(null)

  async function submit() {
    setState('submitting')
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        // Should be impossible — the badge only renders for signed-in
        // users — but surface a clear message instead of silently
        // failing if the session expired between mount and submit.
        setState('error')
        setError('Please sign in to join the early-access list.')
        return
      }
      const res = await fetch('/api/account/pro-early-access', {
        method:  'POST',
        headers: {
          authorization:  `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        cache:   'no-store',
        body:    JSON.stringify({ source, message: message.trim() || undefined }),
      })
      if (!res.ok) {
        const text = await res.text()
        setState('error')
        setError(text || 'Something went wrong.')
        return
      }
      // alreadyRegistered=true reads as success to the user — they're
      // on the list either way.
      setState('success')
    } catch (e) {
      setState('error')
      setError(e instanceof Error ? e.message : 'Network error.')
    }
  }

  if (state === 'success') {
    return (
      <div style={successStyle}>
        ✓ You&apos;re on the Pro early access list. We&apos;ll be in touch.
      </div>
    )
  }

  return (
    <div>
      {state === 'editing' || state === 'submitting' || state === 'error' ? (
        <>
          <label style={labelStyle} htmlFor="pro-early-access-message">
            Anything specific you want from Pro? (optional)
          </label>
          <textarea
            id="pro-early-access-message"
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="What would Pro need to do for you to switch?"
            maxLength={1000}
            rows={3}
            style={textareaStyle}
            disabled={state === 'submitting'}
          />
          <div style={buttonRowStyle}>
            <button
              onClick={() => void submit()}
              disabled={state === 'submitting'}
              style={primaryButtonStyle}
            >
              {state === 'submitting' ? 'Sending…' : 'Join early access'}
            </button>
            {state === 'error' && (
              // Mailto fallback so a busted API can't trap users.
              <Link href={UPGRADE_CTA.buttonHref} style={mailtoLinkStyle}>
                Email us instead
              </Link>
            )}
          </div>
          {state === 'error' && error && (
            <div style={errorStyle}>{error}</div>
          )}
        </>
      ) : (
        <button
          onClick={() => setState('editing')}
          style={primaryButtonStyle}
        >
          {UPGRADE_CTA.buttonLabel}
        </button>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11.5,
  color: 'var(--text-muted)',
  fontFamily: "'Figtree', sans-serif",
  marginBottom: 4,
}
const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 64,
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 12.5,
  fontFamily: "'Figtree', sans-serif",
  resize: 'vertical',
  marginBottom: 8,
  boxSizing: 'border-box',
}
const buttonRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
}
const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px',
  borderRadius: 10,
  background: 'var(--primary)',
  color: '#fff',
  fontSize: 12, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif",
  border: 'none',
  cursor: 'pointer',
}
const mailtoLinkStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: 'var(--primary)',
  fontFamily: "'Figtree', sans-serif",
  textDecoration: 'none',
}
const successStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 8,
  background: 'rgba(34,197,94,0.10)',
  border: '1px solid rgba(34,197,94,0.30)',
  color: '#15803d',
  fontSize: 12.5,
  fontWeight: 700,
  fontFamily: "'Figtree', sans-serif",
}
const errorStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 11.5,
  color: '#b91c1c',
  fontFamily: "'Figtree', sans-serif",
}
