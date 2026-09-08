'use client'
// src/app/admin/editorial/EditorialHqClient.tsx
//
// EIC Block 3 — Editorial HQ dashboard client.
//
// Consumes the compact EditorialContext produced server-side by
// buildEditorialContext(). Sections (top to bottom):
//   1. Shared admin header + peer nav
//   2. Health strip — 5 headline numbers
//   3. THIS WEEK — two publication slots
//   4. Pipeline — planned/in-progress projects outside this week
//   5. Idea backlog — inline create + plan-inline
//   6. Content Library — searchable published article view (Block 3)
//   7. Release Watch — recent + upcoming with coverage + timing +
//      inline release_calendar curation (Block 3)
//
// All privileged writes go through /api/admin/editorial/* with the
// admin's Supabase access token.

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import AdminToolHeader from '@/components/admin/AdminToolHeader'
import type { EditorialContext, EditorialContextArticle } from '@/lib/editorial/context'
import type { ReleaseItem } from '@/lib/editorial/releaseContext'
import type { Opportunity, OpportunityRadar } from '@/lib/editorial/opportunityRadar'
import type { StrategistRecommendation, StrategistResponse } from '@/lib/editorial/strategistPrompt'
import { computeActivePlan, mergeRecommendations, type ActivePlan, type ChatTurn } from '@/lib/editorial/activePlan'
import {
  EDITORIAL_ARTICLE_TYPES,
  EDITORIAL_STATUSES,
  ARTICLE_TYPE_LABELS,
  STATUS_LABELS,
  BACKLOG_STATUSES,
  CLOSED_STATUSES,
  currentWeekWindowUtc,
  isThisWeek,
  type EditorialProject,
  type EditorialArticleType,
  type EditorialStatus,
} from '@/lib/editorial/projects'

// ── Props ────────────────────────────────────────────────────────

type Props = {
  context: EditorialContext
  radar:   OpportunityRadar
  /** ISO datetime the currently-displayed radar was computed. Used
   *  to show "Opportunities updated: <time>" and to reset the
   *  local "just refreshed" hint when the page renders with a
   *  newer timestamp. */
  radarComputedAt?: string
  /** Block 6 — map from project.id -> editorial_research.status. */
  researchStatusById?: Record<string, string>
}

// ── Admin-API helpers (same pattern as InsightsAdminClient) ─────

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('You must be signed in as an admin.')
  return { authorization: `Bearer ${token}` }
}
async function apiJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const auth = await authHeader()
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), ...auth, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

// Editorial projects
async function apiCreateProject(payload: Partial<EditorialProject>): Promise<EditorialProject> {
  const j = await apiJson<{ project: EditorialProject }>('/api/admin/editorial/projects', {
    method: 'POST', body: JSON.stringify(payload),
  })
  return j.project
}
async function apiUpdateProject(id: number, patch: Partial<EditorialProject>): Promise<EditorialProject> {
  const j = await apiJson<{ project: EditorialProject }>(`/api/admin/editorial/projects/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  })
  return j.project
}
async function apiDeleteProject(id: number): Promise<void> {
  await apiJson(`/api/admin/editorial/projects/${id}`, { method: 'DELETE' })
}

// Release calendar
type ReleaseCalendarRow = {
  id: number; set_name: string; set_code: string | null; release_date: string | null;
  region: string | null; jp_release_date: string | null; confirmed: boolean | null; notes: string | null;
}
async function apiCreateRelease(payload: Partial<ReleaseCalendarRow>): Promise<ReleaseCalendarRow> {
  const j = await apiJson<{ release: ReleaseCalendarRow }>('/api/admin/editorial/release-calendar', {
    method: 'POST', body: JSON.stringify(payload),
  })
  return j.release
}
async function apiUpdateRelease(id: number, patch: Partial<ReleaseCalendarRow>): Promise<ReleaseCalendarRow> {
  const j = await apiJson<{ release: ReleaseCalendarRow }>(`/api/admin/editorial/release-calendar/${id}`, {
    method: 'PATCH', body: JSON.stringify(patch),
  })
  return j.release
}
async function apiDeleteRelease(id: number): Promise<void> {
  await apiJson(`/api/admin/editorial/release-calendar/${id}`, { method: 'DELETE' })
}

// ── Deep Research prompt (external articles) ────────────────────
//
// Uses the canonical getEditorialMode helper so the article_type
// alone decides the mode. Title heuristics no longer accidentally
// route internal data articles into the external workflow.

import { getEditorialMode as _getEditorialMode } from '@/lib/editorial/editorialMode'

function isExternalOpportunity(project: { article_type?: string; articleType?: string; title?: string; angle?: string | null }): boolean {
  return _getEditorialMode({
    article_type: (project as any).article_type ?? (project as any).articleType ?? null,
    title:        project.title ?? null,
    angle:        project.angle ?? null,
  }) === 'external'
}

function DeepResearchPromptButton({ project, compact }: { project: { id: number; title: string; article_type?: string; angle?: string | null }; compact?: boolean }) {
  const [busy,    setBusy]    = useState(false)
  const [open,    setOpen]    = useState(false)
  const [prompt,  setPrompt]  = useState<string | null>(null)
  const [copied,  setCopied]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [linkCount, setLinkCount] = useState<number | null>(null)
  if (!isExternalOpportunity(project)) return null

  const fetchPrompt = async () => {
    setBusy(true); setError(null); setCopied(false)
    try {
      const j = await apiJson<{ prompt: string; internalLinkCount?: number }>(`/api/admin/editorial/deep-research-prompt/${project.id}`)
      setPrompt(j.prompt)
      setLinkCount(j.internalLinkCount ?? null)
      setOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown')
    } finally { setBusy(false) }
  }

  const copy = async () => {
    if (!prompt) return
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard permission denied — surface the prompt so admin can select it manually.
      setError('Clipboard blocked — select the text below manually.')
    }
  }

  const btnStyle = compact
    ? { padding: '4px 8px', fontSize: 11, borderRadius: 6, background: 'var(--primary, #0369a1)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' as any }
    : { padding: '6px 12px', fontSize: 12, borderRadius: 6, background: 'var(--primary, #0369a1)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' as any }

  return (
    <>
      <button style={btnStyle} disabled={busy} onClick={fetchPrompt} title="External article — copy a Deep Research prompt to paste into ChatGPT Deep Research">
        {busy ? 'Generating…' : (compact ? 'Deep Research' : 'Copy Deep Research Prompt')}
      </button>
      {error && !open && <span style={{ marginLeft: 8, fontSize: 12, color: '#b91c1c' }}>{error}</span>}
      {open && prompt && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', maxWidth: 900, width: '100%', maxHeight: '90vh', borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: 18 }}>Deep Research prompt</h2>
              <button style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: '#64748b' }} onClick={() => setOpen(false)}>×</button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {project.title} · paste this into ChatGPT Deep Research{linkCount != null ? ` · ${linkCount} internal link candidate(s) included` : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button style={{ padding: '8px 14px', borderRadius: 6, background: copied ? '#16a34a' : '#0f172a', color: 'white', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }} onClick={copy}>
                {copied ? '✓ Copied to clipboard' : 'Copy to clipboard'}
              </button>
              {error && <span style={{ fontSize: 12, color: '#b91c1c' }}>{error}</span>}
            </div>
            <textarea
              value={prompt}
              readOnly
              style={{ flex: 1, minHeight: 400, width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, lineHeight: 1.5, padding: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc', color: '#0f172a', resize: 'vertical' as any }}
              onClick={e => (e.target as HTMLTextAreaElement).select()}
            />
            <div style={{ fontSize: 11, color: '#64748b' }}>
              External articles are researched and written in ChatGPT Deep Research, not inside the EIC. Paste the returned article + sources into Studio when ready.
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Display helpers ──────────────────────────────────────────────

function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return iso }
}
/** Human-readable "Opportunities updated" label. Same-day radar
 *  rows show "today at 14:32", older rows fall back to a date. */
function fmtRadarComputedAt(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    if (sameDay) return `today at ${time}`
    return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} at ${time}`
  } catch { return iso }
}
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return iso }
}
function fmtDayOfWeek(dateIso: string): string {
  return new Date(dateIso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
function daysDeltaLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`
}

// ── Status / priority badge palettes ─────────────────────────────

const STATUS_COLOR: Record<EditorialStatus, { bg: string; fg: string }> = {
  idea:        { bg: 'rgba(148,163,184,0.16)', fg: '#64748b' },
  planned:     { bg: 'rgba(59,130,246,0.14)',  fg: '#2563eb' },
  researching: { bg: 'rgba(139,92,246,0.14)',  fg: '#7c3aed' },
  drafting:    { bg: 'rgba(234,88,12,0.14)',   fg: '#c2410c' },
  review:      { bg: 'rgba(202,138,4,0.14)',   fg: '#a16207' },
  ready:       { bg: 'rgba(21,128,61,0.14)',   fg: '#15803d' },
  published:   { bg: 'rgba(34,197,94,0.16)',   fg: '#15803d' },
  archived:    { bg: 'rgba(100,116,139,0.14)', fg: '#475569' },
}
const COVERAGE_COLOR: Record<'covered' | 'planned' | 'none', { bg: string; fg: string; label: string }> = {
  covered: { bg: 'rgba(34,197,94,0.16)',  fg: '#15803d', label: 'Covered' },
  planned: { bg: 'rgba(59,130,246,0.16)', fg: '#1e40af', label: 'Planned' },
  none:    { bg: 'rgba(239,68,68,0.10)',  fg: '#b91c1c', label: 'No coverage' },
}

function StatusBadge({ status }: { status: string }) {
  const p = STATUS_COLOR[(status as EditorialStatus)] ?? STATUS_COLOR.idea
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: p.bg, color: p.fg,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap' }}>
      {STATUS_LABELS[(status as EditorialStatus)] ?? status}
    </span>
  )
}
function CoverageBadge({ status }: { status: 'covered' | 'planned' | 'none' }) {
  const p = COVERAGE_COLOR[status]
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: p.bg, color: p.fg,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap' }}>
      {p.label}
    </span>
  )
}
function PriorityDot({ priority }: { priority: number }) {
  const colours = ['#ef4444', '#f97316', '#eab308', '#a3a3a3', '#cbd5e1']
  const c = colours[Math.max(0, Math.min(4, priority - 1))]
  const label = priority === 1 ? 'P1 (highest)' : priority === 5 ? 'P5 (lowest)' : `P${priority}`
  return (
    <span title={label} aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: c }} />
      P{priority}
    </span>
  )
}
function TypeBadge({ type }: { type: string }) {
  const label = ARTICLE_TYPE_LABELS[(type as EditorialArticleType)] ?? type
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: 'var(--bg-light)', color: 'var(--text)',
      fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', border: '1px solid var(--border)' }}>
      {label}
    </span>
  )
}
// Block 10 — small pill showing the project's publication state.
// Colour-coded: draft/none = gray, ready = amber, published = green.
// When the project has a linked insights_id and is published, also
// links to the public article.
function PublicationChip({ project }: { project: EditorialProject }) {
  const status = project.status
  let bg = '#f1f5f9', fg = '#334155', label = 'Not planned'
  if (status === 'planned')   { bg = '#e0f2fe'; fg = '#0369a1'; label = 'Planned' }
  if (status === 'drafting')  { bg = '#fef3c7'; fg = '#92400e'; label = 'Drafting' }
  if (status === 'review')    { bg = '#fef3c7'; fg = '#92400e'; label = 'Review' }
  if (status === 'ready')     { bg = '#fef3c7'; fg = '#92400e'; label = 'Ready' }
  if (status === 'published') { bg = '#dcfce7'; fg = '#166534'; label = 'Published' }
  if (status === 'archived')  { bg = '#f1f5f9'; fg = '#64748b'; label = 'Archived' }
  const chip = (
    <span title="Editorial project status" style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: bg, color: fg, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', border: `1px solid ${fg}22` }}>
      {label}
    </span>
  )
  return chip
}

// Block 7 — small pill linking to the project's Article Studio.
function StudioChip({ projectId }: { projectId: number }) {
  return (
    <Link href={`/admin/editorial/studio/${projectId}`} style={{ textDecoration: 'none' }}>
      <span title="Open Article Studio" style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: '#fef3c7', color: '#92400e', fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', border: '1px solid #fbbf24', cursor: 'pointer' }}>
        Studio →
      </span>
    </Link>
  )
}
// Block 6 — small pill linking to the project's Research Room with
// the current editorial_research.status. Defaults to "Research" when
// no research row exists yet.
function ResearchChip({ projectId, status }: { projectId: number; status?: string }) {
  const s = status ?? 'not_started'
  const styles: Record<string, { bg: string; fg: string; label: string }> = {
    not_started:     { bg: '#f1f5f9', fg: '#334155', label: 'Research: none' },
    gathering:       { bg: '#e0f2fe', fg: '#0369a1', label: 'Research: gathering' },
    review_required: { bg: '#fef3c7', fg: '#92400e', label: 'Research: review' },
    blocked:         { bg: '#fee2e2', fg: '#991b1b', label: 'Research: blocked' },
    approved:        { bg: '#dcfce7', fg: '#166534', label: 'Research: approved' },
  }
  const st = styles[s] ?? styles.not_started
  return (
    <Link href={`/admin/editorial/research/${projectId}`} style={{ textDecoration: 'none' }}>
      <span title="Open Research Room" style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, background: st.bg, color: st.fg, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', border: `1px solid ${st.fg}22`, cursor: 'pointer' }}>
        {st.label}
      </span>
    </Link>
  )
}

// ── Common style bits ────────────────────────────────────────────

const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18 }
const sectionH: React.CSSProperties = { fontFamily: "'Outfit', sans-serif", fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text)' }
const sectionSub: React.CSSProperties = { fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '2px 0 0' }
const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontFamily: "'Figtree', sans-serif" }
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', fontSize: 13, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box' }
const btnPrimary: React.CSSProperties = { padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }
const btnGhost: React.CSSProperties = { padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }
const btnDanger: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#ef4444', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }

// ── Convert context.projects (camelCase) back to snake-case rows ─
// so the sub-components can keep working with the DB shape.

function contextProjectToRow(p: EditorialContext['projects'][number]): EditorialProject {
  return {
    id: p.id,
    title: p.title,
    angle: p.angle,
    article_type: p.articleType,
    status: p.status,
    priority: p.priority,
    target_publish_at: p.targetPublishAt,
    notes: p.notes,
    insights_id: p.insightsId,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  }
}

// ────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────

export default function EditorialHqClient(props: Props) {
  const { context, radar, researchStatusById } = props
  const getResearchStatus = useCallback((id: number): string => researchStatusById?.[String(id)] ?? 'not_started', [researchStatusById])
  const [projects, setProjects] = useState<EditorialProject[]>(() => context.projects.map(contextProjectToRow))
  const [releases, setReleases] = useState<readonly ReleaseItem[]>(() => [...context.release.recent, ...context.release.upcoming])
  const [error, setError] = useState<string | null>(null)
  const week = useMemo(() => currentWeekWindowUtc(), [])

  // ── Derived collections ──────────────────────────────────────

  const activeProjects = useMemo(
    () => projects.filter(p => !CLOSED_STATUSES.includes(p.status as EditorialStatus)),
    [projects],
  )
  const thisWeekProjects = useMemo(
    () => activeProjects
      .filter(p => isThisWeek(p.target_publish_at))
      .sort((a, b) => (a.target_publish_at ?? '').localeCompare(b.target_publish_at ?? '')),
    [activeProjects],
  )
  const backlogProjects = useMemo(
    () => projects
      .filter(p => BACKLOG_STATUSES.includes(p.status as EditorialStatus))
      .sort((a, b) => (a.priority - b.priority) || b.created_at.localeCompare(a.created_at)),
    [projects],
  )
  const activeNotThisWeek = useMemo(
    () => activeProjects.filter(p => !isThisWeek(p.target_publish_at) && !BACKLOG_STATUSES.includes(p.status as EditorialStatus))
      .sort((a, b) => (a.target_publish_at ?? '9999').localeCompare(b.target_publish_at ?? '9999')),
    [activeProjects],
  )

  const s = context.summary

  // ── Mutation helpers ─────────────────────────────────────────

  const upsertProject = useCallback((p: EditorialProject) => {
    setProjects(prev => {
      const idx = prev.findIndex(x => x.id === p.id)
      if (idx === -1) return [p, ...prev]
      const next = prev.slice(); next[idx] = p; return next
    })
  }, [])
  const removeProject = useCallback((id: number) => {
    setProjects(prev => prev.filter(p => p.id !== id))
  }, [])
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setError(null)
    try { return await fn() } catch (e: any) { setError(e?.message || 'action failed'); return null }
  }, [])

  const onCreate  = useCallback(async (payload: Partial<EditorialProject>) => { const p = await run(() => apiCreateProject(payload)); if (p) upsertProject(p); return p }, [run, upsertProject])
  const onUpdate  = useCallback(async (id: number, patch: Partial<EditorialProject>) => { const p = await run(() => apiUpdateProject(id, patch)); if (p) upsertProject(p); return p }, [run, upsertProject])
  const onDelete  = useCallback(async (id: number, title: string) => {
    if (!confirm(`Delete "${title}"? If you meant to hide it, set status to Archived instead.`)) return
    const ok = await run(() => apiDeleteProject(id))
    if (ok !== null) removeProject(id)
  }, [run, removeProject])
  const onArchive = useCallback((p: EditorialProject) => onUpdate(p.id, { status: 'archived' }), [onUpdate])

  // Release-calendar mutations mutate local state optimistically then
  // patch onto the release list. We deliberately DO NOT re-run the
  // release context here — a full refresh happens on the next page
  // load, and the local list is Good Enough for the current session.
  const onCreateReleaseRow = useCallback(async (payload: Partial<ReleaseCalendarRow>) => {
    const row = await run(() => apiCreateRelease(payload))
    if (row) {
      setReleases(prev => {
        const item = releaseRowToItem(row, context.meta.today)
        return [item, ...prev]
      })
    }
    return row
  }, [run, context.meta.today])
  const onUpdateReleaseRow = useCallback(async (id: number, patch: Partial<ReleaseCalendarRow>) => {
    const row = await run(() => apiUpdateRelease(id, patch))
    if (row) {
      setReleases(prev => prev.map(x => x.releaseCalendarId === id ? mergeReleaseRow(x, row, context.meta.today) : x))
    }
    return row
  }, [run, context.meta.today])
  const onDeleteReleaseRow = useCallback(async (id: number) => {
    if (!confirm('Delete this release_calendar row? This cannot be undone.')) return
    const ok = await run(() => apiDeleteRelease(id))
    if (ok !== null) {
      setReleases(prev => prev.filter(x => x.releaseCalendarId !== id || x.sources.includes('cards')))
    }
  }, [run])

  // ── Render ───────────────────────────────────────────────────

  return (
    <>
      <AdminToolHeader toolName="Editorial HQ" extraLinks={[{ href: '/admin/insights', label: 'Insights (Articles)' }]} />

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, margin: '0 0 4px', color: 'var(--text)' }}>Editorial HQ</h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
              Plan and ship two exceptional articles a week. Week of {fmtDate(week.startIso)} – {fmtDate(week.endIso)}.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/admin/insights" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>Existing Insights</Link>
            <Link href="/insights" target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>Public /insights ↗</Link>
          </div>
        </div>

        {error && (
          <div role="alert" style={{ background: 'rgba(239,68,68,0.06)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* AI EDITORIAL STRATEGIST — Block 5 */}
        <section style={{ marginBottom: 32 }}>
          <SectionHeader
            title="AI Editorial Strategist"
            subtitle="Editorial judgement over the current PokePrices Context + Opportunity Radar. Recommends what to actually publish, willing to disagree."
          />
          <EditorialStrategistPanel context={context} radar={radar} onCreate={onCreate} />
        </section>

        {/* Health strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 24 }}>
          <StatCard label="Published articles"    value={s.totalArticles} />
          <StatCard label="Ideas in backlog"      value={s.ideasInBacklog} />
          <StatCard label="Planned this week"     value={thisWeekProjects.length} sub="target of 2" />
          <StatCard label="Published this month"  value={s.articlesPublishedThisMonth} />
          <StatCard label="Release watch entries" value={s.recentReleases + s.upcomingReleases}
            sub={`${s.recentReleases} recent · ${s.upcomingReleases} upcoming · ${s.releasesWithoutCoverage} uncovered`} />
        </div>

        {/* OPPORTUNITY RADAR — Block 4 */}
        <section style={{ marginBottom: 32 }}>
          <SectionHeader
            title="Opportunity Radar"
            subtitle={`Grounded editorial opportunities inferred from real PokePrices data. ${radar.opportunities.length} detected today.`}
          />
          <OpportunityRadarPanel radar={radar} onCreate={onCreate} activeProjects={projects} radarComputedAt={props.radarComputedAt} />
        </section>

        {/* THIS WEEK */}
        <section style={{ marginBottom: 32 }}>
          <SectionHeader title="This Week" subtitle="Two publication slots. Anything with a target date in this week fills a slot." />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
            <SlotCard index={1} project={thisWeekProjects[0]} week={week} onUpdate={onUpdate} onArchive={onArchive} onCreate={onCreate} radarSuggestion={radar.opportunities[0]} researchStatus={thisWeekProjects[0] ? getResearchStatus(thisWeekProjects[0].id) : undefined} />
            <SlotCard index={2} project={thisWeekProjects[1]} week={week} onUpdate={onUpdate} onArchive={onArchive} onCreate={onCreate} radarSuggestion={radar.opportunities[1] ?? radar.opportunities[0]} researchStatus={thisWeekProjects[1] ? getResearchStatus(thisWeekProjects[1].id) : undefined} />
          </div>
          {thisWeekProjects.length > 2 && (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Also this week: {thisWeekProjects.slice(2).map(p => (
                <span key={p.id} style={{ marginRight: 8 }}>
                  {fmtDayOfWeek(p.target_publish_at!)} — <strong style={{ color: 'var(--text)' }}>{p.title}</strong>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Pipeline */}
        {activeNotThisWeek.length > 0 && (
          <section style={{ marginBottom: 32 }}>
            <SectionHeader title="Pipeline" subtitle="Planned or in progress, outside this week." />
            <div style={{ display: 'grid', gap: 8 }}>
              {activeNotThisWeek.map(p => (
                <ProjectRow key={p.id} project={p} onUpdate={onUpdate} onArchive={onArchive} onDelete={onDelete} researchStatus={getResearchStatus(p.id)} />
              ))}
            </div>
          </section>
        )}

        {/* Backlog */}
        <section style={{ marginBottom: 32 }}>
          <SectionHeader title="Idea Backlog" subtitle="Raw ideas without a target date. Later blocks will let the AI populate this." />
          <BacklogSection projects={backlogProjects} onCreate={onCreate} onUpdate={onUpdate} onArchive={onArchive} onDelete={onDelete} getResearchStatus={getResearchStatus} />
        </section>

        {/* Content Library — Block 3 */}
        <section style={{ marginBottom: 32 }}>
          <SectionHeader title="Content Library" subtitle="Everything we've already published. Search by any word from the headline, intro or body." />
          <ContentLibrary articles={context.articles} releases={releases} />
        </section>

        {/* Release Watch — Block 3 */}
        <section>
          <SectionHeader
            title="Release Watch"
            subtitle={`Recent (last ${context.release.windowDaysBack} days from card catalogue) + upcoming (next ${context.release.windowDaysForward} days from release_calendar). Coverage + timing shown per set.`}
          />
          <ReleaseWatchPanel
            releases={releases}
            gapNote={context.release.gapNote}
            onCreateRow={onCreateReleaseRow}
            onUpdateRow={onUpdateReleaseRow}
            onDeleteRow={onDeleteReleaseRow}
          />
        </section>
      </div>
    </>
  )
}

// ────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <h2 style={sectionH}>{title}</h2>
      <p style={sectionSub}>{subtitle}</p>
    </div>
  )
}
function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, fontWeight: 800, color: 'var(--text)', lineHeight: 1.1, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── This-week slot ──────────────────────────────────────────────

function SlotCard({
  index, project, week, onUpdate, onArchive, onCreate, radarSuggestion, researchStatus,
}: {
  index: 1 | 2
  project: EditorialProject | undefined
  week: { startIso: string; endIso: string }
  onUpdate: (id: number, patch: Partial<EditorialProject>) => Promise<any>
  onArchive: (p: EditorialProject) => Promise<any>
  onCreate: (payload: Partial<EditorialProject>) => Promise<any>
  radarSuggestion?: Opportunity
  researchStatus?: string
}) {
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)

  if (!project) {
    return (
      <div style={{ ...card, borderStyle: 'dashed', minHeight: 190 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Slot {index}</div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Week of {fmtDate(week.startIso)}</span>
        </div>
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '4px 0 8px', color: 'var(--text)' }}>Not planned</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 14px' }}>
          Add an article for this week. Set a target publish date inside {fmtDate(week.startIso)} – {fmtDate(week.endIso)}.
        </p>
        {creating ? (
          <ProjectForm
            initial={{ status: 'planned', priority: 2, article_type: 'evergreen', target_publish_at: week.startIso }}
            weekWindow={week}
            onCancel={() => setCreating(false)}
            onSubmit={async payload => { await onCreate(payload); setCreating(false) }}
            submitLabel="Plan article"
          />
        ) : (
          <button style={btnPrimary} onClick={() => setCreating(true)}>+ Plan an article</button>
        )}
        {!creating && radarSuggestion && (
          <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'rgba(59,130,246,0.06)', border: '1px dashed rgba(59,130,246,0.3)' }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: '#1e40af', marginBottom: 4 }}>
              Best current opportunity · score {radarSuggestion.score}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{radarSuggestion.headlineSuggestion}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.4 }}>{radarSuggestion.whyNow}</div>
            <button
              style={btnGhost}
              onClick={async () => {
                const payload = opportunityToProjectPayload(radarSuggestion, 'planned', week.startIso)
                await onCreate(payload)
              }}
            >Plan this →</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          Slot {index} · {project.target_publish_at ? fmtDayOfWeek(project.target_publish_at) : 'no date'}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <StatusBadge status={project.status} />
          <ResearchChip projectId={project.id} status={researchStatus} />
      <StudioChip projectId={project.id} />
      <PublicationChip project={project} />
          <PriorityDot priority={project.priority} />
        </div>
      </div>
      {editing ? (
        <ProjectForm
          initial={project}
          weekWindow={week}
          onCancel={() => setEditing(false)}
          onSubmit={async payload => { await onUpdate(project.id, payload); setEditing(false) }}
          submitLabel="Save"
        />
      ) : (
        <>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '2px 0 6px', color: 'var(--text)' }}>{project.title}</h3>
          {project.angle && <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 8px', lineHeight: 1.5 }}>{project.angle}</p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <TypeBadge type={project.article_type} />
          </div>
          {project.notes && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', margin: '0 0 12px', lineHeight: 1.5 }}>{project.notes}</p>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <DeepResearchPromptButton project={project} />
            <button style={btnGhost} onClick={() => setEditing(true)}>Edit</button>
            <StatusPicker current={project.status} onPick={s => onUpdate(project.id, { status: s })} />
            <button style={btnDanger} onClick={() => onArchive(project)}>Archive</button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Pipeline row + Backlog ──────────────────────────────────────

function ProjectRow({ project, onUpdate, onArchive, onDelete, researchStatus }: {
  project: EditorialProject
  onUpdate: (id: number, patch: Partial<EditorialProject>) => Promise<any>
  onArchive: (p: EditorialProject) => Promise<any>
  onDelete: (id: number, title: string) => Promise<any>
  researchStatus?: string
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <div style={{ ...card, padding: 14 }}>
        <ProjectForm initial={project} onCancel={() => setEditing(false)}
          onSubmit={async p => { await onUpdate(project.id, p); setEditing(false) }} submitLabel="Save" />
      </div>
    )
  }
  return (
    <div style={{ ...card, padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 90, fontSize: 12, color: 'var(--text-muted)' }}>
        {project.target_publish_at ? fmtDate(project.target_publish_at) : <em>no date</em>}
      </div>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14, marginBottom: 2 }}>{project.title}</div>
        {project.angle && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{project.angle}</div>}
      </div>
      <TypeBadge type={project.article_type} />
      <StatusBadge status={project.status} />
      <ResearchChip projectId={project.id} status={researchStatus} />
      <StudioChip projectId={project.id} />
      <PublicationChip project={project} />
      <PriorityDot priority={project.priority} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <DeepResearchPromptButton project={project} compact />
        <button style={btnGhost} onClick={() => setEditing(true)}>Edit</button>
        <button style={btnGhost} onClick={() => onArchive(project)}>Archive</button>
        <button style={btnDanger} onClick={() => onDelete(project.id, project.title)}>Delete</button>
      </div>
    </div>
  )
}

function BacklogSection({ projects, onCreate, onUpdate, onArchive, onDelete, getResearchStatus }: {
  projects: EditorialProject[]
  onCreate: (payload: Partial<EditorialProject>) => Promise<any>
  onUpdate: (id: number, patch: Partial<EditorialProject>) => Promise<any>
  onArchive: (p: EditorialProject) => Promise<any>
  onDelete: (id: number, title: string) => Promise<any>
  getResearchStatus: (id: number) => string
}) {
  const [creating, setCreating] = useState(false)
  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{projects.length} idea{projects.length === 1 ? '' : 's'} · sorted by priority then newest</span>
        {!creating && <button style={btnPrimary} onClick={() => setCreating(true)}>+ New idea</button>}
      </div>
      {creating && (
        <div style={{ marginBottom: 14, padding: 14, borderRadius: 10, background: 'var(--bg-light)', border: '1px dashed var(--border)' }}>
          <ProjectForm initial={{ status: 'idea', priority: 3, article_type: 'evergreen' }}
            onCancel={() => setCreating(false)}
            onSubmit={async payload => { await onCreate(payload); setCreating(false) }} submitLabel="Add idea" />
        </div>
      )}
      {projects.length === 0 ? (
        <div style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, border: '1px dashed var(--border)', borderRadius: 10 }}>
          No ideas yet. Capture the next thing worth writing.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {projects.map(p => <BacklogRow key={p.id} project={p} onUpdate={onUpdate} onArchive={onArchive} onDelete={onDelete} researchStatus={getResearchStatus(p.id)} />)}
        </div>
      )}
    </div>
  )
}

function BacklogRow({ project, onUpdate, onArchive, onDelete, researchStatus }: {
  project: EditorialProject
  onUpdate: (id: number, patch: Partial<EditorialProject>) => Promise<any>
  onArchive: (p: EditorialProject) => Promise<any>
  onDelete: (id: number, title: string) => Promise<any>
  researchStatus?: string
}) {
  const [editing, setEditing] = useState(false)
  const [planning, setPlanning] = useState(false)
  if (editing) {
    return (
      <div style={{ padding: 12, borderRadius: 10, background: 'var(--bg-light)', border: '1px solid var(--border)' }}>
        <ProjectForm initial={project} onCancel={() => setEditing(false)}
          onSubmit={async p => { await onUpdate(project.id, p); setEditing(false) }} submitLabel="Save" />
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderRadius: 10, background: 'var(--bg-light)', border: '1px solid var(--border)' }}>
      <PriorityDot priority={project.priority} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{project.title}</div>
        {project.angle && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 }}>{project.angle}</div>}
      </div>
      <TypeBadge type={project.article_type} />
      <ResearchChip projectId={project.id} status={researchStatus} />
      <StudioChip projectId={project.id} />
      <PublicationChip project={project} />
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(project.created_at)}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {planning ? (
          <PlanInline onCancel={() => setPlanning(false)}
            onConfirm={async iso => { await onUpdate(project.id, { status: 'planned', target_publish_at: iso }); setPlanning(false) }} />
        ) : (
          <button style={btnGhost} onClick={() => setPlanning(true)}>Plan…</button>
        )}
        <button style={btnGhost} onClick={() => setEditing(true)}>Edit</button>
        <button style={btnGhost} onClick={() => onArchive(project)}>Archive</button>
        <button style={btnDanger} onClick={() => onDelete(project.id, project.title)}>Delete</button>
      </div>
    </div>
  )
}

function PlanInline({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (iso: string) => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [d, setD] = useState(today)
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input type="date" value={d} onChange={e => setD(e.target.value)} style={{ ...input, width: 150, padding: '6px 8px' }} />
      <button style={btnPrimary} onClick={() => onConfirm(d)}>Plan</button>
      <button style={btnGhost} onClick={onCancel}>Cancel</button>
    </span>
  )
}

// ── Content Library (Block 3) ────────────────────────────────────

function ContentLibrary({ articles, releases }: { articles: readonly EditorialContextArticle[]; releases: readonly ReleaseItem[] }) {
  const [q, setQ] = useState('')
  const [themeFilter, setThemeFilter] = useState<string>('all')

  const themes = useMemo(() => {
    const set = new Set<string>()
    for (const a of articles) if (a.themeLabel) set.add(a.themeLabel)
    return ['all', ...Array.from(set).sort()]
  }, [articles])

  // Build a set of release names each article covers (from the release
  // side's coverage matching, walked backwards). O(articles*releases)
  // is fine at this scale.
  const articleToReleases = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of releases) for (const cov of r.coverage.publishedInsights) {
      const cur = map.get(cov.slug) ?? []
      if (!cur.includes(r.setName)) cur.push(r.setName)
      map.set(cov.slug, cur)
    }
    return map
  }, [releases])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return articles.filter(a => {
      if (themeFilter !== 'all' && a.themeLabel !== themeFilter) return false
      if (!needle) return true
      const hay = `${a.headline} ${a.intro ?? ''} ${a.bodyExcerpt}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [articles, q, themeFilter])

  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search headlines, intros and body text… (e.g. grading, Charizard, PSA, Team Rocket)"
          style={{ ...input, maxWidth: 460 }}
        />
        <select value={themeFilter} onChange={e => setThemeFilter(e.target.value)} style={{ ...input, width: 220, cursor: 'pointer' }}>
          {themes.map(t => <option key={t} value={t}>{t === 'all' ? 'All themes' : t}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{filtered.length} of {articles.length}</span>
      </div>
      {filtered.length === 0 ? (
        <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13, border: '1px dashed var(--border)', borderRadius: 10 }}>
          No published articles match — try a different search term.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {filtered.map(a => {
            const referencedSets = articleToReleases.get(a.slug) ?? []
            const declaredSets = Array.isArray(a.setRefs) ? a.setRefs : []
            const declaredCards = Array.isArray(a.cardRefs) ? a.cardRefs : []
            return (
              <div key={a.id} style={{ padding: 14, borderRadius: 10, background: 'var(--bg-light)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <a href={`/insights/${a.slug}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 17, fontWeight: 800, color: 'var(--text)', textDecoration: 'none' }}>
                        {a.headline}
                      </a>
                      {a.themeLabel && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{a.themeLabel}</span>}
                    </div>
                    {a.intro && <p style={{ fontSize: 13, color: 'var(--text)', margin: '6px 0 0', lineHeight: 1.5 }}>{a.intro}</p>}
                  </div>
                  <div style={{ display: 'grid', gap: 4, textAlign: 'right', minWidth: 140 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDateTime(a.publishedAt)}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.wordCount.toLocaleString('en-GB')} words</span>
                    <a href={`/insights/${a.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block', textAlign: 'center', marginTop: 4 }}>View ↗</a>
                  </div>
                </div>
                {(referencedSets.length + declaredSets.length + declaredCards.length) > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {referencedSets.map(s => <ChipTag key={'r-' + s} label={`Set: ${s}`} tone="blue" />)}
                    {declaredSets.filter(s => !referencedSets.includes(s)).map(s => <ChipTag key={'d-' + s} label={`Set: ${s}`} tone="grey" />)}
                    {declaredCards.slice(0, 4).map(c => <ChipTag key={'c-' + c} label={`Card: ${c}`} tone="grey" />)}
                    {declaredCards.length > 4 && <ChipTag label={`+${declaredCards.length - 4} more cards`} tone="grey" />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ChipTag({ label, tone }: { label: string; tone: 'blue' | 'grey' }) {
  const bg = tone === 'blue' ? 'rgba(59,130,246,0.10)' : 'var(--card)'
  const fg = tone === 'blue' ? '#1e40af' : 'var(--text-muted)'
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, background: bg, color: fg, fontSize: 11, fontWeight: 700, border: '1px solid var(--border)' }}>
      {label}
    </span>
  )
}

// ── Release Watch (Block 3) ──────────────────────────────────────

function ReleaseWatchPanel({
  releases, gapNote, onCreateRow, onUpdateRow, onDeleteRow,
}: {
  releases: readonly ReleaseItem[]
  gapNote: string | null
  onCreateRow: (payload: Partial<ReleaseCalendarRow>) => Promise<any>
  onUpdateRow: (id: number, patch: Partial<ReleaseCalendarRow>) => Promise<any>
  onDeleteRow: (id: number) => Promise<any>
}) {
  const [creating, setCreating] = useState(false)
  const sorted = useMemo(() => releases.slice().sort((a, b) => a.releaseDate.localeCompare(b.releaseDate)), [releases])

  return (
    <div style={{ ...card, padding: 16 }}>
      {gapNote && (
        <div style={{ fontSize: 12, color: '#92400e', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          {gapNote}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sorted.length} entr{sorted.length === 1 ? 'y' : 'ies'} in the window</span>
        {!creating && <button style={btnPrimary} onClick={() => setCreating(true)}>+ Curate release</button>}
      </div>
      {creating && (
        <div style={{ marginBottom: 12, padding: 14, borderRadius: 10, background: 'var(--bg-light)', border: '1px dashed var(--border)' }}>
          <ReleaseForm
            initial={{ region: 'global', confirmed: false }}
            onCancel={() => setCreating(false)}
            onSubmit={async payload => { await onCreateRow(payload); setCreating(false) }}
            submitLabel="Add release"
          />
        </div>
      )}
      {sorted.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No sets in the watch window. Add an upcoming release above.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {sorted.map(r => (
            <ReleaseRow key={`${r.setName}-${r.releaseDate}-${r.releaseCalendarId ?? 'c'}`}
              item={r}
              onUpdateRow={onUpdateRow}
              onDeleteRow={onDeleteRow}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReleaseRow({ item, onUpdateRow, onDeleteRow }: {
  item: ReleaseItem
  onUpdateRow: (id: number, patch: Partial<ReleaseCalendarRow>) => Promise<any>
  onDeleteRow: (id: number) => Promise<any>
}) {
  const [editing, setEditing] = useState(false)
  const applicableTimings = item.timingOpportunities.filter(o => o.applicable)

  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10,
      background: item.kind === 'upcoming' ? 'rgba(59,130,246,0.05)' : 'var(--bg-light)',
      border: `1px solid ${item.kind === 'upcoming' ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12, alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{item.setName}</span>
            {item.setCode && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, color: 'var(--text-muted)' }}>{item.setCode}</span>}
            <CoverageBadge status={item.coverage.status} />
            {item.kind === 'upcoming' && (
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: item.confirmed ? '#15803d' : '#a16207' }}>
                {item.confirmed ? 'Confirmed' : 'Unconfirmed'}
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            {fmtDate(item.releaseDate)} · {daysDeltaLabel(item.daysDelta)}
            {item.region ? ` · ${item.region}` : ''}
            {item.jpReleaseDate ? ` · JP ${fmtDate(item.jpReleaseDate)}` : ''}
            {typeof item.cardCount === 'number' ? ` · ${item.cardCount} catalogue cards` : ''}
          </div>
          {item.coverage.publishedInsights.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6 }}>
              Existing articles: {item.coverage.publishedInsights.map((c, i) => (
                <span key={c.slug}>
                  {i > 0 && ', '}
                  <a href={`/insights/${c.slug}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none' }}>{c.headline}</a>
                </span>
              ))}
            </div>
          )}
          {item.coverage.plannedProjects.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4 }}>
              Planned projects: {item.coverage.plannedProjects.map(p => `${p.title} (${p.status})`).join(', ')}
            </div>
          )}
          {applicableTimings.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6 }}>
              Opportunity: {applicableTimings.map(o => (
                <span key={o.key} title={o.reason} style={{ marginRight: 8, borderBottom: '1px dotted var(--text-muted)' }}>
                  {o.label}
                </span>
              ))}
            </div>
          )}
          {item.altSetNames.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Also known as: {item.altSetNames.join(', ')}
            </div>
          )}
          {item.notes && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>{item.notes}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {item.pokePricesSetUrl && (
            <a href={item.pokePricesSetUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnGhost, textDecoration: 'none', display: 'inline-block' }}>Set page ↗</a>
          )}
          {item.releaseCalendarId && (
            <>
              <button style={btnGhost} onClick={() => setEditing(v => !v)}>{editing ? 'Cancel' : 'Edit'}</button>
              <button style={btnDanger} onClick={() => onDeleteRow(item.releaseCalendarId!)}>Delete</button>
            </>
          )}
        </div>
      </div>
      {editing && item.releaseCalendarId && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--card)', border: '1px dashed var(--border)' }}>
          <ReleaseForm
            initial={{
              set_name: item.setName, set_code: item.setCode, release_date: item.releaseDate,
              region: item.region, jp_release_date: item.jpReleaseDate, confirmed: !!item.confirmed, notes: item.notes,
            }}
            onCancel={() => setEditing(false)}
            onSubmit={async payload => { await onUpdateRow(item.releaseCalendarId!, payload); setEditing(false) }}
            submitLabel="Save"
          />
        </div>
      )}
    </div>
  )
}

function ReleaseForm({
  initial, onSubmit, onCancel, submitLabel,
}: {
  initial: Partial<ReleaseCalendarRow>
  onSubmit: (payload: Partial<ReleaseCalendarRow>) => Promise<any> | void
  onCancel: () => void
  submitLabel: string
}) {
  const [setName, setSetName] = useState(initial.set_name ?? '')
  const [setCode, setSetCode] = useState(initial.set_code ?? '')
  const [region, setRegion]   = useState(initial.region ?? 'global')
  const [releaseDate, setReleaseDate] = useState(initial.release_date ?? '')
  const [jpDate, setJpDate]   = useState(initial.jp_release_date ?? '')
  const [confirmed, setConfirmed] = useState<boolean>(!!initial.confirmed)
  const [notes, setNotes]     = useState(initial.notes ?? '')
  const [saving, setSaving]   = useState(false)

  async function submit() {
    if (!setName.trim()) { alert('set_name is required'); return }
    setSaving(true)
    try {
      await onSubmit({
        set_name:        setName.trim(),
        set_code:        setCode.trim() || null,
        region:          region.trim() || null,
        release_date:    releaseDate || null,
        jp_release_date: jpDate || null,
        confirmed,
        notes:           notes.trim() || null,
      })
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div><span style={label}>Set name *</span>
        <input value={setName} onChange={e => setSetName(e.target.value)} style={input} placeholder="e.g. Mega Evolution — Storm Emerald" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <div><span style={label}>Set code</span>
          <input value={setCode} onChange={e => setSetCode(e.target.value)} style={input} placeholder="e.g. STE" />
        </div>
        <div><span style={label}>Region</span>
          <input value={region} onChange={e => setRegion(e.target.value)} style={input} placeholder="global / uk / us / jp" />
        </div>
        <div><span style={label}>Release date</span>
          <input type="date" value={releaseDate} onChange={e => setReleaseDate(e.target.value)} style={input} />
        </div>
        <div><span style={label}>JP release date</span>
          <input type="date" value={jpDate} onChange={e => setJpDate(e.target.value)} style={input} />
        </div>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text)' }}>
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> Confirmed
      </label>
      <div><span style={label}>Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...input, resize: 'vertical' }} placeholder="Anything the editorial team should know" />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={btnGhost} onClick={onCancel} disabled={saving}>Cancel</button>
        <button style={btnPrimary} onClick={submit} disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
      </div>
    </div>
  )
}

// ── Reusable project form ────────────────────────────────────────

function ProjectForm({
  initial, weekWindow, onSubmit, onCancel, submitLabel,
}: {
  initial: Partial<EditorialProject>
  weekWindow?: { startIso: string; endIso: string }
  onSubmit: (payload: Partial<EditorialProject>) => Promise<any> | void
  onCancel: () => void
  submitLabel: string
}) {
  const [title, setTitle] = useState(initial.title ?? '')
  const [angle, setAngle] = useState(initial.angle ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [status, setStatus] = useState<EditorialStatus>((initial.status as EditorialStatus) ?? 'idea')
  const [type, setType]   = useState<EditorialArticleType>((initial.article_type as EditorialArticleType) ?? 'evergreen')
  const [priority, setPriority] = useState<number>(initial.priority ?? 3)
  const [target, setTarget] = useState<string>(initial.target_publish_at ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim()) { alert('Title is required.'); return }
    setSaving(true)
    try {
      await onSubmit({
        title: title.trim(), angle: angle.trim() || null, notes: notes.trim() || null,
        status, article_type: type, priority: Number(priority),
        target_publish_at: target ? target : null,
      } as Partial<EditorialProject>)
    } finally { setSaving(false) }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div><span style={label}>Title *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Why Base Set Charizard graded 9 vs 10 matters more than ever"
          style={{ ...input, fontFamily: "'Outfit', sans-serif", fontWeight: 700, fontSize: 15 }} />
      </div>
      <div><span style={label}>Angle</span>
        <input value={angle} onChange={e => setAngle(e.target.value)} placeholder="What is the ONE thing this article is really about?" style={input} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <div><span style={label}>Type</span>
          <select value={type} onChange={e => setType(e.target.value as EditorialArticleType)} style={{ ...input, cursor: 'pointer' }}>
            {EDITORIAL_ARTICLE_TYPES.map(t => <option key={t} value={t}>{ARTICLE_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div><span style={label}>Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as EditorialStatus)} style={{ ...input, cursor: 'pointer' }}>
            {EDITORIAL_STATUSES.map(x => <option key={x} value={x}>{STATUS_LABELS[x]}</option>)}
          </select>
        </div>
        <div><span style={label}>Priority</span>
          <select value={priority} onChange={e => setPriority(Number(e.target.value))} style={{ ...input, cursor: 'pointer' }}>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>P{n}{n === 1 ? ' (highest)' : n === 5 ? ' (lowest)' : ''}</option>)}
          </select>
        </div>
        <div><span style={label}>Target publish date</span>
          <input type="date" value={target} onChange={e => setTarget(e.target.value)}
            min={weekWindow?.startIso} max={weekWindow?.endIso} style={input} />
        </div>
      </div>
      <div><span style={label}>Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          placeholder="Evidence sources, angle notes, anything to remember."
          style={{ ...input, resize: 'vertical', lineHeight: 1.5 }} />
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={btnGhost} onClick={onCancel} disabled={saving}>Cancel</button>
        <button style={btnPrimary} onClick={submit} disabled={saving}>{saving ? 'Saving…' : submitLabel}</button>
      </div>
    </div>
  )
}

function StatusPicker({ current, onPick }: { current: string; onPick: (s: EditorialStatus) => void }) {
  return (
    <select value={current} onChange={e => onPick(e.target.value as EditorialStatus)}
      style={{ ...btnGhost, cursor: 'pointer', padding: '7px 10px', appearance: 'none' }} aria-label="Change status">
      {EDITORIAL_STATUSES.map(s => <option key={s} value={s}>Status: {STATUS_LABELS[s]}</option>)}
    </select>
  )
}

// ── Release row → ReleaseItem merge helpers ──────────────────────
// Optimistic local updates without a full context refetch.

function dayDiff(dateIso: string, refIso: string): number {
  const [d1, r1] = [dateIso, refIso].map(s => Date.UTC(
    Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)),
  ))
  return Math.round((d1 - r1) / (24 * 60 * 60 * 1000))
}

function releaseRowToItem(row: ReleaseCalendarRow, today: string): ReleaseItem {
  const date = row.release_date ?? today
  const daysDelta = dayDiff(date, today)
  return {
    kind: daysDelta > 0 ? 'upcoming' : 'recent',
    setName: row.set_name,
    altSetNames: [],
    setCode: row.set_code,
    releaseDate: date,
    jpReleaseDate: row.jp_release_date,
    region: row.region,
    confirmed: row.confirmed,
    cardCount: null,
    daysDelta,
    releaseCalendarId: row.id,
    pokePricesSetUrl: null,
    sources: ['release_calendar'],
    coverage: { publishedInsights: [], plannedProjects: [], status: 'none' },
    timingOpportunities: [],
    notes: row.notes,
  }
}

function mergeReleaseRow(existing: ReleaseItem, row: ReleaseCalendarRow, today: string): ReleaseItem {
  const date = row.release_date ?? existing.releaseDate
  const daysDelta = dayDiff(date, today)
  return {
    ...existing,
    kind: daysDelta > 0 ? 'upcoming' : 'recent',
    setName: row.set_name,
    setCode: row.set_code,
    releaseDate: date,
    jpReleaseDate: row.jp_release_date,
    region: row.region,
    confirmed: row.confirmed,
    daysDelta,
    notes: row.notes,
  }
}

// ── Opportunity → project payload ───────────────────────────────

function opportunityToProjectPayload(
  o: Opportunity,
  status: 'idea' | 'planned',
  targetDate: string | null,
): Partial<EditorialProject> {
  const evidence = o.evidenceSummary.map(e => `• ${e}`).join('\n')
  const metrics  = o.metrics.map(m => `• ${m.label}: ${m.value}${m.hint ? ` (${m.hint})` : ''}`).join('\n')
  const notes = [
    // Marker line — read back by extractRadarOpportunityIdFromNotes
    // to dedupe future Radar rounds against this actioned opportunity.
    // Must always live on the first line so the parser can find it.
    `[radar-opportunity: ${o.id}]`,
    `Radar score: ${o.score}/100 (${o.dataStrength} data, ${o.citationPotential} citation potential)`,
    `Why now: ${o.whyNow}`,
    o.suggestedTiming ? `Suggested timing: ${o.suggestedTiming}` : null,
    o.relatedSets.length ? `Related sets: ${o.relatedSets.join(', ')}` : null,
    o.relatedCards.length ? `Related cards: ${o.relatedCards.slice(0, 8).map(c => c.name).join('; ')}` : null,
    o.visuals.length ? `Suggested visuals: ${o.visuals.join(', ')}` : null,
    o.overlap.verdict !== 'low' ? `Overlap: ${o.overlap.verdict} — closest existing: ${o.overlap.topMatchHeadline}` : null,
    '',
    'Evidence:',
    evidence,
    '',
    'Metrics:',
    metrics,
  ].filter(Boolean).join('\n')
  return {
    title:              o.headlineSuggestion,
    angle:              o.angle,
    article_type:       o.suggestedArticleType,
    status,
    priority:           o.score >= 80 ? 1 : o.score >= 60 ? 2 : 3,
    target_publish_at:  targetDate,
    notes,
  }
}

/** Parse the "[radar-opportunity: <id>]" marker written by
 *  opportunityToProjectPayload. Returns null when the marker is
 *  absent (project created manually or by an older code path). */
export function extractRadarOpportunityIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null
  const m = notes.match(/\[radar-opportunity:\s*([^\]\r\n]+?)\s*\]/)
  return m ? m[1].trim() : null
}

// ── Opportunity Radar panel ─────────────────────────────────────

function OpportunityRadarPanel({
  radar, onCreate, activeProjects, radarComputedAt,
}: {
  radar: OpportunityRadar
  onCreate: (payload: Partial<EditorialProject>) => Promise<any>
  /** Live project list used for suggestion dedupe. See dedupe rules
   *  below — matches are EXACT (opportunity id or exact normalised
   *  title). No substring/containment matching. */
  activeProjects?: readonly EditorialProject[]
  /** ISO datetime of the currently-cached Radar. Shown to the admin
   *  and used by the Refresh Opportunities button as a nice visual
   *  signal. */
  radarComputedAt?: string
}) {
  const [expanded, setExpanded]           = useState<string | null>(null)
  const [locallyDismissed, setDismissed]  = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing]       = useState(false)
  const [refreshError, setRefreshError]   = useState<string | null>(null)

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  // Stable dedupe keys drawn from the current project set:
  //   * radar-opportunity id parsed from the notes marker
  //     "[radar-opportunity: <id>]" (persisted by opportunityToProjectPayload)
  //   * exact normalised title as a legacy fallback
  // Substring/containment matching is deliberately removed —
  // "30th Celebration: Everything We Know" must not suppress
  // "30th Celebration Prices After Release".
  const claimedIds    = new Set<string>()
  const claimedTitles = new Set<string>()
  for (const p of activeProjects ?? []) {
    const oppId = extractRadarOpportunityIdFromNotes(p.notes)
    if (oppId) claimedIds.add(oppId)
    claimedTitles.add(norm(p.title))
  }

  const isAlreadyClaimed = (o: Opportunity): boolean => {
    if (locallyDismissed.has(o.id)) return true
    if (o.id && claimedIds.has(o.id)) return true
    // Exact normalised title fallback — same string modulo case /
    // punctuation / whitespace. NEVER substring/containment.
    if (claimedTitles.has(norm(o.headlineSuggestion))) return true
    return false
  }

  const visible = radar.opportunities.filter(o => !isAlreadyClaimed(o))

  // Split into external / internal groups via canonical helper.
  const [external, internal] = visible.reduce<[Opportunity[], Opportunity[]]>((acc, o) => {
    const mode = _getEditorialMode({ article_type: o.suggestedArticleType, title: o.headlineSuggestion, angle: o.angle })
    if (mode === 'external') acc[0].push(o); else acc[1].push(o)
    return acc
  }, [[], []])

  // Cap each side at 4 so the two groups are visually balanced by
  // default. Everything else remains available via "Show all N".
  const VISIBLE_PER_GROUP = 4
  const externalVisible = external.slice(0, VISIBLE_PER_GROUP)
  const internalVisible = internal.slice(0, VISIBLE_PER_GROUP)
  const externalHidden  = external.length - externalVisible.length
  const internalHidden  = internal.length - internalVisible.length

  const dismissLocally = (id: string) => setDismissed(prev => { const n = new Set(prev); n.add(id); return n })

  const onCreateFromOpportunity = async (o: Opportunity, payload: Partial<EditorialProject>) => {
    const result = await onCreate(payload)
    // Hide immediately whether or not the parent state updates on
    // this render — feels correct even before Next re-renders.
    dismissLocally(o.id)
    return result
  }

  const onRefresh = async () => {
    setRefreshing(true); setRefreshError(null)
    try {
      // Force a Radar recompute + update the daily cache row, so
      // the subsequent page reload reads a fresh cached set rather
      // than immediately re-recomputing.
      await apiJson('/api/admin/editorial/opportunity-radar/refresh', { method: 'POST', body: '{}' })
      if (typeof window !== 'undefined') window.location.reload()
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : 'unknown')
      setRefreshing(false)
    }
  }

  if (radar.opportunities.length === 0) {
    return (
      <div style={{ ...card, padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
          No strong opportunities detected right now.
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          The Radar ran but every detector was suppressed. This is expected on quiet weeks.
        </div>
        {radar.meta.detectorsSuppressed.length > 0 && (
          <details style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>Detector diagnostics</summary>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {radar.meta.detectorsSuppressed.map(d => <li key={d.kind}>{d.kind}: {d.reason}</li>)}
            </ul>
          </details>
        )}
      </div>
    )
  }

  const renderOpp = (o: Opportunity) => {
    const isOpen = expanded === o.id
    const mode = _getEditorialMode({ article_type: o.suggestedArticleType, title: o.headlineSuggestion, angle: o.angle })
    return (
      <div key={o.id} style={{ ...card, padding: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{o.kind.replace(/_/g, ' ')}</span>
              <DataStrengthBadge s={o.dataStrength} />
              <CitationBadge s={o.citationPotential} />
              {o.overlap.verdict !== 'low' && (
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: '#b91c1c' }}>
                  {o.overlap.verdict} overlap
                </span>
              )}
            </div>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '4px 0 6px', color: 'var(--text)' }}>{o.headlineSuggestion}</h3>
            <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1.5 }}>{o.angle}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}><strong>Why now:</strong> {o.whyNow}</p>
            {(o.relatedSets.length > 0 || o.relatedCards.length > 0) && (
              <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {o.relatedSets.slice(0, 5).map(s => <ChipTag key={'s-' + s} label={`Set: ${s}`} tone="blue" />)}
                {o.relatedCards.slice(0, 3).map((c, i) => <ChipTag key={'c-' + i + c.name} label={`Card: ${c.name}`} tone="grey" />)}
                {o.relatedCards.length > 3 && <ChipTag label={`+${o.relatedCards.length - 3} more cards`} tone="grey" />}
              </div>
            )}
            {o.overlap.verdict !== 'low' && o.overlap.topMatchHeadline && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
                Closest existing: <a href={`/insights/${o.overlap.topMatchSlug}`} target="_blank" rel="noopener noreferrer" style={{ color: '#b91c1c' }}>{o.overlap.topMatchHeadline}</a>
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 6, minWidth: 150, textAlign: 'right' }}>
            <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 34, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{o.score}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>out of 100</div>
            <TypeBadge type={o.suggestedArticleType} />
            {o.suggestedTiming && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{o.suggestedTiming}</span>}
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 4 }}>
              <button style={btnGhost} onClick={() => onCreateFromOpportunity(o, opportunityToProjectPayload(o, 'idea', null))}>Save as idea</button>
              <PlanOpportunityInline onSubmit={async iso => { await onCreateFromOpportunity(o, opportunityToProjectPayload(o, 'planned', iso)) }} />
              {mode === 'external' && (
                <DeepResearchPromptButton project={{ id: -1, title: o.headlineSuggestion, article_type: o.suggestedArticleType, angle: o.angle }} compact />
              )}
            </div>
          </div>
        </div>
        <button
          style={{ ...btnGhost, marginTop: 10, fontSize: 11, padding: '4px 10px' }}
          onClick={() => setExpanded(isOpen ? null : o.id)}
          aria-expanded={isOpen}
        >
          {isOpen ? 'Hide evidence + metrics' : 'Show evidence + metrics'}
        </button>
        {isOpen && (
          <div style={{ marginTop: 10, display: 'grid', gap: 10, padding: 12, borderRadius: 10, background: 'var(--bg-light)', border: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Score reasons</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text)' }}>
                {o.scoreReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Metrics</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text)' }}>
                {o.metrics.map((m, i) => <li key={i}><strong>{m.label}:</strong> {m.value}{m.hint ? ` — ${m.hint}` : ''}</li>)}
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Evidence</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text)' }}>
                {o.evidenceSummary.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
            {o.visuals.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Suggested visuals</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {o.visuals.map(v => <ChipTag key={v} label={v.replace(/_/g, ' ')} tone="grey" />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div>
            {visible.length} suggestion{visible.length === 1 ? '' : 's'} · {external.length} external · {internal.length} data
            {(radar.opportunities.length - visible.length) > 0 && ` · ${radar.opportunities.length - visible.length} already saved / planned`}
          </div>
          {radarComputedAt && (
            <div>Opportunities updated: {fmtRadarComputedAt(radarComputedAt)}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          <button
            style={btnGhost}
            onClick={onRefresh}
            disabled={refreshing}
            title="Recalculate suggestions immediately from the latest PokePrices data + release calendar. Normally the Radar refreshes once per calendar day."
          >
            {refreshing ? 'Refreshing…' : 'Refresh Opportunities'}
          </button>
          {refreshError && <div style={{ fontSize: 11, color: '#b91c1c' }}>{refreshError}</div>}
        </div>
      </div>

      {external.length + internal.length === 0 ? (
        <div style={{ ...card, padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
          Every current suggestion has already been saved or planned. Click <strong>Refresh Opportunities</strong> after new data lands, or check back tomorrow.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14 }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              External opportunities {externalVisible.length > 0 ? `(${externalVisible.length}${externalHidden > 0 ? ` of ${external.length}` : ''})` : ''}
            </div>
            {externalVisible.length === 0
              ? <div style={{ ...card, padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No external opportunities detected right now.</div>
              : externalVisible.map(renderOpp)}
            {externalHidden > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>+ {externalHidden} more external hidden. Save or plan a few to make room.</div>
            )}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              PokePrices data opportunities {internalVisible.length > 0 ? `(${internalVisible.length}${internalHidden > 0 ? ` of ${internal.length}` : ''})` : ''}
            </div>
            {internalVisible.length === 0
              ? <div style={{ ...card, padding: 14, fontSize: 12, color: 'var(--text-muted)' }}>No proprietary-data opportunities detected right now.</div>
              : internalVisible.map(renderOpp)}
            {internalHidden > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>+ {internalHidden} more data-led hidden. Save or plan a few to make room.</div>
            )}
          </div>
        </div>
      )}
      {radar.meta.detectorsSuppressed.length > 0 && (
        <details style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          <summary style={{ cursor: 'pointer' }}>Detector diagnostics ({radar.meta.detectorsSuppressed.length} suppressed)</summary>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {radar.meta.detectorsSuppressed.map(d => <li key={d.kind}>{d.kind}: {d.reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

function DataStrengthBadge({ s }: { s: 'strong' | 'medium' | 'weak' }) {
  const c = s === 'strong' ? '#15803d' : s === 'medium' ? '#a16207' : '#64748b'
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: c }}>{s} data</span>
}
function CitationBadge({ s }: { s: 'high' | 'medium' | 'low' }) {
  const c = s === 'high' ? '#15803d' : s === 'medium' ? '#a16207' : '#64748b'
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: c }}>{s} citability</span>
}

function PlanOpportunityInline({ onSubmit }: { onSubmit: (iso: string) => Promise<any> }) {
  const [open, setOpen] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [d, setD] = useState(today)
  if (!open) return <button style={btnPrimary} onClick={() => setOpen(true)}>Plan article</button>
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input type="date" value={d} onChange={e => setD(e.target.value)} style={{ ...input, width: 150, padding: '6px 8px' }} />
      <button style={btnPrimary} onClick={async () => { await onSubmit(d); setOpen(false) }}>Plan</button>
      <button style={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────
// AI Editorial Strategist (Block 5)
// ─────────────────────────────────────────────────────────────────

type StrategistSession = {
  sessionId:        string
  history:          ChatTurn[]
  rejectedRadarIds: string[]
  totalCostUsd:     number
  // Block 5 final — the visible plan is DERIVED from history via
  // computeActivePlan() (see @/lib/editorial/activePlan). It is not
  // stored on the session so it can never drift out of sync with
  // what the assistant actually said. Any earlier `currentRecs`
  // field on a persisted session is ignored on load.
}

const STRATEGIST_SESSION_STORAGE_KEY = 'eic:strategist:session'

function loadSession(): StrategistSession {
  if (typeof window === 'undefined') return newSession()
  try {
    const raw = sessionStorage.getItem(STRATEGIST_SESSION_STORAGE_KEY)
    if (!raw) return newSession()
    const parsed = JSON.parse(raw) as any
    if (!parsed?.sessionId) return newSession()
    // Discard any legacy `currentRecs` on the persisted blob so the
    // derived-from-history contract holds regardless of what older
    // versions of this client wrote to sessionStorage.
    return {
      sessionId:        String(parsed.sessionId),
      history:          Array.isArray(parsed.history) ? parsed.history : [],
      rejectedRadarIds: Array.isArray(parsed.rejectedRadarIds) ? parsed.rejectedRadarIds : [],
      totalCostUsd:     typeof parsed.totalCostUsd === 'number' ? parsed.totalCostUsd : 0,
    }
  } catch { return newSession() }
}
function saveSession(s: StrategistSession): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(STRATEGIST_SESSION_STORAGE_KEY, JSON.stringify(s)) } catch {}
}
function newSession(): StrategistSession {
  return {
    sessionId:        `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    history:          [],
    rejectedRadarIds: [],
    totalCostUsd:     0,
  }
}

type StrategistCallResult = {
  ok:        boolean
  error:     string
  sessionId: string
  response:  StrategistResponse
  rawText:   string
  usage:     { input_tokens: number; output_tokens: number; cost_usd: number; latency_ms: number; model: string }
}
async function callStrategist(body: {
  mode: 'recommend' | 'chat'
  sessionId: string
  history: ChatTurn[]
  userMessage?: string
  rejectedRadarIds: string[]
  currentPlan?: { summary: string; primary: StrategistRecommendation[]; alternatives: StrategistRecommendation[] }
}): Promise<StrategistCallResult> {
  const emptyUsage = { input_tokens: 0, output_tokens: 0, cost_usd: 0, latency_ms: 0, model: '' }
  try {
    const j = await apiJson<any>('/api/admin/editorial/strategist', {
      method: 'POST',
      body: JSON.stringify({
        mode: body.mode,
        sessionId: body.sessionId,
        history: body.history.map(t => ({ role: t.role, content: t.content })),
        userMessage: body.userMessage,
        rejectedRadarIds: body.rejectedRadarIds,
        currentPlan: body.currentPlan ?? null,
      }),
    })
    return {
      ok: Boolean(j?.ok),
      error: j?.ok ? '' : (j?.error || 'strategist call failed'),
      sessionId: String(j?.sessionId ?? body.sessionId),
      response:  (j?.response ?? { assistantMessage: '' }) as StrategistResponse,
      rawText:   String(j?.rawText ?? ''),
      usage:     j?.usage ?? emptyUsage,
    }
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'strategist call failed',
      sessionId: body.sessionId,
      response: { assistantMessage: '' },
      rawText: '',
      usage: emptyUsage,
    }
  }
}

function EditorialStrategistPanel({
  context, radar, onCreate,
}: {
  context: EditorialContext
  radar: OpportunityRadar
  onCreate: (payload: Partial<EditorialProject>) => Promise<any>
}) {
  const [session, setSession] = useState<StrategistSession>(newSession)
  const [loading, setLoading] = useState<'recommend' | 'chat' | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [chatInput, setChatInput] = useState('')
  const chatRef = useRef<HTMLDivElement | null>(null)

  // Load persisted session on mount.
  useEffect(() => { setSession(loadSession()) }, [])
  // Persist on every change.
  useEffect(() => { saveSession(session) }, [session])
  // Autoscroll chat when a new turn arrives.
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
  }, [session.history.length, loading])

  // Block 5 final — single source of truth for the visible plan.
  const activePlan = useMemo(() => computeActivePlan(session.history), [session.history])

  const runRecommend = useCallback(async () => {
    setLoading('recommend'); setError(null)
    const res = await callStrategist({
      mode: 'recommend',
      sessionId: session.sessionId,
      history: session.history,
      rejectedRadarIds: session.rejectedRadarIds,
    })
    setLoading(null)
    if (!res.ok) { setError(res.error); return }
    setSession(prev => {
      const nextHistory: ChatTurn[] = [...prev.history, {
        role: 'assistant', content: res.rawText, ts: new Date().toISOString(),
        parsed: res.response, usage: res.usage,
      }]
      return {
        ...prev,
        sessionId:    res.sessionId,
        history:      nextHistory,
        totalCostUsd: prev.totalCostUsd + res.usage.cost_usd,
      }
    })
  }, [session])

  const runChat = useCallback(async (msg: string) => {
    if (!msg.trim()) return
    setLoading('chat'); setError(null)
    const userTurn: ChatTurn = { role: 'user', content: msg.trim(), ts: new Date().toISOString() }
    const historyWithUser: ChatTurn[] = [...session.history, userTurn]
    setSession(prev => ({ ...prev, history: historyWithUser }))
    setChatInput('')
    const res = await callStrategist({
      mode: 'chat', sessionId: session.sessionId,
      history: session.history, userMessage: msg.trim(),
      rejectedRadarIds: session.rejectedRadarIds,
      currentPlan: activePlan,
    })
    setLoading(null)
    if (!res.ok) { setError(res.error); return }
    setSession(prev => {
      const assistantTurn: ChatTurn = {
        role: 'assistant', content: res.rawText, ts: new Date().toISOString(),
        parsed: res.response, usage: res.usage,
      }
      return {
        ...prev,
        sessionId:    res.sessionId,
        history:      [...historyWithUser, assistantTurn],
        totalCostUsd: prev.totalCostUsd + res.usage.cost_usd,
      }
    })
  }, [session, activePlan])

  const resetSession = useCallback(() => {
    if (!confirm('Start a new strategist session? The current conversation and rejected-idea memory will be cleared.')) return
    const s = newSession()
    setSession(s); saveSession(s); setError(null)
  }, [])

  const rejectRec = useCallback((rec: StrategistRecommendation) => {
    // Track by radarOpportunityId when present; otherwise by title.
    const id = rec.radarOpportunityId ?? `title:${rec.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    setSession(prev => {
      if (prev.rejectedRadarIds.includes(id)) return prev
      return { ...prev, rejectedRadarIds: [...prev.rejectedRadarIds, id] }
    })
    // Explicit about slot preservation so the strategist does not
    // blank the other primary item. Read from the derived plan so
    // the position number is always consistent with what the panel
    // currently shows.
    const which = activePlan?.primary?.findIndex(p => p.headline === rec.headline)
    const primaryPosition = typeof which === 'number' && which >= 0 ? which + 1 : null
    const msg = primaryPosition
      ? `Rejecting primary recommendation #${primaryPosition} ("${rec.headline}"). Do not re-recommend it in this session. In your response, KEEP the other primary recommendation unchanged, then either promote a suitable alternative into the vacated slot or leave it empty and explain why (per the primary-recommendation quality gate). Update the "recommendations" block accordingly.`
      : `Rejecting alternative "${rec.headline}". Do not re-recommend it in this session. Keep the primary recommendations unchanged. Replace this alternative with a stronger candidate if one exists. Update the "recommendations" block accordingly.`
    void runChat(msg)
  }, [runChat, activePlan])

  const planRec = useCallback(async (rec: StrategistRecommendation, targetDate: string) => {
    const payload: Partial<EditorialProject> = {
      title:              rec.headline,
      angle:              rec.angle,
      article_type:       (rec.suggestedArticleType as EditorialArticleType | undefined) ?? 'evergreen',
      status:             'planned',
      priority:           rec.confidence === 'high' ? 1 : rec.confidence === 'medium' ? 2 : 3,
      target_publish_at:  targetDate || null,
      notes: [
        `Recommended by AI Editorial Strategist (${new Date().toLocaleDateString('en-GB')}).`,
        rec.whyNow ? `Why now: ${rec.whyNow}` : null,
        rec.whyUseful ? `Why useful: ${rec.whyUseful}` : null,
        rec.searchOrEditorialIntent ? `Intent: ${rec.searchOrEditorialIntent}` : null,
        rec.recommendedPublishDay ? `Suggested day: ${rec.recommendedPublishDay}` : null,
        rec.citationPotential ? `Citation potential: ${rec.citationPotential}` : null,
        rec.evidenceAvailable.length ? '\nEvidence available:\n' + rec.evidenceAvailable.map(e => '• ' + e).join('\n') : null,
        rec.evidenceStillNeeded.length ? '\nEvidence still needed:\n' + rec.evidenceStillNeeded.map(e => '• ' + e).join('\n') : null,
        rec.suggestedVisualsOrDataBlocks.length ? '\nSuggested visuals: ' + rec.suggestedVisualsOrDataBlocks.join(', ') : null,
        rec.existingContentOverlap?.risk && rec.existingContentOverlap.risk !== 'none' && rec.existingContentOverlap.related.length
          ? `\nOverlap risk (${rec.existingContentOverlap.risk}): ${rec.existingContentOverlap.related.map(r => r.headline).join('; ')}` : null,
        rec.radarOpportunityId ? `\nDerived from Radar opportunity: ${rec.radarOpportunityId}${rec.radarScore != null ? ` (score ${rec.radarScore})` : ''}` : null,
      ].filter(Boolean).join('\n'),
    }
    await onCreate(payload)
  }, [onCreate])

  const saveAsIdea = useCallback((rec: StrategistRecommendation) => planRec(rec, ''), [planRec])

  // Single source of truth for what the panel renders — computed
  // from history, never mutated separately.
  const recs = activePlan

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {/* Header + controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          style={{ ...btnPrimary, background: session.history.length ? 'var(--primary)' : 'var(--primary)' }}
          onClick={runRecommend}
          disabled={loading !== null}
        >
          {loading === 'recommend' ? 'Thinking…' : recs ? 'Refresh recommendations' : 'Generate recommendations'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {session.history.length === 0 ? 'No conversation yet.' : `${session.history.length} turns · $${session.totalCostUsd.toFixed(4)} spent this session`}
        </span>
        {session.rejectedRadarIds.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{session.rejectedRadarIds.length} rejected this session</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {session.history.length > 0 && <button style={btnGhost} onClick={resetSession}>New session</button>}
        </span>
      </div>

      {error && (
        <div role="alert" style={{ background: 'rgba(239,68,68,0.06)', color: '#b91c1c', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
          Strategist error: {error}
        </div>
      )}

      {/* Recommendation cards */}
      {recs && (
        <div style={{ ...card, padding: 16, background: 'linear-gradient(180deg, rgba(59,130,246,0.04), transparent 40%)' }}>
          {recs.summary && (
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, lineHeight: 1.5 }}>
              <strong>Strategist summary:</strong> {recs.summary}
            </div>
          )}

          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
            Recommended this week
          </div>
          {recs.primary.length === 0 && (
            <div style={{ padding: 12, borderRadius: 10, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: 13 }}>
              Strategist did not recommend any primary article. See its summary above.
            </div>
          )}
          <div style={{ display: 'grid', gap: 10 }}>
            {recs.primary.map((rec, i) => (
              <RecommendationCard key={'p' + i} rec={rec} isPrimary onPlan={planRec} onSave={saveAsIdea} onReject={rejectRec} onDiscuss={m => runChat(m)} />
            ))}
          </div>

          {recs.alternatives.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', margin: '18px 0 8px' }}>
                Alternatives
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {recs.alternatives.map((rec, i) => (
                  <RecommendationCard key={'a' + i} rec={rec} isPrimary={false} onPlan={planRec} onSave={saveAsIdea} onReject={rejectRec} onDiscuss={m => runChat(m)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Conversation */}
      {session.history.length > 0 && (
        <div style={{ ...card, padding: 0 }}>
          <div ref={chatRef} style={{ maxHeight: 380, overflowY: 'auto', padding: 14, display: 'grid', gap: 10 }}>
            {session.history.map((t, i) => (
              <ChatBubble key={i} turn={t} />
            ))}
            {loading === 'chat' && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Strategist is thinking…</div>}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', padding: 10, display: 'flex', gap: 8 }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runChat(chatInput) } }}
              placeholder="Ask a follow-up — e.g. 'Give me three alternatives to #2', 'Is there enough data to support that?', 'What's the most citeable thing this week?'"
              style={{ ...input, flex: 1 }}
              disabled={loading !== null}
            />
            <button style={btnPrimary} onClick={() => runChat(chatInput)} disabled={loading !== null || !chatInput.trim()}>Send</button>
          </div>
        </div>
      )}

      {!recs && session.history.length === 0 && !loading && (
        <div style={{ ...card, padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Click "Generate recommendations" to have the Strategist propose this week's two articles from the current Editorial Context + Opportunity Radar.
        </div>
      )}

      {/* Detector diagnostics — separate from Radar section */}
      <details style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        <summary style={{ cursor: 'pointer' }}>Strategist inputs summary ({context.articles.length} articles · {context.projects.length} projects · {radar.opportunities.length} radar opportunities)</summary>
        <div style={{ padding: '6px 0', lineHeight: 1.5 }}>
          Model sees today = {context.meta.today}, {context.release.recent.length} recent + {context.release.upcoming.length} upcoming releases,
          {' '}article body excerpts capped at {context.meta.articleBodyExcerptChars} chars, and every Radar opportunity with its full score reasons, metrics, evidence and overlap verdict.
          {' '}No live database access.
        </div>
      </details>
    </div>
  )
}

function ChatBubble({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user'
  const [showRaw, setShowRaw] = useState(false)

  // Block 5D — never fall back to the raw content in the normal UI.
  // If the parser could not extract a prose assistantMessage, show a
  // clear placeholder rather than dumping a JSON blob into the chat.
  // Raw content stays available behind the "View raw response" toggle
  // for debugging and audit.
  let displayText: string
  if (isUser) {
    // Trim the internal MODE=chat / plan-preamble scaffolding so the
    // user's bubble shows what they actually typed.
    displayText = extractUserVisibleMessage(turn.content)
  } else {
    const prose = turn.parsed?.assistantMessage?.trim() ?? ''
    displayText = prose || '(Recommendations updated. See panel above.)'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '85%',
        padding: '10px 14px',
        borderRadius: 12,
        background: isUser ? 'var(--primary)' : 'var(--bg-light)',
        color: isUser ? '#fff' : 'var(--text)',
        fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap',
        border: isUser ? 'none' : '1px solid var(--border)',
      }}>{displayText}</div>
      {!isUser && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
          {turn.usage && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {turn.usage.input_tokens} in · {turn.usage.output_tokens} out · ${turn.usage.cost_usd.toFixed(4)} · {(turn.usage.latency_ms / 1000).toFixed(1)}s
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowRaw(v => !v)}
            style={{ fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
          >
            {showRaw ? 'Hide raw response' : 'View raw response'}
          </button>
        </div>
      )}
      {!isUser && showRaw && (
        <pre style={{
          maxWidth: '85%', marginTop: 6, padding: 10,
          background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 8,
          fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}>{turn.content}</pre>
      )}
    </div>
  )
}

/** Strip internal scaffolding (MODE=chat, CURRENT ACTIVE EDITORIAL
 *  PLAN preambles the client sends up) so the user's bubble shows
 *  only what they actually typed. */
function extractUserVisibleMessage(raw: string): string {
  if (!raw) return ''
  // Look for the first blank line after "MODE=chat" or the plan
  // preamble; text after that is the human message. Fall back to
  // stripping just the mode marker.
  const modeChatIdx = raw.indexOf('MODE=chat')
  if (modeChatIdx !== -1) {
    // If a plan preamble was included, it lives inside a fenced
    // ```json block. Take everything after the closing fence + blank line.
    const afterFence = raw.match(/```\s*\n\n([\s\S]+)$/)
    if (afterFence) return afterFence[1].trim()
    return raw.slice(modeChatIdx + 'MODE=chat'.length).trim()
  }
  if (raw.startsWith('MODE=recommend')) return '(Generate recommendations)'
  return raw
}

function RecommendationCard({
  rec, isPrimary, onPlan, onSave, onReject, onDiscuss,
}: {
  rec: StrategistRecommendation
  isPrimary: boolean
  onPlan: (rec: StrategistRecommendation, iso: string) => Promise<any>
  onSave: (rec: StrategistRecommendation) => Promise<any>
  onReject: (rec: StrategistRecommendation) => void
  onDiscuss: (msg: string) => void
}) {
  const [expanded, setExpanded] = useState(isPrimary)
  const [planning, setPlanning] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [planDate, setPlanDate] = useState(today)
  const overlapColor = rec.existingContentOverlap.risk === 'high' ? '#b91c1c'
                     : rec.existingContentOverlap.risk === 'medium' ? '#a16207'
                     : rec.existingContentOverlap.risk === 'low'    ? '#64748b' : 'var(--text-muted)'

  return (
    <div style={{
      padding: 14, borderRadius: 10,
      background: isPrimary ? 'var(--card)' : 'var(--bg-light)',
      border: `1px solid ${isPrimary ? 'var(--border)' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              {rec.suggestedArticleType ? rec.suggestedArticleType.replace(/_/g, ' ') : 'article'}
            </span>
            <CitationBadge s={rec.citationPotential} />
            <ConfidenceBadge s={rec.confidence} />
            {rec.recommendedPublishDay && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Suggested: {rec.recommendedPublishDay}</span>
            )}
            {rec.radarScore != null && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Radar {rec.radarScore}</span>
            )}
          </div>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: isPrimary ? 20 : 16, margin: '4px 0 4px', color: 'var(--text)' }}>{rec.headline}</h3>
          <p style={{ fontSize: 13, color: 'var(--text)', margin: '0 0 6px', lineHeight: 1.5 }}>{rec.angle}</p>
          {rec.whyNow && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}><strong>Why now:</strong> {rec.whyNow}</p>}
          {rec.whyUseful && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}><strong>Why useful:</strong> {rec.whyUseful}</p>}
          {rec.searchOrEditorialIntent && <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 4px' }}><strong>Intent:</strong> {rec.searchOrEditorialIntent}</p>}
          {rec.existingContentOverlap.risk !== 'none' && (
            <p style={{ fontSize: 12, color: overlapColor, margin: '0 0 4px' }}>
              <strong>Overlap risk: {rec.existingContentOverlap.risk}.</strong>
              {rec.existingContentOverlap.related.length > 0 && (
                <> Closest: {rec.existingContentOverlap.related.map((r, i) => (
                  <span key={r.slug}>
                    {i > 0 && '; '}
                    <a href={`/insights/${r.slug}`} target="_blank" rel="noopener noreferrer" style={{ color: overlapColor }}>{r.headline}</a>
                  </span>
                ))}</>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'flex-start' }}>
          {planning ? (
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <input type="date" value={planDate} onChange={e => setPlanDate(e.target.value)} style={{ ...input, width: 150, padding: '6px 8px' }} />
              <button style={btnPrimary} onClick={async () => { await onPlan(rec, planDate); setPlanning(false) }}>Plan</button>
              <button style={btnGhost} onClick={() => setPlanning(false)}>Cancel</button>
            </span>
          ) : (
            <>
              <button style={btnPrimary} onClick={() => setPlanning(true)}>Plan</button>
              <button style={btnGhost} onClick={() => onSave(rec)}>Save idea</button>
              <button style={btnGhost} onClick={() => onDiscuss(`Discuss "${rec.headline}" — what do we still need to research or verify before I commit?`)}>Discuss</button>
              <button style={btnDanger} onClick={() => onReject(rec)}>Reject</button>
            </>
          )}
        </div>
      </div>
      <button
        style={{ ...btnGhost, marginTop: 10, fontSize: 11, padding: '4px 10px' }}
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? 'Hide evidence' : 'Show evidence'}
      </button>
      {expanded && (
        <div style={{ marginTop: 10, display: 'grid', gap: 10, padding: 12, borderRadius: 10, background: isPrimary ? 'var(--bg-light)' : 'var(--card)', border: '1px solid var(--border)' }}>
          {rec.evidenceAvailable.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Evidence available</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text)' }}>
                {rec.evidenceAvailable.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {rec.evidenceStillNeeded.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Evidence still needed</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text)' }}>
                {rec.evidenceStillNeeded.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {rec.suggestedVisualsOrDataBlocks.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Suggested visuals</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {rec.suggestedVisualsOrDataBlocks.map((v, i) => <ChipTag key={i} label={v} tone="grey" />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ConfidenceBadge({ s }: { s: 'high' | 'medium' | 'low' }) {
  const c = s === 'high' ? '#15803d' : s === 'medium' ? '#a16207' : '#64748b'
  return <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: c }}>{s} confidence</span>
}

// mergeRecommendations / computeActivePlan now live in
// @/lib/editorial/activePlan (pure module, unit tested).
