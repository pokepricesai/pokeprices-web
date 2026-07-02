'use client'
import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { trackEvent } from '@/lib/analytics'
import Avatar from './Avatar'
import ComingSoonBadge from './ComingSoonBadge'
import MarketplaceSelector from './affiliate/MarketplaceSelector'

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

// Block 5A-W-40A-FIX — trimmed to only labels with a real, working
// destination.
//
// History:
//   * W40A split "Cards" and "Sets" into two top-level items, both
//     pointing at /browse (Sets used the /browse#sets fallback since
//     no dedicated /sets route exists yet). Two items resolving to the
//     same page felt broken, so this fix consolidates them.
//   * W40A also added a top-level "Market" item pointing at the
//     /#market-movers anchor. The matching id doesn't exist on the
//     homepage yet (deferred to W40B), so the link currently just
//     lands at the top of the homepage. Removed for now — W40B can
//     reintroduce Market once the anchor / dedicated route lands.
//
// Final W40A-FIX top level (5 items):
//   Cards & Sets · Pokémon · Tools ▼ · Insights · Ask AI
//
// No emoji-led labels — the hard constraint from the W40 design
// brief still applies to every item below.
const NAV: NavGroup[] = [
  { label: 'Cards & Sets', href: '/browse'  },
  { label: 'Pokémon',      href: '/pokemon' },
  {
    label: 'Tools',
    href: '/tools',   // header itself is clickable on desktop — hover still opens the dropdown
    items: [
      // Free first — advertises that value is accessible immediately
      { label: 'Grading Calculator', href: '/dashboard/grading' },
      { label: 'Trade Evaluator',    href: '/dealer' },
      { label: 'Studio',             href: '/studio' },
      { label: 'Visualisations',     href: '/visualisations', badge: 'New' },
      // Gated (still clickable — tool pages handle login wall)
      { label: 'Quick Price Checker',href: '/dashboard/quick-price', gated: true },
      { label: 'Card Show Planner',  href: '/dashboard/card-shows',  gated: true },
      { label: 'Portfolio',          href: '/dashboard/portfolio',   gated: true },
      { label: 'Watchlist & Alerts', href: '/dashboard/watchlist-alerts', gated: true },
      { label: 'Set Completion',     href: '/dashboard/sets',             gated: true },
    ],
    footer: { label: 'View All Tools →', href: '/tools' },
  },
  { label: 'Insights', href: '/insights' },
  { label: 'Ask AI',   href: '/ai-assistant' },
]

// Demoted items — surfaced in the footer and in the mobile drawer's
// "More" section, no longer in the top-level nav.
const MOBILE_MORE_LINKS: NavItem[] = [
  { label: 'Content Creators',    href: '/creators' },
  { label: 'Vendors & Dealers',   href: '/vendors' },
  { label: 'Upcoming Card Shows', href: '/card-shows' },
  { label: 'Submit a Listing',    href: '/creators/submit' },
  { label: 'Games',               href: '/games' },
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

// Avatar primitives (sprite-or-initial fallback) live in components/Avatar.tsx.

const mobAuthLink: React.CSSProperties = {
  display: 'block', color: '#fff', textDecoration: 'none',
  background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.20)',
  padding: '10px 12px', borderRadius: 10, fontSize: 14, fontWeight: 700,
  fontFamily: "'Figtree', sans-serif", boxSizing: 'border-box',
}

function ProfileLink({ href, label, onClose }: { href: string; label: string; onClose: () => void }) {
  return (
    <Link href={href} onClick={onClose}
      style={{ display: 'block', padding: '8px 14px', fontSize: 13, fontWeight: 600, color: 'var(--text)', textDecoration: 'none', fontFamily: "'Figtree', sans-serif" }}
      onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = 'var(--bg-light)'}
      onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'}
    >
      {label}
    </Link>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function Navbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen]         = useState(false)
  const [openGroup, setOpenGroup]       = useState<string | null>(null)
  const [mobileExpanded, setMobileExp]  = useState<string | null>(null)
  const [query, setQuery]               = useState('')
  const [allResults, setAllResults]     = useState<SearchResult[]>([])
  const [searching, setSearching]       = useState(false)
  const [showResults, setShowResults]   = useState(false)
  const [activeIndex, setActiveIndex]   = useState(-1)
  const [isAuthed, setIsAuthed]         = useState(false)
  const [user, setUser]                 = useState<{ id: string; email: string | null; displayName: string; avatarPokemonId: number | null } | null>(null)
  const [profileOpen, setProfileOpen]   = useState(false)
  const debounceRef = useRef<NodeJS.Timeout>()
  const searchRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<NodeJS.Timeout>()

  useEffect(() => {
    function applySession(session: any) {
      setIsAuthed(!!session)
      if (session?.user) {
        const u = session.user
        const display = u.user_metadata?.display_name || (u.email ? u.email.split('@')[0] : 'Collector')
        const rawPid = u.user_metadata?.avatar_pokemon_id
        const pid = typeof rawPid === 'number' ? rawPid : null
        setUser({ id: u.id, email: u.email ?? null, displayName: display, avatarPokemonId: pid })
      } else {
        setUser(null)
      }
    }
    supabase.auth.getSession().then(({ data: { session } }) => applySession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => applySession(session))
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
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Hover-open dropdowns with a small grace delay on leave so flicking the
  // cursor down to a long menu doesn't snap it shut mid-motion.
  function hoverOpen(label: string) {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    setOpenGroup(label)
  }
  function hoverClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => setOpenGroup(null), 140)
  }

  async function handleSignOut() {
    setProfileOpen(false)
    trackEvent('logout_completed', { source_component: 'navbar' })
    await supabase.auth.signOut()
    router.push('/')
  }

  // Close dropdowns + mobile menu on route change so they do not linger
  // after navigation. The previous effect had empty deps, which meant it
  // ran once on mount and never again.
  useEffect(() => {
    setOpenGroup(null); setMenuOpen(false); setMobileExp(null)
    setShowResults(false); setProfileOpen(false)
  }, [pathname])

  // Lock body scroll when the mobile menu is open so it does not double-scroll.
  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

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
        {item.badge && !disabled && <ComingSoonBadge tone="new" label={item.badge} />}
        {disabled && <ComingSoonBadge variant="dark" />}
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
          {group.badge && <ComingSoonBadge tone="new" label={group.badge} />}
        </Link>
      )
    }
    // Hover container — wraps both trigger and the dropdown panel so the
    // pointer can move from the trigger into the menu without closing it.
    // When the group has its own href (e.g. Tools -> /tools), the trigger
    // becomes a Link so clicking the header navigates while hover still
    // shows the dropdown of nested items.
    const triggerSharedStyle: React.CSSProperties = {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: isOpen ? 'rgba(255,255,255,0.12)' : 'transparent',
      border: 'none', cursor: 'pointer',
      color: 'rgba(255,255,255,0.92)',
      fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
      padding: '6px 10px', borderRadius: 8, whiteSpace: 'nowrap',
      fontFamily: "'Figtree', sans-serif",
      textDecoration: 'none',
    }
    return (
      <div style={{ position: 'relative' }}
        onMouseEnter={() => hoverOpen(group.label)}
        onMouseLeave={hoverClose}
      >
        {group.href ? (
          <Link href={group.href} style={triggerSharedStyle}>
            {group.label} <ChevronDown />
          </Link>
        ) : (
          <button onClick={() => setOpenGroup(isOpen ? null : group.label)}
            style={triggerSharedStyle}>
            {group.label} <ChevronDown />
          </button>
        )}
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
              // 16px to prevent iOS Safari auto-zoom on focus. Anything
              // smaller triggers the zoom-in. Visual size unchanged on
              // desktop where the field sits in a narrow nav slot.
              fontSize: 16, fontFamily: "'Figtree', sans-serif", outline: 'none', boxSizing: 'border-box',
            }}
          />
          {searching && (
            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>...</span>
          )}
        </div>
        {showResults && allResults.length > 0 && <ResultsDropdown />}
      </div>

      {/* Block 5A-W-40A — the previous emoji-led yellow AI pill was
          removed. The AI assistant now lives in the primary NAV as a
          text-only Ask AI item alongside Insights. */}

      {/* Marketplace selector — only renders when 2+ marketplaces configured */}
      <div className="marketplace-selector-wrap" style={{ flexShrink: 0 }}>
        <MarketplaceSelector size="sm" ariaLabel="eBay marketplace" />
      </div>

      {/* Auth area — Sign in + Sign up free when logged out; Dashboard link + profile menu when logged in */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} className="auth-area">
        {isAuthed && user ? (
          <>
            {/* Block 5A-W-40A — Dashboard was previously only reachable
                by clicking the avatar. Adding a direct text link makes
                the destination discoverable and matches the browse-first
                priority of the redesigned nav. */}
            <Link href="/dashboard" className="dashboard-link"
              style={{
                display: 'inline-flex', alignItems: 'center',
                color: '#fff', textDecoration: 'none',
                fontSize: 13, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
                padding: '6px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.15)',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              Dashboard
            </Link>
            <div ref={profileRef} style={{ position: 'relative' }}
            onMouseEnter={() => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); setProfileOpen(true) }}
            onMouseLeave={() => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); closeTimerRef.current = setTimeout(() => setProfileOpen(false), 160) }}
          >
            <button onClick={() => setProfileOpen(o => !o)}
              aria-label="Account menu"
              style={{
                background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                borderRadius: '50%',
                boxShadow: profileOpen ? '0 0 0 3px rgba(255,255,255,0.18)' : 'none',
                transition: 'box-shadow 0.15s',
              }}>
              <Avatar
                pokemonId={user.avatarPokemonId}
                seed={user.id}
                displayName={user.displayName}
                email={user.email}
                size={36}
                ringColour="rgba(255,255,255,0.45)"
              />
            </button>

            {profileOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                minWidth: 240, background: 'var(--card)',
                border: '1px solid var(--border)', borderRadius: 12,
                boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
                padding: '6px 0', zIndex: 150,
                fontFamily: "'Figtree', sans-serif",
              }}>
                {/* Header — name + email */}
                <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar
                    pokemonId={user.avatarPokemonId}
                    seed={user.id}
                    displayName={user.displayName}
                    email={user.email}
                    size={36}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.displayName}</div>
                    {user.email && <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>}
                  </div>
                </div>

                <ProfileLink href="/dashboard"             label="Dashboard" onClose={() => setProfileOpen(false)} />
                <ProfileLink href="/dashboard/portfolio"   label="Portfolio" onClose={() => setProfileOpen(false)} />
                <ProfileLink href="/dashboard/watchlist-alerts" label="Watchlist & Alerts" onClose={() => setProfileOpen(false)} />

                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0' }} />
                <ProfileLink href="/dashboard/settings"    label="Settings"  onClose={() => setProfileOpen(false)} />

                <button onClick={handleSignOut}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: '8px 14px', fontSize: 13, fontWeight: 600,
                    color: '#ef4444', fontFamily: "'Figtree', sans-serif",
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.08)'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = 'transparent'}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
          </>
        ) : (
          <>
            <Link href="/dashboard/login" style={{
              color: 'rgba(255,255,255,0.9)', textDecoration: 'none',
              fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', padding: '5px 10px',
            }}>Sign in</Link>
            <Link href="/dashboard/login?mode=signup" style={{
              color: '#0f172a', background: 'var(--accent)',
              textDecoration: 'none', fontSize: 13, fontWeight: 800,
              padding: '7px 14px', borderRadius: 20, whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(255,203,5,0.35)',
            }}>Sign up free</Link>
          </>
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
                  {group.badge && <span style={{ marginLeft: 8, display: 'inline-flex', verticalAlign: 'middle' }}><ComingSoonBadge tone="new" label={group.badge} /></span>}
                </Link>
              )
            }
            const isOpen = mobileExpanded === group.label
            return (
              <div key={group.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <button onClick={() => setMobileExp(isOpen ? null : group.label)}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', color: '#fff', padding: '14px 0', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: "'Figtree', sans-serif" }}>
                  <span>{group.label}</span>
                  <span style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', opacity: 0.75 }}><ChevronDown size={16} /></span>
                </button>
                {isOpen && group.items && (
                  <div style={{ padding: '4px 0 12px 12px' }}>
                    {group.items.map(it => {
                      const disabled = it.comingSoon
                      const content = (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', fontSize: 14, color: disabled ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.92)', opacity: disabled ? 0.6 : 1, fontFamily: "'Figtree', sans-serif" }}>
                          {it.gated && <span style={{ display: 'inline-flex' }}><LockIcon size={11} /></span>}
                          <span style={{ flex: 1 }}>{it.label}</span>
                          {it.badge && !disabled && <ComingSoonBadge tone="new" label={it.badge} />}
                          {disabled && <ComingSoonBadge variant="light" />}
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
            {isAuthed && user ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0' }}>
                  <Avatar
                    pokemonId={user.avatarPokemonId}
                    seed={user.id}
                    displayName={user.displayName}
                    email={user.email}
                    size={36}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.displayName}</div>
                    {user.email && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.email}</div>}
                  </div>
                </div>
                <Link href="/dashboard"           onClick={() => setMenuOpen(false)} style={mobAuthLink}>Dashboard</Link>
                <Link href="/dashboard/portfolio" onClick={() => setMenuOpen(false)} style={mobAuthLink}>Portfolio</Link>
                <Link href="/dashboard/watchlist-alerts" onClick={() => setMenuOpen(false)} style={mobAuthLink}>Watchlist &amp; Alerts</Link>
                <Link href="/dashboard/settings"  onClick={() => setMenuOpen(false)} style={mobAuthLink}>Settings</Link>
                <button onClick={async () => { await handleSignOut(); setMenuOpen(false) }}
                  style={{ ...mobAuthLink, background: 'transparent', border: '1px solid rgba(239,68,68,0.45)', color: '#fecaca', textAlign: 'left', cursor: 'pointer' }}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/dashboard/login?mode=signup" onClick={() => setMenuOpen(false)} style={{
                  display: 'block', textAlign: 'center', color: '#0f172a',
                  textDecoration: 'none', background: 'var(--accent)',
                  padding: '12px', borderRadius: 10, fontSize: 15, fontWeight: 800,
                }}>Sign up free</Link>
                <Link href="/dashboard/login" onClick={() => setMenuOpen(false)} style={{
                  display: 'block', textAlign: 'center', color: '#fff',
                  textDecoration: 'none', padding: '10px', fontSize: 14, fontWeight: 700,
                }}>Sign in</Link>
              </>
            )}
          </div>

          {/* Block 5A-W-40A — "More" section holds the items demoted
              from the top-level nav (Creators, Vendors, Card Shows,
              Submit a Listing, Games). Kept visible on mobile so
              they're one tap away without cluttering the primary nav. */}
          <div style={{ marginTop: 22, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
            <p style={{
              color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '0 0 6px',
              textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700,
              fontFamily: "'Figtree', sans-serif",
            }}>More</p>
            {MOBILE_MORE_LINKS.map(it => (
              <Link key={it.label} href={it.href!} onClick={() => setMenuOpen(false)}
                style={{
                  display: 'block', color: 'rgba(255,255,255,0.85)', textDecoration: 'none',
                  padding: '10px 0', fontSize: 13.5, fontWeight: 600,
                  fontFamily: "'Figtree', sans-serif",
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {it.label}
              </Link>
            ))}
          </div>

          {/* Close affordance — covers the case where the user has scrolled
              far from the hamburger and needs a quick way back. */}
          <button onClick={() => setMenuOpen(false)}
            style={{
              display: 'block', width: '100%', marginTop: 18, padding: '10px',
              background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
              color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 700,
              borderRadius: 10, cursor: 'pointer', fontFamily: "'Figtree', sans-serif",
              textTransform: 'uppercase', letterSpacing: 1.5,
            }}
          >
            Close menu
          </button>
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
          .ai-cta-label { display: none !important; }
          .ai-cta { padding: 6px 9px !important; }
        }
      `}</style>
    </nav>
  )
}
