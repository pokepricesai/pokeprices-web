'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  result_type: string
  name: string
  subtitle: string
  card_number_display: string | null
  price_usd: number | null
  image_url: string | null
  url_slug: string
}

interface DealCard {
  id: string
  name: string
  set: string
  image: string | null
  marketUsd: number
  customPct: number | null // null = use global
}

interface HotMover {
  card_name: string
  set_name: string
  current_raw: number
  raw_pct_30d: number
  card_url_slug: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const USD_TO_GBP = 0.79

function usdToGbp(usd: number) { return usd * USD_TO_GBP }
function fmt(gbp: number) { return `£${gbp.toFixed(2)}` }
function fmtUsd(usd: number) { return `$${usd.toFixed(2)}` }

function offerValue(marketUsd: number, pct: number) {
  return usdToGbp(marketUsd) * (pct / 100)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RateSlider({
  label, value, onChange, color,
}: { label: string; value: number; onChange: (v: number) => void; color: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#94a3b8', fontFamily: 'DM Mono, monospace' }}>{label}</span>
        <span style={{ fontSize: 20, fontWeight: 900, color, fontFamily: 'DM Mono, monospace', lineHeight: 1 }}>{value}%</span>
      </div>
      <input
        type="range" min={30} max={95} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: color, cursor: 'pointer', height: 4 }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        <span style={{ fontSize: 10, color: '#475569', fontFamily: 'DM Mono, monospace' }}>30%</span>
        <span style={{ fontSize: 10, color: '#475569', fontFamily: 'DM Mono, monospace' }}>95%</span>
      </div>
    </div>
  )
}

function CardRow({
  card, cashPct, tradePct,
  onRemove, onOverride,
}: {
  card: DealCard
  cashPct: number
  tradePct: number
  onRemove: () => void
  onOverride: (pct: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const effectivePct = card.customPct ?? tradePct
  const cashOffer = offerValue(card.marketUsd, card.customPct ?? cashPct)
  const tradeOffer = offerValue(card.marketUsd, effectivePct)
  const market = usdToGbp(card.marketUsd)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '36px 1fr auto auto auto',
      gap: 10,
      alignItems: 'center',
      padding: '10px 14px',
      background: 'rgba(255,255,255,0.02)',
      borderRadius: 10,
      border: '1px solid rgba(255,255,255,0.06)',
      marginBottom: 6,
    }}>
      {/* Image */}
      {card.image
        ? <img src={card.image} alt={card.name} style={{ width: 36, height: 50, objectFit: 'contain', borderRadius: 4 }} />
        : <div style={{ width: 36, height: 50, background: '#1e293b', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🃏</div>
      }

      {/* Name + set */}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</div>
        <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'DM Mono, monospace', marginTop: 1 }}>{card.set}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'DM Mono, monospace' }}>Market: {fmt(market)}</div>
      </div>

      {/* Per-card % override */}
      <div style={{ textAlign: 'center' }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              type="number" min={10} max={100}
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onBlur={() => {
                const v = parseInt(inputVal)
                if (!isNaN(v) && v >= 10 && v <= 100) onOverride(v)
                else onOverride(null)
                setEditing(false)
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              style={{ width: 48, background: '#1e293b', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', fontSize: 13, padding: '3px 6px', fontFamily: 'DM Mono, monospace' }}
            />
            <span style={{ color: '#64748b', fontSize: 12 }}>%</span>
          </div>
        ) : (
          <button
            onClick={() => { setInputVal(String(card.customPct ?? tradePct)); setEditing(true) }}
            style={{
              background: card.customPct != null ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${card.customPct != null ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
              color: card.customPct != null ? '#fbbf24' : '#94a3b8',
              fontFamily: 'DM Mono, monospace',
            }}
          >
            {card.customPct != null ? `${card.customPct}%` : `${tradePct}%`}
          </button>
        )}
        <div style={{ fontSize: 9, color: '#475569', marginTop: 2, fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {card.customPct != null ? 'custom' : 'global'}
        </div>
      </div>

      {/* Cash / Trade offers */}
      <div style={{ textAlign: 'right', minWidth: 80 }}>
        <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Cash / Trade</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#34d399', fontFamily: 'DM Mono, monospace' }}>{fmt(cashOffer)}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#60a5fa', fontFamily: 'DM Mono, monospace' }}>{fmt(tradeOffer)}</div>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', fontSize: 16, padding: 4, borderRadius: 4, lineHeight: 1 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
        onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
      >×</button>
    </div>
  )
}

function SearchBox({ onAdd }: { onAdd: (card: DealCard) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults([]); setOpen(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.rpc('search_global', { query })
      const cards = (data || []).filter((r: SearchResult) => r.result_type === 'card' && r.price_usd)
      setResults(cards.slice(0, 8))
      setOpen(cards.length > 0)
      setLoading(false)
    }, 250)
  }, [query])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleAdd(r: SearchResult) {
    if (!r.price_usd) return
    onAdd({
      id: `${r.url_slug}-${Date.now()}`,
      name: r.name,
      set: r.subtitle,
      image: r.image_url,
      marketUsd: r.price_usd,
      customPct: null,
    })
    setQuery('')
    setResults([])
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: '#475569', pointerEvents: 'none' }}>🔍</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search card to add to deal..."
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12, padding: '12px 16px 12px 42px',
            color: '#f1f5f9', fontSize: 14,
            fontFamily: "'Outfit', sans-serif",
            outline: 'none', transition: 'border-color 0.2s',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'rgba(99,102,241,0.5)'; if (results.length) setOpen(true) }}
          onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'}
        />
        {loading && <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569', fontSize: 12, fontFamily: 'DM Mono, monospace' }}>...</span>}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 100,
          background: '#0f1729', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}>
          {results.map(r => (
            <div
              key={r.url_slug}
              onMouseDown={() => handleAdd(r)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'rgba(99,102,241,0.1)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              {r.image_url
                ? <img src={r.image_url} alt={r.name} style={{ width: 28, height: 39, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                : <div style={{ width: 28, height: 39, background: '#1e293b', borderRadius: 3, flexShrink: 0 }} />
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'DM Mono, monospace' }}>{r.subtitle}{r.card_number_display ? ` · ${r.card_number_display}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', fontFamily: 'DM Mono, monospace' }}>{fmt(usdToGbp(r.price_usd!))}</div>
                <div style={{ fontSize: 10, color: '#475569', fontFamily: 'DM Mono, monospace' }}>{fmtUsd(r.price_usd!)}</div>
              </div>
              <div style={{ fontSize: 11, color: '#6366f1', fontWeight: 700, fontFamily: 'DM Mono, monospace', marginLeft: 4 }}>+ ADD</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HotMoversPanel() {
  const [risers, setRisers] = useState<HotMover[]>([])
  const [fallers, setFallers] = useState<HotMover[]>([])
  const [tab, setTab] = useState<'risers' | 'fallers'>('risers')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('card_trends')
        .select('card_name, set_name, current_raw, raw_pct_30d, card_slug')
        .not('raw_pct_30d', 'is', null)
        .gt('current_raw', 500)
        .order('raw_pct_30d', { ascending: false })
        .limit(200)
      if (!data) return
      const reliable = data.filter((d: any) => Math.abs(d.raw_pct_30d) <= 300)
      setRisers(reliable.filter((d: any) => d.raw_pct_30d > 0).slice(0, 10))
      setFallers(reliable.filter((d: any) => d.raw_pct_30d < 0).sort((a: any, b: any) => a.raw_pct_30d - b.raw_pct_30d).slice(0, 10))
    }
    load()
  }, [])

  const rows = tab === 'risers' ? risers : fallers

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {(['risers', 'fallers'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '12px', border: 'none', cursor: 'pointer', fontFamily: 'DM Mono, monospace',
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
            background: tab === t ? 'rgba(255,255,255,0.05)' : 'transparent',
            color: tab === t ? (t === 'risers' ? '#34d399' : '#f87171') : '#475569',
            borderBottom: tab === t ? `2px solid ${t === 'risers' ? '#34d399' : '#f87171'}` : '2px solid transparent',
            transition: 'all 0.15s',
          }}>
            {t === 'risers' ? '📈 Risers' : '📉 Fallers'}
          </button>
        ))}
      </div>
      <div style={{ padding: '8px 0' }}>
        {rows.map((r, i) => {
          const isUp = r.raw_pct_30d > 0
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
              <div style={{ width: 20, textAlign: 'right', fontSize: 11, color: '#334155', fontFamily: 'DM Mono, monospace', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', fontFamily: "'Outfit', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.card_name}</div>
                <div style={{ fontSize: 10, color: '#475569', fontFamily: 'DM Mono, monospace' }}>{r.set_name}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', fontFamily: 'DM Mono, monospace' }}>{fmt(usdToGbp(r.current_raw / 100))}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: isUp ? '#34d399' : '#f87171', fontFamily: 'DM Mono, monospace' }}>
                  {isUp ? '+' : ''}{r.raw_pct_30d.toFixed(1)}%
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function DealerPage() {
  const [cashPct, setCashPct] = useState(55)
  const [tradePct, setTradePct] = useState(70)
  const [cards, setCards] = useState<DealCard[]>([])
  const [customerCash, setCustomerCash] = useState('')
  const [dealMode, setDealMode] = useState<'buying' | 'appraising'>('buying')

  // Totals
  const totalMarketGbp = cards.reduce((s, c) => s + usdToGbp(c.marketUsd), 0)
  const totalCashOffer = cards.reduce((s, c) => s + offerValue(c.marketUsd, c.customPct ?? cashPct), 0)
  const totalTradeOffer = cards.reduce((s, c) => s + offerValue(c.marketUsd, c.customPct ?? tradePct), 0)
  const cashIn = parseFloat(customerCash) || 0
  const effectiveDealValue = totalTradeOffer + cashIn

  // Blended %
  const blendedPct = totalMarketGbp > 0
    ? ((effectiveDealValue / totalMarketGbp) * 100).toFixed(1)
    : null

  function addCard(card: DealCard) {
    setCards(prev => [...prev, card])
  }

  function removeCard(id: string) {
    setCards(prev => prev.filter(c => c.id !== id))
  }

  function overrideCard(id: string, pct: number | null) {
    setCards(prev => prev.map(c => c.id === id ? { ...c, customPct: pct } : c))
  }

  function clearDeal() {
    setCards([])
    setCustomerCash('')
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#080e1a',
      color: '#f1f5f9',
      fontFamily: "'Outfit', sans-serif",
    }}>
      {/* ── Header ── */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '16px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.01)',
        backdropFilter: 'blur(12px)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 22 }}>🏪</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.3px', color: '#f1f5f9' }}>Dealer Dashboard</div>
            <div style={{ fontSize: 11, color: '#475569', fontFamily: 'DM Mono, monospace', letterSpacing: 0.5 }}>POKEPRICES · TRADE TOOLS</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['buying', 'appraising'] as const).map(m => (
            <button key={m} onClick={() => setDealMode(m)} style={{
              padding: '7px 16px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, textTransform: 'capitalize', letterSpacing: 0.3,
              fontFamily: 'DM Mono, monospace',
              background: dealMode === m ? '#6366f1' : 'rgba(255,255,255,0.05)',
              color: dealMode === m ? '#fff' : '#64748b',
              transition: 'all 0.15s',
            }}>{m === 'buying' ? '💰 Deal Builder' : '📋 Appraisal'}</button>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '28px 32px', display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>

        {/* ── LEFT: Deal Builder ── */}
        <div>

          {/* Rate controls */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, padding: '20px 24px',
            marginBottom: 20,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: '#475569', fontFamily: 'DM Mono, monospace', marginBottom: 18 }}>Your Rates</div>
            <div style={{ display: 'flex', gap: 32 }}>
              <RateSlider label="Cash %" value={cashPct} onChange={setCashPct} color="#34d399" />
              <RateSlider label="Trade %" value={tradePct} onChange={setTradePct} color="#60a5fa" />
            </div>
            <p style={{ fontSize: 11, color: '#334155', fontFamily: 'DM Mono, monospace', margin: '14px 0 0', lineHeight: 1.5 }}>
              Cash: you pay in cash · Trade: customer gets store credit or trades into stock · Override per card using the % badge
            </p>
          </div>

          {/* Search */}
          <div style={{ marginBottom: 16 }}>
            <SearchBox onAdd={addCard} />
          </div>

          {/* Cards in deal */}
          {cards.length === 0 ? (
            <div style={{
              background: 'rgba(255,255,255,0.01)', border: '2px dashed rgba(255,255,255,0.06)',
              borderRadius: 14, padding: '48px 24px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🃏</div>
              <div style={{ fontSize: 14, color: '#475569', fontFamily: 'DM Mono, monospace' }}>Search above to add cards to the deal</div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: '#475569', fontFamily: 'DM Mono, monospace' }}>
                  Customer's Cards ({cards.length})
                </div>
                <button onClick={clearDeal} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#475569', fontFamily: 'DM Mono, monospace', textDecoration: 'underline' }}>
                  Clear all
                </button>
              </div>
              {cards.map(c => (
                <CardRow
                  key={c.id} card={c} cashPct={cashPct} tradePct={tradePct}
                  onRemove={() => removeCard(c.id)}
                  onOverride={(pct) => overrideCard(c.id, pct)}
                />
              ))}
            </div>
          )}

          {/* Customer cash contribution */}
          {cards.length > 0 && (
            <div style={{
              marginTop: 16,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 12, padding: '16px 18px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: '#475569', fontFamily: 'DM Mono, monospace', marginBottom: 10 }}>
                Customer also offers cash
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20, color: '#64748b', fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>£</span>
                <input
                  type="number" min={0} step={0.01}
                  value={customerCash}
                  onChange={e => setCustomerCash(e.target.value)}
                  placeholder="0.00"
                  style={{
                    width: 120, background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8, padding: '8px 12px',
                    color: '#f1f5f9', fontSize: 16, fontWeight: 700,
                    fontFamily: 'DM Mono, monospace', outline: 'none',
                  }}
                />
                {cashIn > 0 && (
                  <span style={{ fontSize: 13, color: '#34d399', fontFamily: 'DM Mono, monospace', fontWeight: 700 }}>
                    + £{cashIn.toFixed(2)} cash added to deal
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Deal summary */}
          {cards.length > 0 && (
            <div style={{
              marginTop: 16,
              background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(59,130,246,0.08))',
              border: '1px solid rgba(99,102,241,0.25)',
              borderRadius: 14, padding: '20px 24px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: '#6366f1', fontFamily: 'DM Mono, monospace', marginBottom: 16 }}>
                Deal Summary
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
                {[
                  { label: 'Market Value', val: fmt(totalMarketGbp), sub: 'raw prices', color: '#94a3b8' },
                  { label: `Cash Offer (${cashPct}%)`, val: fmt(totalCashOffer), sub: 'you pay cash', color: '#34d399' },
                  { label: `Trade Offer (${tradePct}%)`, val: fmt(totalTradeOffer), sub: 'store credit', color: '#60a5fa' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: '12px 14px' }}>
                    <div style={{ fontSize: 10, color: '#475569', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: s.color, fontFamily: 'DM Mono, monospace', lineHeight: 1 }}>{s.val}</div>
                    <div style={{ fontSize: 10, color: '#334155', fontFamily: 'DM Mono, monospace', marginTop: 3 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Blended deal with cash */}
              {cashIn > 0 && (
                <div style={{
                  background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
                  borderRadius: 10, padding: '12px 16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#92400e', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>Blended Deal (cards + £{cashIn.toFixed(2)} cash)</div>
                    <div style={{ fontSize: 11, color: '#78716c', fontFamily: 'DM Mono, monospace' }}>
                      {fmt(totalTradeOffer)} trade value + £{cashIn.toFixed(2)} cash = effective {blendedPct}% of market
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 28, fontWeight: 900, color: '#fbbf24', fontFamily: 'DM Mono, monospace', lineHeight: 1 }}>{fmt(effectiveDealValue)}</div>
                    <div style={{ fontSize: 11, color: '#92400e', fontFamily: 'DM Mono, monospace' }}>total deal value</div>
                  </div>
                </div>
              )}

              {/* Effective % indicator */}
              {blendedPct && (
                <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 3,
                      width: `${Math.min(100, parseFloat(blendedPct))}%`,
                      background: parseFloat(blendedPct) > tradePct
                        ? 'linear-gradient(90deg, #34d399, #60a5fa)'
                        : parseFloat(blendedPct) > cashPct
                          ? 'linear-gradient(90deg, #fbbf24, #34d399)'
                          : '#f87171',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#94a3b8', flexShrink: 0 }}>
                    Effective: {blendedPct}% of market
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Market Intel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Quick reference */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14, padding: '18px 20px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: '#475569', fontFamily: 'DM Mono, monospace', marginBottom: 14 }}>
              Rate Quick Ref
            </div>
            {[
              { market: 100, label: '£100 card' },
              { market: 50, label: '£50 card' },
              { market: 20, label: '£20 card' },
              { market: 10, label: '£10 card' },
            ].map(r => (
              <div key={r.market} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'DM Mono, monospace' }}>{r.label}</span>
                <div style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#34d399', fontFamily: 'DM Mono, monospace' }}>£{(r.market * cashPct / 100).toFixed(0)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', fontFamily: 'DM Mono, monospace' }}>£{(r.market * tradePct / 100).toFixed(0)}</span>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
              <span style={{ fontSize: 10, color: '#34d399', fontFamily: 'DM Mono, monospace' }}>● cash</span>
              <span style={{ fontSize: 10, color: '#60a5fa', fontFamily: 'DM Mono, monospace' }}>● trade</span>
            </div>
          </div>

          {/* Hot movers */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 2, color: '#475569', fontFamily: 'DM Mono, monospace', marginBottom: 10 }}>
              Market Movers — 30d
            </div>
            <HotMoversPanel />
          </div>

          {/* Tips */}
          <div style={{
            background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
            borderRadius: 12, padding: '14px 16px',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.5, color: '#6366f1', fontFamily: 'DM Mono, monospace', marginBottom: 10 }}>Tips</div>
            {[
              'Yellow % badge = custom override. Click to edit or reset.',
              'Cash in = face value. It blends with card offer to show effective %.',
              'Rising cards = worth buying into stock. Falling = be cautious.',
              'PSA 10 pop counts on each card page — low pop = better grading ROI.',
            ].map((tip, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 7 }}>
                <span style={{ color: '#6366f1', fontFamily: 'DM Mono, monospace', fontSize: 11, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ fontSize: 11, color: '#475569', fontFamily: 'DM Mono, monospace', lineHeight: 1.5 }}>{tip}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
