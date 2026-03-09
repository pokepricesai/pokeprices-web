'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// Type colours matching the site's palette
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  fire:     { bg: '#FF6B35', text: '#fff' },
  water:    { bg: '#4A90D9', text: '#fff' },
  grass:    { bg: '#56C271', text: '#fff' },
  electric: { bg: '#F5C518', text: '#1a1a1a' },
  psychic:  { bg: '#E8538F', text: '#fff' },
  ice:      { bg: '#74CEC0', text: '#1a1a1a' },
  dragon:   { bg: '#6B5FA6', text: '#fff' },
  dark:     { bg: '#4A3728', text: '#fff' },
  fairy:    { bg: '#F4A7C3', text: '#1a1a1a' },
  fighting: { bg: '#C03028', text: '#fff' },
  poison:   { bg: '#9B59B6', text: '#fff' },
  ground:   { bg: '#C49A3C', text: '#fff' },
  rock:     { bg: '#B8A038', text: '#fff' },
  bug:      { bg: '#8CB820', text: '#fff' },
  ghost:    { bg: '#5B4F8A', text: '#fff' },
  steel:    { bg: '#9EB8D0', text: '#1a1a1a' },
  normal:   { bg: '#A8A878', text: '#fff' },
  flying:   { bg: '#8EC8F0', text: '#1a1a1a' },
}

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type] ?? { bg: 'var(--bg-light)', text: 'var(--text)' }
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
      background: c.bg, color: c.text, fontFamily: "'Figtree', sans-serif",
    }}>{type}</span>
  )
}

interface PokemonEntry {
  id: number
  name: string
  types: string[]
  cardCount: number
  maxPrice: number | null
}

export default function PokemonPageClient() {
  const [pokemon, setPokemon] = useState<PokemonEntry[]>([])
  const [filtered, setFiltered] = useState<PokemonEntry[]>([])
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sort, setSort] = useState<'id' | 'cards' | 'price' | 'name'>('id')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<{ totalPokemon: number; totalCards: number; mostCards: PokemonEntry | null; mostExpensive: PokemonEntry | null }>({
    totalPokemon: 0, totalCards: 0, mostCards: null, mostExpensive: null,
  })

  useEffect(() => {
    async function load() {
      // Fetch PokeAPI list + paginate ALL card_trends rows (bypassing 1000-row limit)
      // Exclude sealed products from counts
      const [pokeRes] = await Promise.all([
        fetch('https://pokeapi.co/api/v2/pokemon?limit=1025&offset=0'),
      ])
      const json = await pokeRes.json()
      const speciesList: { name: string; url: string }[] = json.results

      // Paginate card_trends to get every row, not just first 1000
      let allCards: { card_name: string; current_raw: number | null }[] = []
      let page = 0
      let done = false
      while (!done) {
        const { data, error } = await supabase
          .from('card_trends')
          .select('card_name, current_raw')
          .not('current_raw', 'is', null)
          .range(page * 1000, page * 1000 + 999)
        if (error || !data || data.length === 0) { done = true; break }
        allCards = [...allCards, ...data]
        if (data.length < 1000) done = true
        page++
      }

      // Get sealed product names so we can exclude them
      const sealedNames = new Set<string>()
      let sPage = 0
      let sDone = false
      while (!sDone) {
        const { data } = await supabase
          .from('cards')
          .select('card_name')
          .eq('is_sealed', true)
          .range(sPage * 1000, sPage * 1000 + 999)
        if (!data || data.length === 0) { sDone = true; break }
        data.forEach((c: any) => sealedNames.add(c.card_name?.toLowerCase()))
        if (data.length < 1000) sDone = true
        sPage++
      }

      // Filter out sealed products
      const cardData = allCards.filter(c => !sealedNames.has(c.card_name?.toLowerCase()))

      // Build card count + max price map per pokemon species
      // Use negative lookahead/lookbehind to avoid partial matches
      // e.g. "pikachu" matches "Pikachu ex" but NOT "Pikachu GX & Eevee GX"
      const cardMap: Record<string, { count: number; maxPrice: number | null }> = {}
      cardData.forEach((card: any) => {
        const cardNameLower = card.card_name?.toLowerCase() ?? ''
        speciesList.forEach(s => {
          const pName = s.name.toLowerCase()
          const escapedName = pName.replace(/-/g, '[- ]').replace(/\./g, '\\.')
          // Word boundary: not preceded or followed by a letter
          const regex = new RegExp(`(?<![a-z])${escapedName}(?![a-z])`, 'i')
          if (regex.test(cardNameLower)) {
            if (!cardMap[s.name]) cardMap[s.name] = { count: 0, maxPrice: null }
            cardMap[s.name].count++
            const price = card.current_raw ? Number(card.current_raw) : null
            if (price && (!cardMap[s.name].maxPrice || price > cardMap[s.name].maxPrice!)) {
              cardMap[s.name].maxPrice = price
            }
          }
        })
      })

      const entries: PokemonEntry[] = speciesList.map((s, i) => ({
        id: i + 1,
        name: s.name,
        types: [],
        cardCount: cardMap[s.name]?.count ?? 0,
        maxPrice: cardMap[s.name]?.maxPrice ?? null,
      }))

      const mostCards = [...entries].sort((a, b) => b.cardCount - a.cardCount)[0] ?? null
      const mostExpensive = [...entries].sort((a, b) => (b.maxPrice ?? 0) - (a.maxPrice ?? 0))[0] ?? null

      setPokemon(entries)
      setFiltered(entries)
      setStats({
        totalPokemon: entries.length,
        totalCards: cardData.length,
        mostCards,
        mostExpensive,
      })
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    let result = [...pokemon]
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(p =>
        p.name.includes(q) || String(p.id).padStart(3, '0').includes(q)
      )
    }
    if (sort === 'id')    result.sort((a, b) => a.id - b.id)
    if (sort === 'cards') result.sort((a, b) => b.cardCount - a.cardCount)
    if (sort === 'price') result.sort((a, b) => (b.maxPrice ?? 0) - (a.maxPrice ?? 0))
    if (sort === 'name')  result.sort((a, b) => a.name.localeCompare(b.name))
    setFiltered(result)
  }, [search, sort, pokemon])

  const capitalize = (s: string) => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, margin: '0 0 6px', color: 'var(--text)' }}>
          Pokémon
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: 0 }}>
          All {stats.totalPokemon} species — click any Pokémon to see every card it appears on with live prices.
        </p>
      </div>

      {/* Stats row */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Total Species', value: stats.totalPokemon.toLocaleString() },
            { label: 'Cards in DB', value: stats.totalCards.toLocaleString() },
            { label: 'Most Cards', value: stats.mostCards ? `${capitalize(stats.mostCards.name)} (${stats.mostCards.cardCount})` : '—' },
            { label: 'Highest Card Value', value: stats.mostExpensive?.maxPrice ? `$${(stats.mostExpensive.maxPrice / 100).toFixed(0)} — ${capitalize(stats.mostExpensive.name)}` : '—' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 5 }}>{s.value}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + sort */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search Pokémon..."
          style={{ flex: 1, minWidth: 200, padding: '10px 16px', fontSize: 14, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--text)', fontFamily: "'Figtree', sans-serif", outline: 'none' }}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['id', 'cards', 'price', 'name'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`sort-btn ${sort === s ? 'active' : ''}`}
              style={{ fontFamily: "'Figtree', sans-serif" }}>
              {s === 'id' ? 'Pokédex #' : s === 'cards' ? 'Most Cards' : s === 'price' ? 'Highest Value' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 160, borderRadius: 12 }} />
          ))}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 12 }}>
            Showing {filtered.length.toLocaleString()} Pokémon
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {filtered.map(p => (
              <Link key={p.id} href={`/pokemon/${p.name}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '14px 12px', textAlign: 'center', transition: 'border-color 0.15s, transform 0.15s',
                  cursor: 'pointer',
                }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}
                >
                  <img
                    src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`}
                    alt={p.name}
                    style={{ width: 80, height: 80, objectFit: 'contain' }}
                    loading="lazy"
                  />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 2 }}>
                    #{String(p.id).padStart(3, '0')}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
                    {capitalize(p.name)}
                  </div>
                  {p.cardCount > 0 ? (
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
                      {p.cardCount} card{p.cardCount !== 1 ? 's' : ''}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--border)', fontFamily: "'Figtree', sans-serif" }}>
                      No cards
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
