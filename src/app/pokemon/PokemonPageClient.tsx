'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'

const PAGE_SIZE = 100

interface PokemonEntry {
  id: number
  name: string
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
      const [speciesRes, countRes] = await Promise.all([
        supabase
          .from('pokemon_species_stats')
          .select('species_name, species_id, card_count, max_raw_usd')
          .order('species_id', { ascending: true }),
        supabase
          .from('cards')
          .select('id', { count: 'exact', head: true })
          .eq('is_sealed', false),
      ])

      const totalCards = countRes.count ?? 0
      const rows = speciesRes.data ?? []

      // Fill in any species not yet in stats table (species_id 1-1025 with 0 cards)
      // by also fetching the full species list
      const { data: allSpecies } = await supabase
        .from('pokemon_species')
        .select('id, name')
        .order('id', { ascending: true })

      const statsMap: Record<string, { card_count: number; max_raw_usd: number | null }> = {}
      rows.forEach((r: any) => {
        statsMap[r.species_name] = { card_count: r.card_count, max_raw_usd: r.max_raw_usd }
      })

      const entries: PokemonEntry[] = (allSpecies ?? []).map((s: any) => ({
        id: s.id,
        name: s.name,
        cardCount: statsMap[s.name]?.card_count ?? 0,
        maxPrice: statsMap[s.name]?.max_raw_usd ?? null,
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
      <BreadcrumbSchema items={[{ name: 'Pokémon' }]} />
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: '0 0 6px', color: 'var(--text)' }}>
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
                <div
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                    padding: '14px 12px', transition: 'border-color 0.15s, transform 0.15s', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
                  }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}
                >
                  <div style={{ width: 80, height: 80, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
