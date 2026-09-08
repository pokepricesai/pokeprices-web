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

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { WriterMetadata, FactCheckResult, FactCheckIssue, GenerationStage } from '@/lib/editorial/writer/types'
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

// Block 9B/9C — real server stages. Progress UI reflects
// writer.currentRun.stage returned from the last poll. The 9C
// split-Writer stages (plan / part1 / part2 / assemble) replace
// the old single 'writer' step for new runs; the legacy 'writer'
// slot stays reachable for in-flight runs from the previous machine.
const STAGE_ORDER: GenerationStage[] = ['queued', 'research_and_write', 'check_and_fix', 'writer', 'writer_plan', 'writer_part1', 'writer_part2', 'writer_assemble', 'writer_external', 'style', 'fact_check', 'repair', 'finalize', 'complete']
const STAGE_LABELS: Record<GenerationStage, string> = {
  queued:             'Preparing',
  // EIC two-stage external path (normal for SEO / news / new-set articles)
  research_and_write: 'Researching & writing',
  check_and_fix:      'Checking & fixing',
  // Legacy stages — kept for in-flight runs from prior machines
  writer:             'Writing draft',
  writer_plan:        'Planning article',
  writer_part1:       'Drafting part 1 of 2',
  writer_part2:       'Drafting part 2 of 2',
  writer_assemble:    'Assembling draft',
  writer_external:    'Writing article',
  style:              'Applying house style',
  fact_check:         'Checking facts',
  repair:             'Repairing draft',
  finalize:           'Saving draft',
  complete:           'Ready',
  failed:             'Failed',
}
function stageIndex(s: GenerationStage): number { return STAGE_ORDER.indexOf(s) }

export function GenerateAndFactCheckPanel(props: Props) {
  const { projectId, researchStatus, hasMeaningfulBody, writer, factCheckStale } = props
  const [busy, setBusy]           = useState<'generate' | 'fact-check' | 'repair' | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [liveStage, setLiveStage] = useState<GenerationStage | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const abortRef = useRef(false)

  const approved = researchStatus === 'approved'

  // Block 9B — Stage-machine poller. Each POST advances one stage
  // (≤1 Claude call) and returns updated writer state. Loop until
  // the server says stage is 'complete' or 'failed'.
  const runOneStage = useCallback(async (overwrite: boolean, mode: 'auto' | 'step'): Promise<{ writer: WriterMetadata; studio: StudioDocument | null; factCheck: FactCheckResult | null }> => {
    const auth = await authHeader()
    const res = await fetch(`/api/admin/editorial/studio/${projectId}/write`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ mode, overwriteExisting: overwrite }),
    })
    const j = await res.json().catch(() => ({}))
    if (res.status === 409 && j?.needsOverwriteConfirmation) {
      throw new Error('__NEEDS_OVERWRITE_CONFIRM__')
    }
    if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
    return { writer: j.writer as WriterMetadata, studio: (j.studio ?? null) as StudioDocument | null, factCheck: (j.factCheck ?? null) as FactCheckResult | null }
  }, [projectId])

  const generate = useCallback(async (overwrite: boolean) => {
    setError(null); setBusy('generate'); abortRef.current = false
    try {
      // First call boots the run + advances one stage (auto mode).
      let step = await runOneStage(overwrite, 'auto')
      setLiveStage(step.writer.currentRun?.stage ?? null)
      props.onWriterResult(step.writer, step.studio)
      // Then loop, polling next stage every ~500ms + server work.
      while (!abortRef.current && step.writer.currentRun && step.writer.currentRun.stage !== 'complete' && step.writer.currentRun.stage !== 'failed') {
        await sleep(400)
        step = await runOneStage(overwrite, 'step')
        setLiveStage(step.writer.currentRun?.stage ?? null)
        props.onWriterResult(step.writer, step.studio)
      }
      setConfirming(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      if (msg === '__NEEDS_OVERWRITE_CONFIRM__') { setConfirming(true); return }
      setError(msg)
    } finally {
      setBusy(null)
      setLiveStage(null)
    }
  }, [runOneStage, props])

  const runManualRepair = useCallback(async () => {
    setError(null); setBusy('repair')
    try {
      const auth = await authHeader()
      const res = await fetch(`/api/admin/editorial/studio/${projectId}/write`, {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'manual_repair' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `${res.status} ${res.statusText}`)
      props.onWriterResult(j.writer as WriterMetadata, (j.studio ?? null) as StudioDocument | null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally { setBusy(null) }
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
              {STAGE_ORDER.filter(s => s !== 'queued').map((s, i, arr) => {
                const cur = liveStage ?? writer?.currentRun?.stage ?? null
                const curIdx = cur ? Math.max(0, arr.indexOf(cur as any)) : -1
                const done = curIdx > i
                const active = curIdx === i
                return (
                  <li key={s} style={{ ...S.progressStep, ...(done || active ? S.progressStepActive : {}) }}>
                    {done ? '✓' : active ? '→' : '·'} {STAGE_LABELS[s]}
                  </li>
                )
              })}
            </ol>
          </div>
        )}
        {writer?.currentRun?.stage === 'failed' && (
          <div style={S.error}>
            Generation failed at stage <strong>{writer.currentRun.stageLabel || writer.currentRun.stage}</strong>: {writer.currentRun.error ?? 'unknown error'}.
            <div style={{ marginTop: 6 }}>
              <button style={S.btnPrimary} disabled={!!busy} onClick={() => generate(true)}>Retry</button>
            </div>
          </div>
        )}
        {writer?.currentRun && writer.currentRun.stage !== 'complete' && writer.currentRun.stage !== 'failed' && !busy && (
          <div style={S.gateNotice}>
            A generation is in progress at stage <strong>{writer.currentRun.stageLabel}</strong>. Reload safely — you can resume from this stage.
            <div style={{ marginTop: 6 }}>
              <button style={S.btnPrimary} onClick={() => generate(true)}>Resume</button>
            </div>
          </div>
        )}
        {error && <div style={S.error}>{error}</div>}
      </div>

      <div style={S.section}>
        <div style={S.title}>Fact check</div>
        <FactCheckSummary writer={writer} stale={factCheckStale} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button style={S.btnPrimary} disabled={busy === 'fact-check'} onClick={runFactCheck}>
            {busy === 'fact-check' ? 'Checking…' : 'Run fact check'}
          </button>
          {writer?.factCheck && writer.factCheck.issues.some(i => i.severity !== 'minor') && !writer.repairFired && (
            <button style={S.btnGhost} disabled={!!busy} onClick={runManualRepair} title="Spends ~2 additional Claude calls (Writer repair + Fact Checker rerun)">
              {busy === 'repair' ? 'Fixing…' : `Fix with AI (${writer.factCheck.issues.filter(i => i.severity !== 'minor').length} issue${writer.factCheck.issues.filter(i => i.severity !== 'minor').length === 1 ? '' : 's'})`}
            </button>
          )}
          {writer?.repairFired && (
            <span style={{ ...S.meta, alignSelf: 'center' }}>A repair pass has already been applied to this draft. Regenerate to try again.</span>
          )}
        </div>
      </div>

      {writer && (
        <div style={S.section}>
          <div style={S.title}>AI cost</div>
          <div style={S.meta}>
            <strong>${writer.generationCost.cost_usd.toFixed(4)}</strong> total ·{' '}
            {writer.generationCost.input_tokens + writer.generationCost.output_tokens} tokens
          </div>
        </div>
      )}

      {writer && (
        <details style={{ ...S.section, padding: 0 }}>
          <summary style={{ ...S.title, padding: 12, cursor: 'pointer', margin: 0 }}>
            Advanced (debug + claim trace + assembly warnings)
          </summary>
          <div style={{ padding: '0 12px 12px' }}>
            <div style={S.meta}>Generated {new Date(writer.generatedAt).toLocaleString()} · model {writer.model}</div>
            {writer.styleRepairFired && <div style={S.meta}>Style-repair pass fired.</div>}
            {writer.repairFired      && <div style={S.meta}>Fact repair pass fired.</div>}
            {writer.currentRun && Object.keys(writer.currentRun.stageTimings).length > 0 && (
              <div style={S.meta}>Stage timings:{' '}
                {Object.entries(writer.currentRun.stageTimings).map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}s`).join(' · ')}
              </div>
            )}
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
        </details>
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

function sleep(ms: number): Promise<void> { return new Promise(res => setTimeout(res, ms)) }

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
