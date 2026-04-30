'use client'
// Grading Calculator
// ──────────────────
// Pick a card (search OR pull from your raw portfolio), set the grade
// outcome odds and grading service, see expected value / ROI / breakeven.
// "Best candidates from your collection" panel re-uses portfolio data.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'

type Currency = 'GBP' | 'USD'

// Public price-list snapshot. Marked editable in the UI in case the user
// has a bulk discount or different shipping route. Fees are USD; we
// convert in the UI based on selected currency.
const SERVICES: Record<string, { label: string; feeUsd: number; days: number }> = {
  psa_value:   { label: 'PSA Value (~$25 ≤ $499 declared)', feeUsd: 25, days: 65 },
  psa_regular: { label: 'PSA Regular (~$75)',                feeUsd: 75, days: 30 },
  psa_express: { label: 'PSA Express (~$150)',               feeUsd: 150, days: 10 },
  cgc_economy: { label: 'CGC Economy (~$18)',                feeUsd: 18, days: 65 },
  cgc_standard:{ label: 'CGC Standard (~$36)',               feeUsd: 36, days: 25 },
  sgc_bulk:    { label: 'SGC Bulk (~$15)',                   feeUsd: 15, days: 60 },
}

interface CardChoice {
  card_slug: string
  card_url_slug: string
  card_name: string
  set_name: string
  image_url: string | null
  raw_usd: number | null
  psa9_usd: number | null
  psa10_usd: number | null
  card_number_display: string | null
}

interface PortfolioCandidate extends CardChoice {
  quantity: number
  expected_roi_pct: number | null
}

function fmt(cents: number | null | undefined, currency: Currency, decimals = 2): string {
  if (cents == null) return '—'
  const v = currency === 'USD' ? cents / 100 : cents / 127
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  return `${sign}${currency === 'USD' ? '$' : '£'}${abs.toFixed(decimals)}`
}

export default function GradingCalculatorClient() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [currency, setCurrency] = useState<Currency>('GBP')

  // Selected card
  const [selected, setSelected] = useState<CardChoice | null>(null)

  // Search
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  // Inputs
  const [serviceId, setServiceId] = useState<keyof typeof SERVICES>('psa_value')
  const [serviceFeeUsd, setServiceFeeUsd] = useState(SERVICES.psa_value.feeUsd)
  const [shippingUsd, setShippingUsd] = useState(15)
  // Outcome odds (must sum to 100 — UI doesn't enforce, but warns)
  const [pct10, setPct10] = useState(25)
  const [pct9,  setPct9]  = useState(55)
  const [pct8,  setPct8]  = useState(15)
  const [pctSub, setPctSub] = useState(5)

  // Portfolio candidates
  const [candidates, setCandidates] = useState<PortfolioCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/dashboard/login'); return }
      setUser(session.user)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/dashboard/login')
      else setUser(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load currency + raw portfolio cards as candidates
  const loadCandidates = useCallback(async () => {
    if (!user) return
    setLoadingCandidates(true)
    const [prefsRes, portRes] = await Promise.all([
      supabase.from('user_email_preferences').select('display_currency').eq('user_id', user.id).maybeSingle()
        .then((r: any) => r.error ? { data: null } : r),
      supabase.from('portfolios').select('id').eq('user_id', user.id).eq('is_default', true).limit(1),
    ])
    const cur = (prefsRes as any).data?.display_currency
    if (cur === 'USD' || cur === 'GBP') setCurrency(cur)

    const pid = portRes.data?.[0]?.id
    if (!pid) { setCandidates([]); setLoadingCandidates(false); return }

    const { data: items } = await supabase
      .from('portfolio_items')
      .select('card_slug, card_name_snapshot, set_name_snapshot, image_url_snapshot, holding_type, quantity')
      .eq('portfolio_id', pid)
      .eq('holding_type', 'raw')

    const rows = items || []
    if (!rows.length) { setCandidates([]); setLoadingCandidates(false); return }

    // Pull current prices
    const names = Array.from(new Set(rows.map((r: any) => r.card_name_snapshot).filter(Boolean)))
    const sets  = Array.from(new Set(rows.map((r: any) => r.set_name_snapshot).filter(Boolean)))
    const { data: trends } = await supabase
      .from('card_trends')
      .select('card_name, set_name, current_raw, current_psa9, current_psa10')
      .in('card_name', names)
      .in('set_name', sets)
    const tk: Record<string, any> = {}
    for (const t of (trends || [])) tk[`${t.card_name}::${t.set_name}`] = t

    // Default odds (pct10/9/8/sub from state defaults) for ranking
    const tot = pct10 + pct9 + pct8 + pctSub
    const w10 = pct10 / tot, w9 = pct9 / tot, w8 = pct8 / tot, wSub = pctSub / tot
    const feeNet = SERVICES[serviceId].feeUsd + shippingUsd

    const out: PortfolioCandidate[] = rows.map((r: any) => {
      const t = tk[`${r.card_name_snapshot}::${r.set_name_snapshot}`]
      const raw = t?.current_raw ?? null
      const psa10 = t?.current_psa10 ?? null
      const psa9  = t?.current_psa9  ?? null
      // PSA 8 ≈ 0.5× PSA 9 fallback if not surfaced; sub-grade ≈ 0.7× raw.
      const psa8Est  = psa9 ? Math.round(psa9 * 0.6) : null
      const subEst   = raw  ? Math.round(raw * 0.7) : null
      let ev: number | null = null
      if (raw && psa10 && psa9) {
        const expected = (w10 * psa10) + (w9 * psa9) + (w8 * (psa8Est || raw)) + (wSub * (subEst || raw))
        ev = expected - raw - (feeNet * 100)
      }
      const roi = ev != null && raw ? (ev / raw) * 100 : null
      return {
        card_slug:           r.card_slug,
        card_url_slug:       r.card_slug,
        card_name:           r.card_name_snapshot,
        set_name:            r.set_name_snapshot,
        image_url:           r.image_url_snapshot,
        raw_usd:             raw,
        psa9_usd:            psa9,
        psa10_usd:           psa10,
        card_number_display: null,
        quantity:            r.quantity || 1,
        expected_roi_pct:    roi,
      }
    })
    out.sort((a, b) => (b.expected_roi_pct ?? -Infinity) - (a.expected_roi_pct ?? -Infinity))
    setCandidates(out)
    setLoadingCandidates(false)
  }, [user, pct10, pct9, pct8, pctSub, serviceId, shippingUsd])

  useEffect(() => { loadCandidates() }, [loadCandidates])

  // Search
  useEffect(() => {
    if (!query.trim() || query.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.rpc('search_global', { query })
      const cards = (data || []).filter((r: any) => r.result_type === 'card').slice(0, 10)
      setResults(cards)
      setSearching(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  async function pickFromSearch(r: any) {
    // Pull real trends to fill psa9 (search RPC may not include all tiers)
    const { data: trend } = await supabase
      .from('card_trends')
      .select('current_raw, current_psa9, current_psa10')
      .eq('card_name', r.name)
      .eq('set_name', r.subtitle || r.set_name)
      .maybeSingle()
    setSelected({
      card_slug:           r.url_slug || r.card_slug,
      card_url_slug:       r.url_slug || r.card_slug,
      card_name:           r.name,
      set_name:            r.subtitle || r.set_name,
      image_url:           r.image_url || null,
      raw_usd:             trend?.current_raw ?? r.price_usd ?? null,
      psa9_usd:            trend?.current_psa9 ?? null,
      psa10_usd:           trend?.current_psa10 ?? null,
      card_number_display: r.card_number_display || null,
    })
    setQuery(''); setResults([])
  }

  function pickFromCandidate(c: PortfolioCandidate) {
    setSelected({
      card_slug: c.card_slug, card_url_slug: c.card_url_slug,
      card_name: c.card_name, set_name: c.set_name,
      image_url: c.image_url,
      raw_usd: c.raw_usd, psa9_usd: c.psa9_usd, psa10_usd: c.psa10_usd,
      card_number_display: c.card_number_display,
    })
  }

  // ── Math ──────────────────────────────────────────────────────────────────
  const odds = useMemo(() => {
    const tot = pct10 + pct9 + pct8 + pctSub
    if (tot <= 0) return { p10: 0, p9: 0, p8: 0, pSub: 0 }
    return { p10: pct10 / tot, p9: pct9 / tot, p8: pct8 / tot, pSub: pctSub / tot }
  }, [pct10, pct9, pct8, pctSub])
  const oddsSum = pct10 + pct9 + pct8 + pctSub

  const result = useMemo(() => {
    if (!selected || !selected.raw_usd) return null
    const psa10 = selected.psa10_usd
    const psa9  = selected.psa9_usd
    if (!psa10 || !psa9) return null
    const psa8Est = Math.round(psa9 * 0.6)
    const subEst  = Math.round(selected.raw_usd * 0.7)
    const feeUsdCents     = Math.round((serviceFeeUsd + shippingUsd) * 100)
    const expectedSale    = (odds.p10 * psa10) + (odds.p9 * psa9) + (odds.p8 * psa8Est) + (odds.pSub * subEst)
    const expectedReturn  = expectedSale - selected.raw_usd - feeUsdCents
    const roiPct          = (expectedReturn / selected.raw_usd) * 100
    // Breakeven raw price = expectedSale - feeUsdCents (i.e. the most you
    // could pay raw and still break even at these odds)
    const breakeven       = Math.max(0, expectedSale - feeUsdCents)
    return { expectedSale, expectedReturn, roiPct, breakeven, feeUsdCents }
  }, [selected, odds, serviceFeeUsd, shippingUsd])

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="grading" email={user?.email} />

      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>Grading Calculator</h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
          Will grading be worth it? Pick a card, set the odds, see expected return after fees.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 }}>

        {/* Pick a card */}
        <Section title="1. Pick a card">
          {selected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--bg-light)', borderRadius: 12 }}>
              {selected.image_url
                ? <img src={selected.image_url} alt={selected.card_name} style={{ width: 48, height: 66, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                : <div style={{ width: 48, height: 66, background: 'var(--bg)', borderRadius: 4, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                  {selected.card_name}{selected.card_number_display ? ` · ${selected.card_number_display}` : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{selected.set_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>
                  Raw {fmt(selected.raw_usd, currency)} · PSA 9 {fmt(selected.psa9_usd, currency)} · PSA 10 {fmt(selected.psa10_usd, currency)}
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12, fontWeight: 600, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a card by name…"
                style={{ width: '100%', padding: '11px 14px', fontSize: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
              {searching && <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '4px 0' }}>Searching…</p>}
              {results.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
                  {results.map((r, i) => (
                    <button key={i} onClick={() => pickFromSearch(r)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-light)', border: 'none', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer', textAlign: 'left' }}>
                      {r.image_url
                        ? <img src={r.image_url} alt={r.name} style={{ width: 28, height: 38, objectFit: 'contain', borderRadius: 3 }} />
                        : <div style={{ width: 28, height: 38, background: 'var(--bg)', borderRadius: 3 }} />}
                      <div style={{ flex: 1, minWidth: 0, fontFamily: "'Figtree', sans-serif" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.subtitle || r.set_name}</div>
                      </div>
                      {r.price_usd != null && r.price_usd > 0 && (
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>{fmt(r.price_usd, currency)}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Section>

        {/* Inputs */}
        {selected && (
          <Section title="2. Service + odds">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <Field label="Grading service">
                <select value={serviceId} onChange={e => { const id = e.target.value as keyof typeof SERVICES; setServiceId(id); setServiceFeeUsd(SERVICES[id].feeUsd) }}
                  style={selectStyle}>
                  {Object.entries(SERVICES).map(([id, s]) => (
                    <option key={id} value={id}>{s.label} · ~{s.days}d</option>
                  ))}
                </select>
              </Field>
              <Field label="Service fee (USD)">
                <input type="number" value={serviceFeeUsd} onChange={e => setServiceFeeUsd(parseFloat(e.target.value) || 0)} style={inputStyle} />
              </Field>
              <Field label="Shipping + sleeves (USD)">
                <input type="number" value={shippingUsd} onChange={e => setShippingUsd(parseFloat(e.target.value) || 0)} style={inputStyle} />
              </Field>
            </div>

            <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
              Outcome odds (must sum to 100)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
              <Field label="PSA 10 %"><input type="number" value={pct10} onChange={e => setPct10(parseFloat(e.target.value) || 0)} style={inputStyle} /></Field>
              <Field label="PSA 9 %"><input type="number" value={pct9}  onChange={e => setPct9(parseFloat(e.target.value) || 0)}  style={inputStyle} /></Field>
              <Field label="PSA 8 %"><input type="number" value={pct8}  onChange={e => setPct8(parseFloat(e.target.value) || 0)}  style={inputStyle} /></Field>
              <Field label="≤ 7 %"><input  type="number" value={pctSub} onChange={e => setPctSub(parseFloat(e.target.value) || 0)} style={inputStyle} /></Field>
            </div>
            <p style={{ fontSize: 11, color: oddsSum === 100 ? 'var(--text-muted)' : '#ef4444', fontFamily: "'Figtree', sans-serif", margin: '6px 0 0' }}>
              {oddsSum === 100 ? 'Sum: 100%' : `Sum: ${oddsSum}% — adjust so it totals 100%.`}
            </p>
          </Section>
        )}

        {/* Result */}
        {selected && result && (
          <Section title="3. Expected outcome">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
              <Stat label="Expected sale price"
                value={fmt(result.expectedSale, currency)}
                sub="weighted by your odds" />
              <Stat label="Net after fees"
                value={fmt(result.expectedReturn, currency)}
                sub={`(–${fmt(result.feeUsdCents, currency)} fees + raw)`}
                color={result.expectedReturn >= 0 ? '#22c55e' : '#ef4444'} />
              <Stat label="Expected ROI"
                value={`${result.roiPct >= 0 ? '+' : ''}${result.roiPct.toFixed(0)}%`}
                color={result.roiPct >= 0 ? '#22c55e' : '#ef4444'} />
              <Stat label="Breakeven raw"
                value={fmt(result.breakeven, currency)}
                sub="max raw price to still break even" />
            </div>
            <div style={{ background: result.roiPct >= 30 ? 'rgba(34,197,94,0.08)' : result.roiPct >= 0 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${result.roiPct >= 30 ? 'rgba(34,197,94,0.25)' : result.roiPct >= 0 ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.55 }}>
              {result.roiPct >= 30
                ? <>Looks worth grading. Expected ROI is healthy after fees. Watch out for sub-grade outcomes — re-run with lower 10% odds if you have any doubt.</>
                : result.roiPct >= 0
                  ? <>Marginal — would clear costs but not by much. Worth it only if you are confident in a 9 or better.</>
                  : <>Don&apos;t grade. At these odds, you would lose money on average. Either sell it raw or tighten your odds before sending in.</>}
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '12px 0 0', lineHeight: 1.5 }}>
              Math: expected sale = (PSA 10 × {(odds.p10 * 100).toFixed(0)}%) + (PSA 9 × {(odds.p9 * 100).toFixed(0)}%) + (PSA 8 ≈ 0.6×PSA 9 × {(odds.p8 * 100).toFixed(0)}%) + (sub ≈ 0.7×raw × {(odds.pSub * 100).toFixed(0)}%). Net = expected sale − raw cost − service fee − shipping. PSA 8 / sub-grade prices are estimates because granular price data is sparse below PSA 9.
            </p>
          </Section>
        )}

        {/* Best candidates */}
        <Section title="Best candidates from your raw cards">
          {loadingCandidates ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>Loading…</p>
          ) : candidates.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
              No raw cards in your portfolio yet. Add one from <Link href="/dashboard/portfolio" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>Portfolio</Link> and we will rank your grading candidates here.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {candidates.slice(0, 8).map(c => (
                <button key={c.card_slug} onClick={() => pickFromCandidate(c)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-light)', cursor: 'pointer', textAlign: 'left', fontFamily: "'Figtree', sans-serif" }}>
                  {c.image_url
                    ? <img src={c.image_url} alt={c.card_name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 3 }} />
                    : <div style={{ width: 32, height: 44, background: 'var(--bg)', borderRadius: 3 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.card_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {c.set_name} · raw {fmt(c.raw_usd, currency)} · PSA 10 {fmt(c.psa10_usd, currency)}
                    </div>
                  </div>
                  {c.expected_roi_pct != null && (
                    <div style={{ fontSize: 13, fontWeight: 800, color: c.expected_roi_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                      {c.expected_roi_pct >= 0 ? '+' : ''}{c.expected_roi_pct.toFixed(0)}%
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </Section>

        <p style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', margin: '4px 0 0', lineHeight: 1.6 }}>
          Service fees and turnaround are public-list snapshots — confirm with the grading company before submitting. Not financial advice.
        </p>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 13, borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
  fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box',
}
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'var(--bg-light)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: color || 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.7, fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
