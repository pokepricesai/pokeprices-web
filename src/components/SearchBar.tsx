'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface SearchResult {
  type: 'card' | 'set'
  label: string
  sublabel: string
  href: string
  image_url?: string
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

export default function SearchBar({ placeholder = 'Search cards or sets…' }: { placeholder?: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const debouncedQuery = useDebounce(query, 220)

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    let cancelled = false
    async function search() {
      setLoading(true)
      const q = debouncedQuery.trim()

      // Cards search
      const { data: cards } = await supabase
        .from('cards')
        .select('card_slug, card_name, set_name, image_url, card_url_slug')
        .ilike('card_name', `%${q}%`)
        .not('card_url_slug', 'is', null)
        .limit(6)

      // Sets search
      const { data: sets } = await supabase
        .from('cards')
        .select('set_name')
        .ilike('set_name', `%${q}%`)
        .limit(20)

      if (cancelled) return

      const cardResults: SearchResult[] = (cards || []).map((c: any) => ({
        type: 'card' as const,
        label: c.card_name,
        sublabel: c.set_name,
        href: `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
        image_url: c.image_url,
      }))

      // Deduplicate sets
      const seen = new Set<string>()
const uniqueSets = (sets || []).filter((s: any) => {
  if (seen.has(s.set_name)) return false
  seen.add(s.set_name)
  return true
})
      const setItems: SearchResult[] = uniqueSets.slice(0, 3).map((s: any) => ({
        type: 'set' as const,
        label: s.set_name,
        sublabel: 'Set',
        href: `/set/${encodeURIComponent(s.set_name)}`,
      }))

      setResults([...setItems, ...cardResults])
      setOpen(true)
      setHighlighted(-1)
      setLoading(false)
    }
    search()
    return () => { cancelled = true }
  }, [debouncedQuery])

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = highlighted >= 0 ? results[highlighted] : results[0]
      if (target) {
        router.push(target.href)
        setOpen(false)
        setQuery('')
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function handleSelect(result: SearchResult) {
    router.push(result.href)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: 560, margin: '0 auto' }}>
      {/* Input */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'rgba(255,255,255,0.12)',
        border: '1px solid rgba(255,255,255,0.25)',
        borderRadius: 14,
        backdropFilter: 'blur(8px)',
        transition: 'all 0.2s',
        boxShadow: open ? '0 0 0 3px rgba(255,203,5,0.25)' : 'none',
      }}>
        <svg style={{ marginLeft: 14, flexShrink: 0, opacity: 0.6 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
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
          <div style={{ marginRight: 14, width: 16, height: 16 }}>
            <div style={{
              width: 16, height: 16, border: '2px solid rgba(255,255,255,0.2)',
              borderTopColor: 'rgba(255,255,255,0.7)', borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          </div>
        )}
        {query && !loading && (
          <button
            onClick={() => { setQuery(''); setOpen(false); inputRef.current?.focus() }}
            style={{
              marginRight: 10, background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.5)', fontSize: 18, lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          zIndex: 1000,
          animation: 'fadeInDown 0.15s ease',
        }}>
          {/* Group: Sets */}
          {results.filter(r => r.type === 'set').length > 0 && (
            <>
              <div style={{
                padding: '8px 14px 4px',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.5, color: 'var(--text-muted)',
                fontFamily: "'Figtree', sans-serif",
              }}>Sets</div>
              {results.filter(r => r.type === 'set').map((r, i) => {
                const idx = results.indexOf(r)
                return (
                  <button
                    key={i}
                    onMouseDown={() => handleSelect(r)}
                    onMouseEnter={() => setHighlighted(idx)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center',
                      gap: 12, padding: '9px 14px', border: 'none', cursor: 'pointer',
                      background: highlighted === idx ? 'var(--bg-light)' : 'transparent',
                      textAlign: 'left', transition: 'background 0.1s',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 8,
                      background: 'linear-gradient(135deg, #1a5fad, #3b8fe8)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 14, flexShrink: 0,
                    }}>📦</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>View set →</div>
                    </div>
                  </button>
                )
              })}
            </>
          )}

          {/* Group: Cards */}
          {results.filter(r => r.type === 'card').length > 0 && (
            <>
              <div style={{
                padding: '8px 14px 4px',
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: 1.5, color: 'var(--text-muted)',
                fontFamily: "'Figtree', sans-serif",
                borderTop: results.filter(r => r.type === 'set').length > 0 ? '1px solid var(--border)' : 'none',
                marginTop: results.filter(r => r.type === 'set').length > 0 ? 4 : 0,
              }}>Cards</div>
              {results.filter(r => r.type === 'card').map((r, i) => {
                const idx = results.indexOf(r)
                return (
                  <button
                    key={i}
                    onMouseDown={() => handleSelect(r)}
                    onMouseEnter={() => setHighlighted(idx)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center',
                      gap: 12, padding: '8px 14px', border: 'none', cursor: 'pointer',
                      background: highlighted === idx ? 'var(--bg-light)' : 'transparent',
                      textAlign: 'left', transition: 'background 0.1s',
                    }}
                  >
                    {r.image_url ? (
                      <img src={r.image_url} alt={r.label} style={{
                        width: 32, height: 44, objectFit: 'contain', borderRadius: 4, flexShrink: 0,
                      }} />
                    ) : (
                      <div style={{
                        width: 32, height: 44, background: 'var(--bg)', borderRadius: 4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 16, flexShrink: 0, color: 'var(--border)',
                      }}>🃏</div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 700, color: 'var(--text)',
                        fontFamily: "'Figtree', sans-serif",
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.sublabel}</div>
                    </div>
                  </button>
                )
              })}
            </>
          )}

          <div style={{
            padding: '8px 14px', borderTop: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
          }}>
            ↑↓ to navigate · Enter to select · Esc to close
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
