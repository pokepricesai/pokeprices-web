'use client'

// src/components/admin/OnboardingEmailTester.tsx
// Block 3B operator-UX addition. Renders the admin testing panel for
// the three onboarding templates inside /admin/content-studio.
//
// Wraps the existing Block 3A admin routes:
//   * /api/admin/email-preview     (open in new tab)
//   * /api/admin/email-send-test   (POST, recipient locked server-side)
//
// The panel NEVER calls the onboarding processor or any state-
// mutating onboarding endpoint. The pure helpers in
// src/lib/admin/onboardingTester.ts are the contract — tests assert
// the panel cannot deviate from them.

import { useState } from 'react'
import {
  ONBOARDING_TEMPLATE_OPTIONS,
  ACTIVATION_BRANCH_OPTIONS,
  buildPreviewUrl,
  buildSendBody,
  requiresBranch,
  summariseSendResult,
  statusToVisibleText,
  SEND_TEST_URL,
  SAFETY_TEXT,
  type OnboardingTemplateKey,
  type ActivationBranch,
  type SendStatus,
} from '@/lib/admin/onboardingTester'

type Props = {
  /**
   * Returns the current Supabase access token, or null when no
   * session is available. The Content Studio page already maintains
   * this helper for the existing admin routes; we reuse it rather
   * than re-implementing.
   */
  getAccessToken: () => Promise<string | null>
}

export default function OnboardingEmailTester({ getAccessToken }: Props) {
  const [template, setTemplate] = useState<OnboardingTemplateKey>('onboarding_welcome')
  const [branch,   setBranch]   = useState<ActivationBranch>('A')
  const [status,   setStatus]   = useState<SendStatus>({ kind: 'idle' })

  const showBranch = requiresBranch(template)

  function openPreview() {
    const url = buildPreviewUrl({ template, branch: showBranch ? branch : undefined })
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  async function sendTest() {
    setStatus({ kind: 'sending' })
    try {
      const token = await getAccessToken()
      if (!token) {
        setStatus({ kind: 'error', message: 'Sign in first.' })
        return
      }
      const body = buildSendBody({ template, branch: showBranch ? branch : undefined })
      const res = await fetch(SEND_TEST_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })
      let data: { success?: unknown; emailId?: unknown; error?: unknown } | null = null
      try { data = await res.json() } catch { /* fine */ }
      setStatus(summariseSendResult({ ok: res.ok, status: res.status, data }))
    } catch (e: unknown) {
      const msg = e instanceof Error && e.message ? e.message : 'Network error'
      setStatus({ kind: 'error', message: msg })
    }
  }

  const visibleStatus = statusToVisibleText(status)
  const statusColor =
    status.kind === 'success' ? '#22c55e'
  : status.kind === 'error'   ? '#b91c1c'
  :                             'var(--text-muted)'

  return (
    <section
      aria-label="Onboarding email testing"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '16px 18px',
        marginBottom: 18,
        fontFamily: "'Figtree', sans-serif",
      }}
    >
      <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, margin: '0 0 4px', color: 'var(--text)' }}>
        Onboarding email testing
      </h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>
        Preview or send a test of the three onboarding emails. Send-test
        and preview routes are admin-only and use the central email
        infrastructure.
      </p>

      {/* Template selector */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <label htmlFor="onboarding-template-select" style={smallLabel}>
          Template
        </label>
        <select
          id="onboarding-template-select"
          value={template}
          onChange={e => setTemplate(e.target.value as OnboardingTemplateKey)}
          style={selectStyle}
        >
          {ONBOARDING_TEMPLATE_OPTIONS.map(opt => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Activation variant selector — only when activation is chosen */}
      {showBranch && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          <label htmlFor="onboarding-branch-select" style={smallLabel}>
            Activation variant
          </label>
          <select
            id="onboarding-branch-select"
            value={branch}
            onChange={e => setBranch(e.target.value as ActivationBranch)}
            style={selectStyle}
          >
            {ACTIVATION_BRANCH_OPTIONS.map(opt => (
              <option key={opt.branch} value={opt.branch}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
        <button
          onClick={openPreview}
          style={previewBtn}
          title="Opens the email preview in a new tab. Admin auth required."
        >
          Preview email
        </button>
        <button
          onClick={sendTest}
          disabled={status.kind === 'sending'}
          style={status.kind === 'sending' ? sendBtnDisabled : sendBtn}
          title="Sends a single test email to EMAIL_TEST_RECIPIENT. Recipient is server-controlled."
        >
          {status.kind === 'sending' ? 'Sending…' : 'Send test email'}
        </button>
        {visibleStatus && status.kind !== 'sending' && (
          <span
            role="status"
            aria-live="polite"
            style={{ fontSize: 12, fontWeight: 600, color: statusColor }}
          >
            {visibleStatus}
          </span>
        )}
      </div>

      {/* Safety text */}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.55 }}>
        {SAFETY_TEXT}
      </p>
    </section>
  )
}

const smallLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8,
  fontFamily: "'Figtree', sans-serif",
}

const selectStyle: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box',
  width: '100%', maxWidth: 360,
}

const previewBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'Figtree', sans-serif",
}

const sendBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 10,
  border: 'none', background: 'var(--primary)', color: '#fff',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'Figtree', sans-serif",
}

const sendBtnDisabled: React.CSSProperties = {
  ...sendBtn, cursor: 'not-allowed', opacity: 0.7,
}
