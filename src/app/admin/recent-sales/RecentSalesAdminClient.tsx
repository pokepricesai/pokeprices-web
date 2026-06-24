'use client'
// src/app/admin/recent-sales/RecentSalesAdminClient.tsx
// Block 4B-W-3A — admin-only read panel for the recent-sales pipeline.
// Calls /api/admin/recent-sales/inspect with the signed-in user's
// Supabase Auth bearer token. No mutation actions.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_ARM_THRESHOLD_MS,
  initialArmedState,
  nextArmedState,
  type ArmedState,
} from './_armedClick'

type ImportRunRow = {
  id: string; provider: string; source: string; status: string
  startedAt: string; completedAt: string | null
  durationMs: number | null
  pagesProcessed: number; rowsOk: number; rowsQuarantined: number; rowsRejected: number; rowsDuplicate: number
  parserVersion: string | null; layoutSignature: string | null
  notes: string | null
  notesParsed: Record<string, unknown> | null
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
type GradeCapViolation = {
  internalCardSlug: string
  gradeKey:         string
  gradeLabel:       string
  activeRowCount:   number
}
type FreshnessDistribution = {
  anchorDate: string | null
  last7d:     number
  last30d:    number
  last90d:    number
  older:      number
}
type RecentSalesHealth = {
  totalRows:           number
  okActiveRows:        number
  okSupersededRows:    number
  distinctActiveCards: number
  gradeCapViolations: {
    cap:           number
    violationCount: number
    samples:       GradeCapViolation[]
  }
  topActiveCards: Array<{
    providerCardId:   string
    internalCardSlug: string
    rowCount:         number
    latestSaleDate:   string | null
  }>
  freshness: FreshnessDistribution
}
type AffiliateWindowMetric = {
  views:  number
  clicks: number
  ctrPct: number | null
}
type AffiliatePerPlacementMetric = {
  placement: string
  views:     number
  clicks:    number
  ctrPct:    number | null
}
type AffiliateMonitoringMetrics = {
  last7d:           AffiliateWindowMetric
  last30d:          AffiliateWindowMetric
  perPlacement30d:  AffiliatePerPlacementMetric[]
}
type AffiliateMonitoringPanel = {
  available:  boolean
  source:     string
  note:       string
  placements: string[]
  metrics?:   AffiliateMonitoringMetrics
}
type AlertEventLatestRow = {
  detectedAt: string
  cardSlug:   string
  cardName:   string | null
  setName:    string | null
  rule:       string
  severity:   string
  delivered:  boolean
}
type EngagementSnapshot = {
  watchlist: {
    rows:           number
    distinctUsers:  number
    topCards: Array<{
      cardSlug:  string
      cardName:  string | null
      setName:   string | null
      watchers:  number
    }>
  }
  portfolio: {
    distinctUsers:  number
    items:          number
  }
  alerts: {
    legacyUserAlertsActive: number
    alertPreferenceRows:    number
    alertEventsAllTime:     number
    alertEvents7d:          number
    alertEventsUndelivered: number
    latest:                 AlertEventLatestRow[]
  }
}
type Snapshot = {
  generatedAt:        string
  importRuns:         ImportRunRow[]
  recentSales:        RecentSalesSummary
  recentSalesHealth:  RecentSalesHealth
  perCard:            PerCardSummaryRow[]
  quarantine:         QuarantineSummary
  duplicateCheck:     DuplicateSaleKeyCheck
  latestSamples:      LatestSampleRow[]
  affiliateMonitoring: AffiliateMonitoringPanel
  engagement:         EngagementSnapshot
}

// Recognised import-run notes fields shown in priority order. Anything
// not in this list still renders under "Other notes" so an operator
// can spot a new scraper field without a code change.
const NOTES_FIELDS_ORDERED = [
  'allow_list_total',
  'offset',
  'effective_offset',
  'batch_size',
  'selected_start',
  'selected_end',
  'max_sales_per_grade',
  'rows_after_grade_cap',
  'rows_dropped_by_grade_cap',
  'rows_pruned_old_active',
  'fetched',
  'cards_allowlisted',
  'cards_parsed',
  'rows_upserted',
  'skipped_429',
  'skipped_http_error',
  'skipped_no_html',
  'errors_count',
  'import_type',
] as const

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

function StatTile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'bad' ? 'var(--red, #c00)' : tone === 'good' ? 'var(--green, #2a7)' : 'var(--text)'
  return (
    <div style={{
      background: 'var(--bg-light)', padding: '8px 12px',
      borderRadius: 8, border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
    </div>
  )
}

// The three sample sizes admins can pick. Bounded enum so the browser
// cannot post an arbitrary number; the route also clamps server-side.
type LimitChoice = 5 | 25 | 100
const LIMIT_CHOICES: ReadonlyArray<LimitChoice> = [5, 25, 100]

// Shape of the evaluator response the panel knows how to render. Extra
// keys on the response are ignored — only the named fields are tile'd
// out; the full body still renders as raw JSON underneath.
type EvaluatorResultBody = {
  dryRun?:                       boolean
  usersConsidered?:              number
  cardsConsidered?:              number
  triggersFound?:                number
  triggersSuppressedByCooldown?: number
  triggersInserted?:             number
  diagnostics?: {
    usersWithDisabledPrefs?:            number
    usersWithNoCards?:                  number
    cardsWithInsufficientPriceHistory?: number
    cardsWithNoRecentSales?:            number
    triggersByRule?:                    Record<string, number>
  }
}

// Shared renderer used by BOTH the dry-run and write-mode buttons so
// the diagnostics show up identically regardless of mode. Block 5A-W-7.
function EvaluatorResultPanel({ body }: { body: EvaluatorResultBody }) {
  const d = body.diagnostics
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
        <SmallStat label="users considered"      value={body.usersConsidered} />
        <SmallStat label="cards considered"      value={body.cardsConsidered} />
        <SmallStat label="triggers found"        value={body.triggersFound} />
        <SmallStat label="suppressed by cooldown" value={body.triggersSuppressedByCooldown} />
        <SmallStat label="triggers inserted"     value={body.triggersInserted} />
      </div>

      {d && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 6 }}>
            Diagnostics
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 8 }}>
            <SmallStat label="users w/ disabled prefs (global)" value={d.usersWithDisabledPrefs} />
            <SmallStat label="users w/ no cards"                value={d.usersWithNoCards} />
            <SmallStat label="cards w/ insufficient history"    value={d.cardsWithInsufficientPriceHistory} />
            <SmallStat label="cards w/ no recent_sales"         value={d.cardsWithNoRecentSales} />
          </div>

          {d.triggersByRule && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Triggers by rule</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(d.triggersByRule).map(([rule, n]) => (
                  <span key={rule} style={{
                    display: 'inline-flex', alignItems: 'baseline', gap: 4,
                    padding: '3px 8px', borderRadius: 6,
                    background: 'var(--bg-light)', border: '1px solid var(--border)',
                    fontSize: 11, fontFamily: 'monospace',
                  }}>
                    <span style={{ color: 'var(--text-muted)' }}>{rule}</span>
                    <span style={{ fontWeight: 700, color: n > 0 ? 'var(--text)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <details>
        <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Raw response JSON</summary>
        <pre style={{
          margin: '6px 0 0', padding: 8, borderRadius: 6,
          background: 'var(--card)', border: '1px solid var(--border)',
          fontFamily: 'monospace', fontSize: 11,
          overflowX: 'auto', whiteSpace: 'pre',
          maxHeight: 320,
        }}>{JSON.stringify(body, null, 2)}</pre>
      </details>
    </div>
  )
}

// Owns the shared limitUsers state and renders both evaluator
// buttons. Default 5 is conservative; admin can step up to 25 or 100
// when the smaller sample finds nothing.
function EvaluatorControls() {
  const [limitUsers, setLimitUsers] = useState<LimitChoice>(5)
  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        marginTop: 8,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Users to evaluate
        </span>
        <div role="radiogroup" aria-label="Users to evaluate" style={{ display: 'inline-flex', gap: 4 }}>
          {LIMIT_CHOICES.map(n => {
            const active = n === limitUsers
            return (
              <button
                key={n}
                role="radio"
                aria-checked={active}
                type="button"
                onClick={() => setLimitUsers(n)}
                style={{
                  padding: '4px 10px', borderRadius: 6,
                  border: '1px solid ' + (active ? 'var(--primary)' : 'var(--border)'),
                  background:   active ? 'var(--primary)' : 'transparent',
                  color:        active ? '#fff'           : 'var(--text)',
                  fontSize: 12, fontWeight: 700,
                  fontFamily: "'Figtree', sans-serif",
                  cursor: 'pointer',
                }}
              >{n}</button>
            )
          })}
        </div>
      </div>
      <EvaluatorDryRunButton limitUsers={limitUsers} />
      <EvaluatorWriteModeButton limitUsers={limitUsers} />
    </>
  )
}

// Admin-only button: POST /api/admin/alerts/evaluate with the same
// Supabase session token used elsewhere on this page. Renders only
// inside this admin-gated client component, so visiting it requires
// RECENT_SALES_ADMIN_VIEW_ENABLED + requireAdmin on the inspect route
// (which is what blocks the page from rendering at all when off).
// The evaluator route itself is independently gated by
// ALERTS_EVALUATOR_ENABLED.
function EvaluatorDryRunButton({ limitUsers }: { limitUsers: LimitChoice }) {
  const [busy,    setBusy]    = useState(false)
  const [status,  setStatus]  = useState<number | null>(null)
  const [body,    setBody]    = useState<EvaluatorResultBody | string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  async function run() {
    setBusy(true); setError(null); setStatus(null); setBody(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Not signed in. Sign in with an authorised admin account.')
        return
      }
      const res = await fetch('/api/admin/alerts/evaluate', {
        method:  'POST',
        headers: {
          authorization:  `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body:    JSON.stringify({ dryRun: true, limitUsers }),
        cache:   'no-store',
      })
      setStatus(res.status)
      // Read body even when !res.ok so the operator can see why.
      const text = await res.text()
      try { setBody(JSON.parse(text)) }
      catch { setBody(text) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => void run()}
        disabled={busy}
        style={{
          padding: '6px 12px', borderRadius: 6,
          border: '1px solid var(--border)',
          background: busy ? 'var(--bg-light)' : 'var(--primary)',
          color: busy ? 'var(--text)' : '#fff',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: 12, fontWeight: 700,
          fontFamily: "'Figtree', sans-serif",
        }}
      >{busy ? 'Running…' : `Run dry-run (limit ${limitUsers} users)`}</button>

      {(status != null || error) && (
        <div style={{ marginTop: 8 }}>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red, #c00)', marginBottom: 4 }}>
              {error}
            </div>
          )}
          {status != null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              HTTP <strong style={{ color: 'var(--text)' }}>{status}</strong>
            </div>
          )}
          {body != null && (
            typeof body === 'string'
              ? <pre style={{
                  margin: 0, padding: 8, borderRadius: 6,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  fontFamily: 'monospace', fontSize: 11,
                  overflowX: 'auto', whiteSpace: 'pre',
                  maxHeight: 320,
                }}>{body}</pre>
              : <EvaluatorResultPanel body={body} />
          )}
        </div>
      )}
    </div>
  )
}

// Admin-only WRITE-mode button. Posts { dryRun: false, limitUsers: 5 }
// to the same /api/admin/alerts/evaluate route the dry-run button
// uses. Gated by a two-click confirmation (see _armedClick.ts) so a
// stray click cannot insert alert_events. The route itself remains
// gated by ALERTS_EVALUATOR_ENABLED + requireAdmin.
//
// IMPORTANT: this button does NOT send any email. The evaluator
// inserts rows into alert_events; the email/digest layer that
// eventually consumes them is a separate, not-yet-built block.
function EvaluatorWriteModeButton({ limitUsers }: { limitUsers: LimitChoice }) {
  const [arm,    setArm]    = useState<ArmedState>(initialArmedState())
  const [busy,   setBusy]   = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [body,   setBody]   = useState<EvaluatorResultBody | string | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  // setTimeout handle so we can cancel a pending auto-disarm when a
  // second click lands first.
  const disarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current)
  }, [])

  async function run() {
    setBusy(true); setError(null); setStatus(null); setBody(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Not signed in. Sign in with an authorised admin account.')
        return
      }
      const res = await fetch('/api/admin/alerts/evaluate', {
        method:  'POST',
        headers: {
          authorization:  `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        // dryRun is hard-coded; limitUsers is one of the bounded
        // LimitChoice values picked by the admin (5/25/100). The route
        // enforces the same numeric bound on its side.
        body:    JSON.stringify({ dryRun: false, limitUsers }),
        cache:   'no-store',
      })
      setStatus(res.status)
      const text = await res.text()
      try { setBody(JSON.parse(text)) } catch { setBody(text) }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setBusy(false)
    }
  }

  function click() {
    if (busy) return
    const decision = nextArmedState(arm, Date.now())
    if (decision.shouldRun) {
      if (disarmTimerRef.current) {
        clearTimeout(disarmTimerRef.current)
        disarmTimerRef.current = null
      }
      setArm(initialArmedState())
      void run()
      return
    }
    setArm({ armed: decision.armed, armedAt: decision.armedAt })
    if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current)
    disarmTimerRef.current = setTimeout(() => {
      setArm(initialArmedState())
      disarmTimerRef.current = null
    }, DEFAULT_ARM_THRESHOLD_MS)
  }

  const armed = arm.armed
  const label = busy
    ? 'Running…'
    : armed
      ? 'Click again to confirm — auto-cancels in 5s'
      : `Run evaluator and create alert events (${limitUsers} users)`

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={click}
        disabled={busy}
        aria-pressed={armed}
        style={{
          padding: '6px 12px', borderRadius: 6,
          border: '1px solid ' + (armed ? 'var(--red, #c00)' : 'var(--border)'),
          background: armed ? 'var(--red, #c00)' : 'transparent',
          color:      armed ? '#fff'             : 'var(--red, #c00)',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: 12, fontWeight: 700,
          fontFamily: "'Figtree', sans-serif",
        }}
      >{label}</button>
      <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        This creates <strong style={{ color: 'var(--text)' }}>alert_events</strong> but does not send emails.
      </span>

      {(status != null || error) && (
        <div style={{ marginTop: 8 }}>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red, #c00)', marginBottom: 4 }}>
              {error}
            </div>
          )}
          {status != null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              HTTP <strong style={{ color: 'var(--text)' }}>{status}</strong>
            </div>
          )}
          {body != null && (
            typeof body === 'string'
              ? <pre style={{
                  margin: 0, padding: 8, borderRadius: 6,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  fontFamily: 'monospace', fontSize: 11,
                  overflowX: 'auto', whiteSpace: 'pre',
                  maxHeight: 320,
                }}>{body}</pre>
              : <EvaluatorResultPanel body={body} />
          )}
        </div>
      )}
    </div>
  )
}

// Admin-only button: POST /api/admin/alerts/preview-email. Renders
// the subject / preview text / HTML body / plain text the digest
// would carry, WITHOUT sending or writing anything. The route picks
// real-vs-sample mode based on whether the admin has undelivered
// alert_events.
function AlertEmailPreviewButton() {
  const [busy,   setBusy]   = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [body,   setBody]   = useState<{
    mode?:        string
    sample?:      boolean
    eventCount?:  number
    subject?:     string
    previewText?: string
    html?:        string
    text?:        string
    error?:       string
  } | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  async function run(mode: 'auto' | 'sample') {
    setBusy(true); setError(null); setStatus(null); setBody(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Not signed in. Sign in with an authorised admin account.')
        return
      }
      const res = await fetch('/api/admin/alerts/preview-email', {
        method:  'POST',
        headers: {
          authorization:  `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body:    JSON.stringify({ mode }),
        cache:   'no-store',
      })
      setStatus(res.status)
      const text = await res.text()
      try { setBody(JSON.parse(text)) } catch { setError(text || 'Empty response') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Preview alert email</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        Renders the digest the user would receive — <strong style={{ color: 'var(--text)' }}>preview only, no email sent</strong>. Auto-mode uses your own undelivered events when present and falls back to sample data when not.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={() => void run('auto')}
          disabled={busy}
          style={{
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid var(--border)',
            background: busy ? 'var(--bg-light)' : 'var(--primary)',
            color: busy ? 'var(--text)' : '#fff',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 12, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif",
          }}
        >{busy ? 'Loading…' : 'Preview alert email (auto)'}</button>
        <button
          onClick={() => void run('sample')}
          disabled={busy}
          style={{
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text)',
            cursor: busy ? 'wait' : 'pointer',
            fontSize: 12, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif",
          }}
        >Force sample</button>
      </div>

      {(status != null || error) && (
        <div style={{ marginTop: 12 }}>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red, #c00)', marginBottom: 4 }}>
              {error}
            </div>
          )}
          {status != null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              HTTP <strong style={{ color: 'var(--text)' }}>{status}</strong>
              {body?.mode && (
                <>
                  {' '}· mode <strong style={{ color: 'var(--text)' }}>{body.mode}</strong>
                  {' '}· events <strong style={{ color: 'var(--text)' }}>{body.eventCount ?? '—'}</strong>
                </>
              )}
            </div>
          )}
          {body?.subject != null && (
            <div style={{
              padding: '8px 10px', borderRadius: 6,
              background: 'var(--bg-light)', border: '1px solid var(--border)',
              marginBottom: 6,
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Subject</div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{body.subject}</div>
            </div>
          )}
          {body?.previewText != null && (
            <div style={{
              padding: '8px 10px', borderRadius: 6,
              background: 'var(--bg-light)', border: '1px solid var(--border)',
              marginBottom: 6,
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Preview text</div>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>{body.previewText}</div>
            </div>
          )}
          {body?.html != null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 4 }}>Rendered HTML</div>
              <iframe
                title="alert digest preview"
                srcDoc={body.html}
                sandbox=""
                style={{
                  width: '100%', height: 540,
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: '#fff',
                }}
              />
            </div>
          )}
          {body?.text != null && (
            <details style={{ marginBottom: 8 }}>
              <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Plain text body</summary>
              <pre style={{
                margin: '6px 0 0', padding: 8, borderRadius: 6,
                background: 'var(--card)', border: '1px solid var(--border)',
                fontFamily: 'monospace', fontSize: 11,
                overflowX: 'auto', whiteSpace: 'pre',
                maxHeight: 320,
              }}>{body.text}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

// Admin-only WRITE-mode button for the test-email send. POSTs to
// /api/admin/alerts/send-test-email. Two-click confirmation reuses
// the _armedClick state machine for parity with the evaluator's
// write-mode button.
function AlertTestEmailSendButton() {
  const [arm,    setArm]    = useState<ArmedState>(initialArmedState())
  const [busy,   setBusy]   = useState(false)
  const [status, setStatus] = useState<number | null>(null)
  const [body,   setBody]   = useState<{
    ok?:              boolean
    outcome?:         string
    deliveryLogId?:   string | null
    emailId?:         string | null
    reason?:          string | null
    recipient?:       string
    recipientSource?: string
    mode?:            string
    eventCount?:      number
    subject?:         string
    error?:           string
  } | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const disarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current)
  }, [])

  async function run() {
    setBusy(true); setError(null); setStatus(null); setBody(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Not signed in. Sign in with an authorised admin account.')
        return
      }
      const res = await fetch('/api/admin/alerts/send-test-email', {
        method:  'POST',
        headers: {
          authorization:  `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        // No body — the route resolves recipient + mode internally.
        body:    '{}',
        cache:   'no-store',
      })
      setStatus(res.status)
      const text = await res.text()
      try { setBody(JSON.parse(text)) } catch { setError(text || 'Empty response') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setBusy(false)
    }
  }

  function click() {
    if (busy) return
    const decision = nextArmedState(arm, Date.now())
    if (decision.shouldRun) {
      if (disarmTimerRef.current) {
        clearTimeout(disarmTimerRef.current)
        disarmTimerRef.current = null
      }
      setArm(initialArmedState())
      void run()
      return
    }
    setArm({ armed: decision.armed, armedAt: decision.armedAt })
    if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current)
    disarmTimerRef.current = setTimeout(() => {
      setArm(initialArmedState())
      disarmTimerRef.current = null
    }, DEFAULT_ARM_THRESHOLD_MS)
  }

  const armed = arm.armed
  const label = busy
    ? 'Sending…'
    : armed
      ? 'Click again to confirm — auto-cancels in 5s'
      : 'Send test alert email to admin'

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={click}
        disabled={busy}
        aria-pressed={armed}
        style={{
          padding: '6px 12px', borderRadius: 6,
          border: '1px solid ' + (armed ? 'var(--red, #c00)' : 'var(--border)'),
          background: armed ? 'var(--red, #c00)' : 'transparent',
          color:      armed ? '#fff'             : 'var(--red, #c00)',
          cursor: busy ? 'wait' : 'pointer',
          fontSize: 12, fontWeight: 700,
          fontFamily: "'Figtree', sans-serif",
        }}
      >{label}</button>
      <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-muted)' }}>
        Sends <strong style={{ color: 'var(--text)' }}>one test email only</strong>. Does not mark alerts delivered. Subject is prefixed <code>[TEST]</code>.
      </span>

      {(status != null || error) && (
        <div style={{ marginTop: 8 }}>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red, #c00)', marginBottom: 4 }}>
              {error}
            </div>
          )}
          {status != null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              HTTP <strong style={{ color: 'var(--text)' }}>{status}</strong>
              {body?.outcome && (
                <>{' '}· outcome <strong style={{ color: body.ok ? 'var(--green, #2a7)' : 'var(--text)' }}>{body.outcome}</strong></>
              )}
              {body?.recipient && (
                <>{' '}· recipient <strong style={{ color: 'var(--text)' }}>{body.recipient}</strong>{body.recipientSource ? ` (${body.recipientSource})` : ''}</>
              )}
              {body?.mode && (
                <>{' '}· mode <strong style={{ color: 'var(--text)' }}>{body.mode}</strong></>
              )}
            </div>
          )}
          {body?.subject && (
            <div style={{
              padding: '8px 10px', borderRadius: 6,
              background: 'var(--bg-light)', border: '1px solid var(--border)',
              marginBottom: 6,
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>Subject sent</div>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{body.subject}</div>
            </div>
          )}
          {body != null && (
            <pre style={{
              margin: 0, padding: 8, borderRadius: 6,
              background: 'var(--card)', border: '1px solid var(--border)',
              fontFamily: 'monospace', fontSize: 11,
              overflowX: 'auto', whiteSpace: 'pre',
              maxHeight: 320,
            }}>{JSON.stringify(body, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  )
}

// Admin-only delivery batch button. Renders the preview (dryRun=true)
// + the send (dryRun=false, two-click confirmation) controls. Posts
// to /api/admin/alerts/deliver. The route + orchestrator enforce the
// hard caps + delivered_at write semantics; this UI is the
// operator-facing surface.
function AlertDeliveryBatchControls() {
  // Shared response state. A second click on Preview while a Send
  // result is showing replaces it (and vice versa).
  const [status, setStatus] = useState<number | null>(null)
  const [busy,   setBusy]   = useState<'idle' | 'preview' | 'send'>('idle')
  const [body,   setBody]   = useState<{
    dryRun?:                boolean
    usersConsidered?:       number
    usersEmailed?:          number
    eventsDelivered?:       number
    cardsDelivered?:        number
    eventsLeftUndelivered?: number
    usersInCooldown?:       number
    cooldownHours?:         number
    suppressedOrSkipped?:   number
    failed?:                number
    perUser?: Array<{
      recipientMasked:       string
      eventCount:            number
      cardCount?:            number
      eventsLeftUndelivered?: number
      outcome:               string
      reason?:               string | null
    }>
    error?:                 string
  } | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  // Two-click confirmation for the SEND button only. Preview is read-only.
  const [arm, setArm] = useState<ArmedState>(initialArmedState())
  const disarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current)
  }, [])

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'send')
    setError(null); setStatus(null); setBody(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('Not signed in. Sign in with an authorised admin account.')
        return
      }
      const res = await fetch('/api/admin/alerts/deliver', {
        method:  'POST',
        headers: {
          authorization:  `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body:    JSON.stringify(dryRun ? { dryRun: true } : { dryRun: false }),
        cache:   'no-store',
      })
      setStatus(res.status)
      const text = await res.text()
      try { setBody(JSON.parse(text)) } catch { setError(text || 'Empty response') }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    } finally {
      setBusy('idle')
    }
  }

  function clickPreview() {
    if (busy !== 'idle') return
    void run(true)
  }

  function clickSend() {
    if (busy !== 'idle') return
    const decision = nextArmedState(arm, Date.now())
    if (decision.shouldRun) {
      if (disarmTimerRef.current) {
        clearTimeout(disarmTimerRef.current)
        disarmTimerRef.current = null
      }
      setArm(initialArmedState())
      void run(false)
      return
    }
    setArm({ armed: decision.armed, armedAt: decision.armedAt })
    if (disarmTimerRef.current) clearTimeout(disarmTimerRef.current)
    disarmTimerRef.current = setTimeout(() => {
      setArm(initialArmedState())
      disarmTimerRef.current = null
    }, DEFAULT_ARM_THRESHOLD_MS)
  }

  const armed = arm.armed
  const sendLabel = busy === 'send'
    ? 'Sending…'
    : armed
      ? 'Click again to confirm — auto-cancels in 5s'
      : 'Send delivery batch'

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Deliver alert emails</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        Sends real digest emails to users with undelivered <code>alert_events</code>. <strong style={{ color: 'var(--text)' }}>Admin-triggered only — no cron.</strong> Defaults: 5 users, 20 events loaded, up to 10 distinct cards per email (multiple reasons on one card collapse into one card block). Recipients shown masked. Marks <code>alert_events.delivered_at</code> only for events actually included in a sent digest — events trimmed by the card cap or the per-user cooldown roll into the next batch. <strong style={{ color: 'var(--text)' }}>Per-recipient cooldown</strong> defaults to 24h (override via <code>ALERT_DELIVERY_USER_COOLDOWN_HOURS</code>); users inside the window show as <code>recent_delivery_cooldown</code> in both preview and send.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={clickPreview}
          disabled={busy !== 'idle'}
          style={{
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid var(--border)',
            background: busy === 'preview' ? 'var(--bg-light)' : 'var(--primary)',
            color: busy === 'preview' ? 'var(--text)' : '#fff',
            cursor: busy !== 'idle' ? 'wait' : 'pointer',
            fontSize: 12, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif",
          }}
        >{busy === 'preview' ? 'Loading…' : 'Preview delivery batch'}</button>
        <button
          onClick={clickSend}
          disabled={busy !== 'idle'}
          aria-pressed={armed}
          style={{
            padding: '6px 12px', borderRadius: 6,
            border: '1px solid ' + (armed ? 'var(--red, #c00)' : 'var(--border)'),
            background: armed ? 'var(--red, #c00)' : 'transparent',
            color:      armed ? '#fff'             : 'var(--red, #c00)',
            cursor: busy !== 'idle' ? 'wait' : 'pointer',
            fontSize: 12, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif",
          }}
        >{sendLabel}</button>
      </div>

      {(status != null || error) && (
        <div style={{ marginTop: 10 }}>
          {error && (
            <div style={{ fontSize: 12, color: 'var(--red, #c00)', marginBottom: 4 }}>
              {error}
            </div>
          )}
          {status != null && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
              HTTP <strong style={{ color: 'var(--text)' }}>{status}</strong>
              {body && typeof body.dryRun === 'boolean' && (
                <> · mode <strong style={{ color: 'var(--text)' }}>{body.dryRun ? 'preview' : 'send'}</strong></>
              )}
            </div>
          )}
          {body && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 8 }}>
                <SmallStat label="users considered"   value={body.usersConsidered} />
                <SmallStat label={body.dryRun === false ? 'users emailed' : 'would email'} value={body.usersEmailed} />
                <SmallStat label={body.dryRun === false ? 'cards delivered' : 'cards in digest'} value={body.cardsDelivered} />
                <SmallStat label={body.dryRun === false ? 'events delivered' : 'would deliver'} value={body.eventsDelivered} />
                <SmallStat label={`in cooldown (${typeof body.cooldownHours === 'number' ? body.cooldownHours : '?'}h)`} value={body.usersInCooldown} />
                <SmallStat label="total backlog left" value={body.eventsLeftUndelivered} />
                <SmallStat label="suppressed / skipped" value={body.suppressedOrSkipped} />
                <SmallStat label="failed"              value={body.failed} />
              </div>
              {Array.isArray(body.perUser) && body.perUser.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700, marginBottom: 4 }}>
                    Per-recipient breakdown
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: 6 }}>recipient</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>cards</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>events</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>left</th>
                      <th style={{ padding: 6 }}>outcome</th>
                      <th style={{ padding: 6 }}>reason</th>
                    </tr></thead>
                    <tbody>
                      {body.perUser.map((u, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{u.recipientMasked}</td>
                          <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.cardCount ?? '—'}</td>
                          <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{u.eventCount}</td>
                          <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: (u.eventsLeftUndelivered ?? 0) > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{u.eventsLeftUndelivered ?? 0}</td>
                          <td style={{ padding: 6 }}>{u.outcome}</td>
                          <td style={{ padding: 6, color: 'var(--text-muted)' }}>{u.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <details>
                <summary style={{ fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer' }}>Raw response JSON</summary>
                <pre style={{
                  margin: '6px 0 0', padding: 8, borderRadius: 6,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  fontFamily: 'monospace', fontSize: 11,
                  overflowX: 'auto', whiteSpace: 'pre',
                  maxHeight: 320,
                }}>{JSON.stringify(body, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SmallStat({ label, value }: { label: string; value: unknown }) {
  const display = typeof value === 'number' ? value : '—'
  return (
    <div style={{
      background: 'var(--bg-light)', padding: '6px 10px',
      borderRadius: 6, border: '1px solid var(--border)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{display}</div>
    </div>
  )
}

function NotesRow({ notes }: { notes: Record<string, unknown> }) {
  const known = NOTES_FIELDS_ORDERED.filter(k => Object.prototype.hasOwnProperty.call(notes, k))
  const knownSet = new Set<string>(known)
  const others = Object.keys(notes).filter(k => !knownSet.has(k)).sort()
  if (known.length === 0 && others.length === 0) return null
  function val(k: string): string {
    const v = notes[k]
    if (v == null) return '—'
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td colSpan={11} style={{ padding: '0 6px 8px 6px' }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          fontSize: 11, color: 'var(--text-muted)',
          padding: '6px 8px', background: 'var(--bg-light)',
          borderRadius: 8, border: '1px solid var(--border)',
        }}>
          {known.map(k => (
            <span key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline' }}>
              <span style={{ opacity: 0.7 }}>{k}:</span>
              <span style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{val(k)}</span>
            </span>
          ))}
          {others.map(k => (
            <span key={k} style={{ display: 'inline-flex', gap: 4, alignItems: 'baseline', opacity: 0.7 }}>
              <span>{k}:</span>
              <span style={{ color: 'var(--text)' }}>{val(k)}</span>
            </span>
          ))}
        </div>
      </td>
    </tr>
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
                      <Fragment key={r.id}>
                        <tr style={{ borderBottom: r.notesParsed ? 'none' : '1px solid var(--border)' }}>
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
                        {r.notesParsed && <NotesRow notes={r.notesParsed} />}
                      </Fragment>
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

          <Section title="Recent sales data health">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
              <StatTile label="total rows"           value={snap.recentSalesHealth.totalRows} />
              <StatTile label="ok + active"          value={snap.recentSalesHealth.okActiveRows} tone="good" />
              <StatTile label="ok + superseded"      value={snap.recentSalesHealth.okSupersededRows} />
              <StatTile label="distinct active cards" value={snap.recentSalesHealth.distinctActiveCards} />
              <StatTile
                label={`> ${snap.recentSalesHealth.gradeCapViolations.cap}/grade violations`}
                value={snap.recentSalesHealth.gradeCapViolations.violationCount}
                tone={snap.recentSalesHealth.gradeCapViolations.violationCount === 0 ? 'good' : 'bad'}
              />
            </div>

            {snap.recentSalesHealth.gradeCapViolations.samples.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--red, #c00)', fontWeight: 600, marginBottom: 6 }}>
                  Buckets exceeding {snap.recentSalesHealth.gradeCapViolations.cap}-per-grade cap
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 6 }}>internal_card_slug</th>
                    <th style={{ padding: 6 }}>grade</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>active rows</th>
                  </tr></thead>
                  <tbody>
                    {snap.recentSalesHealth.gradeCapViolations.samples.map((v, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 6 }}>{v.internalCardSlug}</td>
                        <td style={{ padding: 6 }}>{v.gradeLabel} <span style={{ color: 'var(--text-muted)' }}>({v.gradeKey})</span></td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v.activeRowCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                Sale-date freshness (active rows){snap.recentSalesHealth.freshness.anchorDate ? `, anchored on ${snap.recentSalesHealth.freshness.anchorDate}` : ''}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                <StatTile label="last 7 days"  value={snap.recentSalesHealth.freshness.last7d} />
                <StatTile label="last 30 days" value={snap.recentSalesHealth.freshness.last30d} />
                <StatTile label="last 90 days" value={snap.recentSalesHealth.freshness.last90d} />
                <StatTile label="older"        value={snap.recentSalesHealth.freshness.older} />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Top 20 active cards</div>
              {snap.recentSalesHealth.topActiveCards.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No active rows yet.</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: 6 }}>provider_card_id</th>
                      <th style={{ padding: 6 }}>internal_card_slug</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>active rows</th>
                      <th style={{ padding: 6 }}>latest sale_date</th>
                    </tr></thead>
                    <tbody>
                      {snap.recentSalesHealth.topActiveCards.map((c, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 6 }}>{c.providerCardId}</td>
                          <td style={{ padding: 6 }}>{c.internalCardSlug}</td>
                          <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.rowCount}</td>
                          <td style={{ padding: 6 }}>{fmtDate(c.latestSaleDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
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

          <Section title="User engagement">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              <StatTile label="watchlist users"        value={snap.engagement.watchlist.distinctUsers} />
              <StatTile label="watchlist rows"         value={snap.engagement.watchlist.rows} />
              <StatTile label="portfolio users"        value={snap.engagement.portfolio.distinctUsers} />
              <StatTile label="portfolio items"        value={snap.engagement.portfolio.items} />
              <StatTile label="alert prefs rows"       value={snap.engagement.alerts.alertPreferenceRows} />
              <StatTile label="alert events — all"     value={snap.engagement.alerts.alertEventsAllTime} />
              <StatTile label="alert events — 7d"      value={snap.engagement.alerts.alertEvents7d} />
              <StatTile label="undelivered events"     value={snap.engagement.alerts.alertEventsUndelivered} />
              <StatTile label="legacy threshold alerts" value={snap.engagement.alerts.legacyUserAlertsActive} />
            </div>

            {snap.engagement.alerts.latest.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Latest 10 alert events (newest first)</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                      <th style={{ padding: 6 }}>detected_at</th>
                      <th style={{ padding: 6 }}>card name</th>
                      <th style={{ padding: 6 }}>set name</th>
                      <th style={{ padding: 6 }}>card slug</th>
                      <th style={{ padding: 6 }}>rule</th>
                      <th style={{ padding: 6 }}>severity</th>
                      <th style={{ padding: 6 }}>delivered</th>
                    </tr></thead>
                    <tbody>
                      {snap.engagement.alerts.latest.map((e, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 6 }}>{fmtDateTime(e.detectedAt)}</td>
                          <td style={{ padding: 6 }}>{e.cardName ?? '—'}</td>
                          <td style={{ padding: 6, color: 'var(--text-muted)' }}>{e.setName ?? '—'}</td>
                          <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{e.cardSlug}</td>
                          <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{e.rule}</td>
                          <td style={{ padding: 6 }}>{e.severity}</td>
                          <td style={{ padding: 6, color: e.delivered ? 'var(--green, #2a7)' : 'var(--text-muted)' }}>
                            {e.delivered ? 'yes' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div style={{
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-light)',
              fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6,
              marginBottom: 16,
            }}>
              <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>Run the alert evaluator</div>
              <div>Requires <code>ALERTS_EVALUATOR_ENABLED=true</code> in the runtime env. The dry-run button is read-only — no writes, no emails. The write-mode button inserts into <code>alert_events</code> but still sends no emails; it is gated by a two-click confirmation. Pick a sample size, then run.</div>
              <EvaluatorControls />
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0 0' }} />
              <AlertEmailPreviewButton />
              <AlertTestEmailSendButton />
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '14px 0 0' }} />
              <AlertDeliveryBatchControls />
              <pre style={{
                margin: '6px 0 0', padding: 8, borderRadius: 6,
                background: 'var(--card)', border: '1px solid var(--border)',
                fontFamily: 'monospace', fontSize: 11, overflowX: 'auto', whiteSpace: 'pre',
              }}>
{`# dry-run (default): returns proposals, writes nothing
curl -X POST /api/admin/alerts/evaluate \\
  -H "authorization: Bearer <session token>"

# write mode: inserts into alert_events, still sends NO emails
curl -X POST /api/admin/alerts/evaluate \\
  -H "authorization: Bearer <session token>" \\
  -H "content-type: application/json" \\
  -d '{"dryRun": false}'`}
              </pre>
            </div>
            {snap.engagement.watchlist.topCards.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Top 20 watched cards</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 6 }}>card</th>
                    <th style={{ padding: 6 }}>set</th>
                    <th style={{ padding: 6 }}>card_slug</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>watchers</th>
                  </tr></thead>
                  <tbody>
                    {snap.engagement.watchlist.topCards.map(c => (
                      <tr key={c.cardSlug} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 6 }}>{c.cardName ?? '—'}</td>
                        <td style={{ padding: 6, color: 'var(--text-muted)' }}>{c.setName ?? '—'}</td>
                        <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{c.cardSlug}</td>
                        <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.watchers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Affiliate monitoring">
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--bg-light)',
              fontSize: 13, color: 'var(--text)', marginBottom: 12,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {snap.affiliateMonitoring.available
                  ? 'Server-side affiliate metrics (last 30 days)'
                  : 'Server-side storage not yet populated'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                <div><strong style={{ color: 'var(--text)' }}>Source:</strong> {snap.affiliateMonitoring.source}</div>
                <div style={{ marginTop: 4 }}>{snap.affiliateMonitoring.note}</div>
              </div>
            </div>

            {snap.affiliateMonitoring.metrics && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 16 }}>
                  <StatTile label="views — 7d"    value={snap.affiliateMonitoring.metrics.last7d.views} />
                  <StatTile label="clicks — 7d"   value={snap.affiliateMonitoring.metrics.last7d.clicks} />
                  <StatTile label="CTR — 7d"      value={snap.affiliateMonitoring.metrics.last7d.ctrPct == null ? '—' : `${snap.affiliateMonitoring.metrics.last7d.ctrPct.toFixed(1)}%`} />
                  <StatTile label="views — 30d"   value={snap.affiliateMonitoring.metrics.last30d.views} />
                  <StatTile label="clicks — 30d"  value={snap.affiliateMonitoring.metrics.last30d.clicks} />
                  <StatTile label="CTR — 30d"     value={snap.affiliateMonitoring.metrics.last30d.ctrPct == null ? '—' : `${snap.affiliateMonitoring.metrics.last30d.ctrPct.toFixed(1)}%`} />
                </div>

                {snap.affiliateMonitoring.metrics.perPlacement30d.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                      Per-placement (last 30 days)
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: 6 }}>placement</th>
                        <th style={{ padding: 6, textAlign: 'right' }}>views</th>
                        <th style={{ padding: 6, textAlign: 'right' }}>clicks</th>
                        <th style={{ padding: 6, textAlign: 'right' }}>CTR</th>
                      </tr></thead>
                      <tbody>
                        {snap.affiliateMonitoring.metrics.perPlacement30d.map(p => (
                          <tr key={p.placement} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: 6, fontFamily: 'monospace', fontSize: 11 }}>{p.placement}</td>
                            <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.views}</td>
                            <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.clicks}</td>
                            <td style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.ctrPct == null ? '—' : `${p.ctrPct.toFixed(1)}%`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {snap.affiliateMonitoring.placements.length > 0 && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                  GA4 placement filters (event: affiliate_click / affiliate_link_view)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {snap.affiliateMonitoring.placements.map(p => (
                    <span key={p} style={{
                      fontSize: 11, fontFamily: 'monospace',
                      padding: '3px 8px', borderRadius: 6,
                      background: 'var(--card)', border: '1px solid var(--border)',
                      color: 'var(--text)',
                    }}>{p}</span>
                  ))}
                </div>
              </div>
            )}
          </Section>
        </>
      )}
    </main>
  )
}
