'use client'
import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface SearchResult {
  result_type: string
  name: string
  subtitle: string
  card_number: string | null
  card_number_display: string | null
  price_usd: number | null
  image_url: string | null
  url_slug: string
}

const navLinks = [
  { label: 'Insights', href: '/insights' },
  { label: 'Pokémon', href: '/pokemon' },
  { label: 'Cards & Sets', href: '/browse' },
  { label: 'Vendors', href: '/vendors' },
  { label: 'Contact', href: '/contact' },
]

function formatPrice(cents: number | null) {
  if (!cents) return null
  const gbp = (cents / 100) * 0.79
  return `£${gbp.toFixed(2)}`
}

function ResultIcon({ type }: { type: string }) {
  if (type === 'card') return <span>🃏</span>
  if (type === 'set') return <span>📦</span>
  if (type === 'pokemon') return <span>⚡</span>
  return null
}

export default function Navbar() {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debounceRef = useRef<NodeJS.Timeout>()
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleSearch(val: string) {
    setQuery(val)
    setActiveIndex(-1)
    if (val.length < 2) {
      setResults([])
      setShowResults(false)
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.rpc('search_global', { query: val })
      setResults(data ?? [])
      setShowResults(true)
      setSearching(false)
    }, 250)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showResults || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = activeIndex >= 0 ? results[activeIndex] : results[0]
      if (target) navigateTo(target)
    } else if (e.key === 'Escape') {
      setShowResults(false)
    }
  }

  function navigateTo(result: SearchResult) {
    setShowResults(false)
    setQuery('')
    if (result.result_type === 'card') router.push(`/card/${result.url_slug}`)
    else if (result.result_type === 'set') router.push(`/set/${result.url_slug}`)
    else if (result.result_type === 'pokemon') router.push(`/pokemon/${result.url_slug.toLowerCase()}`)
  }

  const cardResults = results.filter(r => r.result_type === 'card')
  const setResults = results.filter(r => r.result_type === 'set')
  const pokemonResults = results.filter(r => r.result_type === 'pokemon')

  return (
    <nav style={{
      background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
      padding: '0 24px',
      height: 60,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      position: 'sticky',
      top: 0,
      zIndex: 100,
      boxShadow: '0 2px 15px rgba(26,95,173,0.3)',
    }}>

      {/* Mobile hamburger */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        style={{
          background: 'none', border: 'none', color: '#fff',
          fontSize: 22, cursor: 'pointer', padding: '4px 8px',
          flexShrink: 0,
        }}
        className="mobile-menu-btn"
      >
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* Logo */}
      <Link href="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <img src="/logo.png" alt="PokePrices" style={{ height: 38, display: 'block' }} />
      </Link>

      {/* Search bar */}
      <div ref={searchRef} style={{ flex: 1, maxWidth: 480, position: 'relative' }} className="nav-search">
        <div style={{ position: 'relative' }}>
          <span style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            fontSize: 14, opacity: 0.5, pointerEvents: 'none',
          }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length > 0 && setShowResults(true)}
            placeholder="Search cards, sets, Pokémon..."
            style={{
              width: '100%',
              padding: '8px 12px 8px 36px',
              borderRadius: 10,
              border: 'none',
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              fontSize: 13,
              fontFamily: "'Figtree', sans-serif",
              outline: 'none',
              boxSizing: 'border-box',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
            onMouseLeave={e => {
              if (document.activeElement !== e.currentTarget) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
              }
            }}
          />
          {searching && (
            <span style={{
              position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
              fontSize: 11, color: 'rgba(255,255,255,0.6)',
            }}>...</span>
          )}
        </div>

        {/* Results dropdown */}
        {showResults && results.length > 0 && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
            zIndex: 200,
            maxHeight: 480, overflowY: 'auto',
          }}>

            {/* Cards */}
            {cardResults.length > 0 && (
              <>
                <div style={{
                  padding: '8px 14px 4px',
                  fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
                  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
                  textTransform: 'uppercase',
                }}>Cards</div>
                {cardResults.map((r, i) => {
                  const globalIndex = i
                  const isActive = activeIndex === globalIndex
                  return (
                    <div
                      key={i}
                      onMouseDown={() => navigateTo(r)}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 14px', cursor: 'pointer',
                        background: isActive ? 'var(--bg-light)' : 'transparent',
                        transition: 'background 0.1s',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      {/* Card image */}
                      {r.image_url ? (
                        <img
                          src={r.image_url}
                          alt={r.name}
                          style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }}
                        />
                      ) : (
                        <div style={{
                          width: 32, height: 44, borderRadius: 3, flexShrink: 0,
                          background: 'var(--bg-light)', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', fontSize: 16,
                        }}>🃏</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: 'var(--text)',
                          fontFamily: "'Figtree', sans-serif",
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {r.name}
                        </div>
                        <div style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          fontFamily: "'Figtree', sans-serif",
                          display: 'flex', gap: 6, alignItems: 'center',
                        }}>
                          <span>{r.subtitle}</span>
                          {r.card_number_display && (
                            <span style={{
                              background: 'var(--bg-light)', border: '1px solid var(--border)',
                              borderRadius: 4, padding: '0px 5px', fontSize: 10, fontWeight: 700,
                            }}>
                              {r.card_number_display}
                            </span>
                          )}
                        </div>
                      </div>
                      {r.price_usd && (
                        <div style={{
                          fontSize: 13, fontWeight: 800, color: 'var(--primary)',
                          fontFamily: "'Figtree', sans-serif", flexShrink: 0,
                        }}>
                          {formatPrice(r.price_usd)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}

            {/* Sets */}
            {setResults.length > 0 && (
              <>
                <div style={{
                  padding: '8px 14px 4px',
                  fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
                  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
                  textTransform: 'uppercase',
                }}>Sets</div>
                {setResults.map((r, i) => {
                  const globalIndex = cardResults.length + i
                  const isActive = activeIndex === globalIndex
                  return (
                    <div
                      key={i}
                      onMouseDown={() => navigateTo(r)}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', cursor: 'pointer',
                        background: isActive ? 'var(--bg-light)' : 'transparent',
                        transition: 'background 0.1s',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ fontSize: 20 }}>📦</span>
                      <div>
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: 'var(--text)',
                          fontFamily: "'Figtree', sans-serif",
                        }}>{r.name}</div>
                        <div style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          fontFamily: "'Figtree', sans-serif",
                        }}>{r.subtitle}</div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}

            {/* Pokémon */}
            {pokemonResults.length > 0 && (
              <>
                <div style={{
                  padding: '8px 14px 4px',
                  fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
                  color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
                  textTransform: 'uppercase',
                }}>Pokémon</div>
                {pokemonResults.map((r, i) => {
                  const globalIndex = cardResults.length + setResults.length + i
                  const isActive = activeIndex === globalIndex
                  return (
                    <div
                      key={i}
                      onMouseDown={() => navigateTo(r)}
                      onMouseEnter={() => setActiveIndex(globalIndex)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 14px', cursor: 'pointer',
                        background: isActive ? 'var(--bg-light)' : 'transparent',
                        transition: 'background 0.1s',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ fontSize: 20 }}>⚡</span>
                      <div>
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: 'var(--text)',
                          fontFamily: "'Figtree', sans-serif", textTransform: 'capitalize',
                        }}>{r.name}</div>
                        <div style={{
                          fontSize: 11, color: 'var(--text-muted)',
                          fontFamily: "'Figtree', sans-serif",
                        }}>{r.subtitle}</div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}

            {/* No results */}
            {results.length === 0 && !searching && (
              <div style={{
                padding: '20px 14px', textAlign: 'center',
                fontSize: 13, color: 'var(--text-muted)',
                fontFamily: "'Figtree', sans-serif",
              }}>
                No results for "{query}"
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop nav links */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }} className="desktop-nav">
        {navLinks.map((item) => (
          <Link key={item.label} href={item.href} style={{
            color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
            fontSize: 13, fontWeight: 700, transition: 'color 0.2s',
            letterSpacing: 0.3, whiteSpace: 'nowrap',
          }}>{item.label}</Link>
        ))}
      </div>

      {/* Mobile menu dropdown */}
      {menuOpen && (
        <div style={{
          position: 'absolute', top: 60, left: 0, right: 0,
          background: 'linear-gradient(135deg, #15509a, #2268b8)',
          padding: '12px 24px 16px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
          zIndex: 99,
        }}>
          {/* Mobile search */}
          <div style={{ marginBottom: 12 }}>
            <input
              value={query}
              onChange={e => handleSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search cards, sets, Pokémon..."
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 10,
                border: 'none', background: 'rgba(255,255,255,0.15)',
                color: '#fff', fontSize: 14, fontFamily: "'Figtree', sans-serif",
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {showResults && results.length > 0 && (
              <div style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 10, marginTop: 6, overflow: 'hidden',
                maxHeight: 300, overflowY: 'auto',
              }}>
                {results.map((r, i) => (
                  <div
                    key={i}
                    onMouseDown={() => { navigateTo(r); setMenuOpen(false) }}
                    style={{
                      padding: '10px 14px', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}
                  >
                    <ResultIcon type={r.result_type} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                        {r.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {r.subtitle} {r.card_number_display && `· ${r.card_number_display}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {navLinks.map((item) => (
            <Link key={item.label} href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: 'block', color: 'rgba(255,255,255,0.9)',
                textDecoration: 'none', padding: '10px 0', fontSize: 15,
                fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.1)',
              }}>{item.label}</Link>
          ))}
        </div>
      )}

      <style jsx>{`
        input::placeholder { color: rgba(255,255,255,0.5); }
        @media (min-width: 768px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: flex !important; }
        }
        @media (max-width: 767px) {
          .mobile-menu-btn { display: block !important; }
          .desktop-nav { display: none !important; }
          .nav-search { display: none !important; }
        }
      `}</style>
    </nav>
  )
}
