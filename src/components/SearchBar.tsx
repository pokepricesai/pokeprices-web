'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

interface Result {
  type: 'card' | 'set' | 'pokemon'
  label: string
  sublabel: string
  href: string
  image_url?: string | null
  price?: number | null
}

export default function SearchBar({ placeholder = 'Search cards, sets, Pokémon… try "Charizard Base Set" or "215/203"' }: { placeholder?: string }) {
  const [query, setQuery]           = useState('')
  const [results, setResults]       = useState<Result[]>([])
  const [loading, setLoading]       = useState(false)
  const [open, setOpen]             = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const inputRef    = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router      = useRouter()
  const dq          = useDebounce(query, 200)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const q = dq.trim()
    if (q.length < 2) { setResults([]); setOpen(false); return }
    let cancelled = false

    async function run() {
      setLoading(true)

      // ── Strategy 1: search_global RPC ─────────────────────────────
      // Handles any mix of name, set, number in any order
      const { data: rpcData } = await supabase.rpc('search_global', { query: q })

      if (!cancelled && rpcData && rpcData.length > 0) {
        const mapped: Result[] = (rpcData as any[]).map(r => {
          if (r.result_type === 'set') return {
            type: 'set' as const,
            label: r.name,
            sublabel: r.subtitle || 'Set',
            href: `/set/${encodeURIComponent(r.name)}`,
            image_url: r.image_url,
            price: null,
          }
          if (r.result_type === 'pokemon') return {
            type: 'pokemon' as const,
            label: r.name,
            sublabel: r.subtitle || 'Pokémon species',
            href: `/pokemon/${r.url_slug?.toLowerCase() || r.name.toLowerCase()}`,
            image_url: r.image_url,
            price: null,
          }
          // card
          const href = r.subtitle
            ? `/set/${encodeURIComponent(r.subtitle)}/card/${r.url_slug}`
            : `/browse`
          return {
            type: 'card' as const,
            label: r.name,
            sublabel: r.card_number_display
              ? `${r.subtitle} · #${r.card_number_display}`
              : (r.subtitle || ''),
            href,
            image_url: r.image_url,
            price: r.price_usd,
          }
        })
        setResults(mapped)
        setOpen(true)
        setHighlighted(-1)
        setLoading(false)
        return
      }

      if (cancelled) return

      // ── Strategy 2: fallback direct search ────────────────────────
      // Handles cases where search_global returns nothing
      // Split query into tokens — try each as name, set, or card number
      const tokens = q.split(/\s+/)
      const numberToken = tokens.find(t => /^\d{1,3}(\/\d+)?$/.test(t))
      const nameTokens  = tokens.filter(t => t !== numberToken).join(' ')

      const queries: (() => Promise<Result[]>)[] = []

      // Card name search (flexible — name tokens only)
      if (nameTokens.length >= 2) {
        queries.push(async () => {
          const r = await supabase.from('cards')
            .select('card_name, set_name, card_url_slug, image_url, card_number')
            .ilike('card_name', `%${nameTokens}%`)
            .not('card_url_slug', 'is', null)
            .limit(5)
          return (r.data || []).map((c: any) => ({
            type: 'card' as const,
            label: c.card_name,
            sublabel: c.card_number ? `${c.set_name} · #${c.card_number}` : c.set_name,
            href: `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
            image_url: c.image_url,
            price: null,
          }))
        })
      }

      // Full query as card name
      queries.push(async () => {
        const r = await supabase.from('cards')
          .select('card_name, set_name, card_url_slug, image_url, card_number')
          .ilike('card_name', `%${q}%`)
          .not('card_url_slug', 'is', null)
          .limit(5)
        return (r.data || []).map((c: any) => ({
          type: 'card' as const,
          label: c.card_name,
          sublabel: c.card_number ? `${c.set_name} · #${c.card_number}` : c.set_name,
          href: `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
          image_url: c.image_url,
          price: null,
        }))
      })

      // Set name search
      queries.push(async () => {
        const r = await supabase.from('cards')
          .select('set_name')
          .ilike('set_name', `%${q}%`)
          .limit(30)
        const seen = new Set<string>()
        return (r.data || [])
          .filter((s: any) => { if (seen.has(s.set_name)) return false; seen.add(s.set_name); return true })
          .slice(0, 4)
          .map((s: any) => ({
            type: 'set' as const,
            label: s.set_name,
            sublabel: 'View set',
            href: `/set/${encodeURIComponent(s.set_name)}`,
            image_url: null,
            price: null,
          }))
      })

      // Card number search
      if (numberToken) {
        const num = parseInt(numberToken, 10).toString()
        const padded = num.padStart(3, '0')
        queries.push(async () => {
          const r = await supabase.from('cards')
            .select('card_name, set_name, card_url_slug, image_url, card_number')
            .in('card_number', [num, padded])
            .not('card_url_slug', 'is', null)
            .limit(4)
          return (r.data || []).map((c: any) => ({
            type: 'card' as const,
            label: c.card_name,
            sublabel: `${c.set_name} · #${c.card_number}`,
            href: `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
            image_url: c.image_url,
            price: null,
          }))
        })
      }

      const batches = await Promise.all(queries.map(fn => fn()))
      if (cancelled) return

      // Merge, deduplicate by href, sets first
      const seen = new Set<string>()
      const merged: Result[] = []
      const sets  = batches.flat().filter(r => r.type === 'set')
      const cards = batches.flat().filter(r => r.type === 'card')

      for (const r of [...sets, ...cards]) {
        if (!seen.has(r.href)) { seen.add(r.href); merged.push(r) }
        if (merged.length >= 10) break
      }

      setResults(merged)
      setOpen(merged.length > 0)
      setHighlighted(-1)
      setLoading(false)
    }

    run()
    return () => { cancelled = true }
  }, [dq])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const t = highlighted >= 0 ? results[highlighted] : results[0]
      if (t) { router.push(t.href); setOpen(false); setQuery('') }
    } else if (e.key === 'Escape') setOpen(false)
  }

  function select(r: Result) { router.push(r.href); setOpen(false); setQuery('') }

  const sets     = results.filter(r => r.type === 'set')
  const pokemon  = results.filter(r => r.type === 'pokemon')
  const cards    = results.filter(r => r.type === 'card')

  const typeIcon: Record<string, string> = { set: '📦', pokemon: '⚡', card: '🃏' }
  const typeLabel: Record<string, string> = { set: 'Sets', pokemon: 'Pokémon', card: 'Cards' }

  function Section({ items, type }: { items: Result[]; type: string }) {
    if (items.length === 0) return null
    return (
      <>
        <div style={{
          padding: '8px 14px 4px', fontSize: 10, fontWeight: 700,
          textTransform: 'uppercase', letterSpacing: 1.5,
          color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
          position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1,
          borderTop: type !== 'set' ? '1px solid var(--border)' : 'none',
        }}>{typeLabel[type]}</div>
        {items.map((r, i) => {
          const idx = results.indexOf(r)
          const isActive = highlighted === idx
          return (
            <button key={i} onMouseDown={() => select(r)} onMouseEnter={() => setHighlighted(idx)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                padding: type === 'card' ? '8px 14px' : '9px 14px',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                background: isActive ? 'var(--bg-light)' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              {type === 'card' && r.image_url ? (
                <img src={r.image_url} alt={r.label}
                  style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <div style={{
                  width: 32, height: type === 'card' ? 44 : 32,
                  borderRadius: type === 'card' ? 4 : 8, flexShrink: 0,
                  background: type === 'set'
                    ? 'linear-gradient(135deg, #1a5fad, #3b8fe8)'
                    : type === 'pokemon'
                    ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
                    : 'var(--bg)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, color: type === 'card' ? 'var(--border)' : '#fff',
                }}>{typeIcon[type]}</div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: 'var(--text)',
                  fontFamily: "'Figtree', sans-serif",
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.sublabel}</div>
              </div>
              {r.price != null && r.price > 0 && (
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>
                  £{((r.price / 100) * 0.79).toFixed(0)}
                </div>
              )}
            </button>
          )
        })}
      </>
    )
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto' }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.25)',
        borderRadius: 14, backdropFilter: 'blur(8px)',
        transition: 'all 0.2s',
        boxShadow: open ? '0 0 0 3px rgba(255,203,5,0.25)' : 'none',
      }}>
        <svg style={{ marginLeft: 14, flexShrink: 0, opacity: 0.6 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#fff', fontSize: 14, padding: '11px 14px',
            fontFamily: "'Figtree', sans-serif", fontWeight: 500,
          }}
        />
        {loading && (
          <div style={{ marginRight: 14 }}>
            <div style={{
              width: 15, height: 15, border: '2px solid rgba(255,255,255,0.2)',
              borderTopColor: 'rgba(255,255,255,0.7)', borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        )}
        {query && !loading && (
          <button onClick={() => { setQuery(''); setOpen(false); inputRef.current?.focus() }}
            style={{ marginRight: 10, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>
            ×
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.2)',
          zIndex: 1000, display: 'flex', flexDirection: 'column',
          maxHeight: 440, overflow: 'hidden',
          animation: 'fadeInDown 0.15s ease',
        }}>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <Section items={sets}    type="set"     />
            <Section items={pokemon} type="pokemon" />
            <Section items={cards}   type="card"    />
          </div>
          <div style={{
            padding: '8px 14px', borderTop: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
            flexShrink: 0, background: 'var(--card)',
          }}>
            ↑↓ navigate · Enter select · Esc close
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeInDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin { to { transform:rotate(360deg); } }
        input::placeholder { color: rgba(255,255,255,0.55); }
      `}</style>
    </div>
  )
}
