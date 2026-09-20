'use client'

// src/app/admin/seo/OpportunitiesPanel.tsx
// ============================================================================
// SEO Mission Control · Stage 4B — deterministic opportunity queues.
//
// Two operator queues, no scoring, no AI, no potential-clicks estimates:
//
//   CTR Gold        — pages Google ranks well but users are not clicking
//   Ranking Push    — pages sitting close enough to page-one to matter
//
// Each queue has:
//   * adjustable thresholds (default values match the /api endpoint)
//   * page-type filter
//   * server-side pagination
//   * a reason string that shows the actual numbers, not a score
//
// Data is fetched lazily on tab activation / threshold change so the base
// /admin/seo Mission Control render stays fast.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ─── formatting helpers ────────────────────────────────────────────────
const nf = new Intl.NumberFormat('en-GB')
const int = (v: number | null | undefined) => v == null ? '—' : nf.format(Math.round(v))
const pct = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : `${(v * 100).toFixed(digits)}%`
const pos = (v: number | null | undefined) => v == null ? '—' : v.toFixed(2)

/** Turn a canonical URL into a human-readable label using entity_id +
 *  URL path segments. Cheap V1 — the RPC does not currently join with
 *  the cards table for full display names. */
function readableLabel(url: string, page_type: string, entity_id: string | null): string {
  try {
    const path = new URL(url).pathname
    if (page_type === 'card') {
      const m = path.match(/^\/set\/([^/]+)\/card\/([^/]+)$/)
      if (m) {
        const setName = decodeURIComponent(m[1])
        const slug = decodeURIComponent(m[2])
        return `${slug}  ·  ${setName}`
      }
    }
    if (page_type === 'set') {
      const m = path.match(/^\/set\/([^/]+)$/)
      if (m) return decodeURIComponent(m[1])
    }
    if (page_type === 'pokemon') {
      const m = path.match(/^\/pokemon\/([^/]+)$/)
      if (m) return decodeURIComponent(m[1])
    }
    if (page_type === 'insight')     return `insights: ${entity_id ?? path}`
    if (page_type === 'card_show')   return `card show: ${entity_id ?? path.replace('/card-shows/', '')}`
    if (page_type === 'creator')     return `creator: ${entity_id ?? path.replace('/creators/', '')}`
    if (page_type === 'vendor')      return `vendor: ${entity_id ?? path.replace('/vendors/', '')}`
    if (page_type === 'homepage')    return 'Homepage (/)'
    return path
  } catch { return url }
}

function gscInspectionUrl(canonicalUrl: string): string {
  // Google Search Console URL-inspection deep link. Property URL for the
  // pokeprices.io site is the standard "sc-domain:" property; the URL
  // parameter carries the actual page URL.
  const site = 'sc-domain:pokeprices.io'
  return `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(site)}&id=${encodeURIComponent(canonicalUrl)}`
}

// ─── types shared with the API ─────────────────────────────────────────

type QueueKey = 'ctr_gold' | 'ranking_push'

type Candidate = {
  url: string
  page_type: string
  entity_id: string | null
  raw_variant_count: number
  impressions_28d: number
  clicks_28d: number
  sum_position_28d: number
  ctr_28d: number | null
  avg_position_28d: number | null
  in_sitemap: boolean
  is_indexable_now: boolean | null
}

type CtrGoldSummary = {
  candidate_count: number
  total_impressions_28d: number
  total_clicks_28d: number
  zero_click_count: number
  zero_click_impressions: number
  by_page_type: Record<string, number>
}
type RankingPushSummary = {
  candidate_count: number
  total_impressions_28d: number
  total_clicks_28d: number
  position_10_to_15_count: number
  position_15_to_20_count: number
  by_page_type: Record<string, number>
}

// ─── HTTP helpers ──────────────────────────────────────────────────────

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  if (!token) throw new Error('You must be signed in as an admin.')
  return { authorization: `Bearer ${token}` }
}

async function fetchQueue<TSummary>(payload: object): Promise<{ summary: TSummary; candidates: Candidate[]; thresholds: any }> {
  const auth = await authHeader()
  const res = await fetch('/api/admin/seo/opportunities', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch {}
    throw new Error(msg)
  }
  return res.json()
}

// ─── page-type filter options ──────────────────────────────────────────

const PAGE_TYPE_OPTIONS: Array<{ value: string | null; label: string }> = [
  { value: null,        label: 'All' },
  { value: 'card',      label: 'Card' },
  { value: 'pokemon',   label: 'Pokémon' },
  { value: 'set',       label: 'Set' },
  { value: 'insight',   label: 'Insight' },
  { value: 'card_show', label: 'Card show' },
  { value: 'creator',   label: 'Creator' },
  { value: 'vendor',    label: 'Vendor' },
  { value: 'homepage',  label: 'Homepage' },
  { value: 'browse',    label: 'Browse' },
  { value: 'other',     label: 'Other' },
]

// ─── shared UI primitives ──────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 14, ...style,
    }}>{children}</div>
  )
}

function NumberInput({ label, value, onChange, step, min, max }:
  { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{
        color: 'var(--text-muted)', fontSize: 10.5, letterSpacing: 0.6,
        textTransform: 'uppercase', fontWeight: 800,
      }}>{label}</span>
      <input
        type="number"
        value={value}
        step={step ?? 1}
        min={min}
        max={max}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          padding: '6px 8px', width: 100, border: '1px solid var(--border)',
          borderRadius: 6, fontFamily: "'Figtree', sans-serif", fontSize: 13,
          background: 'var(--card)', color: 'var(--text)',
          fontFeatureSettings: '"tnum"',
        }}
      />
    </label>
  )
}

function Select({ label, value, onChange, options }:
  { label: string; value: string | null; onChange: (v: string | null) => void; options: Array<{ value: string | null; label: string }> }) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{
        color: 'var(--text-muted)', fontSize: 10.5, letterSpacing: 0.6,
        textTransform: 'uppercase', fontWeight: 800,
      }}>{label}</span>
      <select
        value={value ?? '__all__'}
        onChange={e => onChange(e.target.value === '__all__' ? null : e.target.value)}
        style={{
          padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6,
          fontFamily: "'Figtree', sans-serif", fontSize: 13,
          background: 'var(--card)', color: 'var(--text)',
        }}
      >
        {options.map(o => (
          <option key={o.value ?? '__all__'} value={o.value ?? '__all__'}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th style={{
      padding: '10px 12px', fontSize: 10.5, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)',
      textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}
function Td({ children, right, style }: { children: React.ReactNode; right?: boolean; style?: React.CSSProperties }) {
  return (
    <td style={{
      padding: '9px 12px', fontFeatureSettings: '"tnum"',
      textAlign: right ? 'right' : 'left', whiteSpace: 'nowrap', ...style,
    }}>{children}</td>
  )
}

function CandidateTable({ rows, reasonFor }: { rows: Candidate[]; reasonFor: (c: Candidate) => string }) {
  if (rows.length === 0) return (
    <Card><p style={{ margin: 0, color: 'var(--text-muted)' }}>No candidates match the current thresholds.</p></Card>
  )
  return (
    <Card style={{ padding: 0, overflowX: 'auto' }}>
      <table style={{ width: '100%', minWidth: 940, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: 'var(--bg-light)' }}>
            <Th>Page</Th>
            <Th>Type</Th>
            <Th right>Impressions 28d</Th>
            <Th right>Clicks 28d</Th>
            <Th right>CTR</Th>
            <Th right>Avg pos</Th>
            <Th>Reason</Th>
            <Th>Open</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.url} style={{ borderTop: '1px solid var(--border)' }}>
              <Td style={{ whiteSpace: 'normal', maxWidth: 340 }}>
                <div style={{ fontWeight: 700 }}>{readableLabel(r.url, r.page_type, r.entity_id)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                  {r.url.replace('https://www.pokeprices.io', '')}
                  {r.raw_variant_count > 1 ? <span style={{
                    marginLeft: 6, padding: '1px 6px', borderRadius: 999,
                    background: 'var(--bg-light)', border: '1px solid var(--border)',
                    fontSize: 10, color: 'var(--text-muted)',
                  }}>+{r.raw_variant_count - 1} variant{r.raw_variant_count > 2 ? 's' : ''}</span> : null}
                </div>
              </Td>
              <Td>{r.page_type}</Td>
              <Td right>{int(r.impressions_28d)}</Td>
              <Td right>{int(r.clicks_28d)}</Td>
              <Td right>{pct(r.ctr_28d)}</Td>
              <Td right>{pos(r.avg_position_28d)}</Td>
              <Td style={{ whiteSpace: 'normal', maxWidth: 260, color: 'var(--text-muted)', fontSize: 12 }}>
                {reasonFor(r)}
              </Td>
              <Td>
                <a href={r.url} target="_blank" rel="noopener noreferrer" style={{
                  color: 'var(--primary)', textDecoration: 'none', fontWeight: 700, fontSize: 12,
                }}>page ↗</a>
                {' · '}
                <a href={gscInspectionUrl(r.url)} target="_blank" rel="noopener noreferrer" style={{
                  color: 'var(--text-muted)', textDecoration: 'none', fontWeight: 700, fontSize: 12,
                }}>GSC ↗</a>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ─── CTR Gold tab ──────────────────────────────────────────────────────

function CtrGoldTab() {
  const [minImp, setMinImp] = useState(100)
  const [maxPos, setMaxPos] = useState(10)
  const [maxCtrPct, setMaxCtrPct] = useState(0.50)   // stored as pct (0.50 = 0.5%)
  const [pageType, setPageType] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Candidate[]>([])
  const [summary, setSummary] = useState<CtrGoldSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    setLoading(true)
    setError(null)
    try {
      const t0 = performance.now()
      const j = await fetchQueue<CtrGoldSummary>({
        queue: 'ctr_gold',
        thresholds: { min_impressions: minImp, max_position: maxPos, max_ctr: maxCtrPct / 100 },
        page_type: pageType,
        limit: pageSize,
        offset: page * pageSize,
      })
      if (ctl.signal.aborted) return
      setRows(j.candidates)
      setSummary(j.summary)
      setLoadedAt(Math.round(performance.now() - t0))
    } catch (e) {
      if (ctl.signal.aborted) return
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      if (!ctl.signal.aborted) setLoading(false)
    }
  }, [minImp, maxPos, maxCtrPct, pageType, pageSize, page])

  useEffect(() => { load() }, [load])

  const reasonFor = useCallback((c: Candidate) => {
    const parts = [
      `${int(c.impressions_28d)} impressions`,
      `position ${pos(c.avg_position_28d)}`,
      c.clicks_28d === 0 ? '0 clicks' : `CTR ${pct(c.ctr_28d)}`,
    ]
    return parts.join(' · ')
  }, [])

  const totalPages = summary?.candidate_count ? Math.ceil(summary.candidate_count / pageSize) : 1
  const canPrev = page > 0
  const canNext = summary?.candidate_count ? (page + 1) * pageSize < summary.candidate_count : false

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <NumberInput label="Min impressions"  value={minImp}   onChange={v => { setPage(0); setMinImp(Math.max(0, v)) }} min={0} />
          <NumberInput label="Max avg position" value={maxPos}  onChange={v => { setPage(0); setMaxPos(Math.max(1, v)) }} min={1} step={0.5} />
          <NumberInput label="Max CTR (%)"      value={maxCtrPct} onChange={v => { setPage(0); setMaxCtrPct(Math.max(0, v)) }} min={0} step={0.05} />
          <Select     label="Page type"         value={pageType} onChange={v => { setPage(0); setPageType(v) }} options={PAGE_TYPE_OPTIONS} />
          <Select     label="Page size"         value={String(pageSize)} onChange={v => { setPage(0); setPageSize(Number(v) || 50) }} options={[{ value: '50', label: '50' }, { value: '100', label: '100' }]} />
          <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
            {loading ? 'loading…' : (loadedAt != null ? `loaded in ${loadedAt} ms` : '')}
          </div>
        </div>
      </Card>

      {summary ? (
        <Card>
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}>
            <Stat label="Candidate pages" value={int(summary.candidate_count)} />
            <Stat label="Total impressions (28d)" value={int(summary.total_impressions_28d)} />
            <Stat label="Total clicks (28d)" value={int(summary.total_clicks_28d)} />
            <Stat label="Zero-click subset"
                  value={int(summary.zero_click_count)}
                  sub={`${int(summary.zero_click_impressions)} impressions with no clicks`} />
          </div>
          {summary.by_page_type && Object.keys(summary.by_page_type).length > 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              By page type: {Object.entries(summary.by_page_type).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, n]) => `${k} ${int(n as number)}`).join(' · ')}
            </div>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <Card><span style={{ color: '#b91c1c' }}>{error}</span></Card>
      ) : null}

      <CandidateTable rows={rows} reasonFor={reasonFor} />

      <PaginationBar page={page} setPage={setPage} canPrev={canPrev} canNext={canNext} totalPages={totalPages} />
    </div>
  )
}

// ─── Ranking Push tab ──────────────────────────────────────────────────

function RankingPushTab() {
  const [minImp, setMinImp] = useState(50)
  const [minPos, setMinPos] = useState(10)
  const [maxPos, setMaxPos] = useState(20)
  const [pageType, setPageType] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Candidate[]>([])
  const [summary, setSummary] = useState<RankingPushSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ctl = new AbortController()
    abortRef.current = ctl
    setLoading(true); setError(null)
    try {
      const t0 = performance.now()
      const j = await fetchQueue<RankingPushSummary>({
        queue: 'ranking_push',
        thresholds: {
          min_impressions: minImp,
          min_position: minPos,
          max_position_ranking: maxPos,
        },
        page_type: pageType,
        limit: pageSize,
        offset: page * pageSize,
      })
      if (ctl.signal.aborted) return
      setRows(j.candidates)
      setSummary(j.summary)
      setLoadedAt(Math.round(performance.now() - t0))
    } catch (e) {
      if (ctl.signal.aborted) return
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      if (!ctl.signal.aborted) setLoading(false)
    }
  }, [minImp, minPos, maxPos, pageType, pageSize, page])

  useEffect(() => { load() }, [load])

  const reasonFor = useCallback((c: Candidate) => {
    return `${int(c.impressions_28d)} impressions · avg position ${pos(c.avg_position_28d)}${c.clicks_28d > 0 ? ` · ${int(c.clicks_28d)} clicks` : ''}`
  }, [])

  const canPrev = page > 0
  const canNext = summary?.candidate_count ? (page + 1) * pageSize < summary.candidate_count : false
  const totalPages = summary?.candidate_count ? Math.ceil(summary.candidate_count / pageSize) : 1

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <NumberInput label="Min impressions" value={minImp} onChange={v => { setPage(0); setMinImp(Math.max(0, v)) }} min={0} />
          <NumberInput label="Min avg position (>)" value={minPos} onChange={v => { setPage(0); setMinPos(Math.max(0, v)) }} min={0} step={0.5} />
          <NumberInput label="Max avg position (≤)" value={maxPos} onChange={v => { setPage(0); setMaxPos(Math.max(minPos + 0.5, v)) }} min={0} step={0.5} />
          <Select     label="Page type"         value={pageType} onChange={v => { setPage(0); setPageType(v) }} options={PAGE_TYPE_OPTIONS} />
          <Select     label="Page size"         value={String(pageSize)} onChange={v => { setPage(0); setPageSize(Number(v) || 50) }} options={[{ value: '50', label: '50' }, { value: '100', label: '100' }]} />
          <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 11 }}>
            {loading ? 'loading…' : (loadedAt != null ? `loaded in ${loadedAt} ms` : '')}
          </div>
        </div>
      </Card>

      {summary ? (
        <Card>
          <div style={{
            display: 'grid', gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          }}>
            <Stat label="Candidate pages" value={int(summary.candidate_count)} />
            <Stat label="Total impressions (28d)" value={int(summary.total_impressions_28d)} />
            <Stat label="Total clicks (28d)" value={int(summary.total_clicks_28d)} />
            <Stat label="Position 10–15" value={int(summary.position_10_to_15_count)}
                  sub={`Position 15–20: ${int(summary.position_15_to_20_count)}`} />
          </div>
          {summary.by_page_type && Object.keys(summary.by_page_type).length > 0 ? (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              By page type: {Object.entries(summary.by_page_type).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([k, n]) => `${k} ${int(n as number)}`).join(' · ')}
            </div>
          ) : null}
        </Card>
      ) : null}

      {error ? (
        <Card><span style={{ color: '#b91c1c' }}>{error}</span></Card>
      ) : null}

      <CandidateTable rows={rows} reasonFor={reasonFor} />

      <PaginationBar page={page} setPage={setPage} canPrev={canPrev} canNext={canNext} totalPages={totalPages} />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 900, letterSpacing: 1.3,
        textTransform: 'uppercase', color: 'var(--text-muted)',
      }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.5, marginTop: 2, fontFeatureSettings: '"tnum"' }}>{value}</div>
      {sub ? <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

function PaginationBar({ page, setPage, canPrev, canNext, totalPages }: {
  page: number; setPage: (n: number) => void; canPrev: boolean; canNext: boolean; totalPages: number
}) {
  const btn = (label: string, onClick: () => void, disabled: boolean) => (
    <button
      onClick={onClick} disabled={disabled}
      style={{
        padding: '6px 14px', borderRadius: 8,
        background: disabled ? 'var(--bg-light)' : 'var(--card)',
        border: '1px solid var(--border)',
        color: disabled ? 'var(--text-muted)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer', fontWeight: 700, fontSize: 12,
      }}
    >{label}</button>
  )
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Page {page + 1} of {Math.max(1, totalPages)}</span>
      {btn('← Prev', () => canPrev && setPage(page - 1), !canPrev)}
      {btn('Next →', () => canNext && setPage(page + 1), !canNext)}
    </div>
  )
}

// ─── shell ─────────────────────────────────────────────────────────────

export default function OpportunitiesPanel() {
  const [tab, setTab] = useState<QueueKey>('ctr_gold')
  const [opened, setOpened] = useState(false)   // don't fetch until the panel is expanded

  return (
    <section style={{ padding: '20px 20px 24px', maxWidth: 1400, margin: '0 auto' }}>
      <button
        onClick={() => setOpened(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{
          transform: opened ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 120ms', display: 'inline-block',
          color: 'var(--text-muted)',
        }}>▶</span>
        <div>
          <h2 style={{
            fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 800,
            margin: 0, letterSpacing: -0.2,
          }}>SEO Opportunities</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: '2px 0 0' }}>
            Deterministic queues based on current Search Console performance. No automatic changes. {opened ? '' : 'Click to expand.'}
          </p>
        </div>
      </button>

      {opened ? (
        <div style={{ marginTop: 14 }}>
          <div style={{
            display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999,
            background: 'var(--bg-light)', marginBottom: 12,
          }}>
            {([
              { key: 'ctr_gold',     label: 'CTR Gold' },
              { key: 'ranking_push', label: 'Ranking Push' },
            ] as const).map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 800,
                  background: tab === t.key ? 'var(--primary)' : 'transparent',
                  color:      tab === t.key ? '#fff'           : 'var(--text)',
                }}
              >{t.label}</button>
            ))}
          </div>
          {tab === 'ctr_gold' ? <CtrGoldTab /> : <RankingPushTab />}
        </div>
      ) : null}
    </section>
  )
}
