'use client'
// Block 5A-W-50B — shared login/create-account prompt used by
// logged-out card-tile actions on set pages.
//
// Design constraints:
//   * Reuses the existing /dashboard/login route (both sign-in and
//     sign-up modes live there). No new auth flow.
//   * `returnTo` is preserved via the existing safeReturnTo mechanism.
//   * Keyboard + screen-reader accessible: role=dialog, Escape closes,
//     backdrop-click closes, first focusable element focused on open,
//     focus does not leak to the underlying set page.
//   * No pending watchlist/portfolio insert happens before auth
//     succeeds. Callers may separately call setIntendedAction() when
//     they want auto-replay after login.

import { useEffect, useRef } from 'react'
import Link from 'next/link'

export type AuthPromptContext = 'watchlist' | 'portfolio'

const CONTEXT_COPY: Record<AuthPromptContext, { title: string; body: string }> = {
  watchlist: {
    title: 'Save this card',
    body:  'Create a free account or sign in to add cards to your watchlist and portfolio.',
  },
  portfolio: {
    title: 'Track this card',
    body:  'Create a free account or sign in to add cards to your portfolio and watchlist.',
  },
}

export default function AuthPromptModal({
  open,
  context,
  returnTo,
  onClose,
}: {
  open:     boolean
  context:  AuthPromptContext
  /** The set-page URL to send the user back to after auth completes. */
  returnTo: string
  onClose:  () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstBtnRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    // Defer focus to next tick so the dialog is mounted first.
    const t = setTimeout(() => firstBtnRef.current?.focus(), 0)
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      // Restore focus to whatever opened the modal (the tile button).
      prev?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const copy = CONTEXT_COPY[context]
  // Block 5A-W-50B-FIX1 — /dashboard/login accepts `?mode=signup` to
  // preselect the registration tab. Sign-in stays on the default
  // (`signin`) so the Log-in button lands on the sign-in form.
  const encodedReturn = encodeURIComponent(returnTo)
  const loginHref  = `/dashboard/login?returnTo=${encodedReturn}`
  const signupHref = `/dashboard/login?mode=signup&returnTo=${encodedReturn}`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-prompt-title"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        style={{
          background: 'var(--card)', borderRadius: 18,
          border: '1px solid var(--border)', width: '100%',
          maxWidth: 420, padding: 24,
          fontFamily: "'Figtree', sans-serif",
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
          <h2 id="auth-prompt-title" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: 0, color: 'var(--text)' }}>
            {copy.title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
          {copy.body}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link
            ref={firstBtnRef}
            href={loginHref}
            style={{
              width: '100%', padding: '11px', borderRadius: 10, border: 'none',
              background: 'var(--primary)', color: '#fff', fontSize: 14,
              fontWeight: 700, textDecoration: 'none', textAlign: 'center',
              display: 'block',
            }}
          >
            Log in
          </Link>
          <Link
            href={signupHref}
            style={{
              width: '100%', padding: '11px', borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--bg-light)',
              color: 'var(--text)', fontSize: 14, fontWeight: 700,
              textDecoration: 'none', textAlign: 'center', display: 'block',
            }}
          >
            Create free account
          </Link>
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '10px', borderRadius: 10,
              border: 'none', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 0', textAlign: 'center', opacity: 0.75 }}>
          Free — no card required. Free plan supports watchlist &amp; portfolio.
        </p>
      </div>
    </div>
  )
}
