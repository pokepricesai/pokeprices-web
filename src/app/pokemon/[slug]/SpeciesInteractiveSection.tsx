'use client'
// Client island for the species page: sortable card grid + dossier export
// button. Everything else on /pokemon/[slug] is server-rendered.

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import PokemonInsightCard from '@/components/PokemonInsightCard'
import { exportElementAsPng, canShareFiles } from '@/lib/pngExport'

interface Card {
  card_slug: string
  card_name: string
  set_name: string
  card_url_slug: string
  image_url: string | null
  card_number: string | null
  card_number_display: string | null
  current_raw: number | null
  current_psa10: number | null
  raw_pct_30d: number | null
  set_release_date?: string | null
}

// Shape PokemonInsightCard expects
interface DossierCard {
  card_name: string
  set_name: string
  card_url_slug: string
  image_url: string | null
  raw_usd: number | null
  psa10_usd: number | null
  card_number: string | null
  is_sealed: boolean
}

interface DossierData {
  pokeData: any
  speciesData: any
  cards: DossierCard[]
  uniqueSetCount: number
  mostExpensiveRaw: DossierCard | null
  mostExpensivePsa10: DossierCard | null
}

export default function SpeciesInteractiveSection({
  cards,
  slug,
  displayName,
  dossierData,
}: {
  cards: Card[]
  slug: string
  displayName: string
  dossierData: DossierData | null
}) {
  const [sort, setSort] = useState<'price_desc' | 'price_asc' | 'set' | 'name'>('price_desc')
  const [exporting, setExporting] = useState(false)
  const [shareMode, setShareMode] = useState(false)

  useEffect(() => {
    setShareMode(canShareFiles())
  }, [])

  const sortedCards = useMemo(() => {
    const arr = [...cards]
    if (sort === 'price_desc') arr.sort((a, b) => (b.current_raw ?? 0) - (a.current_raw ?? 0))
    if (sort === 'price_asc')  arr.sort((a, b) => (a.current_raw ?? Infinity) - (b.current_raw ?? Infinity))
    if (sort === 'name')       arr.sort((a, b) => a.card_name.localeCompare(b.card_name))
    if (sort === 'set')        arr.sort((a, b) => a.set_name.localeCompare(b.set_name))
    return arr
  }, [cards, sort])

  async function handleDownloadInsight() {
    if (exporting || !dossierData) return
    setExporting(true)
    try {
      await exportElementAsPng({
        elementId: 'pokemon-insight-card',
        fileName: `pokeprices-${slug}-dossier.png`,
        pixelRatio: 2,
        shareTitle: 'PokePrices',
        shareText: `${displayName} — collector's dossier from PokePrices`,
      })
    } catch (e: any) {
      console.error('Insight export failed:', e)
      alert(`Export failed: ${e?.message || 'please try again'}`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: 0, color: 'var(--text)' }}>
            All {cards.length} {displayName} Cards
          </h2>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['price_desc', 'price_asc', 'set', 'name'] as const).map(s => (
              <button key={s} onClick={() => setSort(s)}
                className={`sort-btn ${sort === s ? 'active' : ''}`}
                style={{ fontFamily: "'Figtree', sans-serif", fontSize: 11 }}>
                {s === 'price_desc' ? 'Highest Price' : s === 'price_asc' ? 'Lowest Price' : s === 'set' ? 'By Set' : 'A–Z'}
              </button>
            ))}
            {dossierData && (
              <button
                onClick={handleDownloadInsight}
                disabled={exporting}
                style={{
                  marginLeft: 6, padding: '6px 14px', borderRadius: 18,
                  border: '1px solid var(--primary)', background: 'rgba(26,95,173,0.08)',
                  color: 'var(--primary)', cursor: exporting ? 'wait' : 'pointer',
                  fontSize: 11, fontWeight: 700, fontFamily: "'Figtree', sans-serif",
                  opacity: exporting ? 0.65 : 1,
                }}
              >
                {exporting
                  ? 'Generating…'
                  : shareMode ? `↗ Save dossier` : `↓ Download dossier`}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {sortedCards.map(card => (
            <Link key={card.card_slug}
              href={`/set/${encodeURIComponent(card.set_name)}/card/${card.card_url_slug}`}
              style={{ textDecoration: 'none' }}>
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 10px', textAlign: 'center', height: '100%', boxSizing: 'border-box', transition: 'border-color 0.15s, transform 0.15s' }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.transform = 'translateY(-2px)' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.transform = 'translateY(0)' }}>
                {card.image_url
                  ? <img src={card.image_url} alt={card.card_name}
                      style={{ width: 90, height: 126, objectFit: 'contain', borderRadius: 6, marginBottom: 8, display: 'block', margin: '0 auto 8px' }}
                      loading="lazy"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                  : <div style={{ width: 90, height: 126, background: 'var(--bg-light)', borderRadius: 6, margin: '0 auto 8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🃏</div>}
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', fontFamily: "'Figtree', sans-serif", marginBottom: 2, lineHeight: 1.3 }}>{card.card_name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif", marginBottom: 6 }}>
                  {card.set_name}{card.card_number ? ` · #${card.card_number}` : ''}
                </div>
                {card.current_raw && card.current_raw > 0
                  ? (
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--primary)', fontFamily: "'Figtree', sans-serif" }}>
                      ${(card.current_raw / 100).toFixed(2)}
                    </div>
                  )
                  : <div style={{ fontSize: 11, color: 'var(--border)', fontFamily: "'Figtree', sans-serif" }}>No price</div>}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Off-screen 1080x1080 dossier — html-to-image needs a live element. */}
      {dossierData && (
        <div aria-hidden style={{ position: 'absolute', left: -20000, top: 0, width: 1080, height: 1080, pointerEvents: 'none' }}>
          <PokemonInsightCard
            pokeData={dossierData.pokeData}
            speciesData={dossierData.speciesData}
            displayName={displayName}
            cards={dossierData.cards}
            uniqueSetCount={dossierData.uniqueSetCount}
            mostExpensiveRaw={dossierData.mostExpensiveRaw}
            mostExpensivePsa10={dossierData.mostExpensivePsa10}
          />
        </div>
      )}
    </>
  )
}
