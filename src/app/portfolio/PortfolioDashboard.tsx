'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortfolioItem {
  id: string
  card_slug: string
  card_name: string
  set_name: string
  image_url: string | null
  quantity: number
  holding_type: string
  purchase_price_cents: number | null
  purchase_currency: string | null
  purchase_date: string | null
  current_raw: number | null
  current_psa9: number | null
  current_psa10: number | null
  current_value_cents: number | null
  position_value_cents: number | null
  pct_7d: number | null
  pct_30d: number | null
  pct_90d: number | null
  notes: string | null
}

interface PortfolioSummary {
  total_value_cents: number
  item_count: number
  unique_cards: number
  items: PortfolioItem[]
}

const HOLDING_TYPES = [
  { value: 'raw',   label: 'Raw' },
  { value: 'psa7',  label: 'PSA 7' },
  { value: 'psa8',  label: 'PSA 8' },
  { value: 'psa9',  label: 'PSA 9' },
  { value: 'psa10', label: 'PSA 10' },
  { value: 'cgc95', label: 'CGC 9.5' },
  { value: 'cgc10', label: 'CGC 10' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtGbp(cents: number | null): string {
  if (!cents) return '—'
  return `£${(cents / 127).toFixed(2)}`
}

function fmtUsd(cents: number | null): string {
  if (!cents) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

function fmtPct(pct: number | null): { text: string; color: string } {
  if (pct == null) return { text: '—', color: 'var(--text-muted)' }
  const color = pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : 'var(--text-muted)'
  return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, color }
}

function fmtLarge(cents: number): string {
  const gbp = cents / 127
  if (gbp >= 1000000) return `£${(gbp / 1000000).toFixed(2)}M`
  if (gbp >= 1000) return `£${(gbp / 1000).toFixed(1)}k`
  return `£${gbp.toFixed(2)}`
}

// ── Add Card Modal ────────────────────────────────────────────────────────────

function AddCardModal({ onAdd, onClose }: { onAdd: (item: any) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [holdingType, setHoldingType] = useState('raw')
  const [quantity, setQuantity] = useState(1)
  const [purchasePrice, setPurchasePrice] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [notes, setNotes] = useState('')
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.rpc('search_global', { query })
      setResults((data || []).filter((r: any) => r.result_type === 'card').slice(0, 8))
      setSearching(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  async function handleAdd() {
    if (!selected) return
    setSaving(true)
    const priceCents = purchasePrice ? Math.round(parseFloat(purchasePrice) * 127) : null
    await onAdd({
      card_slug: selected.url_slug,
      card_name_snapshot: selected.name,
      set_name_snapshot: selected.subtitle || '',
      image_url_snapshot: selected.image_url || null,
      holding_type: holdingType,
      quantity,
      purchase_price_cents: priceCents,
      purchase_currency: 'GBP',
      purchase_date: purchaseDate || null,
      notes: notes || null,
    })
    setSaving(false)
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg-light)',
    color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--card)', borderRadius: 20, border: '1px solid var(--border)',
        width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto',
        padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: 0, color: 'var(--text)' }}>Add to Portfolio</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {!selected ? (
          <>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search for a card e.g. Charizard Base Set..."
                autoFocus
                style={inputStyle}
              />
              {searching && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>...</span>}
            </div>
            {results.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {results.map((r, i) => (
                  <div key={i} onClick={() => setSelected(r)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                  >
                    {r.image_url ? (
                      <img src={r.image_url} alt={r.name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 32, height: 44, background: 'var(--bg)', borderRadius: 4, flexShrink: 0 }} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
                    </div>
                    {r.price_usd && (
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", flexShrink: 0, marginLeft: 'auto' }}>
                        £{((r.price_usd / 100) / 1.27).toFixed(0)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {query.length >= 2 && !searching && results.length === 0 && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textAlign: 'center', padding: '20px 0' }}>No cards found</p>
            )}
          </>
        ) : (
          <>
            {/* Selected card preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--bg-light)', borderRadius: 12, marginBottom: 20 }}>
              {selected.image_url && (
                <img src={selected.image_url} alt={selected.name} style={{ width: 40, height: 56, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{selected.subtitle}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Change</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>Grade / Condition</label>
                <select value={holdingType} onChange={e => setHoldingType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {HOLDING_TYPES.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>Quantity</label>
                <input type="number" min={1} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>Purchase Price (£) <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="number" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>Purchase Date <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif" }}>Notes <span style={{ fontWeight: 400 }}>optional</span></label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. From eBay, great centering" style={inputStyle} />
            </div>

            <button onClick={handleAdd} disabled={saving}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Adding...' : 'Add to Portfolio'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function PortfolioDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [portfolioId, setPortfolioId] = useState<string | null>(null)
  const [summary, setSummary] = useState<PortfolioSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [sortBy, setSortBy] = useState<'value' | 'pct_30d' | 'name'>('value')
  const [activeTab, setActiveTab] = useState<'holdings' | 'insights'>('holdings')

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/portfolio/login'); return }
      setUser(session.user)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      if (!session) router.push('/portfolio/login')
      else setUser(session.user)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load portfolio
  const loadPortfolio = useCallback(async () => {
    if (!user) return
    setLoading(true)

    // Get or create default portfolio
    const { data: portfolios } = await supabase
      .from('portfolios')
      .select('id')
      .eq('user_id', user.id)
      .eq('is_default', true)
      .limit(1)

    let pid = portfolios?.[0]?.id
    if (!pid) {
      const { data: newP } = await supabase.from('portfolios').insert([{ user_id: user.id, name: 'My Collection', is_default: true }]).select('id').single()
      pid = newP?.id
    }
    setPortfolioId(pid)

    // Get portfolio summary
    if (pid) {
      const { data } = await supabase.rpc('get_portfolio_summary', { p_portfolio_id: pid })
      if (data && !data.error) setSummary(data)
    }
    setLoading(false)
  }, [user])

  useEffect(() => { loadPortfolio() }, [loadPortfolio])

  async function handleAddCard(itemData: any) {
    if (!portfolioId || !user) return
    await supabase.from('portfolio_items').upsert([{
      ...itemData,
      portfolio_id: portfolioId,
      user_id: user.id,
    }], { onConflict: 'portfolio_id,card_slug,holding_type' })
    await loadPortfolio()
  }

  async function handleRemove(itemId: string) {
    if (!confirm('Remove this card from your portfolio?')) return
    await supabase.from('portfolio_items').delete().eq('id', itemId)
    await loadPortfolio()
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />)}
      </div>
    </div>
  )

  const items = summary?.items || []
  const totalValue = summary?.total_value_cents || 0

  // Derived analytics
  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'value') return (b.position_value_cents || 0) - (a.position_value_cents || 0)
    if (sortBy === 'pct_30d') return (b.pct_30d || 0) - (a.pct_30d || 0)
    return a.card_name.localeCompare(b.card_name)
  })

  const topMover = items.length ? [...items].sort((a, b) => (b.pct_30d || 0) - (a.pct_30d || 0))[0] : null
  const biggestDrop = items.length ? [...items].sort((a, b) => (a.pct_30d || 0) - (b.pct_30d || 0))[0] : null
  const mostValuable = items.length ? [...items].sort((a, b) => (b.position_value_cents || 0) - (a.position_value_cents || 0))[0] : null

  // Total P&L
  const totalCost = items.reduce((s, i) => s + (i.purchase_price_cents ? i.purchase_price_cents * i.quantity : 0), 0)
  const totalPnl = totalCost > 0 ? totalValue - totalCost : null
  const totalPnlPct = totalPnl && totalCost > 0 ? (totalPnl / totalCost) * 100 : null

  // Grading opportunities — raw items where PSA 10 > 3x raw
  const gradingOpps = items.filter(i => i.holding_type === 'raw' && i.current_psa10 && i.current_raw && i.current_psa10 > i.current_raw * 3)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 4px', color: 'var(--text)' }}>My Collection</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
            {user?.email}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAddModal(true)}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            + Add Card
          </button>
          <button onClick={handleSignOut}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        /* Empty state */
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🃏</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Start tracking your collection</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            Add your cards to see their current value, track performance, and get insights on when to buy or sell.
          </p>
          <button onClick={() => setShowAddModal(true)}
            style={{ padding: '12px 28px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Add your first card
          </button>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              {
                label: 'Total Value',
                value: fmtLarge(totalValue),
                sub: `${summary?.unique_cards || 0} unique cards`,
                highlight: true,
              },
              {
                label: 'Total Cards',
                value: String(summary?.item_count || 0),
                sub: `${summary?.unique_cards || 0} unique`,
              },
              ...(totalPnl !== null ? [{
                label: 'Total P&L',
                value: `${totalPnl >= 0 ? '+' : ''}${fmtGbp(totalPnl)}`,
                sub: totalPnlPct ? `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%` : '',
                color: totalPnl >= 0 ? '#22c55e' : '#ef4444',
              }] : []),
              ...(topMover && topMover.pct_30d ? [{
                label: 'Top Mover (30d)',
                value: `+${topMover.pct_30d.toFixed(1)}%`,
                sub: topMover.card_name,
                color: '#22c55e',
              }] : []),
            ].map((stat, i) => (
              <div key={i} style={{
                background: stat.highlight ? 'rgba(26,95,173,0.06)' : 'var(--card)',
                border: `1px solid ${stat.highlight ? 'rgba(26,95,173,0.2)' : 'var(--border)'}`,
                borderRadius: 14, padding: '16px 18px',
              }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: stat.color || 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 4 }}>
                  {stat.value}
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>
                  {stat.label}
                </div>
                {stat.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.sub}</div>}
              </div>
            ))}
          </div>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['holdings', 'insights'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ padding: '8px 18px', borderRadius: 20, border: activeTab === tab ? '1px solid var(--primary)' : '1px solid var(--border)', background: activeTab === tab ? 'rgba(26,95,173,0.08)' : 'transparent', color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', textTransform: 'capitalize' }}>
                {tab === 'holdings' ? `Holdings (${items.length})` : 'Insights'}
              </button>
            ))}
          </div>

          {activeTab === 'holdings' && (
            <>
              {/* Sort controls */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['value', 'By Value'], ['pct_30d', 'Best 30d'], ['name', 'A–Z']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setSortBy(val)}
                    className={`sort-btn ${sortBy === val ? 'active' : ''}`}
                    style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11 }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Holdings list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sortedItems.map(item => {
                  const pct30 = fmtPct(item.pct_30d)
                  const currentValue = item.current_value_cents
                  const positionValue = item.position_value_cents
                  const pnl = item.purchase_price_cents && currentValue
                    ? (currentValue - item.purchase_price_cents)
                    : null
                  const cardUrl = `/set/${encodeURIComponent(item.set_name)}/card/${item.card_slug}`
                  const gradeLabel = HOLDING_TYPES.find(h => h.value === item.holding_type)?.label || item.holding_type

                  return (
                    <div key={item.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      {/* Image */}
                      <Link href={cardUrl} style={{ flexShrink: 0 }}>
                        {item.image_url ? (
                          <img src={item.image_url} alt={item.card_name} style={{ width: 44, height: 62, objectFit: 'contain', borderRadius: 4 }} loading="lazy"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <div style={{ width: 44, height: 62, background: 'var(--bg-light)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🃏</div>
                        )}
                      </Link>

                      {/* Card info */}
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <Link href={cardUrl} style={{ textDecoration: 'none' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif', marginBottom: 2, lineHeight: 1.3" }}>{item.card_name}</div>
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                          {item.set_name} · {gradeLabel}{item.quantity > 1 ? ` × ${item.quantity}` : ''}
                        </div>
                      </div>

                      {/* Prices */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                          {fmtGbp(positionValue)}
                        </div>
                        <div style={{ fontSize: 11, color: pct30.color, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>
                          {pct30.text} 30d
                        </div>
                        {pnl !== null && (
                          <div style={{ fontSize: 11, color: pnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: "'Figtree', sans-serif" }}>
                            {pnl >= 0 ? '+' : ''}{fmtGbp(pnl)} P&L
                          </div>
                        )}
                      </div>

                      {/* Remove */}
                      <button onClick={() => handleRemove(item.id)}
                        style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.05)', color: '#ef4444', fontSize: 12, cursor: 'pointer', flexShrink: 0 }}>
                        🗑
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {activeTab === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* Top mover insight */}
              {topMover && topMover.pct_30d && topMover.pct_30d > 5 && (
                <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderLeft: '3px solid #22c55e', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#22c55e', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>📈 Top Performer</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>{topMover.card_name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                    Up {topMover.pct_30d.toFixed(1)}% in 30 days. Currently worth {fmtGbp(topMover.current_value_cents)} per card.
                    {topMover.current_value_cents && topMover.purchase_price_cents && topMover.current_value_cents > topMover.purchase_price_cents * 1.3
                      ? ' Up significantly from your purchase price — worth watching for a good exit point.'
                      : ''}
                  </div>
                </div>
              )}

              {/* Biggest drop */}
              {biggestDrop && biggestDrop.pct_30d && biggestDrop.pct_30d < -10 && (
                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderLeft: '3px solid #ef4444', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#ef4444', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>📉 Biggest Drop</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>{biggestDrop.card_name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                    Down {Math.abs(biggestDrop.pct_30d).toFixed(1)}% in 30 days. Now at {fmtGbp(biggestDrop.current_value_cents)}.
                    {biggestDrop.purchase_price_cents && biggestDrop.current_value_cents && biggestDrop.current_value_cents < biggestDrop.purchase_price_cents
                      ? ' Currently below your purchase price.'
                      : ' Still above your purchase price.'}
                  </div>
                </div>
              )}

              {/* Grading opportunities */}
              {gradingOpps.length > 0 && (
                <div style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)', borderLeft: '3px solid #a78bfa', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#a78bfa', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>⭐ Grading Opportunities</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {gradingOpps.slice(0, 3).map(item => {
                      const multiple = item.current_psa10 && item.current_raw ? (item.current_psa10 / item.current_raw).toFixed(1) : null
                      return (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{item.card_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{fmtGbp(item.current_raw)} raw → {fmtGbp(item.current_psa10)} PSA 10</div>
                          </div>
                          {multiple && (
                            <div style={{ fontSize: 14, fontWeight: 800, color: '#a78bfa', fontFamily: "'Figtree', sans-serif" }}>{multiple}x</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Most valuable holding */}
              {mostValuable && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>👑 Most Valuable</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {mostValuable.image_url && (
                      <img src={mostValuable.image_url} alt={mostValuable.card_name} style={{ width: 36, height: 50, objectFit: 'contain', borderRadius: 4 }} />
                    )}
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{mostValuable.card_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{mostValuable.set_name}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmtGbp(mostValuable.position_value_cents)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {totalValue > 0 ? `${((mostValuable.position_value_cents || 0) / totalValue * 100).toFixed(0)}% of portfolio` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {gradingOpps.length === 0 && (!topMover || !topMover.pct_30d) && (!biggestDrop || !biggestDrop.pct_30d) && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>Add more cards to unlock portfolio insights</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showAddModal && <AddCardModal onAdd={handleAddCard} onClose={() => setShowAddModal(false)} />}
    </div>
  )
}
