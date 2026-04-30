// /pokemon/[slug] — Pokémon species hub page (server-rendered).
//
// Renders SEO-critical content (H1, listicle, prose, FAQ) server-side so
// Google sees the actual content, not a JS shell. Data comes from the
// get_pokemon_species_detail RPC (one round trip, all aggregates pre-rolled).
// PokeAPI is fetched in parallel for the Pokédex hero (type/abilities/stats).
//
// Interactive bits (card grid sort, dossier export) live in a tiny client
// island at the bottom of the page so most of the layout stays static.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import BreadcrumbSchema from '@/components/BreadcrumbSchema'
import PokemonStructuredData from '@/components/PokemonStructuredData'
import FAQ from '@/components/FAQ'
import { getPokemonFaqItems } from '@/lib/faqs'
import SpeciesInteractiveSection from './SpeciesInteractiveSection'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const revalidate = 3600

// ── Types ────────────────────────────────────────────────────────────────────

type Cents = number | null

interface SpeciesRow {
  id: number
  name: string
  type_primary: string | null
  type_secondary: string | null
  generation: number | null
  is_legendary: boolean
  is_mythical: boolean
  total_cards: number
  total_market_value_cents: number
  highest_card_price_cents: Cents
  highest_card_slug: string | null
  first_appeared_set: string | null
  first_appeared_year: number | null
  most_recent_set: string | null
  description: string | null
  updated_at: string | null
}

interface CardRow {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string
  image_url: string | null
  card_number: string | null
  card_number_display: string | null
  current_raw: Cents
  current_psa9?: Cents
  current_psa10: Cents
  raw_pct_30d: number | null
  set_release_date?: string | null
}

interface BySetRow {
  set_name: string
  count: number
  top_image: string | null
  top_card_url_slug: string | null
  top_card_name: string | null
}

interface SpeciesDetail {
  species: SpeciesRow
  top_cards: CardRow[]
  risers_30d: CardRow[]
  fallers_30d: CardRow[]
  all_cards: CardRow[]
  cards_by_set: BySetRow[]
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchSpeciesDetail(slug: string): Promise<SpeciesDetail | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_pokemon_species_detail`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_slug: slug }),
    next: { revalidate: 3600 },
  })
  if (!r.ok) return null
  const data = await r.json()
  return data || null
}

async function fetchPokeApi(slug: string): Promise<{ pokemon: any; species: any } | null> {
  // Some species (Deoxys, Giratina, Shaymin, …) have non-default forms whose
  // /pokemon/{slug} endpoint 404s. Fall through to species.varieties for the
  // default variety name.
  try {
    const speciesRes = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${slug}`, {
      next: { revalidate: 86400 },
    })
    if (!speciesRes.ok) return null
    const species = await speciesRes.json()

    let pokemonRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${slug}`, {
      next: { revalidate: 86400 },
    })
    if (!pokemonRes.ok) {
      const fallback = (species.varieties || []).find((v: any) => v.is_default)?.pokemon?.name
      if (fallback && fallback !== slug) {
        pokemonRes = await fetch(`https://pokeapi.co/api/v2/pokemon/${fallback}`, {
          next: { revalidate: 86400 },
        })
      }
    }
    if (!pokemonRes.ok) return { pokemon: null, species }
    const pokemon = await pokemonRes.json()
    return { pokemon, species }
  } catch {
    return null
  }
}

async function fetchNeighbours(id: number): Promise<{ prev: { id: number; name: string } | null; next: { id: number; name: string } | null }> {
  const ids = [id - 1, id + 1].filter(n => n >= 1)
  if (!ids.length) return { prev: null, next: null }
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/pokemon_species?id=in.(${ids.join(',')})&select=id,name`,
    {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
      next: { revalidate: 86400 },
    },
  )
  if (!r.ok) return { prev: null, next: null }
  const rows = (await r.json()) as { id: number; name: string }[]
  return {
    prev: rows.find(r => r.id === id - 1) ?? null,
    next: rows.find(r => r.id === id + 1) ?? null,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

function fmtUsd(cents: Cents): string {
  if (cents == null || cents <= 0) return '—'
  const v = cents / 100
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1000)      return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function fmtUsdRaw(cents: Cents): string {
  if (cents == null || cents <= 0) return '—'
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// ── Metadata (SEO-critical, generated from real data) ───────────────────────

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const detail = await fetchSpeciesDetail(slug)
  const name = capitalize(slug)

  // Fall back to a sane default if the species exists in PokeAPI but has no
  // cards in our DB — we still want a valid title (no 404 unless slug doesn't
  // exist at all in pokemon_species).
  if (!detail || !detail.species) {
    const year = new Date().getFullYear()
    return {
      title:       `${name} Pokémon Cards — Prices & Values (${year}) | PokePrices`,
      description: `Browse every ${name} Pokémon TCG card with raw and PSA 10 prices, set checklists and grading data. Updated nightly.`,
      alternates:  { canonical: `https://www.pokeprices.io/pokemon/${slug}` },
      robots:      { index: detail !== null, follow: true },
    }
  }

  const sp = detail.species
  const topCard = detail.top_cards[0] ?? null

  const title = `${name} Pokémon Cards — All Prices & Values | PokePrices`

  // 150-160 char description with real data: count, top card, top price.
  const topPrice = topCard?.current_psa10 ?? topCard?.current_raw ?? null
  const topBit = topCard
    ? ` Top: ${topCard.card_name} from ${topCard.set_name} at ${fmtUsd(topPrice)}.`
    : ''
  let description = `Prices for all ${sp.total_cards} ${name} Pokémon cards.${topBit} Live raw + PSA 10 values, market trends, updated daily.`
  if (description.length > 160) description = description.slice(0, 157) + '…'

  // OG image: use the most-valuable card's image as the share thumbnail.
  const ogImage = topCard?.image_url ?? null

  return {
    title,
    description,
    alternates: { canonical: `https://www.pokeprices.io/pokemon/${slug}` },
    openGraph: {
      title,
      description,
      url: `https://www.pokeprices.io/pokemon/${slug}`,
      siteName: 'PokePrices',
      type: 'website',
      images: ogImage ? [{ url: ogImage, alt: topCard?.card_name ?? name }] : undefined,
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
    robots: { index: sp.total_cards > 0, follow: true },
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function PokemonSpeciesPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const [detail, pokeBundle] = await Promise.all([
    fetchSpeciesDetail(slug),
    fetchPokeApi(slug),
  ])

  // notFound only if the species genuinely doesn't exist anywhere — DB and
  // PokeAPI both came back empty.
  if (!detail && !pokeBundle?.species) {
    notFound()
  }

  const sp = detail?.species
  const cards = detail?.all_cards ?? []
  const topCards = detail?.top_cards ?? []
  const risers = detail?.risers_30d ?? []
  const fallers = detail?.fallers_30d ?? []
  const bySet = detail?.cards_by_set ?? []

  const displayName = sp ? capitalize(sp.name) : capitalize(slug)
  const neighbours = sp ? await fetchNeighbours(sp.id) : { prev: null, next: null }

  // PokeAPI bits for the visual hero
  const pokeData = pokeBundle?.pokemon
  const speciesData = pokeBundle?.species
  const types: string[] = (pokeData?.types || []).map((t: any) => t.type.name)
  const stats = (pokeData?.stats || []).map((s: any) => ({ name: s.stat.name, value: s.base_stat }))
  const totalStats = stats.reduce((sum: number, s: any) => sum + s.value, 0)
  const abilities: string[] = (pokeData?.abilities || []).map((a: any) =>
    (a.ability?.name || '').split('-').map((w: string) => w[0]?.toUpperCase() + w.slice(1)).join(' '),
  )
  const heightM = pokeData ? (pokeData.height / 10).toFixed(1) : null
  const weightKg = pokeData ? (pokeData.weight / 10).toFixed(1) : null
  const flavorText = (speciesData?.flavor_text_entries || [])
    .filter((f: any) => f?.language?.name === 'en')
    .slice(-1)[0]?.flavor_text?.replace(/\f/g, ' ').replace(/­/g, '')
    || sp?.description || null
  const genus = (speciesData?.genera || []).find((g: any) => g?.language?.name === 'en')?.genus || null
  const isLegendary = !!speciesData?.is_legendary || !!sp?.is_legendary
  const isMythical = !!speciesData?.is_mythical || !!sp?.is_mythical
  const artworkUrl = pokeData
    ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokeData.id}.png`
    : sp ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${sp.id}.png` : null

  const primaryType = sp?.type_primary || types[0] || null
  const typeColors: Record<string, { bg: string; text: string; light: string }> = {
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
  const typeColor = (primaryType && typeColors[primaryType]) || { bg: 'var(--primary)', text: '#fff', light: 'rgba(26,95,173,0.08)' }

  // The brief's H1 + subtitle. SEO-targeted at price queries.
  const h1 = `${displayName} Pokémon Cards — Prices & Values`
  const subtitle = sp && sp.total_cards > 0
    ? `All ${sp.total_cards} ${displayName} cards across ${bySet.length || sp.total_cards} sets, with live prices, PSA 10 values and rarity guide. Updated nightly.`
    : `${displayName} doesn't appear on any Pokémon TCG cards in our database yet — we'll add them as soon as new sets land.`

  // Programmatic prose — every sentence is conditional on real data presence.
  const proseParts: string[] = []
  if (sp && sp.total_cards > 0) {
    const parts: string[] = []
    if (sp.first_appeared_set && sp.first_appeared_year) {
      parts.push(`${displayName} has appeared on ${sp.total_cards} different Pokémon TCG cards across ${bySet.length || 'multiple'} sets since first being printed in ${sp.first_appeared_set} in ${sp.first_appeared_year}.`)
    } else {
      parts.push(`${displayName} has appeared on ${sp.total_cards} Pokémon TCG cards.`)
    }
    if (primaryType) {
      const typeStr = sp.type_secondary ? `${primaryType.charAt(0).toUpperCase() + primaryType.slice(1)} / ${sp.type_secondary.charAt(0).toUpperCase() + sp.type_secondary.slice(1)}` : `${primaryType.charAt(0).toUpperCase() + primaryType.slice(1)}`
      const lineage = isLegendary ? ' Legendary' : isMythical ? ' Mythical' : ''
      const genStr = sp.generation ? ` from generation ${sp.generation}` : ''
      parts.push(`It is a${lineage} ${typeStr}-type Pokémon${genStr}.`)
    }
    proseParts.push(parts.join(' '))
  }
  if (topCards.length > 0) {
    const top = topCards[0]
    const psa10 = top.current_psa10
    const raw   = top.current_raw
    const valueParts: string[] = []
    if (raw)   valueParts.push(`${fmtUsd(raw)} raw`)
    if (psa10) valueParts.push(`${fmtUsd(psa10)} in PSA 10`)
    const valueStr = valueParts.length ? ` — currently ${valueParts.join(' and ')}` : ''
    proseParts.push(`The most valuable ${displayName} card by current sold-listing prices is the ${top.card_name} from ${top.set_name}${valueStr}. Vintage holos, full arts and special illustrations command the highest prices, while modern reprints sit closer to bulk.`)
  }
  if (sp?.most_recent_set && risers.length > 0) {
    const r = risers[0]
    if (r.raw_pct_30d != null && r.raw_pct_30d > 0) {
      proseParts.push(`The most recent ${displayName} cards are from ${sp.most_recent_set}. Over the last 30 days, the biggest mover for ${displayName} is ${r.card_name} (${r.set_name}), up ${r.raw_pct_30d.toFixed(1)}%.`)
    } else {
      proseParts.push(`The most recent ${displayName} cards are from ${sp.most_recent_set}.`)
    }
  } else if (sp?.most_recent_set) {
    proseParts.push(`The most recent ${displayName} cards are from ${sp.most_recent_set}.`)
  }

  // FAQ
  const faqItems = sp && sp.total_cards > 0 ? getPokemonFaqItems({
    name: displayName,
    cards: cards.map(c => ({ card_name: c.card_name, set_name: c.set_name, raw_usd: c.current_raw, psa10_usd: c.current_psa10 })),
    uniqueSets: bySet.length,
    primaryType,
    isLegendary,
    isMythical,
    firstAppearedSet: sp.first_appeared_set,
    firstAppearedYear: sp.first_appeared_year,
    topRiser: risers[0] ? { card_name: risers[0].card_name, set_name: risers[0].set_name, raw_pct_30d: risers[0].raw_pct_30d } : null,
  }) : []

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      {/* Schema */}
      <PokemonStructuredData name={displayName} slug={slug} cards={cards.slice(0, 10).map(c => ({
        card_name: c.card_name,
        set_name: c.set_name,
        card_url_slug: c.card_url_slug,
        image_url: c.image_url,
        raw_usd: c.current_raw,
        psa10_usd: c.current_psa10,
        card_number: c.card_number,
        is_sealed: false,
      }))} />
      <BreadcrumbSchema items={[{ name: 'Pokémon', url: '/pokemon' }, { name: displayName }]} />

      {/* Breadcrumb + prev/next */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/pokemon" style={navChip()}>← All Pokémon</Link>
          {neighbours.prev && (
            <Link href={`/pokemon/${neighbours.prev.name}`} style={navChip(true)}>
              <span style={{ opacity: 0.55 }}>←</span>
              <span style={{ opacity: 0.6 }}>#{String(neighbours.prev.id).padStart(3, '0')}</span>
              <span style={{ textTransform: 'capitalize' }}>{neighbours.prev.name.replace(/-/g, ' ')}</span>
            </Link>
          )}
        </div>
        {neighbours.next && (
          <Link href={`/pokemon/${neighbours.next.name}`} style={navChip(true)}>
            <span style={{ opacity: 0.6 }}>#{String(neighbours.next.id).padStart(3, '0')}</span>
            <span style={{ textTransform: 'capitalize' }}>{neighbours.next.name.replace(/-/g, ' ')}</span>
            <span style={{ opacity: 0.55 }}>→</span>
          </Link>
        )}
      </div>

      {/* H1 + subtitle */}
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 4 }}>
          {sp ? `#${String(sp.id).padStart(3, '0')}` : ''}
          {sp?.generation ? ` · Gen ${sp.generation}` : ''}
          {isLegendary ? ' · Legendary' : isMythical ? ' · Mythical' : ''}
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 32, margin: '0 0 8px', color: 'var(--text)', lineHeight: 1.15 }}>
          {h1}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6, maxWidth: 720 }}>
          {subtitle}
        </p>
      </header>

      {/* HERO: most valuable card spotlight (above the fold, captures the chase-card query intent) */}
      {topCards[0] && (
        <Link href={`/set/${encodeURIComponent(topCards[0].set_name)}/card/${topCards[0].card_url_slug}`}
          style={{ textDecoration: 'none', display: 'block', marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 24, padding: '24px 28px', background: typeColor.light, border: '1px solid var(--border)', borderRadius: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            {topCards[0].image_url && (
              <img src={topCards[0].image_url} alt={topCards[0].card_name}
                style={{ width: 140, height: 196, objectFit: 'contain', borderRadius: 8, flexShrink: 0, filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.18))' }} />
            )}
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: typeColor.bg, fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
                Most valuable {displayName} card
              </div>
              <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 4px', color: 'var(--text)', lineHeight: 1.2 }}>
                {topCards[0].card_name}
              </h2>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 14 }}>
                {topCards[0].set_name}
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                {topCards[0].current_raw && topCards[0].current_raw > 0 && (
                  <Stat label="Raw" value={fmtUsdRaw(topCards[0].current_raw)} />
                )}
                {topCards[0].current_psa10 && topCards[0].current_psa10 > 0 && (
                  <Stat label="PSA 10" value={fmtUsdRaw(topCards[0].current_psa10)} highlight={typeColor.bg} />
                )}
              </div>
            </div>
          </div>
        </Link>
      )}

      {/* Quick stats row */}
      {sp && sp.total_cards > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 24 }}>
          <StatTile label="Total cards" value={sp.total_cards.toString()} />
          <StatTile label="Sets featured in" value={(bySet.length || 0).toString()} />
          {sp.highest_card_price_cents && <StatTile label="Highest price" value={fmtUsdRaw(sp.highest_card_price_cents)} />}
          {sp.first_appeared_year && <StatTile label="First appeared" value={String(sp.first_appeared_year)} sub={sp.first_appeared_set || undefined} />}
        </div>
      )}

      {/* Pokédex hero — keeps the existing visual richness (type badges + base stats + flavor) */}
      {pokeData && (
        <div style={{ background: typeColor.light, border: '1px solid var(--border)', borderRadius: 20, padding: '24px 28px', marginBottom: 28, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'center' }}>
          {artworkUrl && (
            <img src={artworkUrl} alt={displayName}
              style={{ width: 160, height: 160, objectFit: 'contain', filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))' }} />
          )}
          <div style={{ flex: 1, minWidth: 240 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 8px', color: 'var(--text)' }}>
              About {displayName}
            </h2>
            {genus && <p style={{ fontSize: 13, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px' }}>The {genus}</p>}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
              {types.map((t: string) => {
                const tc = typeColors[t] ?? { bg: 'var(--bg-light)', text: 'var(--text)', light: '' }
                return (
                  <span key={t} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, background: tc.bg, color: tc.text, fontFamily: "'Figtree', sans-serif" }}>
                    {t}
                  </span>
                )
              })}
            </div>
            {flavorText && (
              <p style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.7, margin: '0 0 14px', fontStyle: 'italic', maxWidth: 480 }}>
                "{flavorText}"
              </p>
            )}
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
              {heightM && <Stat label="Height" value={`${heightM}m`} />}
              {weightKg && <Stat label="Weight" value={`${weightKg}kg`} />}
              {abilities.length > 0 && <Stat label="Abilities" value={abilities.join(', ')} />}
            </div>
          </div>
          {stats.length > 0 && (
            <div style={{ flex: '0 0 auto', minWidth: 220, background: 'var(--card)', borderRadius: 14, border: '1px solid var(--border)', padding: '14px 18px' }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.5, color: 'var(--text-muted)', marginBottom: 12, fontFamily: "'Figtree', sans-serif" }}>
                Base Stats · {totalStats} total
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {stats.map((s: any) => (
                  <div key={s.name} style={{ display: 'grid', gridTemplateColumns: '70px 36px 1fr', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 0.8 }}>{s.name.replace(/-/g, ' ')}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", textAlign: 'right' }}>{s.value}</span>
                    <div style={{ height: 6, background: 'var(--bg-light)', borderRadius: 99, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(100, (s.value / 255) * 100)}%`, background: typeColor.bg, borderRadius: 99 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION: Most Valuable Cards listicle (target: "most expensive [name] cards") */}
      {topCards.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 6px', color: 'var(--text)' }}>
            Most Valuable {displayName} Cards
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 14px' }}>
            Top 10 by combined raw and PSA 10 value. Click any card for full price history and grading data.
          </p>
          <ol style={{ display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', padding: 0, margin: 0, counterReset: 'rank' }}>
            {topCards.map((c, i) => (
              <li key={c.card_slug} style={{ counterIncrement: 'rank' }}>
                <Link href={`/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`}
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: i < 3 ? typeColor.bg : 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", minWidth: 28 }}>
                    {i + 1}
                  </span>
                  {c.image_url
                    ? <img src={c.image_url} alt={c.card_name} style={{ width: 44, height: 62, objectFit: 'contain', borderRadius: 4, flexShrink: 0 }} />
                    : <div style={{ width: 44, height: 62, background: 'var(--bg-light)', borderRadius: 4, flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
                      {c.card_name}{c.card_number_display ? ` · ${c.card_number_display}` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                      {c.set_name}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 100 }}>
                    {c.current_psa10 && c.current_psa10 > 0 && (
                      <div style={{ fontSize: 14, fontWeight: 800, color: typeColor.bg, fontFamily: "'Figtree', sans-serif" }}>
                        {fmtUsdRaw(c.current_psa10)} <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.7 }}>PSA 10</span>
                      </div>
                    )}
                    {c.current_raw && c.current_raw > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                        {fmtUsdRaw(c.current_raw)} raw
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* SECTION: Recent Price Movement */}
      {(risers.length > 0 || fallers.length > 0) && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 6px', color: 'var(--text)' }}>
            Recent Price Movement
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: '0 0 14px' }}>
            {displayName} cards moving the most over the last 30 days, raw price.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
            {risers.length > 0 && (
              <MoverPanel title="Top risers" cards={risers} positive={true} />
            )}
            {fallers.length > 0 && (
              <MoverPanel title="Top fallers" cards={fallers} positive={false} />
            )}
          </div>
        </section>
      )}

      {/* SECTION: All cards (sortable grid - client island) */}
      {cards.length > 0 && (
        <SpeciesInteractiveSection
          cards={cards}
          slug={slug}
          displayName={displayName}
          dossierData={pokeData ? {
            pokeData,
            speciesData,
            cards: cards.map(c => ({
              card_name: c.card_name,
              set_name: c.set_name,
              card_url_slug: c.card_url_slug,
              image_url: c.image_url,
              raw_usd: c.current_raw,
              psa10_usd: c.current_psa10,
              card_number: c.card_number,
              is_sealed: false,
            })),
            uniqueSetCount: bySet.length,
            mostExpensiveRaw: topCards[0] ? { card_name: topCards[0].card_name, set_name: topCards[0].set_name, raw_usd: topCards[0].current_raw, psa10_usd: topCards[0].current_psa10, card_number: topCards[0].card_number, image_url: topCards[0].image_url, card_url_slug: topCards[0].card_url_slug, is_sealed: false } : null,
            mostExpensivePsa10: (() => {
              const c = [...topCards].filter(t => t.current_psa10 && t.current_psa10 > 0).sort((a, b) => (b.current_psa10 ?? 0) - (a.current_psa10 ?? 0))[0]
              return c ? { card_name: c.card_name, set_name: c.set_name, raw_usd: c.current_raw, psa10_usd: c.current_psa10, card_number: c.card_number, image_url: c.image_url, card_url_slug: c.card_url_slug, is_sealed: false } : null
            })(),
          } : null}
        />
      )}

      {/* SECTION: Explore by Set */}
      {bySet.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 14px', color: 'var(--text)' }}>
            Explore {displayName} by Set
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {bySet.map(s => (
              <Link key={s.set_name} href={`/set/${encodeURIComponent(s.set_name)}`} style={{ textDecoration: 'none' }}>
                <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 14px' }}>
                  {s.top_image && (
                    <img src={s.top_image} alt={s.top_card_name || s.set_name}
                      style={{ width: 50, height: 70, objectFit: 'contain', display: 'block', margin: '0 auto 10px', borderRadius: 4 }} loading="lazy" />
                  )}
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1.3, marginBottom: 4 }}>
                    {s.set_name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                    {s.count} card{s.count !== 1 ? 's' : ''}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* SECTION: About prose (long-form for SEO) */}
      {proseParts.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 12px', color: 'var(--text)' }}>
            {displayName} in the Pokémon TCG
          </h2>
          {proseParts.map((para, i) => (
            <p key={i} style={{ fontSize: 14, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", margin: '0 0 12px', lineHeight: 1.75 }}>
              {para}
            </p>
          ))}
        </section>
      )}

      {/* FAQ */}
      {faqItems.length > 0 && <FAQ items={faqItems} title={`${displayName} card FAQs`} />}

      {/* Empty state */}
      {(!sp || sp.total_cards === 0) && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '40px 24px', textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🃏</div>
          <p style={{ color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", margin: 0, lineHeight: 1.6 }}>
            {displayName} hasn't appeared on any Pokémon TCG cards in our database yet. We'll add them as soon as new sets land — check back later.
          </p>
        </div>
      )}

      {/* Explore More Pokémon */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 24px' }}>
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, margin: '0 0 14px', color: 'var(--text)' }}>
          Explore More Pokémon
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {[
            'charizard', 'pikachu', 'mewtwo', 'umbreon', 'eevee', 'gengar',
            'rayquaza', 'lugia', 'blastoise', 'venusaur', 'snorlax', 'dragonite',
          ].filter(p => p !== slug).slice(0, 12).map(name => (
            <Link key={name} href={`/pokemon/${name}`}
              style={{ padding: '6px 14px', borderRadius: 20, textDecoration: 'none', background: 'var(--bg-light)', border: '1px solid var(--border)', fontSize: 13, fontWeight: 600, color: 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </Link>
          ))}
          <Link href="/pokemon" style={{ padding: '6px 14px', borderRadius: 20, textDecoration: 'none', background: 'var(--primary)', fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: "'Figtree', sans-serif" }}>
            All Pokémon →
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Small server-side helper components ─────────────────────────────────────

function navChip(emphasised = false): React.CSSProperties {
  return {
    fontSize: 13, color: emphasised ? 'var(--text)' : 'var(--text-muted)',
    fontFamily: "'Figtree', sans-serif", textDecoration: 'none',
    padding: '6px 12px', borderRadius: 18,
    border: '1px solid var(--border)', background: 'var(--card)',
    fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 6,
    whiteSpace: 'nowrap',
  }
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: highlight ?? 'var(--text)', fontFamily: "'Figtree', sans-serif" }}>{value}</div>
    </div>
  )
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  )
}

function MoverPanel({ title, cards, positive }: { title: string; cards: CardRow[]; positive: boolean }) {
  const accent = positive ? '#22c55e' : '#ef4444'
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cards.map(c => (
          <Link key={c.card_slug} href={`/set/${encodeURIComponent(c.set_name)}/card/${c.card_url_slug}`}
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
            {c.image_url
              ? <img src={c.image_url} alt={c.card_name} style={{ width: 30, height: 42, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
              : <div style={{ width: 30, height: 42, background: 'var(--bg-light)', borderRadius: 3, flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.card_name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
                {c.set_name}
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: accent, fontFamily: "'Figtree', sans-serif" }}>
              {c.raw_pct_30d != null ? `${c.raw_pct_30d > 0 ? '+' : ''}${c.raw_pct_30d.toFixed(1)}%` : '—'}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
