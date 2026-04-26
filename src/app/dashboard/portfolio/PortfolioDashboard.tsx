'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import DashboardNav from '../DashboardNav'

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
  pct_365d: number | null
  notes: string | null
}

interface PortfolioSummary {
  total_value_cents: number
  item_count: number
  unique_cards: number
  items: PortfolioItem[]
}

const HOLDING_TYPES = [
  { value: 'raw',   label: 'Raw (Ungraded)' },
  { value: 'psa7',  label: 'PSA 7' },
  { value: 'psa8',  label: 'PSA 8' },
  { value: 'psa9',  label: 'PSA 9' },
  { value: 'psa10', label: 'PSA 10' },
  { value: 'cgc95', label: 'CGC 9.5' },
  { value: 'cgc10', label: 'CGC 10' },
]

const GRADE_LABELS: Record<string, string> = {
  raw: 'Raw', psa7: 'PSA 7', psa8: 'PSA 8', psa9: 'PSA 9',
  psa10: 'PSA 10', cgc95: 'CGC 9.5', cgc10: 'CGC 10',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtGbp(cents: number | null | undefined, decimals = 2): string {
  if (!cents || cents <= 0) return '—'
  const gbp = cents / 127
  if (gbp >= 10000) return `£${(gbp / 1000).toFixed(1)}k`
  return `£${gbp.toFixed(decimals)}`
}

function fmtLarge(cents: number): string {
  const gbp = cents / 127
  if (gbp >= 1000000) return `£${(gbp / 1000000).toFixed(2)}M`
  if (gbp >= 1000) return `£${(gbp / 1000).toFixed(1)}k`
  return `£${gbp.toFixed(2)}`
}

function fmtPct(pct: number | null): { text: string; color: string } {
  if (pct == null) return { text: '—', color: 'var(--text-muted)' }
  const color = pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : 'var(--text-muted)'
  return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`, color }
}

function inferEra(setName: string): string {
  const s = setName.toLowerCase()
  if (/base set|jungle|fossil|team rocket|gym|neo|legendary collection/.test(s)) return 'vintage'
  if (/ruby|sapphire|emerald|deoxys|delta|legend maker|power keepers|ex |unseen forces/.test(s)) return 'ex-era'
  if (/diamond|pearl|platinum|heartgold|soulsilver|call of legends/.test(s)) return 'dp-era'
  if (/black|white|xy|flashfire|phantom|roaring|ancient origins/.test(s)) return 'bw-xy-era'
  if (/sun|moon|team up|unbroken bonds|cosmic eclipse/.test(s)) return 'sm-era'
  if (/sword|shield|battle styles|chilling reign|evolving skies|fusion strike|brilliant stars/.test(s)) return 'swsh-era'
  if (/scarlet|violet|paldea|paradox|obsidian|twilight|stellar|surging|prismatic|ascended|perfect order|journey/.test(s)) return 'sv-era'
  return 'other'
}

const ERA_LABELS: Record<string, string> = {
  'vintage': 'Vintage (WotC)', 'ex-era': 'EX Era', 'dp-era': 'DP Era',
  'bw-xy-era': 'BW/XY Era', 'sm-era': 'Sun & Moon', 'swsh-era': 'Sword & Shield',
  'sv-era': 'Scarlet & Violet', 'other': 'Other',
}

// ── Add Card Modal ────────────────────────────────────────────────────────────

function AddCardModal({ onAdd, onClose }: { onAdd: (item: any) => Promise<void>; onClose: () => void }) {
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
  const [error, setError] = useState('')

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
    setError('')
    try {
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
      onClose()
    } catch (e: any) {
      setError(e.message || 'Failed to add card')
    }
    setSaving(false)
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', fontSize: 14, borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--bg-light)',
    color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase',
    letterSpacing: 1, display: 'block', marginBottom: 6, fontFamily: "'Figtree', sans-serif",
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--card)', borderRadius: 20, border: '1px solid var(--border)', width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: 0, color: 'var(--text)' }}>Add to Portfolio</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {!selected ? (
          <>
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search cards e.g. Charizard Base Set..." autoFocus style={inputStyle} />
              {searching && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>...</span>}
            </div>
            {results.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
                {results.map((r, i) => (
                  <div key={i} onClick={() => setSelected(r)}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none' }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-light)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                    {r.image_url ? <img src={r.image_url} alt={r.name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} /> : <div style={{ width: 32, height: 44, background: 'var(--bg)', borderRadius: 4, flexShrink: 0 }} />}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
                    </div>
                    {r.price_usd && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>£{((r.price_usd / 100) / 1.27).toFixed(0)}</div>}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--bg-light)', borderRadius: 12, marginBottom: 20 }}>
              {selected.image_url && <img src={selected.image_url} alt={selected.name} style={{ width: 40, height: 56, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{selected.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{selected.subtitle}</div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Change</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Grade</label>
                <select value={holdingType} onChange={e => setHoldingType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {HOLDING_TYPES.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Quantity</label>
                <input type="number" min={1} value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={labelStyle}>Purchase Price (£) <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="number" step="0.01" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} placeholder="0.00" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Purchase Date <span style={{ fontWeight: 400 }}>optional</span></label>
                <input type="date" value={purchaseDate} onChange={e => setPurchaseDate(e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Notes <span style={{ fontWeight: 400 }}>optional</span></label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Great centering, from eBay" style={inputStyle} />
            </div>

            {error && <p style={{ fontSize: 12, color: '#ef4444', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>{error}</p>}

            <button onClick={handleAdd} disabled={saving}
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 14, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Adding...' : 'Add to Portfolio'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Portfolio DNA ─────────────────────────────────────────────────────────────

function PortfolioDNA({ items, totalValue }: { items: PortfolioItem[]; totalValue: number }) {
  if (!items.length || !totalValue) return null

  // Raw vs graded
  const rawValue = items.filter(i => i.holding_type === 'raw').reduce((s, i) => s + (i.position_value_cents || 0), 0)
  const gradedValue = items.filter(i => i.holding_type !== 'raw').reduce((s, i) => s + (i.position_value_cents || 0), 0)
  const rawPct = Math.round((rawValue / totalValue) * 100)
  const gradedPct = 100 - rawPct

  // By era
  const byEra: Record<string, number> = {}
  items.forEach(i => {
    const era = inferEra(i.set_name)
    byEra[era] = (byEra[era] || 0) + (i.position_value_cents || 0)
  })
  const topEras = Object.entries(byEra).sort((a, b) => b[1] - a[1]).slice(0, 4)

  // Concentration — top card % of portfolio
  const topCard = [...items].sort((a, b) => (b.position_value_cents || 0) - (a.position_value_cents || 0))[0]
  const concentration = topCard ? Math.round(((topCard.position_value_cents || 0) / totalValue) * 100) : 0

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 16 }}>Portfolio DNA</div>

      {/* Raw vs Graded bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Raw vs Graded</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{rawPct}% raw · {gradedPct}% graded</span>
        </div>
        <div style={{ height: 8, borderRadius: 99, background: 'var(--bg-light)', overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${rawPct}%`, background: '#94a3b8', borderRadius: '99px 0 0 99px' }} />
          <div style={{ width: `${gradedPct}%`, background: 'var(--primary)', borderRadius: '0 99px 99px 0' }} />
        </div>
      </div>

      {/* By era */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>By Era</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topEras.map(([era, value]) => {
            const pct = Math.round((value / totalValue) * 100)
            return (
              <div key={era}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{ERA_LABELS[era] || era}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{pct}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 99, background: 'var(--bg-light)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 99 }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Concentration warning */}
      {concentration > 40 && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, color: '#f59e0b', fontFamily: "'Figtree', sans-serif", fontWeight: 600 }}>
            ⚠ {topCard?.card_name} makes up {concentration}% of your portfolio — consider diversifying
          </div>
        </div>
      )}
    </div>
  )
}

// ── AI Insight Panel ──────────────────────────────────────────────────────────

function AIInsightPanel({ items, totalValue }: { items: PortfolioItem[]; totalValue: number }) {
  const [insight, setInsight] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)

  async function generate() {
    if (!items.length) return
    setLoading(true)

    const portfolioSummary = {
      total_value_gbp: (totalValue / 127).toFixed(0),
      card_count: items.length,
      top_cards: items.slice(0, 5).map(i => ({
        name: i.card_name,
        set: i.set_name,
        grade: GRADE_LABELS[i.holding_type] || i.holding_type,
        value_gbp: ((i.position_value_cents || 0) / 127).toFixed(0),
        pct_30d: i.pct_30d,
        pct_365d: i.pct_365d,
        purchase_price_gbp: i.purchase_price_cents ? (i.purchase_price_cents / 127).toFixed(0) : null,
      })),
      risers: items.filter(i => i.pct_30d && i.pct_30d > 10).map(i => ({ name: i.card_name, pct_30d: i.pct_30d })),
      fallers: items.filter(i => i.pct_30d && i.pct_30d < -10).map(i => ({ name: i.card_name, pct_30d: i.pct_30d })),
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 200,
          system: `You are a Pokemon TCG market analyst writing a brief portfolio summary for a collector. 
Write 2-3 sentences in plain prose — no bullet points, no bold, no headers. 
Be direct and specific. Use the actual card names and numbers. 
Sound like a knowledgeable collector friend, not a financial advisor.
Mention what's moving, what to watch, and one actionable observation.
Always end with "Not financial advice."`,
          messages: [{
            role: 'user',
            content: `Here is my Pokemon card portfolio: ${JSON.stringify(portfolioSummary)}. Give me a brief summary of how it's performing and what to watch.`
          }]
        })
      })
      const data = await res.json()
      setInsight(data.content?.[0]?.text || null)
      setGenerated(true)
    } catch {
      setInsight('Unable to generate insight right now. Try again later.')
    }
    setLoading(false)
  }

  return (
    <div style={{ background: 'linear-gradient(135deg, rgba(26,95,173,0.06), rgba(59,130,246,0.04))', border: '1px solid rgba(26,95,173,0.2)', borderRadius: 14, padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: insight ? 12 : 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
          ✦ AI Portfolio Summary
        </div>
        {!generated && (
          <button onClick={generate} disabled={loading || !items.length}
            style={{ padding: '6px 14px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Analysing...' : 'Generate'}
          </button>
        )}
        {generated && (
          <button onClick={() => { setInsight(null); setGenerated(false) }}
            style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Refresh
          </button>
        )}
      </div>
      {insight && (
        <p style={{ fontSize: 13, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.7, margin: 0 }}>
          {insight}
        </p>
      )}
      {!insight && !loading && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '10px 0 0', lineHeight: 1.6 }}>
          Get a personalised AI summary of your portfolio performance and what to watch.
        </p>
      )}
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

  const loadPortfolio = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data: portfolios } = await supabase.from('portfolios').select('id').eq('user_id', user.id).eq('is_default', true).limit(1)
    let pid = portfolios?.[0]?.id
    if (!pid) {
      const { data: newP } = await supabase.from('portfolios').insert([{ user_id: user.id, name: 'My Collection', is_default: true }]).select('id').single()
      pid = newP?.id
    }
    setPortfolioId(pid)
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
      ...itemData, portfolio_id: portfolioId, user_id: user.id,
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

  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'value') return (b.position_value_cents || 0) - (a.position_value_cents || 0)
    if (sortBy === 'pct_30d') return (b.pct_30d || -999) - (a.pct_30d || -999)
    return a.card_name.localeCompare(b.card_name)
  })

  // Analytics
  const topMover    = items.length ? [...items].sort((a, b) => (b.pct_30d || -999) - (a.pct_30d || -999))[0] : null
  const biggestDrop = items.length ? [...items].sort((a, b) => (a.pct_30d || 999) - (b.pct_30d || 999))[0] : null
  const mostVal     = items.length ? [...items].sort((a, b) => (b.position_value_cents || 0) - (a.position_value_cents || 0))[0] : null
  const totalCost   = items.reduce((s, i) => s + (i.purchase_price_cents ? i.purchase_price_cents * i.quantity : 0), 0)
  const totalPnl    = totalCost > 0 ? totalValue - totalCost : null
  const totalPnlPct = totalPnl && totalCost > 0 ? (totalPnl / totalCost) * 100 : null

  // Grading opps — raw items where PSA 10 > 3x raw
  const gradingOpps = items.filter(i =>
    i.holding_type === 'raw' && i.current_psa10 && i.current_raw && i.current_psa10 > i.current_raw * 3
  ).sort((a, b) => {
    const multA = (a.current_psa10 || 0) / (a.current_raw || 1)
    const multB = (b.current_psa10 || 0) / (b.current_raw || 1)
    return multB - multA
  })

  // Dead weight — no price data or flat for 90d
  const deadWeight = items.filter(i => !i.current_value_cents || (!i.pct_90d && !i.pct_30d))

  // Sell signals — cards up > 50% in 90 days (potential take profit)
  const sellSignals = items.filter(i => i.pct_90d && i.pct_90d > 50)

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      <DashboardNav current="portfolio" email={user?.email} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, margin: '0 0 2px', color: 'var(--text)' }}>My Collection</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>Track what you own — value, P&amp;L, grading insights.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAddModal(true)}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            + Add Card
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ background: 'var(--card)', border: '2px dashed var(--border)', borderRadius: 20, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🃏</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 8px', color: 'var(--text)' }}>Start tracking your collection</h2>
          <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 24px', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
            Add your cards to see their current value, track performance, and get personalised insights.
          </p>
          <button onClick={() => setShowAddModal(true)}
            style={{ padding: '12px 28px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 15, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer' }}>
            Add your first card
          </button>
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Collection Value', value: fmtLarge(totalValue), sub: `${summary?.unique_cards || 0} unique cards`, highlight: true },
              { label: 'Total Cards', value: String(summary?.item_count || 0), sub: `${summary?.unique_cards || 0} unique` },
              ...(totalPnl !== null ? [{ label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}${fmtGbp(totalPnl)}`, sub: totalPnlPct ? `${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(1)}%` : '', color: totalPnl >= 0 ? '#22c55e' : '#ef4444' }] : []),
              ...(topMover?.pct_30d ? [{ label: 'Best 30d', value: fmtPct(topMover.pct_30d).text, sub: topMover.card_name, color: '#22c55e' }] : []),
              ...(items.filter(i => i.pct_30d && i.pct_30d > 0).length > 0 ? [{ label: 'Cards Rising', value: String(items.filter(i => (i.pct_30d || 0) > 0).length), sub: 'in last 30 days', color: '#22c55e' }] : []),
            ].map((stat, i) => (
              <div key={i} style={{ background: stat.highlight ? 'rgba(26,95,173,0.06)' : 'var(--card)', border: `1px solid ${stat.highlight ? 'rgba(26,95,173,0.2)' : 'var(--border)'}`, borderRadius: 14, padding: '16px 18px' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: (stat as any).color || 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 4 }}>{stat.value}</div>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{stat.label}</div>
                {stat.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat.sub}</div>}
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {(['holdings', 'insights'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                style={{ padding: '8px 18px', borderRadius: 20, border: activeTab === tab ? '1px solid var(--primary)' : '1px solid var(--border)', background: activeTab === tab ? 'rgba(26,95,173,0.08)' : 'transparent', color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif", cursor: 'pointer', textTransform: 'capitalize' }}>
                {tab === 'holdings' ? `Holdings (${items.length})` : `Insights${(gradingOpps.length + sellSignals.length) > 0 ? ` · ${gradingOpps.length + sellSignals.length}` : ''}`}
              </button>
            ))}
          </div>

          {/* ── Holdings tab ── */}
          {activeTab === 'holdings' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {([['value', 'By Value'], ['pct_30d', 'Best 30d'], ['name', 'A–Z']] as const).map(([val, label]) => (
                  <button key={val} onClick={() => setSortBy(val)}
                    className={`sort-btn ${sortBy === val ? 'active' : ''}`}
                    style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11 }}>
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sortedItems.map(item => {
                  const pct30    = fmtPct(item.pct_30d)
                  const posVal   = item.position_value_cents
                  const pnl      = item.purchase_price_cents && item.current_value_cents ? (item.current_value_cents - item.purchase_price_cents) * item.quantity : null
                  const cardUrl  = `/set/${encodeURIComponent(item.set_name)}/card/${item.card_slug}`
                  const grade    = GRADE_LABELS[item.holding_type] || item.holding_type

                  return (
                    <div key={item.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                      <Link href={cardUrl} style={{ flexShrink: 0 }}>
                        {item.image_url
                          ? <img src={item.image_url} alt={item.card_name} style={{ width: 44, height: 62, objectFit: 'contain', borderRadius: 4 }} loading="lazy" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                          : <div style={{ width: 44, height: 62, background: 'var(--bg-light)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🃏</div>
                        }
                      </Link>
                      <div style={{ flex: 1, minWidth: 140 }}>
                        <Link href={cardUrl} style={{ textDecoration: 'none' }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 2 }}>{item.card_name}</div>
                        </Link>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                          {item.set_name} · {grade}{item.quantity > 1 ? ` × ${item.quantity}` : ''}
                        </div>
                        {pnl !== null && (
                          <div style={{ fontSize: 11, color: pnl >= 0 ? '#22c55e' : '#ef4444', fontFamily: "'Figtree', sans-serif", marginTop: 2, fontWeight: 600 }}>
                            {pnl >= 0 ? '+' : ''}{fmtGbp(pnl)} P&L
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{fmtGbp(posVal)}</div>
                        <div style={{ fontSize: 11, color: pct30.color, fontFamily: "'Figtree', sans-serif", fontWeight: 700 }}>{pct30.text} 30d</div>
                      </div>
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

          {/* ── Insights tab ── */}
          {activeTab === 'insights' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

              {/* AI summary */}
              <AIInsightPanel items={items} totalValue={totalValue} />

              {/* Portfolio DNA */}
              <PortfolioDNA items={items} totalValue={totalValue} />

              {/* Sell signals */}
              {sellSignals.length > 0 && (
                <div style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', borderLeft: '3px solid #22c55e', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#22c55e', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>🔥 Consider Taking Profit</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sellSignals.map(item => (
                      <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{item.card_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>Up {item.pct_90d?.toFixed(1)}% in 90 days · now {fmtGbp(item.current_value_cents)}</div>
                        </div>
                        <Link href={`/set/${encodeURIComponent(item.set_name)}/card/${item.card_slug}`} style={{ fontSize: 12, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none', fontWeight: 600 }}>View →</Link>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top mover */}
              {topMover?.pct_30d && topMover.pct_30d > 5 && (
                <div style={{ background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#22c55e', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>📈 Top Performer This Month</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 3 }}>{topMover.card_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        +{topMover.pct_30d.toFixed(1)}% in 30 days · {fmtGbp(topMover.current_value_cents)} per card
                        {topMover.purchase_price_cents && topMover.current_value_cents && topMover.current_value_cents > topMover.purchase_price_cents * 1.3 ? ' · significantly above your buy price' : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#22c55e', fontFamily: "'Figtree', sans-serif" }}>+{topMover.pct_30d.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Biggest drop */}
              {biggestDrop?.pct_30d && biggestDrop.pct_30d < -10 && (
                <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#ef4444', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>📉 Biggest Drop This Month</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 3 }}>{biggestDrop.card_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {biggestDrop.pct_30d.toFixed(1)}% in 30 days · now {fmtGbp(biggestDrop.current_value_cents)}
                        {biggestDrop.purchase_price_cents && biggestDrop.current_value_cents && biggestDrop.current_value_cents < biggestDrop.purchase_price_cents ? ' · below your purchase price' : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#ef4444', fontFamily: "'Figtree', sans-serif" }}>{biggestDrop.pct_30d.toFixed(1)}%</div>
                  </div>
                </div>
              )}

              {/* Grading opportunities */}
              {gradingOpps.length > 0 && (
                <div style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)', borderLeft: '3px solid #a78bfa', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: '#a78bfa', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>⭐ Grading Opportunities</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {gradingOpps.slice(0, 4).map(item => {
                      const mult = item.current_psa10 && item.current_raw ? (item.current_psa10 / item.current_raw) : null
                      const upside = item.current_psa10 && item.current_raw ? ((item.current_psa10 - item.current_raw - 2500) / 127).toFixed(0) : null
                      return (
                        <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 2 }}>{item.card_name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                              {fmtGbp(item.current_raw)} raw → {fmtGbp(item.current_psa10)} PSA 10
                              {upside && parseInt(upside) > 0 ? ` · ~£${upside} upside if PSA 10` : ''}
                            </div>
                          </div>
                          {mult && <div style={{ fontSize: 16, fontWeight: 800, color: '#a78bfa', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>{mult.toFixed(1)}x</div>}
                        </div>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '12px 0 0', lineHeight: 1.5 }}>
                    Upside estimate assumes £20 grading cost and a PSA 10 result. Actual outcome depends on card condition and gem rate. Not financial advice.
                  </p>
                </div>
              )}

              {/* Dead weight */}
              {deadWeight.length > 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>💤 No Price Data</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 8 }}>
                    {deadWeight.length} card{deadWeight.length !== 1 ? 's' : ''} in your portfolio {deadWeight.length !== 1 ? 'have' : 'has'} no current market data — these may be rare, very new, or thinly traded.
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {deadWeight.slice(0, 3).map(item => (
                      <div key={item.id} style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>· {item.card_name} ({item.set_name})</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty insights state */}
              {gradingOpps.length === 0 && sellSignals.length === 0 && (!topMover?.pct_30d) && (!biggestDrop?.pct_30d) && deadWeight.length === 0 && (
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, fontSize: 14 }}>
                    Add more cards with purchase prices to unlock portfolio insights
                  </p>
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
