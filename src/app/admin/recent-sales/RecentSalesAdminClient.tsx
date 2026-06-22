'use client'
// src/app/admin/recent-sales/RecentSalesAdminClient.tsx
// Block 4B-W-3A — admin-only read panel for the recent-sales pipeline.
// Calls /api/admin/recent-sales/inspect with the signed-in user's
// Supabase Auth bearer token. No mutation actions.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ImportRunRow = {
  id: string; provider: string; source: string; status: string
  startedAt: string; completedAt: string | null
  durationMs: number | null
  pagesProcessed: number; rowsOk: number; rowsQuarantined: number; rowsRejected: number; rowsDuplicate: number
  parserVersion: string | null; layoutSignature: string | null; notes: string | null
}
type RecentSalesSummary = {
  totalRows: number; okRows: number; activeRows: number
  distinctProviderCards: number; distinctMarketplaces: number
  bestOfferStatusBreakdown: Record<string, number>
  conditionBucketBreakdown: Record<string, number>
  rawOrGradedBreakdown:     Record<string, number>
  parseStatusBreakdown:     Record<string, number>
  reviewStatusBreakdown:    Record<string, number>
}
type PerCardSummaryRow = {
  providerCardId: string; internalCardSlug: string; cardSlug: string | null
  rowCount: number; latestSaleDate: string | null
  marketplaceBreakdown: Record<string, number>; rawCount: number; gradedCount: number
}
type QuarantineSummary = {
  quarantinedRowsInTable: number; rejectedRowsInTable: number
  runQuarantinedTotal:    number; runRejectedTotal:    number
  latestQuarantineReasons: Array<{ reason: string | null; count: number }>
}
type DuplicateSaleKeyCheck = {
  duplicateCount: number
  duplicateSamples: Array<{ providerSaleKey: string; n: number }>
}
type LatestSampleRow = {
  saleDate: string; marketplaceSource: string; marketplaceCountry: string | null
  providerCardId: string; internalCardSlug: string; observedSection: string
  gradingCompany: string | null; grade: string | null; rawOrGraded: string | null
  conditionBucket: string | null; bestOfferStatus: string | null
  salePriceCents: number; parseStatus: string; reviewStatus: string
  parseConfidence: number; firstSeenAt: string
}
type Snapshot = {
  generatedAt:    string
  importRuns:     ImportRunRow[]
  recentSales:    RecentSalesSummary
  perCard:        PerCardSummaryRow[]
  quarantine:     QuarantineSummary
  duplicateCheck: DuplicateSaleKeyCheck
  latestSamples:  LatestSampleRow[]
}

// ── Helpers ─────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
}

function Breakdown({ label, data }: { label: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1])
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>{label}</div>
      {entries.length === 0
        ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {entries.map(([k, n]) => (
                <tr key={k}>
                  <td style={{ padding: '2px 6px', color: 'var(--text-muted)' }}>{k}</td>
                  <td style={{ padding: '2px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 16, marginBottom: 16,
    }}>
      <h2 style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 16, margin: '0 0 12px', color: 'var(--text)',
      }}>{title}</h2>
      {children}
    </section>
  )
}

// ── Main component ──────────────────────────────────────────────────

export default function RecentSalesAdminClient() {
  const [snap,    setSnap]    = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [signedIn,setSignedIn]= useState<boolean | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setSignedIn(false)
        setError('Not signed in. Sign in with an authorised admin account.')
        return
      }
      setSignedIn(true)
      const res = await fetch('/api/admin/recent-sales/inspect', {
        method: 'GET',
        headers: { authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(`HTTP ${res.status}: ${body.error ?? 'request failed'}`)
        return
      }
      const json = await res.json() as Snapshot
      setSnap(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <main style={{ maxWidth: 1100, margin: '32px auto', padding: '0 16px', fontFamily: "'Figtree', sans-serif", color: 'var(--text)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: 0 }}>Recent Sales — Admin Inspection</h1>
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--bg-light)',
            color: 'var(--text)', cursor: loading ? 'wait' : 'pointer', fontSize: 13,
          }}
        >{loading ? 'Loading…' : 'Refresh'}</button>
      </header>

      {error && (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderLeft: '4px solid var(--red, #c00)',
          padding: 12, borderRadius: 8, marginBottom: 16,
          color: 'var(--text)', fontSize: 13,
        }}>
          <div style={{ fontWeight: 600 }}>Unable to load snapshot.</div>
          <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{error}</div>
          {signedIn === false && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              Sign in at /intel/login or your normal account sign-in flow, then refresh this page.
            </div>
          )}
        </div>
      )}

      {snap && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            Generated at {fmtDateTime(snap.generatedAt)}
          </div>

          <Section title="Latest market_import_runs">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 6 }}>started_at</th>
                    <th style={{ padding: 6 }}>source</th>
                    <th style={{ padding: 6 }}>status</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>pages</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>ok</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>quar.</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>rej.</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>dup.</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>ms</th>
                    <th style={{ padding: 6 }}>parser</th>
                    <th style={{ padding: 6 }}>layout</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.importRuns.length === 0
                    ? <tr><td colSpan={11} style={{ padding: 8, color: 'var(--text-muted)' }}>No runs yet.</td></tr>
                    : snap.importRuns.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 6 }}>{fmtDateTime(r.startedAt)}</td>
                        <td style={{ padding: 6 }}>{r.source}</td>
                        <td style={{ padding: 6 }}>{r.status}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.pagesProcessed}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rowsOk}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rowsQuarantined}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rowsRejected}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rowsDuplicate}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.durationMs ?? '—'}</td>
                        <td style={{ padding: 6, color: 'var(--text-muted)' }}>{r.parserVersion ?? '—'}</td>
                        <td style={{ padding: 6, color: 'var(--text-muted)' }}>{r.layoutSignature ?? '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="recent_sales summary">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                ['total rows',                snap.recentSales.totalRows],
                ['ok rows',                   snap.recentSales.okRows],
                ['active rows',               snap.recentSales.activeRows],
                ['distinct provider_card_id', snap.recentSales.distinctProviderCards],
                ['distinct marketplaces',     snap.recentSales.distinctMarketplaces],
              ].map(([label, n]) => (
                <div key={String(label)} style={{
                  background: 'var(--bg-light)', padding: '8px 12px',
                  borderRadius: 8, border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{n as number}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
              <Breakdown label="best_offer_status" data={snap.recentSales.bestOfferStatusBreakdown} />
              <Breakdown label="condition_bucket"  data={snap.recentSales.conditionBucketBreakdown} />
              <Breakdown label="raw_or_graded"     data={snap.recentSales.rawOrGradedBreakdown} />
              <Breakdown label="parse_status"      data={snap.recentSales.parseStatusBreakdown} />
              <Breakdown label="review_status"     data={snap.recentSales.reviewStatusBreakdown} />
            </div>
          </Section>

          <Section title="Per-card summary (parse_status=ok AND review_status=active)">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 6 }}>provider_card_id</th>
                    <th style={{ padding: 6 }}>internal_card_slug</th>
                    <th style={{ padding: 6 }}>card_slug (resolved)</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>rows</th>
                    <th style={{ padding: 6 }}>latest sale_date</th>
                    <th style={{ padding: 6 }}>marketplaces</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>raw</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>graded</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.perCard.length === 0
                    ? <tr><td colSpan={8} style={{ padding: 8, color: 'var(--text-muted)' }}>No active rows yet.</td></tr>
                    : snap.perCard.map(r => (
                      <tr key={`${r.providerCardId}|${r.internalCardSlug}`} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 6 }}>{r.providerCardId}</td>
                        <td style={{ padding: 6 }}>{r.internalCardSlug}</td>
                        <td style={{ padding: 6, color: 'var(--text-muted)' }}>{r.cardSlug ?? '—'}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rowCount}</td>
                        <td style={{ padding: 6 }}>{fmtDate(r.latestSaleDate)}</td>
                        <td style={{ padding: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                          {Object.entries(r.marketplaceBreakdown).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' · ')}
                        </td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.rawCount}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.gradedCount}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Quarantined / rejected">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>quarantined in recent_sales</div><div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{snap.quarantine.quarantinedRowsInTable}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>rejected in recent_sales</div><div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{snap.quarantine.rejectedRowsInTable}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>quarantined per run counters</div><div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{snap.quarantine.runQuarantinedTotal}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>rejected per run counters</div><div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{snap.quarantine.runRejectedTotal}</div></div>
            </div>
            {snap.quarantine.latestQuarantineReasons.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 6 }}>rejection_reason</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>count</th>
                </tr></thead>
                <tbody>
                  {snap.quarantine.latestQuarantineReasons.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 6 }}>{r.reason ?? '(null)'}</td>
                      <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Duplicate provider_sale_key check">
            <div style={{ fontSize: 14 }}>
              {snap.duplicateCheck.duplicateCount === 0
                ? <span style={{ color: 'var(--green, #2a7)' }}>0 duplicates — provider_sale_key UNIQUE invariant holds.</span>
                : <span style={{ color: 'var(--red, #c00)' }}>{snap.duplicateCheck.duplicateCount} duplicate sale keys detected.</span>}
            </div>
            {snap.duplicateCheck.duplicateSamples.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 6 }}>provider_sale_key</th>
                  <th style={{ padding: 6, textAlign: 'right' }}>n</th>
                </tr></thead>
                <tbody>
                  {snap.duplicateCheck.duplicateSamples.map(d => (
                    <tr key={d.providerSaleKey} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{d.providerSaleKey}</td>
                      <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Latest sample rows (newest first)">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 6 }}>sale_date</th>
                    <th style={{ padding: 6 }}>marketplace</th>
                    <th style={{ padding: 6 }}>provider_card_id</th>
                    <th style={{ padding: 6 }}>section</th>
                    <th style={{ padding: 6 }}>grading</th>
                    <th style={{ padding: 6 }}>condition</th>
                    <th style={{ padding: 6 }}>best_offer</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>price</th>
                    <th style={{ padding: 6 }}>parse</th>
                    <th style={{ padding: 6 }}>review</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>conf</th>
                  </tr>
                </thead>
                <tbody>
                  {snap.latestSamples.length === 0
                    ? <tr><td colSpan={11} style={{ padding: 8, color: 'var(--text-muted)' }}>No rows yet.</td></tr>
                    : snap.latestSamples.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 6 }}>{fmtDate(s.saleDate)}</td>
                        <td style={{ padding: 6 }}>{s.marketplaceSource}{s.marketplaceCountry ? ` (${s.marketplaceCountry})` : ''}</td>
                        <td style={{ padding: 6 }}>{s.providerCardId}</td>
                        <td style={{ padding: 6, color: 'var(--text-muted)' }}>{s.observedSection}</td>
                        <td style={{ padding: 6 }}>{s.gradingCompany ? `${s.gradingCompany} ${s.grade ?? ''}` : (s.rawOrGraded ?? '—')}</td>
                        <td style={{ padding: 6, color: 'var(--text-muted)' }}>{s.conditionBucket ?? '—'}</td>
                        <td style={{ padding: 6 }}>{s.bestOfferStatus ?? '—'}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtCents(s.salePriceCents)}</td>
                        <td style={{ padding: 6 }}>{s.parseStatus}</td>
                        <td style={{ padding: 6 }}>{s.reviewStatus}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.parseConfidence}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}
    </main>
  )
}
