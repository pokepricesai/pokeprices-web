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

function formatPrice(cents: number | null) {
  if (!cents) return null
  const gbp = (cents / 100) * 0.79
  return `£${gbp.toFixed(2)}`
}

// ── Menu structure ──────────────────────────────────────────────────────────
// Each top-level entry is either a direct link (`href`) or a dropdown group
// (`items`). Items can be coming-soon (greyed, non-clickable) or gated
// (shown with a lock icon — the click still works; gated tool pages handle
// their own login walls).

type NavItem = {
  label: string
  href?: string
  comingSoon?: boolean
  gated?: boolean
  badge?: string
  hint?: string
}

type NavGroup = {
  label: string
  href?: string             // direct link if no items
  badge?: string
  items?: NavItem[]
  footer?: { label: string; href: string }
}

const NAV: NavGroup[] = [
  {
    label: 'Prices',
    items: [
      { label: 'Browse cards & sets', href: '/browse' },
      { label: 'Browse Pokémon',      href: '/pokemon' },
      { label: 'Visualisations',      href: '/visualisations', badge: 'New' },
    ],
  },
  {
    label: 'Tools',
    items: [
      // Free first — advertises that value is accessible immediately
      { label: 'Grading calculator', href: '/dashboard/grading' },
      { label: 'Card show planner',  href: '/dashboard/card-shows' },
      { label: 'Trade evaluator',    comingSoon: true },
      // Gated (still clickable — tool pages handle login wall)
      { label: 'Portfolio',          href: '/dashboard/portfolio', gated: true },
      { label: 'Watchlist',          href: '/dashboard/watchlist', gated: true },
      { label: 'Set completion',     href: '/dashboard/sets',      gated: true },
      { label: 'Smart alerts',       href: '/dashboard/alerts',    gated: true },
      { label: 'Studio',             href: '/studio',              gated: true },
    ],
    footer: { label: 'View all tools →', href: '/tools' },
  },
  { label: 'Insights', href: '/insights' },
  {
    label: 'Community',
    items: [
      { label: 'Content creators',     href: '/creators' },
      { label: 'Vendors & dealers',    href: '/vendors' },
      { label: 'Upcoming card shows',  href: '/card-shows' },
      { label: 'Submit a listing',     href: '/creators/submit' },
    ],
  },
  { label: 'Games', href: '/games', badge: 'New' },
]

// ── Icons ───────────────────────────────────────────────────────────────────

function LockIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
    </svg>
  )
}

function ChevronDown({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function Navbar() {
  const router = useRouter()
  const [menuOpen, setMenuOpen]         = useState(false)
  const [openGroup, setOpenGroup]       = useState<string | null>(null)
  const [mobileExpanded, setMobileExp]  = useState<string | null>(null)
  const [query, setQuery]               = useState('')
  const [allResults, setAllResults]     = useState<SearchResult[]>([])
  const [searching, setSearching]       = useState(false)
  const [showResults, setShowResults]   = useState(false)
  const [activeIndex, setActiveIndex]   = useState(-1)
  const [isAuthed, setIsAuthed]         = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()
  const searchRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setIsAuthed(!!session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setIsAuthed(!!session))
    return () => subscription.unsubscribe()
  }, [])

  // Close any open dropdown / search when clicking outside.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null)
      }
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Close dropdowns on route change so they don't linger after navigation.
  useEffect(() => {
    setOpenGroup(null); setMenuOpen(false); setMobileExp(null)
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
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter')     { e.preventDefault(); const t = activeIndex >= 0 ? allResults[activeIndex] : allResults[0]; if (t) navigateTo(t) }
    else if (e.key === 'Escape')    setShowResults(false)
  }

  function navigateTo(result: SearchResult) {
    setShowResults(false); setQuery('')
    if (result.result_type === 'card')      router.push(`/set/${encodeURIComponent(result.subtitle)}/card/${result.url_slug}`)
    else if (result.result_type === 'set')  router.push(`/set/${encodeURIComponent(result.name)}`)
    else if (result.result_type === 'pokemon') router.push(`/pokemon/${result.url_slug.toLowerCase()}`)
  }

  const cardResults    = allResults.filter(r => r.result_type === 'card')
  const setResults     = allResults.filter(r => r.result_type === 'set')
  const pokemonResults = allResults.filter(r => r.result_type === 'pokemon')

  // ── Search results dropdown (unchanged behaviour) ─────────────────────────

  const SectionHeader = ({ label }: { label: string }) => (
    <div style={{
      padding: '8px 14px 4px', fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
      color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif",
      textTransform: 'uppercase', background: 'var(--card)',
    }}>{label}</div>
  )

  const ResultsDropdown = ({ mobile = false }: { mobile?: boolean }) => (
    <div style={{
      position: mobile ? 'relative' : 'absolute',
      top: mobile ? undefined : 'calc(100% + 8px)',
      left: 0, right: 0, background: 'var(--card)',
      border: '1px solid var(--border)', borderRadius: 14,
      boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
      zIndex: 200, maxHeight: mobile ? 300 : 480, overflowY: 'auto',
      marginTop: mobile ? 6 : undefined,
    }}>
      {setResults.length > 0 && (<>
        <SectionHeader label="Sets" />
        {setResults.map((r, i) => {
          const globalIndex = i; const isActive = activeIndex === globalIndex
          return (
            <div key={i} onMouseDown={() => navigateTo(r)} onMouseEnter={() => setActiveIndex(globalIndex)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: isActive ? 'var(--bg-light)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 20 }}>📦</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
              </div>
            </div>
          )
        })}
      </>)}
      {cardResults.length > 0 && (<>
        <SectionHeader label="Cards" />
        {cardResults.map((r, i) => {
          const globalIndex = setResults.length + i; const isActive = activeIndex === globalIndex
          return (
            <div key={i} onMouseDown={() => navigateTo(r)} onMouseEnter={() => setActiveIndex(globalIndex)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'pointer', background: isActive ? 'var(--bg-light)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
              {r.image_url
                ? <img src={r.image_url} alt={r.name} style={{ width: 32, height: 44, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                : <div style={{ width: 32, height: 44, borderRadius: 3, flexShrink: 0, background: 'var(--bg-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🃏</div>}
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
      </>)}
      {pokemonResults.length > 0 && (<>
        <SectionHeader label="Pokémon" />
        {pokemonResults.map((r, i) => {
          const globalIndex = setResults.length + cardResults.length + i; const isActive = activeIndex === globalIndex
          return (
            <div key={i} onMouseDown={() => navigateTo(r)} onMouseEnter={() => setActiveIndex(globalIndex)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: isActive ? 'var(--bg-light)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 20 }}>⚡</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", textTransform: 'capitalize' }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>{r.subtitle}</div>
              </div>
            </div>
          )
        })}
      </>)}
    </div>
  )

  // ── Desktop nav-group dropdown ────────────────────────────────────────────

  function NavItemRow({ item, onClose }: { item: NavItem; onClose: () => void }) {
    const disabled = item.comingSoon
    const inner = (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 14px',
        fontSize: 13, fontWeight: 600, fontFamily: "'Figtree', sans-serif",
        color: disabled ? 'var(--text-muted)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        textDecoration: 'none',
      }}>
        {item.gated && <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }} title="Sign in to use"><LockIcon /></span>}
        <span style={{ flex: 1 }}>{item.label}</span>
        {item.badge && !disabled && (
          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--accent)', background: 'rgba(255,203,5,0.18)', padding: '2px 7px', borderRadius: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>{item.badge}</span>
        )}
        {disabled && (
          <span style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', background: 'var(--bg-light)', border: '1px solid var(--border)', padding: '2px 7px', borderRadius: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>Coming soon</span>
        )}
      </div>
    )
    if (disabled || !item.href) {
      return <div>{inner}</div>
    }
    return (
      <Link href={item.href} onClick={onClose} style={{ display: 'block', textDecoration: 'none' }}
        onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-light)'}
        onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'}
      >
        {inner}
      </Link>
    )
  }

  function GroupTrigger({ group }: { group: NavGroup }) {
    const isOpen = openGroup === group.label
    if (group.href && !group.items) {
      return (
        <Link href={group.href} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          color: 'rgba(255,255,255,0.92)', textDecoration: 'none',
          fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
          padding: '6px 10px', borderRadius: 8, whiteSpace: 'nowrap',
        }}>
          {group.label}
          {group.badge && <span style={{ fontSize: 9, fontWeight: 800, color: '#0f172a', background: 'var(--accent)', padding: '1px 6px', borderRadius: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>{group.badge}</span>}
        </Link>
      )
    }
    return (
      <div style={{ position: 'relative' }}>
        <button onClick={() => setOpenGroup(isOpen ? null : group.label)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: isOpen ? 'rgba(255,255,255,0.12)' : 'transparent',
            border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,0.92)',
            fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
            padding: '6px 10px', borderRadius: 8, whiteSpace: 'nowrap',
            fontFamily: "'Figtree', sans-serif",
          }}>
          {group.label} <ChevronDown />
        </button>
        {isOpen && group.items && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            minWidth: 240, background: 'var(--card)',
            border: '1px solid var(--border)', borderRadius: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
            padding: '6px 0', zIndex: 150,
          }}>
            {group.items.map(it => <NavItemRow key={it.label} item={it} onClose={() => setOpenGroup(null)} />)}
            {group.footer && (
              <>
                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                <Link href={group.footer.href} onClick={() => setOpenGroup(null)}
                  style={{ display: 'block', padding: '8px 14px', fontSize: 12, fontWeight: 800, color: 'var(--primary)', textDecoration: 'none', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>
                  {group.footer.label}
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <nav style={{
      background: 'linear-gradient(135deg, #1a5fad, #2874c8)',
      padding: '0 20px', height: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 100,
      boxShadow: '0 2px 15px rgba(26,95,173,0.3)', gap: 14, overflow: 'visible',
    }}>
      <button onClick={() => setMenuOpen(!menuOpen)} className="mobile-menu-btn"
        style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: '4px 8px', flexShrink: 0 }}>
        {menuOpen ? '✕' : '☰'}
      </button>

      <Link href="/" style={{ textDecoration: 'none', flexShrink: 0 }}>
        <img src="/logo.png" alt="PokePrices" style={{ height: 36, display: 'block' }} />
      </Link>

      {/* Desktop nav groups */}
      <div ref={navRef} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} className="desktop-nav">
        {NAV.map(g => <GroupTrigger key={g.label} group={g} />)}
      </div>

      {/* Search */}
      <div ref={searchRef} style={{ flex: 1, maxWidth: 360, position: 'relative' }} className="nav-search">
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, opacity: 0.5, pointerEvents: 'none' }}>🔍</span>
          <input
            value={query}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => allResults.length > 0 && setShowResults(true)}
            placeholder="Search cards, sets, Pokémon…"
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

      {/* Auth area (Step 1 — unchanged; full overhaul comes in Step 2) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} className="auth-area">
        {isAuthed ? (
          <Link href="/dashboard" style={{
            color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 800,
            background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)',
            padding: '5px 12px', borderRadius: 20, whiteSpace: 'nowrap',
          }}>Dashboard</Link>
        ) : (
          <Link href="/dashboard/login" style={{
            color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
            padding: '5px 12px',
          }}>Sign in</Link>
        )}
      </div>

      {/* Mobile menu (accordions) */}
      {menuOpen && (
        <div style={{
          position: 'absolute', top: 60, left: 0, right: 0,
          background: 'linear-gradient(135deg, #15509a, #2268b8)',
          padding: '12px 20px 18px', boxShadow: '0 8px 20px rgba(0,0,0,0.15)', zIndex: 99,
          maxHeight: 'calc(100vh - 60px)', overflowY: 'auto',
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
              }} />
            {showResults && allResults.length > 0 && <ResultsDropdown mobile />}
          </div>

          {NAV.map(group => {
            if (group.href && !group.items) {
              return (
                <Link key={group.label} href={group.href} onClick={() => setMenuOpen(false)}
                  style={{ display: 'block', color: '#fff', textDecoration: 'none', padding: '12px 0', fontSize: 15, fontWeight: 800, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  {group.label}
                  {group.badge && <span style={{ fontSize: 9, fontWeight: 800, color: '#0f172a', background: 'var(--accent)', padding: '1px 6px', borderRadius: 10, letterSpacing: 0.5, textTransform: 'uppercase', marginLeft: 8 }}>{group.badge}</span>}
                </Link>
              )
            }
            const isOpen = mobileExpanded === group.label
            return (
              <div key={group.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <button onClick={() => setMobileExp(isOpen ? null : group.label)}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: '#fff', padding: '12px 0', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: "'Figtree', sans-serif" }}>
                  <span>{group.label}</span>
                  <span style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}><ChevronDown size={12} /></span>
                </button>
                {isOpen && group.items && (
                  <div style={{ padding: '4px 0 12px 12px' }}>
                    {group.items.map(it => {
                      const disabled = it.comingSoon
                      const content = (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', fontSize: 14, color: disabled ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.92)', opacity: disabled ? 0.6 : 1, fontFamily: "'Figtree', sans-serif" }}>
                          {it.gated && <span style={{ display: 'inline-flex' }}><LockIcon size={11} /></span>}
                          <span style={{ flex: 1 }}>{it.label}</span>
                          {it.badge && !disabled && <span style={{ fontSize: 9, fontWeight: 800, color: '#0f172a', background: 'var(--accent)', padding: '1px 6px', borderRadius: 10 }}>{it.badge}</span>}
                          {disabled && <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.65)' }}>Coming soon</span>}
                        </div>
                      )
                      if (disabled || !it.href) return <div key={it.label}>{content}</div>
                      return (
                        <Link key={it.label} href={it.href} onClick={() => setMenuOpen(false)} style={{ textDecoration: 'none' }}>
                          {content}
                        </Link>
                      )
                    })}
                    {group.footer && (
                      <Link href={group.footer.href} onClick={() => setMenuOpen(false)}
                        style={{ display: 'block', padding: '10px 0 4px', fontSize: 12, fontWeight: 800, color: 'var(--accent)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {group.footer.label}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {isAuthed ? (
              <Link href="/dashboard" onClick={() => setMenuOpen(false)} style={{
                display: 'block', textAlign: 'center', color: '#fff', textDecoration: 'none',
                background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)',
                padding: '10px', borderRadius: 10, fontSize: 14, fontWeight: 800,
              }}>Dashboard</Link>
            ) : (
              <Link href="/dashboard/login" onClick={() => setMenuOpen(false)} style={{
                display: 'block', textAlign: 'center', color: '#fff', textDecoration: 'none',
                background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.3)',
                padding: '10px', borderRadius: 10, fontSize: 14, fontWeight: 800,
              }}>Sign in</Link>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        input::placeholder { color: rgba(255,255,255,0.5); }
        @media (min-width: 1024px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: block !important; }
          .desktop-nav { display: flex !important; }
          .auth-area { display: flex !important; }
        }
        @media (max-width: 1023px) {
          .mobile-menu-btn { display: block !important; }
          .desktop-nav { display: none !important; }
          .nav-search { display: none !important; }
          .auth-area { display: none !important; }
        }
      `}</style>
    </nav>
  )
}
