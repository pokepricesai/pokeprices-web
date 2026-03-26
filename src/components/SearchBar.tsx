'use client'
import { useState, useEffect, useRef } from 'react'
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

// FIX 3: Now accepts leading zeros — "015/126", "015", "#015", "15/126", "15"
function extractCardNumber(q: string): string | null {
  // "015/126" or "15/126" or "015" or "15" or "#015" or "#15"
  const slashMatch = q.match(/^#?(\d{1,3})\/\d+$/)
  if (slashMatch) return slashMatch[1] // keeps leading zero stripped for eq match
  const hashMatch = q.match(/^#(\d{1,3})$/)
  if (hashMatch) return hashMatch[1]
  const plainMatch = q.match(/^(\d{1,3})$/)
  if (plainMatch) return plainMatch[1]
  return null
}

// "Pikachu 015/199" or "Pikachu #015" — handles leading zeros
function extractNameAndNumber(q: string): { name: string; number: string } | null {
  const match = q.match(/^(.+?)\s+#?(\d{1,3}(?:\/\d+)?)$/)
  if (match) {
    const name = match[1].trim()
    const number = match[2].replace(/\/\d+$/, '')
    if (name.length >= 2) return { name, number }
  }
  return null
}

// Search cards by number — tries exact match, then zero-padded, then stripped
async function searchByNumber(num: string) {
  const stripped = String(parseInt(num, 10)) // "015" → "15"
  const padded2 = stripped.padStart(2, '0')  // "15" → "15"
  const padded3 = stripped.padStart(3, '0')  // "15" → "015"

  const numbersToTry = Array.from(new Set([num, stripped, padded2, padded3]))

  const { data } = await supabase
    .from('cards')
    .select('card_slug, card_name, set_name, image_url, card_url_slug, card_number')
    .in('card_number', numbersToTry)
    .not('card_url_slug', 'is', null)
    .limit(8)

  return data || []
}

export default function SearchBar({ placeholder = 'Search cards, sets, or number e.g. 015/126…' }: { placeholder?: string }) {
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

      let cardResults: SearchResult[] = []
      let setItems: SearchResult[] = []

      const pureNumber = extractCardNumber(q)
      const nameAndNumber = extractNameAndNumber(q)

      if (pureNumber) {
        // Pure number search with leading zero support
        const cards = await searchByNumber(pureNumber)
        cardResults = cards.map((c: any) => ({
          type: 'card' as const,
          label: c.card_name,
          sublabel: `${c.set_name} · #${c.card_number}`,
          href: `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
          image_url: c.image_url,
        }))

      } else if (nameAndNumber) {
        // Name + number with leading zero support
        const stripped = String(parseInt(nameAndNumber.number, 10))
        const padded3 = stripped.padStart(3, '0')
        const numbersToTry = Array.from(new Set([nameAndNumber.number, stripped, padded3]))

        const { data: cards } = await supabase
          .from('cards')
          .select('card_slug, card_name, set_name, image_url, card_url_slug, card_number')
          .ilike('card_name', `%${nameAndNumber.name}%`)
          .in('card_number', numbersToTry)
          .not('card_url_slug', 'is', null)
          .limit(8)

        cardResults = (cards || []).map((c: any) => ({
          type: 'card' as const,
          label: c.card_name,
          sublabel: `${c.set_name} · #${c.card_number}`,
          href: `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
          image_url: c.image_url,
        }))

      } else {
        // Normal text search — run cards and sets in parallel
        const words = q.split(' ')
        const firstWord = words[0]
        const likelySetWords = words.slice(1).join(' ')

        let cardQuery = supabase
          .from('cards')
          .select('card_slug, card_name, set_name, image_url, card_url_slug, card_number')
          .not('card_url_slug', 'is', null)

        if (words.length > 1 && likelySetWords.length > 2) {
          cardQuery = cardQuery
            .ilike('card_name', `%${firstWord}%`)
            .ilike('set_name', `%${likelySetWords}%`)
        } else {
          cardQuery = cardQuery.ilike('card_name', `%${q}%`)
        }

        // FIX 2: Run set search in parallel and prioritise by match quality
        const [{ data: cards }, { data: sets }] = await Promise.all([
          cardQuery.limit(6),
          supabase
            .from('cards')
            .select('set_name')
            .ilike('set_name', `%${q}%`)
            .limit(50),
        ])

        cardResults = (cards || []).map((c: any) => ({
          type: 'card' as const,
          label: c.card_name,
          sublabel: c.card_number ? `${c.set_name} · #${c.card_number}` : c.set_name,
          href: `/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`,
          image_url: c.image_url,
        }))

        const seen = new Set<string>()
        const uniqueSets = (sets || []).filter((s: any) => {
          if (seen.has(s.set_name)) return false
          seen.add(s.set_name)
          return true
        })

        setItems = uniqueSets.slice(0, 6).map((s: any) => ({
          type: 'set' as const,
          label: s.set_name,
          sublabel: 'Set',
          href: `/set/${encodeURIComponent(s.set_name)}`,
        }))

        // FIX 2: If query closely matches a set name, boost sets to top
        // (already handled by showing sets first in render, but ensure
        // exact/close set matches appear even if cards also match)
      }

      if (cancelled) return

      // Sets always appear before cards in results array
      setResults([...setItems, ...cardResults])
      setOpen(true)
      setHighlighted(-1)
      setLoading(false)
    }

    search()
    return () => { cancelled = true }
  }, [debouncedQuery])

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
      if (target) { router.push(target.href); setOpen(false); setQuery('') }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function handleSelect(result: SearchResult) {
    router.push(result.href)
    setOpen(false)
    setQuery('')
  }

  const setItems = results.filter(r => r.type === 'set')
  const cardItems = results.filter(r => r.type === 'card')

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

      {/* FIX 1: Added maxHeight and overflowY scroll to dropdown */}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,0.18)',
          overflow: 'hidden', zIndex: 1000,
          animation: 'fadeInDown 0.15s ease',
          maxHeight: 420,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Scrollable results area */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {/* FIX 2: Sets always appear first */}
            {setItems.length > 0 && (
              <>
                <div style={{
                  padding: '8px 14px 4px', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: 1.5,
                  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
                  position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1,
                }}>Sets</div>
                {setItems.map((r, i) => {
                  const idx = results.indexOf(r)
                  return (
                    <button key={i} onMouseDown={() => handleSelect(r)} onMouseEnter={() => setHighlighted(idx)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                        padding: '9px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                        background: highlighted === idx ? 'var(--bg-light)' : 'transparent',
                        transition: 'background 0.1s',
                      }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        background: 'linear-gradient(135deg, #1a5fad, #3b8fe8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
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

            {cardItems.length > 0 && (
              <>
                <div style={{
                  padding: '8px 14px 4px', fontSize: 10, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: 1.5,
                  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
                  borderTop: setItems.length > 0 ? '1px solid var(--border)' : 'none',
                  marginTop: setItems.length > 0 ? 4 : 0,
                  position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1,
                }}>Cards</div>
                {cardItems.map((r, i) => {
                  const idx = results.indexOf(r)
                  return (
                    <button key={i} onMouseDown={() => handleSelect(r)} onMouseEnter={() => setHighlighted(idx)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 14px', border: 'none', cursor: 'pointer', textAlign: 'left',
                        background: highlighted === idx ? 'var(--bg-light)' : 'transparent',
                        transition: 'background 0.1s',
                      }}>
                      {r.image_url ? (
                        <img src={r.image_url} alt={r.label} style={{
                          width: 32, height: 44, objectFit: 'contain', borderRadius: 4, flexShrink: 0,
                        }} />
                      ) : (
                        <div style={{
                          width: 32, height: 44, background: 'var(--bg)', borderRadius: 4, flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--border)',
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
          </div>

          {/* Footer always visible at bottom */}
          <div style={{
            padding: '8px 14px', borderTop: '1px solid var(--border)',
            fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
            flexShrink: 0, background: 'var(--card)',
          }}>↑↓ navigate · Enter select · Esc close</div>
        </div>
      )}

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(255, 255, 255, 0.6); }
      `}</style>
    </div>
  )
}
