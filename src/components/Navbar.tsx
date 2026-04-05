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
  { label: 'Cards & Sets', href: '/browse'    },
  { label: 'Pokémon',      href: '/pokemon'   },
  { label: 'Insights',     href: '/insights'  },
  { label: 'Studio',       href: '/studio'    },
  { label: 'Creators',     href: '/creators'  },
  { label: 'Vendors',      href: '/vendors'   },
  { label: 'Contact',      href: '/contact'   },
]

function formatPrice(cents: number | null) {
  if (!cents) return null
  const gbp = (cents / 100) * 0.79
  return `£${gbp.toFixed(2)}`
}

export default function Navbar() {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [allResults, setAllResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debounceRef = useRef<NodeJS.Timeout>()
  const searchRef = useRef<HTMLDivElement>(null)

  const cardResults    = allResults.filter(r => r.result_type === 'card')
  const setResults     = allResults.filter(r => r.result_type === 'set')
  const pokemonResults = allResults.filter(r => r.result_type === 'pokemon')

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
    if (val.length < 2) { setAllResults([]); setShowResults(false); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const { data } = await supabase.rpc('search_global', { query: val })
      setAllResults(data ?? [])
      setShowResults(true)
      setSearching(false)
    }, 250)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showResults || allResults.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, allResults.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter') { e.preventDefault(); const t = activeIndex >= 0 ? allResults[activeIndex] : allResults[0]; if (t) navigateTo(t) }
    else if (e.key === 'Escape') setShowResults(false)
  }

  function navigateTo(result: SearchResult) {
    setShowResults(false)
    setQuery('')
    if (result.result_type === 'card') router.push(`/set/${encodeURIComponent(result.subtitle)}/card/${result.url_slug}`)
    else if (result.result_type === 'set') router.push(`/set/${encodeURIComponent(result.name)}`)
    else if (result.result_type === 'pokemon') router.push(`/pokemon/${result.url_slug.toLowerCase()}`)
  }

  const SectionHeader = ({ label }: { label: string }) => (
    <div style={{
      padding: '8px 14px 4px', fontSize: 10, fontWeight: 800,
      letterSpacing: 1.5, color: 'var(--text-muted)',
      fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase' as const,
      background: 'var(--card)',
    }}>{label}</div>
  )

  const ResultsDropdown = ({ mobile = false }: { mobile?: boolean }) => (
    <div style={{
      position: mobile ? 'relative' : 'absolute',
      top: mobile ? undefined : 'calc(100% + 8px)',
      left: 0, right: 0,
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
      zIndex: 200,
      maxHeight: mobile ? 300 : 480,
      overflowY: 'auto',
      marginTop: mobile ? 6 : undefined,
    }}>
      {setResults.length > 0 && (
        <>
          <SectionHeader label="Sets" />
          {setResults.map((r, i) => {
            const globalIndex = i
            const isActive = activeIndex === globalIndex
            return (
              <div key={i} onMouseDown={() => navigateTo(r)} onMouseEnter={() => setActiveIndex(globalIndex)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: isActive ? 'var(--bg-light)' : 'transparent', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}>
                <span style={{ fontSize: 20 }}>📦</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
                </div>
              </div>
            )
          })}
        </>
      )}

      {cardResults.length > 0 && (
        <>
          <SectionHeader label="Cards" />
          {cardResults.map((r, i) => {
            const globalIndex = setResults.length + i
            const isActive = activeIndex === globalIndex
            return (
              <div key={i} onMouseDown={() => navigateTo(r)} onMouseEnter={() => setActiveIndex(globalIndex)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: isActive ? 'var(--bg-light)' : 'transparent', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}>
                {r.image_url ? (
                  <img src={r.image_url} alt={r.name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 32, height: 44, borderRadius: 3, flexShrink: 0, background: 'var(--bg-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🃏</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span>{r.subtitle}</span>
                    {r.card_number_display && (
                      <span style={{ background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 4, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>{r.card_number_display}</span>
                    )}
                  </div>
                </div>
                {r.price_usd && (
                  <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif", flexShrink: 0 }}>{formatPrice(r.price_usd)}</div>
                )}
              </div>
            )
          })}
        </>
      )}

      {pokemonResults.length > 0 && (
        <>
          <SectionHeader label="Pokémon" />
          {pokemonResults.map((r, i) => {
            const globalIndex = setResults.length + cardResults.length + i
            const isActive = activeIndex === globalIndex
            return (
              <div key={i} onMouseDown={() => navigateTo(r)} onMouseEnter={() => setActiveIndex(globalIndex)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: isActive ? 'var(--bg-light)' : 'transparent', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}>
                <span style={{ fontSize: 20 }}>⚡</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", textTransform: 'capitalize' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )

  return (
    <nav style={{
      background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
      padding: '0 24px', height: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 100,
      boxShadow: '0 2px 15px rgba(26,95,173,0.3)',
      gap: 16, overflow: 'visible',
    }}>

      {/* Mobile hamburger */}
      <button onClick={() => setMenuOpen(!menuOpen)} className="mobile-menu-btn"
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 8px', flexShrink: 0 }}>
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* Logo */}
      <Link href="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <img src="/logo.png" alt="PokePrices" style={{ height: 38, display: 'block' }} />
      </Link>

      {/* Search */}
      <div ref={searchRef} style={{ flex: 1, maxWidth: 500, margin: '0 16px', position: 'relative' }} className="nav-search">
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, opacity: 0.5, pointerEvents: 'none' }}>🔍</span>
          <input
            value={query}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => allResults.length > 0 && setShowResults(true)}
            placeholder="Search cards, sets, Pokémon... try 'Pikachu 50' or '4/102'"
            style={{
              width: '100%', padding: '8px 36px 8px 36px', borderRadius: 10,
              border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff',
              fontSize: 13, fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box',
            }}
          />
          {searching && (
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>...</span>
          )}
        </div>
        {showResults && allResults.length > 0 && <ResultsDropdown />}
      </div>

      {/* Desktop nav */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexShrink: 0 }} className="desktop-nav">
        {navLinks.map((item) => (
          <Link key={item.label} href={item.href} style={{
            color: item.label === 'Studio' ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
            textDecoration: 'none', fontSize: 13, fontWeight: 700,
            letterSpacing: 0.3, whiteSpace: 'nowrap',
            ...(item.label === 'Studio' ? {
              background: 'rgba(255,203,5,0.15)',
              border: '1px solid rgba(255,203,5,0.3)',
              padding: '4px 12px', borderRadius: 20,
            } : {}),
          }}>{item.label}</Link>
        ))}
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div style={{
          position: 'absolute', top: 60, left: 0, right: 0,
          background: 'linear-gradient(135deg, #15509a, #2268b8)',
          padding: '12px 24px 16px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.15)', zIndex: 99,
        }}>
          <div style={{ marginBottom: 12, position: 'relative' }}>
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
            {showResults && allResults.length > 0 && <ResultsDropdown mobile />}
          </div>
          {navLinks.map((item) => (
            <Link key={item.label} href={item.href} onClick={() => setMenuOpen(false)}
              style={{
                display: 'block', color: item.label === 'Studio' ? 'var(--accent)' : 'rgba(255,255,255,0.9)',
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
          .nav-search { display: block !important; }
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
