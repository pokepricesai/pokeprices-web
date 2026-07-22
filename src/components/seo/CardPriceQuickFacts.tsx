// src/components/seo/CardPriceQuickFacts.tsx
// Block 5A-W-46C — server-rendered "Quick price facts" panel for
// indexable card pages.
//
// SCOPE
//   * Server component (no 'use client' directive) so the block ships
//     in the initial HTML that Google + Bing crawl.
//   * Uses the pure `buildCardQuickFacts` helper for every derivation.
//     No I/O, no useEffect, no useState. If the parent passes null
//     data the component returns null (no shell, no placeholder).
//   * Renders as a semantic <section> with a proper <h2>. Facts are
//     a <dl> so screen readers announce label/value pairs.
//   * No new schema is emitted. This block is prose + data, not
//     structured data.

import Link from 'next/link'
import {
  buildCardQuickFacts,
  hasEnoughFacts,
  type CardQuickFactsCardInput,
  type CardQuickFactsTrendInput,
} from '@/lib/seo/quickFacts'

export type CardPriceQuickFactsProps = {
  card:  CardQuickFactsCardInput | null | undefined
  trend: CardQuickFactsTrendInput
  /** Canonical set page path — required so the "View all cards from
   *  {set}" link points at a real URL. Pass `null` to suppress the
   *  set-link line. */
  setHref?: string | null
  /** Canonical Pokémon page path for the visible species. Passed
   *  only when the caller can verify the species slug corresponds to
   *  an existing row in pokemon_species. Pass `null` to suppress —
   *  we never guess. */
  pokemonHref?: string | null
  /** Species display name, used only in the CTA copy alongside
   *  pokemonHref. Ignored when pokemonHref is null. */
  pokemonName?: string | null
}

const sectionStyle: React.CSSProperties = {
  margin: '18px 0 24px',
  padding: '18px 20px',
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  fontFamily: "'Figtree', sans-serif",
}
const headingStyle: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif",
  fontSize: 17,
  margin: '0 0 12px',
  color: 'var(--text)',
}
const dlStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: 10,
  margin: 0,
  padding: 0,
}
const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '8px 12px',
  background: 'var(--bg-light)',
  border: '1px solid var(--border)',
  borderRadius: 10,
}
const dtStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}
const ddStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: 'var(--text)',
  margin: 0,
}
const summaryStyle: React.CSSProperties = {
  fontSize: 13.5,
  color: 'var(--text)',
  margin: '0 0 12px',
  lineHeight: 1.55,
}
const linkRowStyle: React.CSSProperties = {
  marginTop: 12,
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  fontSize: 12.5,
  color: 'var(--text-muted)',
}
const linkStyle: React.CSSProperties = {
  color: 'var(--primary)',
  textDecoration: 'none',
  fontWeight: 700,
}

function variantColor(v: 'up' | 'down' | 'flat' | 'default' | undefined): string | undefined {
  if (v === 'up')   return '#22c55e'
  if (v === 'down') return '#ef4444'
  return undefined
}

export default function CardPriceQuickFacts({
  card, trend, setHref, pokemonHref, pokemonName,
}: CardPriceQuickFactsProps) {
  const out = buildCardQuickFacts(card ?? null, trend ?? null)
  if (!hasEnoughFacts(out)) return null

  // ── Server-rendered lead sentence. Concise, factual, one line. ──
  const numberSuffix = out.cardNumberLabel ? ` ${out.cardNumberLabel}` : ''
  const setName = card?.set_name ?? ''
  const rawFact  = out.facts.find(f => f.key === 'raw')
  const psa10Fact = out.facts.find(f => f.key === 'psa10')
  let lead: string | null = null
  if (out.displayName && setName) {
    if (rawFact) {
      lead = `${out.displayName}${numberSuffix} from ${setName} has a current raw market value of ${rawFact.value}.`
    } else if (psa10Fact) {
      lead = `${out.displayName}${numberSuffix} from ${setName} currently trades at ${psa10Fact.value} in PSA 10.`
    }
  }

  return (
    <section
      aria-label="Quick price facts"
      style={sectionStyle}
      data-testid="card-quick-facts"
    >
      <h2 style={headingStyle}>Quick price facts</h2>
      {lead && <p style={summaryStyle}>{lead}</p>}
      <dl style={dlStyle}>
        {out.facts.map(f => (
          <div key={f.key} style={rowStyle}>
            <dt style={dtStyle}>{f.label}</dt>
            <dd style={{ ...ddStyle, color: variantColor(f.variant) ?? ddStyle.color }}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
      {(setHref || pokemonHref) && (
        <div style={linkRowStyle}>
          {setHref && (
            <Link href={setHref} style={linkStyle}>
              View all cards from {setName || 'this set'} →
            </Link>
          )}
          {pokemonHref && pokemonName && (
            <Link href={pokemonHref} style={linkStyle}>
              View all {pokemonName} card prices →
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
