'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const PAGE_SIZE = 100

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
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'id' | 'cards' | 'price' | 'name'>('id')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<{
    totalPokemon: number
    totalCards: number
    mostCards: PokemonEntry | null
    mostExpensive: PokemonEntry | null
  }>({ totalPokemon: 0, totalCards: 0, mostCards: null, mostExpensive: null })

  useEffect(() => {
    async function load() {
      const [pokeRes, countRes] = await Promise.all([
        fetch('https://pokeapi.co/api/v2/pokemon?limit=1025&offset=0'),
        // Count all non-sealed cards from cards table — correct total
        supabase.from('cards').select('id', { count: 'exact', head: true }).eq('is_sealed', false),
      ])

      const json = await pokeRes.json()
      const speciesList: { name: string; url: string }[] = json.results
      const totalCards = countRes.count ?? 0

      // Fetch all non-sealed card names for count mapping (paginated)
      let allCardNames: { card_name: string }[] = []
      let cPage = 0, cDone = false
      while (!cDone) {
        const { data, error } = await supabase
          .from('cards').select('card_name').eq('is_sealed', false)
          .range(cPage * 1000, cPage * 1000 + 999)
        if (error || !data || data.length === 0) { cDone = true; break }
        allCardNames = [...allCardNames, ...data]
        if (data.length < 1000) cDone = true
        cPage++
      }

      // Fetch priced cards from card_trends for max price mapping (paginated)
      let allPricedCards: { card_name: string; current_raw: number | null }[] = []
      let pPage = 0, pDone = false
      while (!pDone) {
        const { data, error } = await supabase
          .from('card_trends').select('card_name, current_raw')
          .not('current_raw', 'is', null)
          .range(pPage * 1000, pPage * 1000 + 999)
        if (error || !data || data.length === 0) { pDone = true; break }
        allPricedCards = [...allPricedCards, ...data]
        if (data.length < 1000) pDone = true
        pPage++
      }

      // Build count map from all cards
      const countMap: Record<string, number> = {}
      allCardNames.forEach((card: any) => {
        const cardNameLower = card.card_name?.toLowerCase() ?? ''
        speciesList.forEach(s => {
          const pName = s.name.toLowerCase()
          const escapedName = pName.replace(/-/g, '[- ]').replace(/\./g, '\\.')
          const regex = new RegExp(`(?<![a-z])${escapedName}(?![a-z])`, 'i')
          if (regex.test(cardNameLower)) {
            countMap[s.name] = (countMap[s.name] ?? 0) + 1
          }
        })
      })

      // Build price map from priced cards
      const priceMap: Record<string, number> = {}
      allPricedCards.forEach((card: any) => {
        const cardNameLower = card.card_name?.toLowerCase() ?? ''
        speciesList.forEach(s => {
          const pName = s.name.toLowerCase()
          const escapedName = pName.replace(/-/g, '[- ]').replace(/\./g, '\\.')
          const regex = new RegExp(`(?<![a-z])${escapedName}(?![a-z])`, 'i')
          if (regex.test(cardNameLower)) {
            const price = card.current_raw ? Number(card.current_raw) : null
            if (price && (!priceMap[s.name] || price > priceMap[s.name])) {
              priceMap[s.name] = price
            }
          }
        })
      })

      const entries: PokemonEntry[] = speciesList.map((s, i) => ({
        id: i + 1,
        name: s.name,
        types: [],
        cardCount: countMap[s.name] ?? 0,
        maxPrice: priceMap[s.name] ?? null,
      }))

      const mostCards = [...entries].sort((a, b) => b.cardCount - a.cardCount)[0] ?? null
      const mostExpensive = [...entries].sort((a, b) => (b.maxPrice ?? 0) - (a.maxPrice ?? 0))[0] ?? null

      setPokemon(entries)
      setFiltered(entries)
      setStats({ totalPokemon: entries.length, totalCards, mostCards, mostExpensive })
      setLoading(false)
    }
    load()
  }, [])

  // Filter + sort — resets visible count on any change
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
    setVisible(PAGE_SIZE)
  }, [search, sort, pokemon])

  const capitalize = (s: string) => s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
  const visiblePokemon = filtered.slice(0, visible)
  const hasMore = visible < filtered.length

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, margin: '0 0 6px', color: 'var(--text)' }}>
          Pokémon
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'Figtree', sans-serif", margin: 0 }}>
          All {stats.totalPokemon} species — click any Pokémon to see every card it appears on with live prices.
        </p>
      </div>

      {/* Stats */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Total Species', value: stats.totalPokemon.toLocaleString() },
            { label: 'Cards in Database', value: stats.totalCards.toLocaleString() },
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
            <div key={i} className="skeleton" style={{ height: 180, borderRadius: 12 }} />
          ))}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 12 }}>
            Showing {Math.min(visible, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} Pokémon
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {visiblePokemon.map(p => (
              <Link key={p.id} href={`/pokemon/${p.name}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '14px 12px', transition: 'border-color 0.15s, transform 0.15s', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
                }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}
                >
                  {/* Fixed container so all cards are same height regardless of image size */}
                  <div style={{
                    width: 80, height: 80, marginBottom: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <img
                      src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`}
                      alt={capitalize(p.name)}
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
                      loading="lazy"
                    />
                  </div>
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
                    <div style={{ fontSize: 11, color: 'var(--border)', fontFamily: "'Figtree', sans-serif" }}>No cards</div>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Load more button */}
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 32 }}>
              <button
                onClick={() => setVisible(v => v + PAGE_SIZE)}
                style={{
                  padding: '12px 32px', borderRadius: 10, border: '1px solid var(--border)',
                  background: 'var(--card)', color: 'var(--text)', fontSize: 14, fontWeight: 700,
                  fontFamily: "'Figtree', sans-serif", cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--primary)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)' }}
              >
                Load more · showing {Math.min(visible, filtered.length)} of {filtered.length}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
