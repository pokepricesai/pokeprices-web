'use client'
// src/app/admin/editorial/studio/[projectId]/WriterPanel.tsx
//
// EIC Block 9 — Studio sidebar tab for AI generation + Fact Check.
//
// Gated: the Generate button is disabled unless the project's
// research is approved. If the current draft has meaningful content,
// a second explicit confirmation is required before overwrite.
// Progress UI shows the pipeline steps deterministically (no real
// SSE — sufficient per spec).

import React, { useCallback, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { WriterMetadata, FactCheckResult, FactCheckIssue } from '@/lib/editorial/writer/types'
import type { StudioDocument } from '@/lib/studio/types'

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('You must be signed in as an admin.')
  return { authorization: `Bearer ${token}` }
}

type Props = {
  projectId:          number
  researchStatus:     string
  hasMeaningfulBody:  boolean
  writer:             WriterMetadata | null
  factCheckStale:     boolean
  onWriterResult:     (writer: WriterMetadata, studio: StudioDocument | null) => void
  onFactCheckResult:  (result: FactCheckResult) => void
}

const PROGRESS_STEPS = [
  'Preparing evidence',
  'Writing draft',
  'Building data blocks',
  'Applying house style',
  'Checking facts',
  'Saving draft',
] as const

export function GenerateAndFactCheckPanel(props: Props) {
  const { projectId, researchStatus, hasMeaningfulBody, writer, factCheckStale } = props
  const [busy, setBusy]           = useState<'generate' | 'fact-check' | null>(null)
  const [stepIdx, setStepIdx]     = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const approved = researchStatus === 'approved'

  const generate = useCallback(async (overwrite: boolean) => {
    setError(null); setStepIdx(0); setBusy('generate')
    // Cosmetic step animation: 1s per step until the request completes.
    const timer = setInterval(() => setStepIdx(i => (i < PROGRESS_STEPS.length - 1 ? i + 1 : i)), 1200)
    try {
      const auth = await authHeader()
      const res = await fetch(`/api/admin/editorial/studio/${projectId}/write`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ overwriteExisting: overwrite }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409 && j?.needsOverwriteConfirmation) {
        setConfirming(true)
        return
      }
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
      setStepIdx(PROGRESS_STEPS.length - 1)
      props.onWriterResult(j.writer as WriterMetadata, (j.studio ?? null) as StudioDocument | null)
      setConfirming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally {
      clearInterval(timer); setBusy(null)
    }
  }, [projectId, props])

  const runFactCheck = useCallback(async () => {
    setError(null); setBusy('fact-check')
    try {
      const auth = await authHeader()
      const res = await fetch(`/api/admin/editorial/studio/${projectId}/fact-check`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
      props.onFactCheckResult(j.factCheck as FactCheckResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally {
      setBusy(null)
    }
  }, [projectId, props])

  return (
    <div style={S.wrap}>
      <div style={S.section}>
        <div style={S.title}>Generate draft</div>
        {!approved && (
          <div style={S.gateNotice}>
            Approved research required. Current research status: <strong>{researchStatus}</strong>. Approve the pack in the Research Room before generating.
          </div>
        )}
        {approved && !busy && !confirming && (
          <button style={S.btnPrimary} onClick={() => generate(!hasMeaningfulBody)}>Generate draft</button>
        )}
        {approved && !busy && confirming && (
          <div style={S.confirmBox}>
            <div style={{ marginBottom: 8, fontWeight: 700 }}>Replace current draft with a newly generated article?</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={S.btnPrimary} onClick={() => generate(true)}>Yes, replace</button>
              <button style={S.btnGhost}   onClick={() => setConfirming(false)}>Cancel</button>
            </div>
          </div>
        )}
        {busy === 'generate' && (
          <div style={S.progressBox}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Generating…</div>
            <ol style={S.progressList}>
              {PROGRESS_STEPS.map((s, i) => (
                <li key={i} style={{ ...S.progressStep, ...(i <= stepIdx ? S.progressStepActive : {}) }}>
                  {i < stepIdx ? '✓' : i === stepIdx ? '→' : '·'} {s}
                </li>
              ))}
            </ol>
          </div>
        )}
        {error && <div style={S.error}>{error}</div>}
      </div>

      <div style={S.section}>
        <div style={S.title}>Fact check</div>
        <FactCheckSummary writer={writer} stale={factCheckStale} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button style={S.btnPrimary} disabled={busy === 'fact-check'} onClick={runFactCheck}>
            {busy === 'fact-check' ? 'Checking…' : 'Run fact check'}
          </button>
        </div>
      </div>

      {writer && (
        <div style={S.section}>
          <div style={S.title}>Writer metadata</div>
          <div style={S.meta}>Generated {new Date(writer.generatedAt).toLocaleString()} · model {writer.model}</div>
          <div style={S.meta}>Cost estimate ${writer.generationCost.cost_usd.toFixed(4)} · {writer.generationCost.input_tokens + writer.generationCost.output_tokens} tokens</div>
          {writer.styleRepairFired && <div style={S.meta}>Style-repair pass fired.</div>}
          {writer.repairFired      && <div style={S.meta}>Fact repair pass fired.</div>}
          {writer.assemblyWarnings.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>{writer.assemblyWarnings.length} assembly warning(s)</summary>
              <ul style={S.list}>{writer.assemblyWarnings.map((w, i) => <li key={i}>[{w.kind}] {w.detail}</li>)}</ul>
            </details>
          )}
          {writer.claimTrace.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>{writer.claimTrace.length} claim trace(s)</summary>
              <ul style={S.list}>
                {writer.claimTrace.slice(0, 20).map((c, i) => (
                  <li key={i}><strong>{c.sectionId}:</strong> {c.claim} <span style={S.muted}>[{c.evidenceRefs.join(', ') || '—'}]</span></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function FactCheckSummary({ writer, stale }: { writer: WriterMetadata | null; stale: boolean }) {
  const fc = writer?.factCheck
  if (!fc) return <div style={S.meta}>No fact check has been run for this draft.</div>
  const audit = fc.numericAudit
  return (
    <div style={{ marginTop: 8 }}>
      {stale && <div style={S.staleNotice}>Fact check is out of date — the draft has changed since this check.</div>}
      <div style={{ marginTop: 4, fontSize: 12 }}>
        Status: <strong>{fc.status}</strong> · {fc.issues.length} issue(s) · numeric audit: {audit.matched}/{audit.checked} matched
      </div>
      {fc.issues.length > 0 && (
        <ul style={S.list}>
          {fc.issues.slice(0, 25).map((i, k) => <li key={k}><IssueRow issue={i} /></li>)}
        </ul>
      )}
      <div style={S.meta}>Checked {new Date(fc.checkedAt).toLocaleString()}{fc.autoCheck ? ' (auto after generation)' : ' (manual)'}</div>
    </div>
  )
}

function IssueRow({ issue }: { issue: FactCheckIssue }) {
  const color = issue.severity === 'critical' ? '#991b1b' : issue.severity === 'major' ? '#b45309' : '#334155'
  return (
    <span style={{ color }}>
      <strong>[{issue.severity}] {issue.kind}</strong> — {issue.claim}
      {issue.reason && <span style={S.muted}> · {issue.reason}</span>}
      {issue.suggestedCorrection && <span style={S.muted}> · try: {issue.suggestedCorrection}</span>}
    </span>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap:      { padding: 12 },
  section:   { padding: 12, background: 'white', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 10 },
  title:     { fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 8, textTransform: 'uppercase' as any, letterSpacing: 0.4 },
  gateNotice:{ padding: 10, background: '#fffbeb', border: '1px solid #fbbf24', color: '#92400e', borderRadius: 4, fontSize: 12 },
  btnPrimary:{ padding: '8px 12px', borderRadius: 4, background: '#0369a1', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnGhost:  { padding: '8px 12px', borderRadius: 4, background: 'white', color: '#334155', border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  confirmBox:{ padding: 10, background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 4, marginTop: 8, fontSize: 12 },
  progressBox:{ padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, marginTop: 8 },
  progressList:{ margin: 0, padding: '0 0 0 4px', listStyle: 'none' as any, fontSize: 12 },
  progressStep:{ padding: '4px 0', color: '#94a3b8' },
  progressStepActive:{ color: '#0f172a', fontWeight: 600 },
  error:     { marginTop: 8, padding: 8, background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: 4, fontSize: 12 },
  staleNotice:{ padding: 8, background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24', borderRadius: 4, fontSize: 12 },
  meta:      { fontSize: 11, color: '#64748b', marginTop: 4 },
  list:      { fontSize: 12, color: '#334155', margin: '6px 0 0 18px', padding: 0 },
  muted:     { color: '#64748b' },
}
