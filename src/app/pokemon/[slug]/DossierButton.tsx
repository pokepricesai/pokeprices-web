'use client'
// Dossier-export client island. Renders the prominent "Download dossier"
// button + the off-screen 1080x1080 PokemonInsightCard that html-to-image
// captures. Kept self-contained so the hero section in page.tsx can drop
// it in without making the whole page client-side.

import { useState, useEffect } from 'react'
import PokemonInsightCard from '@/components/PokemonInsightCard'
import { exportElementAsPng, canShareFiles } from '@/lib/pngExport'

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

export default function DossierButton({
  slug,
  displayName,
  pokeData,
  speciesData,
  cards,
  uniqueSetCount,
  mostExpensiveRaw,
  mostExpensivePsa10,
  accentBg,
  accentText,
}: {
  slug: string
  displayName: string
  pokeData: any
  speciesData: any
  cards: DossierCard[]
  uniqueSetCount: number
  mostExpensiveRaw: DossierCard | null
  mostExpensivePsa10: DossierCard | null
  accentBg: string
  accentText: string
}) {
  const [exporting, setExporting] = useState(false)
  const [shareMode, setShareMode] = useState(false)

  useEffect(() => { setShareMode(canShareFiles()) }, [])

  async function handleClick() {
    if (exporting) return
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
      <button
        onClick={handleClick}
        disabled={exporting}
        style={{
          marginTop: 18, padding: '11px 20px', borderRadius: 12,
          border: 'none', cursor: exporting ? 'wait' : 'pointer',
          background: accentBg,
          color: accentText,
          fontFamily: "'Figtree', sans-serif", fontSize: 13, fontWeight: 800,
          letterSpacing: 0.3,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
          opacity: exporting ? 0.65 : 1,
        }}
      >
        <span style={{ fontSize: 15 }}>{shareMode ? '↗' : '↓'}</span>
        {exporting
          ? 'Generating dossier…'
          : shareMode
            ? `Save ${displayName} dossier`
            : `Download ${displayName} dossier`}
      </button>

      {/* Off-screen 1080x1080 dossier — html-to-image needs a live element. */}
      <div aria-hidden style={{ position: 'absolute', left: -20000, top: 0, width: 1080, height: 1080, pointerEvents: 'none' }}>
        <PokemonInsightCard
          pokeData={pokeData}
          speciesData={speciesData}
          displayName={displayName}
          cards={cards}
          uniqueSetCount={uniqueSetCount}
          mostExpensiveRaw={mostExpensiveRaw}
          mostExpensivePsa10={mostExpensivePsa10}
        />
      </div>
    </>
  )
}
