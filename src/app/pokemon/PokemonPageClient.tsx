'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'
import FAQ from '@/components/FAQ'
import { getPokemonHubFaqItems } from '@/lib/faqs'

const PAGE_SIZE = 100

interface PokemonEntry {
  id: number
  name: string
  cardCount: number
  maxPrice: number | null
  totalValue: number
  typePrimary: string | null
  generation: number | null
}

export default function PokemonPageClient() {
  const [pokemon, setPokemon] = useState<PokemonEntry[]>([])
  const [filtered, setFiltered] = useState<PokemonEntry[]>([])
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'id' | 'cards' | 'price' | 'value' | 'name'>('id')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<{
    totalPokemon: number
    totalCards: number
    mostCards: PokemonEntry | null
    mostExpensive: PokemonEntry | null
  }>({ totalPokemon: 0, totalCards: 0, mostCards: null, mostExpensive: null })

  useEffect(() => {
    async function load() {
      // get_pokemon_species_list is paged at the RPC level — call it
      // multiple times to get every species, regardless of the PostgREST
      // 1,000-row cap.
      let all: any[] = []
      const PAGE = 500
      let offset = 0
      while (true) {
        const { data, error } = await supabase.rpc('get_pokemon_species_list', {
          p_lim: PAGE, p_offset: offset,
        })
        if (error || !data || data.length === 0) break
        all = all.concat(data)
        if (data.length < PAGE) break
        offset += PAGE
        if (all.length >= 5000) break
      }

      const [countRes] = await Promise.all([
        supabase.from('cards').select('id', { count: 'exact', head: true }).eq('is_sealed', false),
      ])

      const entries: PokemonEntry[] = all.map((r: any) => ({
        id:           r.id,
        name:         r.name,
        cardCount:    r.total_cards ?? 0,
        maxPrice:     r.highest_card_price_cents ?? null,
        totalValue:   Number(r.total_market_value_cents ?? 0),
        typePrimary:  r.type_primary ?? null,
        generation:   r.generation ?? null,
      }))

      const mostCards     = [...entries].sort((a, b) => b.cardCount - a.cardCount)[0] ?? null
      const mostExpensive = [...entries].sort((a, b) => (b.maxPrice ?? 0) - (a.maxPrice ?? 0))[0] ?? null

      setPokemon(entries)
      setFiltered(entries)
      setStats({
        totalPokemon: entries.length,
        totalCards:   countRes.count ?? 0,
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
    if (sort === 'value') result.sort((a, b) => b.totalValue - a.totalValue)
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
      {/* Dataset: catalog of all Pokémon species with TCG card data */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        '@id': 'https://www.pokeprices.io/pokemon#dataset',
        name: 'Pokémon Card Prices by Species — Master Dataset',
        description: `All ${pokemon.length || '1,025'} Pokémon species cross-referenced against every Pokémon TCG card they appear on, with raw and PSA 10 prices, PSA population data, and Pokédex info.`,
        url: 'https://www.pokeprices.io/pokemon',
        license: 'https://www.pokeprices.io/terms',
        creator: { '@id': 'https://www.pokeprices.io/#org' },
        publisher: { '@id': 'https://www.pokeprices.io/#org' },
        isAccessibleForFree: true,
        keywords: ['Pokémon by species', 'Pokémon card value', 'PSA 10 prices', 'Pokémon TCG database'],
        variableMeasured: ['Card count per species', 'Max card price per species', 'Pokédex info', 'Type, abilities, base stats'],
        temporalCoverage: '1999/..',
      }) }} />
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
          {(['id', 'cards', 'value', 'price', 'name'] as const).map(s => (
            <button key={s} onClick={() => setSort(s)}
              className={`sort-btn ${sort === s ? 'active' : ''}`}
              style={{ fontFamily: "'Figtree', sans-serif" }}>
              {s === 'id' ? 'Pokédex #' : s === 'cards' ? 'Most Cards' : s === 'value' ? 'Total Value' : s === 'price' ? 'Highest Single Card' : 'A–Z'}
            </button>
          ))}
        </div>
      </div>

      {/* Top species by total market value — internal-link booster for the
          most valuable species pages. Hidden when searching/sorting so it
          doesn't double up with the user's chosen view. */}
      {!loading && !search.trim() && sort === 'id' && (() => {
        const topByValue = [...pokemon]
          .filter(p => p.totalValue > 0)
          .sort((a, b) => b.totalValue - a.totalValue)
          .slice(0, 12)
        if (topByValue.length === 0) return null
        return (
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 6px', color: 'var(--text)' }}>
              Most Valuable Pokémon by Total Card Market
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px' }}>
              Sum of every card's current value across raw + PSA 10. Click any species to see all cards and prices.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
              {topByValue.map((p, i) => (
                <Link key={p.id} href={`/pokemon/${p.name}`} style={{ textDecoration: 'none' }}>
                  <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, transition: 'border-color 0.15s, transform 0.15s' }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}>
                    <span style={{ fontSize: 14, fontWeight: 900, color: i < 3 ? 'var(--primary)' : 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", minWidth: 22 }}>
                      {i + 1}
                    </span>
                    <img
                      src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`}
                      alt={capitalize(p.name)}
                      style={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0 }}
                      loading="lazy"
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {capitalize(p.name)}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {p.cardCount} cards · ${p.totalValue >= 1_000_000 ? `${(p.totalValue / 1_000_000 / 100).toFixed(1)}M` : p.totalValue >= 100_000 ? `${(p.totalValue / 100_000 / 10).toFixed(0)}k` : `${(p.totalValue / 100).toFixed(0)}`}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )
      })()}

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

      {/* FAQ — visible content + FAQPage schema */}
      <FAQ items={getPokemonHubFaqItems(pokemon.length || null)} />
    </div>
  )
}
