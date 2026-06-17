'use client'

// src/components/admin/OnboardingAutomationStatus.tsx
// Block 3D — admin Content Studio panel showing the onboarding
// processor's automation status. Mounts under the existing
// Onboarding email testing panel.
//
// Reads /api/admin/onboarding-status on mount (and after a manual
// run). "Run now" calls /api/admin/run-onboarding-processor, which
// reuses the central runProcessor function.

import { useCallback, useEffect, useState } from 'react'

type LastRun = {
  startedAt:   string
  completedAt: string | null
  status:      string
  durationMs:  number | null
  source:      string
}
type LastOk = {
  startedAt:  string
  durationMs: number | null
  source:     string
}
type Summary = {
  processed: number
  sent:      number
  skipped:   number
  retried:   number
  cancelled: number
  failed:    number
}
type Snapshot = {
  enabled:          boolean
  lastRun:          LastRun | null
  lastSuccessfulRun: LastOk | null
  lastSummary:      Summary | null
  state: {
    active:      number
    dueNow:      number
    paused:      number
    cancelled:   number
    completed:   number
    staleClaims: number
  }
}

type RunResponse = {
  status?:    string
  processed?: number
  sent?:      number
  skipped?:   number
  retried?:   number
  cancelled?: number
  failed?:    number
  runId?:     string | null
  error?:     string
}

type Props = { getAccessToken: () => Promise<string | null> }

export default function OnboardingAutomationStatus({ getAccessToken }: Props) {
  const [snap,      setSnap]      = useState<Snapshot | null>(null)
  const [busy,      setBusy]      = useState(false)
  const [runBusy,   setRunBusy]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [runResult, setRunResult] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const token = await getAccessToken()
      if (!token) { setError('Sign in first.'); return }
      const res = await fetch('/api/admin/onboarding-status', {
        headers: { Authorization: `Bearer ${token}` },
        cache:   'no-store',
      })
      if (!res.ok) { setError(`Could not load status (HTTP ${res.status})`); return }
      const json = await res.json() as Snapshot
      setSnap(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }, [getAccessToken])

  useEffect(() => { load() }, [load])

  const runNow = useCallback(async () => {
    setRunBusy(true); setError(null); setRunResult(null)
    try {
      const token = await getAccessToken()
      if (!token) { setError('Sign in first.'); return }
      const res  = await fetch('/api/admin/run-onboarding-processor', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      let data: RunResponse = {}
      try { data = await res.json() } catch { /* fine */ }
      if (!res.ok) {
        setError(data.error || `Run failed (HTTP ${res.status})`)
      } else {
        const parts = [
          `status=${data.status ?? 'unknown'}`,
          `processed=${data.processed ?? 0}`,
          `sent=${data.sent ?? 0}`,
          `skipped=${data.skipped ?? 0}`,
          `retried=${data.retried ?? 0}`,
          `cancelled=${data.cancelled ?? 0}`,
          `failed=${data.failed ?? 0}`,
        ]
        setRunResult(parts.join(' · '))
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setRunBusy(false)
    }
  }, [getAccessToken, load])

  return (
    <section style={sectionStyle} aria-label="Onboarding automation status">
      <h2 style={h2Style}>Onboarding automation status</h2>
      <p style={leadStyle}>
        Live snapshot of the onboarding processor + state table. Refreshes
        when you press <em>Run now</em>. No emails, user IDs or onboarding
        row IDs are loaded.
      </p>

      {error && (
        <p style={errorStyle}>{error}</p>
      )}

      {snap == null && !error ? (
        <p style={mutedStyle}>{busy ? 'Loading…' : 'No status loaded.'}</p>
      ) : snap == null ? null : (
        <>
          <div style={cardsGrid}>
            <Card label="Feature flag" value={snap.enabled ? 'Enabled' : 'Disabled'}
                  tone={snap.enabled ? 'good' : 'muted'} />
            <Card label="Last run"            value={formatRun(snap.lastRun)} />
            <Card label="Last successful run" value={formatOk(snap.lastSuccessfulRun)} />
            <Card label="Due now"             value={String(snap.state.dueNow)} />
            <Card label="Active"              value={String(snap.state.active)} />
            <Card label="Completed"           value={String(snap.state.completed)} />
            <Card label="Paused"              value={String(snap.state.paused)}
                  tone={snap.state.paused > 0 ? 'warn' : 'muted'} />
            <Card label="Cancelled"           value={String(snap.state.cancelled)} />
            <Card label="Stale claims"        value={String(snap.state.staleClaims)}
                  tone={snap.state.staleClaims > 0 ? 'warn' : 'muted'} />
          </div>

          {snap.lastSummary && (
            <p style={summaryStyle}>
              Last summary —{' '}
              processed: {snap.lastSummary.processed} ·{' '}
              sent: {snap.lastSummary.sent} ·{' '}
              skipped: {snap.lastSummary.skipped} ·{' '}
              retried: {snap.lastSummary.retried} ·{' '}
              cancelled: {snap.lastSummary.cancelled} ·{' '}
              failed: {snap.lastSummary.failed}
            </p>
          )}
        </>
      )}

      <div style={actionsRow}>
        <button
          onClick={runNow}
          disabled={runBusy}
          style={runBusy ? primaryBtnDisabled : primaryBtn}
          title="Server-side run via the central processor. Same code path as Vercel Cron. The browser never sees CRON_SECRET."
        >
          {runBusy ? 'Running…' : 'Run now'}
        </button>
        <button
          onClick={load}
          disabled={busy}
          style={busy ? secondaryBtnDisabled : secondaryBtn}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
        {runResult && (
          <span role="status" aria-live="polite" style={successStyle}>{runResult}</span>
        )}
      </div>

      <p style={footnoteStyle}>
        Manual runs and cron runs share the same code path and are
        distinguishable in <code>email_onboarding_runs.source</code> as
        <code> manual</code> vs <code> cron</code>.
      </p>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatRun(r: LastRun | null): string {
  if (!r) return 'never'
  return `${shortTime(r.startedAt)} · ${r.status}${r.durationMs == null ? '' : ` · ${r.durationMs}ms`}`
}
function formatOk(r: LastOk | null): string {
  if (!r) return 'never'
  return `${shortTime(r.startedAt)}${r.durationMs == null ? '' : ` · ${r.durationMs}ms`}`
}
function shortTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function Card({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'warn' | 'muted' }) {
  const color =
    tone === 'good'  ? '#27ae60' :
    tone === 'warn'  ? '#b8741f' :
    tone === 'muted' ? 'var(--text-muted)' :
                       'var(--text)'
  return (
    <div style={cardStyle}>
      <div style={cardLabel}>{label}</div>
      <div style={{ ...cardValue, color }}>{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Styles (inline, mirror the existing admin panel tone)
// ─────────────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14, padding: '16px 18px', marginBottom: 18,
  fontFamily: "'Figtree', sans-serif",
}
const h2Style: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif", fontSize: 17,
  margin: '0 0 4px', color: 'var(--text)',
}
const leadStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)',
  margin: '0 0 14px', lineHeight: 1.55,
}
const errorStyle: React.CSSProperties = {
  fontSize: 12, color: '#b91c1c', margin: '0 0 10px', fontWeight: 600,
}
const mutedStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-muted)', margin: '0 0 10px',
}
const cardsGrid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: 8, marginBottom: 10,
}
const cardStyle: React.CSSProperties = {
  background: 'var(--bg)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '10px 12px',
}
const cardLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
}
const cardValue: React.CSSProperties = {
  fontSize: 14, fontWeight: 700,
}
const summaryStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text)', margin: '4px 0 12px', lineHeight: 1.5,
}
const actionsRow: React.CSSProperties = {
  display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 4,
}
const primaryBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 10, border: 'none',
  background: 'var(--primary)', color: '#fff',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'Figtree', sans-serif",
}
const primaryBtnDisabled: React.CSSProperties = { ...primaryBtn, cursor: 'not-allowed', opacity: 0.7 }
const secondaryBtn: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 10,
  border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
  fontSize: 12, fontWeight: 700, cursor: 'pointer',
  fontFamily: "'Figtree', sans-serif",
}
const secondaryBtnDisabled: React.CSSProperties = { ...secondaryBtn, cursor: 'not-allowed', opacity: 0.7 }
const successStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: '#27ae60',
}
const footnoteStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-muted)', margin: '14px 0 0', lineHeight: 1.55,
}
