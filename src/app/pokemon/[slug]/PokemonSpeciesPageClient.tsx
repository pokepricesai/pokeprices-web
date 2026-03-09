'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase, formatPrice } from '@/lib/supabase'

const TYPE_COLORS: Record<string, { bg: string; text: string; light: string }> = {
  fire:     { bg: '#FF6B35', text: '#fff', light: 'rgba(255,107,53,0.1)' },
  water:    { bg: '#4A90D9', text: '#fff', light: 'rgba(74,144,217,0.1)' },
  grass:    { bg: '#56C271', text: '#fff', light: 'rgba(86,194,113,0.1)' },
  electric: { bg: '#F5C518', text: '#1a1a1a', light: 'rgba(245,197,24,0.1)' },
  psychic:  { bg: '#E8538F', text: '#fff', light: 'rgba(232,83,143,0.1)' },
  ice:      { bg: '#74CEC0', text: '#1a1a1a', light: 'rgba(116,206,192,0.1)' },
  dragon:   { bg: '#6B5FA6', text: '#fff', light: 'rgba(107,95,166,0.1)' },
  dark:     { bg: '#4A3728', text: '#fff', light: 'rgba(74,55,40,0.1)' },
  fairy:    { bg: '#F4A7C3', text: '#1a1a1a', light: 'rgba(244,167,195,0.1)' },
  fighting: { bg: '#C03028', text: '#fff', light: 'rgba(192,48,40,0.1)' },
  poison:   { bg: '#9B59B6', text: '#fff', light: 'rgba(155,89,182,0.1)' },
  ground:   { bg: '#C49A3C', text: '#fff', light: 'rgba(196,154,60,0.1)' },
  rock:     { bg: '#B8A038', text: '#fff', light: 'rgba(184,160,56,0.1)' },
  bug:      { bg: '#8CB820', text: '#fff', light: 'rgba(140,184,32,0.1)' },
  ghost:    { bg: '#5B4F8A', text: '#fff', light: 'rgba(91,79,138,0.1)' },
  steel:    { bg: '#9EB8D0', text: '#1a1a1a', light: 'rgba(158,184,208,0.1)' },
  normal:   { bg: '#A8A878', text: '#fff', light: 'rgba(168,168,120,0.1)' },
  flying:   { bg: '#8EC8F0', text: '#1a1a1a', light: 'rgba(142,200,240,0.1)' },
}

const STAT_LABELS: Record<string, string> = {
  hp: 'HP', attack: 'ATK', defense: 'DEF',
  'special-attack': 'Sp.ATK', 'special-defense': 'Sp.DEF', speed: 'SPD',
}

const STAT_COLORS: Record<string, string> = {
  hp: '#FF6B6B', attack: '#FF8C42', defense: '#FFD166',
  'special-attack': '#6BCB77', 'special-defense': '#4D96FF', speed: '#C77DFF',
}

function TypeBadge({ type }: { type: string }) {
  const c = TYPE_COLORS[type] ?? { bg: 'var(--bg-light)', text: 'var(--text)', light: 'transparent' }
  return (
    <span style={{
      display: 'inline-block', padding: '4px 12px', borderRadius: 20,
      fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
      background: c.bg, color: c.text, fontFamily: "'Figtree', sans-serif",
    }}>{type}</span>
  )
}

function StatBar({ name, value }: { name: string; value: number }) {
  const color = STAT_COLORS[name] ?? 'var(--primary)'
  const pct = Math.min(100, (value / 255) * 100)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '70px 36px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.8 }}>
        {STAT_LABELS[name] ?? name}
      </span>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>
        {value}
      </span>
      <div style={{ height: 8, background: 'var(--bg-light)', borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99, transition: 'width 0.8s ease' }} />
      </div>
    </div>
  )
}

interface Card {
  card_name: string
  set_name: string
  card_url_slug: string
  image_url: string | null
  raw_usd: number | null
  psa10_usd: number | null
  card_number: string | null
  is_sealed: boolean
}

export default function PokemonSpeciesPageClient({ slug }: { slug: string }) {
  const [pokeData, setPokeData] = useState<any>(null)
  const [speciesData, setSpeciesData] = useState<any>(null)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [cardSort, setCardSort] = useState<'set' | 'price_desc' | 'price_asc' | 'name'>('price_desc')

  useEffect(() => {
    async function load() {
      const [pokeRes, speciesRes] = await Promise.all([
        fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`),
        fetch(`https://pokeapi.co/api/v2/pokemon-species/${slug}`),
      ])
      if (!pokeRes.ok) { setLoading(false); return }
      const [poke, species] = await Promise.all([pokeRes.json(), speciesRes.ok ? speciesRes.json() : null])
      setPokeData(poke)
      setSpeciesData(species)

      // Fetch cards from Supabase — match by name containing the pokemon name
      const displayName = slug.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ')
      // Try exact match first, then broader
      const { data: cardData } = await supabase
        .from('cards')
        .select('card_name, set_name, card_url_slug, image_url, card_number, is_sealed')
        .ilike('card_name', `%${displayName}%`)
        .order('set_name')
        .limit(500)

      if (cardData && cardData.length > 0) {
        // Get prices for these cards
        const slugs = cardData.map((c: any) => c.card_url_slug).filter(Boolean)
        const { data: priceData } = await supabase
          .from('card_trends')
          .select('card_name, set_name, current_raw, current_psa10')
          .in('card_name', cardData.map((c: any) => c.card_name))

        const priceMap: Record<string, any> = {}
        priceData?.forEach((p: any) => {
          const key = `${p.card_name}|||${p.set_name}`
          priceMap[key] = p
        })

        const enriched: Card[] = cardData.map((c: any) => {
          const key = `${c.card_name}|||${c.set_name}`
          const price = priceMap[key]
          return {
            ...c,
            raw_usd: price?.current_raw ?? null,
            psa10_usd: price?.current_psa10 ?? null,
          }
        })
        setCards(enriched)
      }
      setLoading(false)
    }
    load()
  }, [slug])

  const capitalize = (s: string) => s.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' ')

  const sortedCards = [...cards].sort((a, b) => {
    if (cardSort === 'price_desc') return (b.raw_usd ?? 0) - (a.raw_usd ?? 0)
    if (cardSort === 'price_asc') return (a.raw_usd ?? Infinity) - (b.raw_usd ?? Infinity)
    if (cardSort === 'name') return a.card_name.localeCompare(b.card_name)
    return a.set_name.localeCompare(b.set_name)
  })

  if (loading) return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
        <div className="skeleton" style={{ width: 220, height: 220, borderRadius: 16 }} />
        <div style={{ flex: 1, minWidth: 280 }}>
          <div className="skeleton" style={{ height: 36, width: '50%', marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 18, width: '30%', marginBottom: 20 }} />
          <div className="skeleton" style={{ height: 120, borderRadius: 12 }} />
        </div>
      </div>
    </div>
  )

  if (!pokeData) return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, marginBottom: 12 }}>Pokémon not found</h1>
      <Link href="/pokemon" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>← All Pokémon</Link>
    </div>
  )

  // Derived data
  const types: string[] = pokeData.types.map((t: any) => t.type.name)
  const primaryType = types[0]
  const typeColor = TYPE_COLORS[primaryType] ?? { bg: 'var(--primary)', text: '#fff', light: 'rgba(26,95,173,0.08)' }
  const stats: { name: string; value: number }[] = pokeData.stats.map((s: any) => ({ name: s.stat.name, value: s.base_stat }))
  const totalStats = stats.reduce((sum, s) => sum + s.value, 0)
  const abilities: string[] = pokeData.abilities.map((a: any) => a.ability.name.split('-').map((w: string) => w[0].toUpperCase() + w.slice(1)).join(' '))
  const artworkUrl = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeData.id}.png`

  const flavorText = speciesData?.flavor_text_entries
    ?.filter((f: any) => f.language.name === 'en')
    ?.slice(-1)[0]?.flavor_text
    ?.replace(/\f/g, ' ')
    ?.replace(/\u00ad/g, '')
    ?? null

  const genus = speciesData?.genera?.find((g: any) => g.language.name === 'en')?.genus ?? null
  const isLegendary = speciesData?.is_legendary
  const isMythical = speciesData?.is_mythical
  const heightM = (pokeData.height / 10).toFixed(1)
  const weightKg = (pokeData.weight / 10).toFixed(1)

  // Card analytics
  const regularCards = cards.filter(c => !c.is_sealed)
  const uniqueSets = new Set(regularCards.map(c => c.set_name)).size
  const mostExpensiveCard = [...regularCards].sort((a, b) => (b.raw_usd ?? 0) - (a.raw_usd ?? 0))[0]
  const mostExpensivePsa10 = [...regularCards].sort((a, b) => (b.psa10_usd ?? 0) - (a.psa10_usd ?? 0))[0]
  const priceRange = regularCards.filter(c => c.raw_usd)
  const avgPrice = priceRange.length ? priceRange.reduce((s, c) => s + (c.raw_usd ?? 0), 0) / priceRange.length : null

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/pokemon" style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textDecoration: 'none' }}>
          ← All Pokémon
        </Link>
      </div>

      {/* Hero section */}
      <div style={{
        background: typeColor.light, border: '1px solid var(--border)', borderRadius: 20,
        padding: '28px 32px', marginBottom: 24,
        display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {/* Artwork */}
        <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
          <img
            src={artworkUrl}
            alt={capitalize(slug)}
            style={{ width: 180, height: 180, objectFit: 'contain', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))' }}
          />
        </div>

        {/* Core info */}
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
              #{String(pokeData.id).padStart(3, '0')}
            </span>
            {isLegendary && (
              <span style={{ fontSize: 10, fontWeight: 800, background: '#FFD166', color: '#1a1a1a', padding: '2px 8px', borderRadius: 20, fontFamily: "'Figtree', sans-serif", letterSpacing: 0.8, textTransform: 'uppercase' }}>Legendary</span>
            )}
            {isMythical && (
              <span style={{ fontSize: 10, fontWeight: 800, background: '#C77DFF', color: '#fff', padding: '2px 8px', borderRadius: 20, fontFamily: "'Figtree', sans-serif", letterSpacing: 0.8, textTransform: 'uppercase' }}>Mythical</span>
            )}
          </div>

          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 36, margin: '0 0 4px', color: 'var(--text)', lineHeight: 1 }}>
            {capitalize(slug)}
          </h1>
          {genus && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px' }}>
              The {genus}
            </p>
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {types.map(t => <TypeBadge key={t} type={t} />)}
          </div>

          {flavorText && (
            <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.7, margin: '0 0 16px', fontStyle: 'italic', maxWidth: 420 }}>
              "{flavorText}"
            </p>
          )}

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Height</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{heightM}m</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Weight</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{weightKg}kg</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Abilities</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{abilities.join(', ')}</div>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ flex: '0 0 auto', minWidth: 240, background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '16px 20px' }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 14, fontFamily: "'Figtree', sans-serif" }}>
            Base Stats · {totalStats} total
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stats.map(s => <StatBar key={s.name} name={s.name} value={s.value} />)}
          </div>
        </div>
      </div>

      {/* Card analytics */}
      {regularCards.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 24 }}>
          {[
            { label: 'Total Cards', value: regularCards.length.toString() },
            { label: 'Sets Featured In', value: uniqueSets.toString() },
            { label: 'Most Expensive Raw', value: mostExpensiveCard?.raw_usd ? `$${(mostExpensiveCard.raw_usd / 100).toFixed(0)}` : '—', sub: mostExpensiveCard?.card_name },
            { label: 'Best PSA 10', value: mostExpensivePsa10?.psa10_usd ? `$${(mostExpensivePsa10.psa10_usd / 100).toFixed(0)}` : '—', sub: mostExpensivePsa10?.card_name },
            { label: 'Avg Raw Price', value: avgPrice ? `$${(avgPrice / 100).toFixed(0)}` : '—' },
          ].map((s, i) => (
            <div key={i} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 4 }}>{s.value}</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
              {s.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Cards section */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, margin: 0, color: 'var(--text)' }}>
            {regularCards.length > 0 ? `${regularCards.length} Cards` : 'Cards'}
          </h2>
          {regularCards.length > 0 && (
            <div style={{ display: 'flex', gap: 6 }}>
              {(['price_desc', 'price_asc', 'set', 'name'] as const).map(s => (
                <button key={s} onClick={() => setCardSort(s)}
                  className={`sort-btn ${cardSort === s ? 'active' : ''}`}
                  style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11 }}>
                  {s === 'price_desc' ? 'Highest Price' : s === 'price_asc' ? 'Lowest Price' : s === 'set' ? 'By Set' : 'A–Z'}
                </button>
              ))}
            </div>
          )}
        </div>

        {regularCards.length === 0 ? (
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🃏</div>
            <p style={{ color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0 }}>
              {capitalize(slug)} hasn't appeared on any Pokémon TCG cards in our database yet.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {sortedCards.filter(c => !c.is_sealed).map((card, i) => (
              <Link key={i} href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}`} style={{ textDecoration: 'none' }}>
                <div style={{
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
                  padding: '12px 10px', textAlign: 'center', transition: 'border-color 0.15s, transform 0.15s',
                }}
                  onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
                  onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}
                >
                  {card.image_url ? (
                    <img src={card.image_url} alt={card.card_name} style={{ width: 90, borderRadius: 6, marginBottom: 8 }} loading="lazy" />
                  ) : (
                    <div style={{ width: 90, height: 126, background: 'var(--bg-light)', borderRadius: 6, margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🃏</div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 2, lineHeight: 1.3 }}>
                    {card.card_name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
                    {card.set_name}{card.card_number ? ` · #${card.card_number}` : ''}
                  </div>
                  {card.raw_usd ? (
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
                      ${(card.raw_usd / 100).toFixed(2)}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: 'var(--border)', fontFamily: "'Figtree', sans-serif" }}>No price</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
