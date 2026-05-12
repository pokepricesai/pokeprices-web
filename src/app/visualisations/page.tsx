import Link from 'next/link'
import type { Metadata } from 'next'
import ComingSoonBadge from '@/components/ComingSoonBadge'

export const metadata: Metadata = {
  title: 'Pokémon TCG market visualisations | PokePrices',
  description: 'Visual views of the Pokémon TCG market — heatmaps, risers, fallers, set indexes, grade premium curves and price distributions. Built from real sold-listing data.',
  alternates: { canonical: 'https://www.pokeprices.io/visualisations' },
}

type Viz = {
  title: string
  blurb: string
  status: 'live' | 'soon' | 'planned'
  href?: string
  accent: string
  emoji: string
}

const VISUALISATIONS: Viz[] = [
  {
    title: 'Market heatmap',
    blurb: 'A grid of the most-watched cards, colour-coded by 30-day price change. Spot the whole market at a glance.',
    status: 'live',
    href: '/visualisations/heatmap',
    accent: 'linear-gradient(135deg, #1a5fad 0%, #2874c8 100%)',
    emoji: '🔥',
  },
  {
    title: 'Risers & fallers',
    blurb: 'Leaderboards of the biggest movers — 30d, 90d, 365d. Sparklines per row so you see the shape of the move, not just the number.',
    status: 'soon',
    accent: 'linear-gradient(135deg, #22c55e 0%, #ef4444 100%)',
    emoji: '📈',
  },
  {
    title: 'Set price index',
    blurb: 'Average sealed and single price per set, tracked over time. Compare any two sets on one chart.',
    status: 'soon',
    accent: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
    emoji: '📊',
  },
  {
    title: 'Grade premium curve',
    blurb: 'For any card: the raw price, then PSA 6, 7, 8, 9, 10 — plotted against grading cost so the break-even line is obvious.',
    status: 'soon',
    accent: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
    emoji: '📐',
  },
  {
    title: 'Price distribution',
    blurb: 'Histogram of every recent sale for a card. See the modal price, the long tail, and which grades sit where.',
    status: 'planned',
    accent: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)',
    emoji: '📉',
  },
  {
    title: 'Sealed market tracker',
    blurb: 'Booster boxes, ETBs and special sets, tracked over their full release-to-now arc. Compare any two products side by side.',
    status: 'planned',
    accent: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
    emoji: '📦',
  },
]

const STATUS_LABEL: Record<Viz['status'], string> = {
  live: 'Live',
  soon: 'Coming soon',
  planned: 'Planned',
}

const STATUS_CTA: Record<Viz['status'], string> = {
  live: 'View →',
  soon: 'In development',
  planned: 'Roadmap',
}

export default function VisualisationsHubPage() {
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '36px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.10)', padding: '4px 12px', borderRadius: 14, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          New section · Roadmap inside
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 38, margin: '0 0 10px', color: 'var(--text)', letterSpacing: '-0.5px' }}>
          See the market, don't just read it
        </h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 620, margin: '0 auto' }}>
          Numbers are useful. Pictures are faster. This is where the PokePrices data set turns into charts, heatmaps and indexes you can actually feel.
        </p>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {VISUALISATIONS.map(v => (
          <VizCard key={v.title} viz={v} />
        ))}
      </div>

      {/* Roadmap note */}
      <div style={{
        marginTop: 40,
        background: 'var(--bg-light)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '20px 22px',
        maxWidth: 720,
        marginLeft: 'auto',
        marginRight: 'auto',
      }}>
        <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, margin: '0 0 8px' }}>
          What's a visualisation worth to you?
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
          The order this list ships in depends on what collectors actually want. Got a chart in mind we have not listed?{' '}
          <Link href="/contact" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>Tell me</Link> — small site, real human reads every message.
        </p>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 30, lineHeight: 1.6 }}>
        Every chart is built on the same public sold-listing data the rest of the site shows. No asking prices, no guesses.
      </p>
    </div>
  )
}

function VizCard({ viz }: { viz: Viz }) {
  const isInteractive = viz.status === 'live' && !!viz.href
  const inner = (
    <>
      <div style={{
        background: viz.accent, color: '#fff',
        padding: '28px 22px', display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', gap: 10, minHeight: 140,
        opacity: viz.status === 'planned' ? 0.7 : 1,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div style={{ fontSize: 28 }}>{viz.emoji}</div>
          <ComingSoonBadge variant="light" label={STATUS_LABEL[viz.status]} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Outfit', sans-serif", lineHeight: 1.15, marginTop: 'auto' }}>
          {viz.title}
        </div>
      </div>
      <div style={{ padding: '16px 20px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 14px' }}>
          {viz.blurb}
        </p>
        <span style={{
          fontSize: 12, fontWeight: 800,
          color: viz.status === 'live' ? 'var(--primary)' : 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 'auto',
        }}>
          {STATUS_CTA[viz.status]}
        </span>
      </div>
    </>
  )

  const baseStyle: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', textDecoration: 'none',
    background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)',
    overflow: 'hidden',
    transition: 'transform 0.15s, box-shadow 0.15s',
    cursor: isInteractive ? 'pointer' : 'default',
  }

  if (isInteractive) {
    return <Link href={viz.href!} style={baseStyle}>{inner}</Link>
  }
  return <div style={baseStyle}>{inner}</div>
}
