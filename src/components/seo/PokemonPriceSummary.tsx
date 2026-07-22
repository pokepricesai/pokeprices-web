// src/components/seo/PokemonPriceSummary.tsx
// Block 5A-W-46C — server-rendered "card prices at a glance" summary
// for the /pokemon/{slug} page. Renders in initial HTML using data
// the species RPC already returns.

import Link from 'next/link'
import {
  buildPokemonSummary,
  type PokemonSummaryInput,
} from '@/lib/seo/pokemonSummary'

export type PokemonPriceSummaryProps = PokemonSummaryInput

const sectionStyle: React.CSSProperties = {
  margin: '10px 0 24px',
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
const ulStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
  listStyle: 'none',
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
const labelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
  textTransform: 'uppercase', color: 'var(--text-muted)',
}
const valueStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: 'var(--text)',
}

function variantColor(v: 'up' | 'down' | 'default' | undefined): string | undefined {
  if (v === 'up')   return '#22c55e'
  if (v === 'down') return '#ef4444'
  return undefined
}

export default function PokemonPriceSummary(props: PokemonPriceSummaryProps) {
  const out = buildPokemonSummary(props)
  if (!out.render) return null

  return (
    <section
      aria-label={`${out.displayName} card prices at a glance`}
      style={sectionStyle}
      data-testid="pokemon-price-summary"
    >
      <h2 style={headingStyle}>{out.displayName} card prices at a glance</h2>
      <ul style={ulStyle}>
        {out.facts.map(f => {
          const value = f.linkHref
            ? <Link href={f.linkHref} style={{
                color: 'var(--primary)', textDecoration: 'none', fontWeight: 700,
              }}>{f.value}</Link>
            : f.value
          const color = variantColor(f.variant) ?? valueStyle.color
          return (
            <li key={f.key} style={rowStyle}>
              <span style={labelStyle}>{f.label}</span>
              <span style={{ ...valueStyle, color }}>{value}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
