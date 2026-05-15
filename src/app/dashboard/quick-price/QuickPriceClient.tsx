'use client'
// Quick Price Checker — login-required dealer-style tool for batching
// cards quickly. Scan or search to add, set grade + qty, see live market
// value per row, total, and a buy-percentage applied to that total.
// Manual override per row for thinly-traded grades or off-market prices.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'
import CardScanner, { ConfirmedCard, ConfirmContext } from '@/components/CardScanner'
import {
  HOLDING_TYPES,
  GRADE_LABELS,
  HOLDING_TYPE_TO_PRICE_COLUMN,
  isManualGrade,
} from '@/lib/portfolioGrades'

const USD_TO_GBP = 0.79

type Currency = 'GBP' | 'USD'

interface Row {
  id: string                  // local id for list operations
  card_slug: string           // pc-prefixed slug used for price lookups
  card_url_slug: string       // url-friendly slug used for links
  name: string                // clean name (no #NN suffix)
  set_name: string
  card_number_display: string | null
  image_url: string | null
  holdingType: string
  quantity: number
  marketCents: number | null  // live USD cents from daily_prices, null when not available
  manualCents: number | null  // user override (in current currency cents), null = use market
}

function fmt(cents: number | null | undefined, currency: Currency, decimals = 2): string {
  if (!cents || cents <= 0) return '—'
  const v = currency === 'USD' ? cents / 100 : (cents / 100) * USD_TO_GBP
  return (currency === 'USD' ? '$' : '£') + v.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// Parse a £/$ string into cents in the CURRENT currency. If user enters
// "12.50" with GBP selected, returns 1250 GBP-cents. We then convert to
// USD-cents for storage by dividing by USD_TO_GBP.
function parseManualToUsdCents(input: string, currency: Currency): number | null {
  const n = parseFloat(input.replace(/[^0-9.]/g, ''))
  if (!isFinite(n) || n <= 0) return null
  const centsInCurrency = Math.round(n * 100)
  return currency === 'USD' ? centsInCurrency : Math.round(centsInCurrency / USD_TO_GBP)
}

export default function QuickPriceClient() {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [showScanner, setShowScanner] = useState(false)
  const [currency, setCurrency] = useState<Currency>('GBP')
  const [pctOfTotal, setPctOfTotal] = useState<number>(70)  // dealer-style "I'll pay X% of total"
  const [refreshing, setRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  // Auth gate
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/dashboard/login'); return }
      setAuthed(true)
      setEmail(session.user.email ?? null)
    })
  }, [router])

  // Manual search (alternative to scanning).
  useEffect(() => {
    if (searchQuery.length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.rpc('search_global', { query: searchQuery })
      const cardRows = (data || []).filter((r: any) => r.result_type === 'card').slice(0, 8)
      setSearchResults(cardRows)
      setSearching(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Price lookup for a single (card_slug, holdingType) — returns USD cents
  // or null when not available. Reads from daily_prices using the column
  // mapping in src/lib/portfolioGrades.
  const fetchPrice = useCallback(async (cardSlug: string, holdingType: string): Promise<number | null> => {
    const col = HOLDING_TYPE_TO_PRICE_COLUMN[holdingType]
    if (!col) return null
    try {
      const { data: cardRow } = await supabase
        .from('cards').select('card_slug').eq('card_url_slug', cardSlug).maybeSingle()
      if (!cardRow?.card_slug) return null
      const { data: dp } = await supabase
        .from('daily_prices').select(col)
        .eq('card_slug', 'pc-' + cardRow.card_slug)
        .order('date', { ascending: false }).limit(1).maybeSingle()
      const v = dp ? (dp as any)[col] : null
      return typeof v === 'number' && v > 0 ? v : null
    } catch {
      return null
    }
  }, [])

  // Append a card to the list. Used by both scanner confirm and manual search.
  const addRow = useCallback(async (
    card: { card_url_slug: string; clean_name: string; set_name: string; card_number_display: string | null; image_url: string | null },
    holdingType: string,
    quantity: number,
  ) => {
    const market = await fetchPrice(card.card_url_slug, holdingType)
    setRows(prev => [...prev, {
      id: `${card.card_url_slug}-${holdingType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      card_slug: 'pc-' + card.card_url_slug,
      card_url_slug: card.card_url_slug,
      name: card.clean_name,
      set_name: card.set_name,
      card_number_display: card.card_number_display,
      image_url: card.image_url,
      holdingType,
      quantity: Math.max(1, quantity),
      marketCents: market,
      manualCents: null,
    }])
  }, [fetchPrice])

  // Refresh market prices for all rows.
  async function refreshAll() {
    if (rows.length === 0) return
    setRefreshing(true)
    const updated = await Promise.all(
      rows.map(async r => {
        const market = await fetchPrice(r.card_url_slug, r.holdingType)
        return { ...r, marketCents: market }
      })
    )
    setRows(updated)
    setRefreshing(false)
  }

  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
  }
  function updateRow(id: string, patch: Partial<Row>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }
  function clearAll() {
    if (!confirm('Clear the whole list?')) return
    setRows([])
  }

  // Per-row effective cents (manual override wins, else market) * qty.
  function rowValueCents(r: Row): number {
    const per = r.manualCents ?? r.marketCents ?? 0
    return per * r.quantity
  }
  const totalCents = useMemo(() => rows.reduce((s, r) => s + rowValueCents(r), 0), [rows])
  const offerCents = Math.round((totalCents * pctOfTotal) / 100)

  if (authed === null) return null   // brief blank while auth resolves
  if (authed === false) return null  // router.replace will take us away

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px 16px 60px' }}>
      <DashboardNav current="quick-price" email={email} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: 0, color: 'var(--text)' }}>Quick Price Checker</h1>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: '#1a3a6b' }}>BETA</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '4px 0 0' }}>
            Scan or search to build a list. Set a grade and quantity per card, then apply a percentage to the total. Nothing is saved — close the tab and the list goes with it.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowScanner(true)}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--primary)', background: 'transparent', color: 'var(--primary)', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            Scan / upload
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.2, padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: '#1a3a6b' }}>BETA</span>
          </button>
          <select value={currency} onChange={e => setCurrency(e.target.value as Currency)}
            style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            <option value="GBP">£ GBP</option>
            <option value="USD">$ USD</option>
          </select>
        </div>
      </div>

      {/* Manual search */}
      <div style={{ marginBottom: 18, position: 'relative' }}>
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Or type a card name e.g. Charizard Base Set..."
          style={{
            width: '100%', padding: '10px 14px', fontSize: 16, borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)',
            fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box',
          }}
        />
        {searchResults.length > 0 && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
            maxHeight: 320, overflowY: 'auto', zIndex: 50,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}>
            {searchResults.map((r, i) => (
              <div
                key={i}
                onClick={async () => {
                  await addRow(
                    { card_url_slug: r.url_slug, clean_name: r.name, set_name: r.subtitle || '', card_number_display: r.card_number_display, image_url: r.image_url },
                    'raw', 1,
                  )
                  setSearchQuery('')
                  setSearchResults([])
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: i < searchResults.length - 1 ? '1px solid var(--border)' : 'none' }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
              >
                {r.image_url
                  ? <img src={r.image_url} alt="" style={{ width: 28, height: 38, objectFit: 'contain', borderRadius: 4 }} />
                  : <div style={{ width: 28, height: 38, background: 'var(--bg-light)', borderRadius: 4 }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.name}{r.card_number_display ? ` · ${r.card_number_display}` : ''}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        {searching && <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)' }}>...</span>}
      </div>

      {/* Rows */}
      {rows.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 16, padding: '40px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚡</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 6px', color: 'var(--text)' }}>Start a list</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.55, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
            Scan a card with your phone camera, upload images on desktop, or use the search box above. Set the grade and quantity, the live market value pulls in automatically.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {rows.map(r => (
              <RowCard
                key={r.id}
                row={r}
                currency={currency}
                onChange={patch => updateRow(r.id, patch)}
                onRemove={() => removeRow(r.id)}
                onRefresh={async () => {
                  const m = await fetchPrice(r.card_url_slug, r.holdingType)
                  updateRow(r.id, { marketCents: m })
                }}
              />
            ))}
          </div>

          {/* Totals + percentage */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16,
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 12,
          }}>
            <div>
              <div style={statLabelStyle}>Cards</div>
              <div style={statValueStyle}>{rows.reduce((s, r) => s + r.quantity, 0)}</div>
              <div style={statSubStyle}>{rows.length} unique row{rows.length === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div style={statLabelStyle}>Market total</div>
              <div style={statValueStyle}>{fmt(totalCents, currency)}</div>
            </div>
            <div>
              <div style={statLabelStyle}>Percentage</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={pctOfTotal}
                  onChange={e => setPctOfTotal(Math.max(1, parseInt(e.target.value) || 0))}
                  style={{
                    width: 64, padding: '6px 10px', fontSize: 16, borderRadius: 8,
                    border: '1px solid var(--border)', background: 'var(--bg-light)', color: 'var(--text)',
                    fontFamily: "'Figtree', sans-serif", outline: 'none', fontWeight: 700,
                  }}
                />
                <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>%</span>
              </div>
              <div style={statSubStyle}>of market</div>
            </div>
            <div>
              <div style={statLabelStyle}>Offer</div>
              <div style={{ ...statValueStyle, color: 'var(--primary)' }}>{fmt(offerCents, currency)}</div>
              <div style={statSubStyle}>at {pctOfTotal}%</div>
            </div>
          </div>

          {/* Action row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              onClick={refreshAll}
              disabled={refreshing}
              style={{
                padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--card)', color: 'var(--text)',
                fontFamily: "'Figtree', sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer',
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              {refreshing ? 'Refreshing...' : 'Refresh all prices'}
            </button>
            <button onClick={clearAll}
              style={{
                padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.3)',
                background: 'rgba(239,68,68,0.06)', color: '#ef4444',
                fontFamily: "'Figtree', sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>
              Clear list
            </button>
          </div>
        </>
      )}

      {/* Scanner modal */}
      {showScanner && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
             onClick={e => e.target === e.currentTarget && setShowScanner(false)}>
          <div style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
            <CardScanner
              showGradeSelector
              onCardConfirmed={async (card: ConfirmedCard, ctx: ConfirmContext) => {
                await addRow(
                  {
                    card_url_slug: card.card_url_slug,
                    clean_name: card.clean_name,
                    set_name: card.set_name,
                    card_number_display: card.card_number_display,
                    image_url: card.image_url,
                  },
                  ctx.holdingType || 'raw',
                  ctx.quantity   || 1,
                )
              }}
              onClose={() => setShowScanner(false)}
              ctaLabel="Add to list"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Row component ──────────────────────────────────────────────────────────

function RowCard({
  row, currency, onChange, onRemove, onRefresh,
}: {
  row: Row
  currency: Currency
  onChange: (patch: Partial<Row>) => void
  onRemove: () => void
  onRefresh: () => void | Promise<void>
}) {
  const [manualInput, setManualInput] = useState<string>('')
  const companies = Array.from(new Set(HOLDING_TYPES.map(t => t.company)))
  const cardHref = `/set/${encodeURIComponent(row.set_name)}/card/${row.card_url_slug}`
  const effective = row.manualCents ?? row.marketCents
  const isMan = isManualGrade(row.holdingType)

  // When the grade changes, refresh the price for the new grade.
  async function handleGradeChange(v: string) {
    onChange({ holdingType: v, manualCents: null })
    setManualInput('')
    // Trigger refresh — fire-and-forget; the parent updates state.
    await onRefresh()
  }

  function commitManual() {
    if (!manualInput.trim()) {
      onChange({ manualCents: null })
      return
    }
    const cents = parseManualToUsdCents(manualInput, currency)
    onChange({ manualCents: cents })
  }

  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 12,
      display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap',
    }}>
      <Link href={cardHref} target="_blank" rel="noopener" style={{ flexShrink: 0 }}>
        {row.image_url
          ? <img src={row.image_url} alt={row.name} style={{ width: 44, borderRadius: 6, display: 'block' }} />
          : <div style={{ width: 44, height: 60, background: 'var(--bg-light)', borderRadius: 6 }} />}
      </Link>

      <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Link href={cardHref} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
            {row.name}
          </div>
        </Link>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          {row.set_name}{row.card_number_display ? ` · ${row.card_number_display}` : ''}
        </div>
        {/* Controls */}
        <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={row.holdingType}
            onChange={e => handleGradeChange(e.target.value)}
            style={rowSelectStyle}
            title={GRADE_LABELS[row.holdingType]}
          >
            {companies.map(company => (
              <optgroup key={company} label={company}>
                {HOLDING_TYPES.filter(t => t.company === company).map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={row.quantity}
            onChange={e => onChange({ quantity: Math.max(1, parseInt(e.target.value) || 1) })}
            style={{ ...rowSelectStyle, width: 60 }}
            title="Quantity"
          />
          <input
            type="text"
            placeholder={`Manual ${currency === 'GBP' ? '£' : '$'}`}
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onBlur={commitManual}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ ...rowSelectStyle, width: 96 }}
            title="Override the market value for this row"
          />
        </div>
        {isMan && row.manualCents == null && (
          <div style={{ fontSize: 10, color: '#b8741f', fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>
            ⚠ No live market data for this grade — enter a manual value.
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 100 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
          {fmt(effective ? effective * row.quantity : null, currency)}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          {row.quantity > 1 ? `${fmt(effective, currency)} × ${row.quantity}` : (row.manualCents != null ? 'manual' : 'market')}
        </div>
        <button
          onClick={onRemove}
          aria-label="Remove from list"
          title="Remove from list"
          style={{
            marginTop: 6,
            padding: '4px 10px', borderRadius: 8,
            border: '1px solid rgba(239,68,68,0.25)',
            background: 'rgba(239,68,68,0.06)',
            color: '#ef4444', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
          }}
        >
          Remove
        </button>
      </div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────

const rowSelectStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg-light)', color: 'var(--text)',
  fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none',
  boxSizing: 'border-box',
}

const statLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1.0, textTransform: 'uppercase',
  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4,
}

const statValueStyle: React.CSSProperties = {
  fontSize: 22, fontWeight: 800, color: 'var(--text)', fontFamily: "'Outfit', sans-serif",
}

const statSubStyle: React.CSSProperties = {
  fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2,
}
