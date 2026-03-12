'use client'
import { useState, useEffect, useRef } from 'react'
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
  customPct: number | null
}

interface HotMover {
  card_name: string
  set_name: string
  current_raw: number
  raw_pct_30d: number
  card_url_slug?: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const USD_TO_GBP = 0.79

function gbp(usd: number) { return usd * USD_TO_GBP }
function fmt(v: number) { return `£${v.toFixed(2)}` }

function offerVal(marketUsd: number, pct: number) {
  return gbp(marketUsd) * (pct / 100)
}

// ── Search Box ───────────────────────────────────────────────────────────────

function SearchBox({ placeholder, onAdd }: { placeholder: string; onAdd: (card: DealCard) => void }) {
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
    onAdd({ id: `${r.url_slug}-${Date.now()}`, name: r.name, set: r.subtitle, image: r.image_url, marketUsd: r.price_usd, customPct: null })
    setQuery(''); setResults([]); setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-muted)', pointerEvents: 'none' }}>🔍</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '9px 12px 9px 36px',
            color: 'var(--text)', fontSize: 13,
            fontFamily: "'Figtree', sans-serif", outline: 'none',
          }}
          onFocus={e => e.currentTarget.style.borderColor = 'var(--primary)'}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
        {loading && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 11 }}>...</span>}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}>
          {results.map(r => (
            <div key={r.url_slug} onMouseDown={() => handleAdd(r)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-light)', transition: 'background 0.1s' }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
            >
              {r.image_url
                ? <img src={r.image_url} alt={r.name} style={{ width: 26, height: 36, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                : <div style={{ width: 26, height: 36, background: 'var(--bg)', borderRadius: 3, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}{r.card_number_display ? ` · ${r.card_number_display}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmt(gbp(r.price_usd!))}</div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700, fontFamily: "'Figtree', sans-serif" }}>+ ADD</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Card Row ─────────────────────────────────────────────────────────────────

function CardRow({ card, pct, label, color, onRemove, onOverride }: {
  card: DealCard; pct: number; label: string; color: string
  onRemove: () => void; onOverride: (pct: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [inputVal, setInputVal] = useState('')
  const effectivePct = card.customPct ?? pct
  const offer = offerVal(card.marketUsd, effectivePct)
  const market = gbp(card.marketUsd)

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '40px 1fr auto auto auto',
      gap: 10, alignItems: 'center',
      padding: '10px 12px', background: 'var(--bg-light)',
      borderRadius: 10, border: '1px solid var(--border-light)', marginBottom: 6,
    }}>
      {card.image
        ? <img src={card.image} alt={card.name} style={{ width: 40, height: 55, objectFit: 'contain', borderRadius: 4 }} />
        : <div style={{ width: 40, height: 55, background: 'var(--bg)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🃏</div>}

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{card.set}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Market: {fmt(market)}</div>
      </div>

      {/* % override */}
      <div style={{ textAlign: 'center' }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input autoFocus type="number" min={10} max={100} value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onBlur={() => {
                const v = parseInt(inputVal)
                onOverride(!isNaN(v) && v >= 10 && v <= 100 ? v : null)
                setEditing(false)
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              style={{ width: 44, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12, padding: '3px 5px', fontFamily: "'Figtree', sans-serif" }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>%</span>
          </div>
        ) : (
          <button onClick={() => { setInputVal(String(card.customPct ?? pct)); setEditing(true) }}
            style={{
              background: card.customPct != null ? 'rgba(245,158,11,0.12)' : 'var(--bg)',
              border: `1px solid ${card.customPct != null ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`,
              borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
              fontSize: 12, fontWeight: 700,
              color: card.customPct != null ? '#d97706' : 'var(--text-muted)',
              fontFamily: "'Figtree', sans-serif",
            }}>
            {effectivePct}%
          </button>
        )}
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2, fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {card.customPct != null ? 'custom' : 'global'}
        </div>
      </div>

      {/* Offer */}
      <div style={{ textAlign: 'right', minWidth: 70 }}>
        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 800, color, fontFamily: "'Figtree', sans-serif" }}>{fmt(offer)}</div>
      </div>

      <button onClick={onRemove}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, padding: 4, borderRadius: 4, lineHeight: 1 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
      >×</button>
    </div>
  )
}

// ── Column ───────────────────────────────────────────────────────────────────

function DealColumn({ title, emoji, description, cards, pct, pctLabel, offerLabel, offerColor, cashAmount, showCash,
  onAdd, onRemove, onOverride, onCashChange, accentColor, emptyHint,
}: {
  title: string; emoji: string; description: string
  cards: DealCard[]; pct: number; pctLabel: string
  offerLabel: string; offerColor: string
  cashAmount: string; showCash: boolean
  onAdd: (c: DealCard) => void; onRemove: (id: string) => void
  onOverride: (id: string, pct: number | null) => void
  onCashChange: (v: string) => void
  accentColor: string; emptyHint: string
}) {
  const totalMarket = cards.reduce((s, c) => s + gbp(c.marketUsd), 0)
  const totalOffer = cards.reduce((s, c) => s + offerVal(c.marketUsd, c.customPct ?? pct), 0)
  const cashVal = parseFloat(cashAmount) || 0
  const grandTotal = totalOffer + (showCash ? cashVal : 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Column header */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '16px 18px',
        borderTop: `3px solid ${accentColor}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>{emoji}</span>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{title}</h2>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{description}</p>
      </div>

      {/* Search */}
      <SearchBox placeholder={`Search card to add...`} onAdd={onAdd} />

      {/* Cards */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 14px 10px' }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>
          Cards {cards.length > 0 && <span style={{ color: accentColor }}>({cards.length})</span>}
        </div>

        {cards.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', border: '2px dashed var(--border)', borderRadius: 10 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🃏</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{emptyHint}</div>
          </div>
        ) : (
          cards.map(c => (
            <CardRow key={c.id} card={c} pct={pct} label={offerLabel} color={offerColor}
              onRemove={() => onRemove(c.id)}
              onOverride={(p) => onOverride(c.id, p)}
            />
          ))
        )}

        {/* Cash row */}
        {showCash && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: 'var(--bg-light)', borderRadius: 10, border: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", fontWeight: 700, flexShrink: 0 }}>💵 Cash</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              <span style={{ fontSize: 14, color: 'var(--text-muted)', fontWeight: 700 }}>£</span>
              <input type="number" min={0} step={0.01} value={cashAmount} onChange={e => onCashChange(e.target.value)} placeholder="0.00"
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text)', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", outline: 'none' }}
              />
            </div>
            {cashVal > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>{fmt(cashVal)}</span>}
          </div>
        )}

        {/* Column totals */}
        {(cards.length > 0 || (showCash && cashVal > 0)) && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--bg)', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
                {pctLabel} · {cards.length > 0 ? `market ${fmt(totalMarket)}` : ''}
              </div>
              {showCash && cashVal > 0 && cards.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 2 }}>
                  {fmt(totalOffer)} cards + {fmt(cashVal)} cash
                </div>
              )}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: accentColor, fontFamily: "'Figtree', sans-serif" }}>
              {fmt(grandTotal)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Hot Movers ───────────────────────────────────────────────────────────────

function HotMovers() {
  const [risers, setRisers] = useState<HotMover[]>([])
  const [fallers, setFallers] = useState<HotMover[]>([])
  const [tab, setTab] = useState<'risers' | 'fallers'>('risers')

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('card_trends')
        .select('card_name, set_name, current_raw, raw_pct_30d')
        .not('raw_pct_30d', 'is', null).gt('current_raw', 500)
        .order('raw_pct_30d', { ascending: false }).limit(200)
      if (!data) return
      const reliable = data.filter((d: any) => Math.abs(d.raw_pct_30d) <= 300)
      setRisers(reliable.filter((d: any) => d.raw_pct_30d > 0).slice(0, 10))
      setFallers(reliable.filter((d: any) => d.raw_pct_30d < 0).sort((a: any, b: any) => a.raw_pct_30d - b.raw_pct_30d).slice(0, 10))
    }
    load()
  }, [])

  const rows = tab === 'risers' ? risers : fallers

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
        {(['risers', 'fallers'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
            background: tab === t ? 'var(--bg-light)' : 'transparent',
            color: tab === t ? (t === 'risers' ? '#16a34a' : '#dc2626') : 'var(--text-muted)',
            borderBottom: tab === t ? `2px solid ${t === 'risers' ? '#16a34a' : '#dc2626'}` : '2px solid transparent',
            fontFamily: "'Figtree', sans-serif",
          }}>
            {t === 'risers' ? '📈 Risers' : '📉 Fallers'}
          </button>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ width: 16, textAlign: 'right', fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.card_name}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.set_name}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmt(gbp(r.current_raw / 100))}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: r.raw_pct_30d > 0 ? '#16a34a' : '#dc2626', fontFamily: "'Figtree', sans-serif" }}>
              {r.raw_pct_30d > 0 ? '+' : ''}{r.raw_pct_30d.toFixed(1)}%
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function DealerPageClient() {
  const [cashPct, setCashPct] = useState(55)
  const [tradePct, setTradePct] = useState(70)

  // Dealer side — what the dealer is selling / the item being negotiated over
  const [dealerCards, setDealerCards] = useState<DealCard[]>([])

  // Customer side — what the customer is offering (cards + optional cash)
  const [customerCards, setCustomerCards] = useState<DealCard[]>([])
  const [customerCash, setCustomerCash] = useState('')

  // Totals
  const dealerTotal = dealerCards.reduce((s, c) => s + gbp(c.marketUsd), 0)  // market value (asking)
  const customerCardsOffer = customerCards.reduce((s, c) => s + offerVal(c.marketUsd, c.customPct ?? tradePct), 0)
  const cashVal = parseFloat(customerCash) || 0
  const customerTotal = customerCardsOffer + cashVal

  const diff = customerTotal - dealerTotal
  const diffPct = dealerTotal > 0 ? ((customerTotal / dealerTotal) * 100).toFixed(1) : null

  const verdict = diff > 2 ? 'up' : diff < -2 ? 'down' : 'even'
  const verdictColor = verdict === 'up' ? '#16a34a' : verdict === 'down' ? '#dc2626' : '#d97706'
  const verdictText = verdict === 'up'
    ? `You're up ${fmt(diff)} on this deal`
    : verdict === 'down'
    ? `You're short ${fmt(Math.abs(diff))} on this deal`
    : `Deal is roughly even`

  function removeDealer(id: string) { setDealerCards(p => p.filter(c => c.id !== id)) }
  function removeCustomer(id: string) { setCustomerCards(p => p.filter(c => c.id !== id)) }
  function overrideDealer(id: string, pct: number | null) { setDealerCards(p => p.map(c => c.id === id ? { ...c, customPct: pct } : c)) }
  function overrideCustomer(id: string, pct: number | null) { setCustomerCards(p => p.map(c => c.id === id ? { ...c, customPct: pct } : c)) }

  const hasAnything = dealerCards.length > 0 || customerCards.length > 0 || cashVal > 0

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
          🏪 Dealer Tools · PokePrices
        </div>
        <h1 style={{ margin: '0 0 6px', fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 700, color: 'var(--text)' }}>
          Deal Builder
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
          Build both sides of a deal. See instantly whether you're up, down or even at your rates.
        </p>
      </div>

      {/* ── Rate controls ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 22px', marginBottom: 24 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 14 }}>
          Your Rates
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {[
            { label: 'Cash offer %', value: cashPct, set: setCashPct, color: '#16a34a', hint: 'You pay cash' },
            { label: 'Trade / credit %', value: tradePct, set: setTradePct, color: 'var(--primary)', hint: 'Store credit or trade' },
          ].map(r => (
            <div key={r.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.label}</span>
                <span style={{ fontSize: 26, fontWeight: 900, color: r.color, fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{r.value}%</span>
              </div>
              <input type="range" min={30} max={95} value={r.value} onChange={e => r.set(Number(e.target.value))}
                style={{ width: '100%', accentColor: r.color, cursor: 'pointer' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginTop: 4 }}>{r.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Two column deal ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <DealColumn
          title="Your Side"
          emoji="🏪"
          description="Cards or items you're selling / trading away"
          cards={dealerCards}
          pct={tradePct}
          pctLabel="Market ask"
          offerLabel="Market"
          offerColor="var(--text)"
          cashAmount=""
          showCash={false}
          onAdd={c => setDealerCards(p => [...p, c])}
          onRemove={removeDealer}
          onOverride={overrideDealer}
          onCashChange={() => {}}
          accentColor="var(--primary)"
          emptyHint="Add what you're selling or trading away"
        />

        <DealColumn
          title="Customer's Offer"
          emoji="🤝"
          description="What the customer is putting on the table"
          cards={customerCards}
          pct={tradePct}
          pctLabel={`Trade rate (${tradePct}%)`}
          offerLabel="Your offer"
          offerColor="var(--primary)"
          cashAmount={customerCash}
          showCash={true}
          onAdd={c => setCustomerCards(p => [...p, c])}
          onRemove={removeCustomer}
          onOverride={overrideCustomer}
          onCashChange={setCustomerCash}
          accentColor="#16a34a"
          emptyHint="Add their cards, then add any cash they're putting in"
        />
      </div>

      {/* ── Deal verdict ── */}
      {hasAnything && (
        <div style={{
          background: 'var(--card)', border: `1px solid var(--border)`,
          borderRadius: 16, padding: '20px 24px', marginBottom: 24,
          borderLeft: `4px solid ${verdictColor}`,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: 16, alignItems: 'center' }}>
            {/* Dealer total */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>Your side (market)</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{fmt(dealerTotal)}</div>
            </div>

            {/* VS */}
            <div style={{ textAlign: 'center', padding: '0 8px' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>vs</div>
            </div>

            {/* Customer total */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
                Customer's offer {diffPct && <span style={{ color: verdictColor }}>({diffPct}%)</span>}
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: verdictColor, fontFamily: "'Figtree', sans-serif", lineHeight: 1 }}>{fmt(customerTotal)}</div>
            </div>

            {/* Verdict */}
            <div style={{ textAlign: 'right', background: 'var(--bg-light)', borderRadius: 12, padding: '12px 18px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: verdictColor, fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                {verdict === 'up' ? '✅ Good deal' : verdict === 'down' ? '❌ Short' : '⚖️ Even'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{verdictText}</div>
            </div>
          </div>

          {/* Progress bar */}
          {diffPct && (
            <div style={{ marginTop: 14 }}>
              <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3, transition: 'width 0.3s ease',
                  width: `${Math.min(100, parseFloat(diffPct))}%`,
                  background: verdict === 'up' ? '#16a34a' : verdict === 'down' ? '#dc2626' : '#d97706',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>0%</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>100% of ask</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Bottom: rate ref + hot movers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>

        {/* Rate quick ref */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px 18px', alignSelf: 'start' }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 12 }}>
            Rate Quick Ref
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '6px 16px', alignItems: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}></div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>Cash</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>Trade</div>
            {[100, 50, 20, 10, 5].map(v => (
              <>
                <div key={`l${v}`} style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>£{v} card</div>
                <div key={`c${v}`} style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>£{(v * cashPct / 100).toFixed(0)}</div>
                <div key={`t${v}`} style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>£{(v * tradePct / 100).toFixed(0)}</div>
              </>
            ))}
          </div>
        </div>

        {/* Hot movers */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.8, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>
            Market Movers — 30d
          </div>
          <HotMovers />
        </div>
      </div>
    </div>
  )
}
