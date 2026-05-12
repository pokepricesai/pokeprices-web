import Link from 'next/link'
import type { Metadata } from 'next'
import ComingSoonBadge from '@/components/ComingSoonBadge'

export const metadata: Metadata = {
  title: 'Tools for Pokémon TCG collectors | PokePrices',
  description: 'Calculators, trackers and creator tools built on real Pokémon TCG sold-listing data. Grading ROI, card show planner, portfolio tracker, smart price alerts and more — all free.',
  alternates: { canonical: 'https://www.pokeprices.io/tools' },
}

type Tool = {
  title: string
  blurb: string
  href?: string
  gated?: boolean
  comingSoon?: boolean
  accent: string
  emoji: string
}

type Category = {
  label: string
  hint: string
  tools: Tool[]
}

const CATEGORIES: Category[] = [
  {
    label: 'Calculators & Utilities',
    hint: 'Free, no login. Open data, open math.',
    tools: [
      {
        title: 'Grading Calculator',
        blurb: 'PSA / CGC / BGS landed cost vs. graded uplift. See break-even and ROI for every card.',
        href: '/dashboard/grading',
        accent: 'linear-gradient(135deg, #1a5fad 0%, #2874c8 100%)',
        emoji: '🎯',
      },
      {
        title: 'Card Show Planner',
        blurb: 'UK & US Pokémon card shows mapped, filtered and saved. Plan your weekend in one screen.',
        href: '/dashboard/card-shows',
        accent: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)',
        emoji: '📍',
      },
      {
        title: 'Trade Evaluator',
        blurb: 'Build two stacks of cards side-by-side. See the fair-value gap in cash, trade-credit and blended modes.',
        href: '/dealer',
        accent: 'linear-gradient(135deg, #06b6d4 0%, #38bdf8 100%)',
        emoji: '⚖️',
      },
    ],
  },
  {
    label: 'Track Your Collection',
    hint: 'Sign in to save. Free forever, no data sold.',
    tools: [
      {
        title: 'Portfolio',
        blurb: 'Log what you own, what you paid, and watch the landed value move in real time.',
        href: '/dashboard/portfolio',
        gated: true,
        accent: 'linear-gradient(135deg, #22c55e 0%, #4ade80 100%)',
        emoji: '💼',
      },
      {
        title: 'Watchlist',
        blurb: 'Cards you are tracking but do not own yet. One click to follow, see weekly trend at a glance.',
        href: '/dashboard/watchlist',
        gated: true,
        accent: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
        emoji: '👀',
      },
      {
        title: 'Set Completion',
        blurb: 'Tick off what you own. See your progress per set, missing cards ranked by current market value.',
        href: '/dashboard/sets',
        gated: true,
        accent: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
        emoji: '📚',
      },
      {
        title: 'Smart Alerts',
        blurb: 'Get pinged when a card breaks a price you care about — up or down. Email only, no spam.',
        href: '/dashboard/alerts',
        gated: true,
        accent: 'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
        emoji: '🔔',
      },
    ],
  },
  {
    label: 'Create & Share',
    hint: 'For creators, dealers and Discord show-and-tellers.',
    tools: [
      {
        title: 'Studio',
        blurb: 'One-click branded graphics from any card or set. Export PNG for X, Instagram, YouTube thumbs.',
        href: '/studio',
        gated: true,
        accent: 'linear-gradient(135deg, #1a5fad 0%, #7c3aed 100%)',
        emoji: '🎨',
      },
    ],
  },
]

function buildItemList() {
  const items = CATEGORIES.flatMap(cat => cat.tools)
    .filter(t => t.href && !t.comingSoon)
    .map((t, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: t.title,
      url: `https://www.pokeprices.io${t.href}`,
      description: t.blurb,
    }))
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'PokePrices tools for Pokémon TCG collectors',
    itemListElement: items,
  }
}

export default function ToolsHubPage() {
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '36px 20px 60px', fontFamily: "'Figtree', sans-serif" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildItemList()) }}
      />

      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, fontWeight: 800, color: 'var(--primary)', background: 'rgba(26,95,173,0.10)', padding: '4px 12px', borderRadius: 14, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>
          Free · No paywall · Real data
        </div>
        <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 38, margin: '0 0 10px', color: 'var(--text)', letterSpacing: '-0.5px' }}>
          Tools for serious collectors
        </h1>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 620, margin: '0 auto' }}>
          Calculators, trackers and creator tools built on the same sold-listing data the rest of the site runs on. No login required for the open tools. Trackers save your work when you sign in.
        </p>
      </div>

      {/* Categories */}
      {CATEGORIES.map(cat => (
        <section key={cat.label} style={{ marginBottom: 44 }}>
          <div style={{ marginBottom: 16 }}>
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, margin: '0 0 4px', color: 'var(--text)' }}>
              {cat.label}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>{cat.hint}</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {cat.tools.map(tool => (
              <ToolCard key={tool.title} tool={tool} />
            ))}
          </div>
        </section>
      ))}

      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
        Built by collectors, for collectors. Every tool runs on the same public sold-listing data the rest of the site shows.
      </p>
    </div>
  )
}

function ToolCard({ tool }: { tool: Tool }) {
  const isInteractive = !!tool.href && !tool.comingSoon
  const inner = (
    <>
      <div style={{
        background: tool.accent, color: '#fff',
        padding: '28px 22px', display: 'flex', flexDirection: 'column',
        alignItems: 'flex-start', gap: 10, minHeight: 140,
        opacity: tool.comingSoon ? 0.7 : 1,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
          <div style={{ fontSize: 28 }}>{tool.emoji}</div>
          {tool.comingSoon && <ComingSoonBadge variant="light" />}
          {tool.gated && !tool.comingSoon && <ComingSoonBadge variant="light" label="Sign in" />}
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "'Outfit', sans-serif", lineHeight: 1.15, marginTop: 'auto' }}>
          {tool.title}
        </div>
      </div>
      <div style={{ padding: '16px 20px 20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, margin: '0 0 14px' }}>
          {tool.blurb}
        </p>
        <span style={{ fontSize: 12, fontWeight: 800, color: tool.comingSoon ? 'var(--text-muted)' : 'var(--primary)', textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 'auto' }}>
          {tool.comingSoon ? 'In development' : tool.gated ? 'Sign in to use →' : 'Open tool →'}
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
    return <Link href={tool.href!} style={baseStyle}>{inner}</Link>
  }
  return <div style={baseStyle}>{inner}</div>
}
