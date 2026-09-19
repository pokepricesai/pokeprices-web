'use client'

// src/app/admin/design/card-layout-b2/PrototypeB2Client.tsx
// ============================================================================
// Prototype B2 — Collector Dashboard (refined)
//
// The IA refinement over Prototype B:
//   • Genuine sticky left section-navigation rail on wide desktop (>=1200px).
//     Grouped items (Value / Grading / Collector / Tools), active-section
//     highlighting via IntersectionObserver, and inline contextual price
//     data next to "Prices" and "Grading" for immediate scanability.
//   • Sections separated cleanly so nav destinations map 1:1 to headings:
//       overview · prices · price-history · grading · grade-ladder ·
//       psa-population · market-signals · about-set · faq · ask-ai
//     (Related Cards omitted — no data in the shared loader.)
//   • Below 1200px the left rail collapses to a compact sticky horizontal
//     chip strip. Below 900px the right eBay rail also folds into the
//     main column, but the horizontal chip strip stays so section jumps
//     remain one tap away on mobile.
//
// Zero fork of business logic — reuses the loader + affiliate components
// + shared helpers already used by Prototype B.
// ============================================================================

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EbayCardPrimaryAction from '@/components/affiliate/EbayCardPrimaryAction'
import EbayCardPriceActions from '@/components/affiliate/EbayCardPriceActions'
import EbayCompactLink from '@/components/affiliate/EbayCompactLink'
import PriceChart, { type ChartSeries } from '@/components/PriceChart'
import GradeLadder, { type GradePrices } from '@/components/GradeLadder'
import FAQ from '@/components/FAQ'
import InlineChat from '@/components/InlineChat'
import { getCardFaqItems } from '@/lib/faqs'
import { getSetAssets } from '@/lib/setAssets'
import type { PrototypeCardPayload } from '../_lib/loadPrototypeCard'
import {
  cleanCardName, fmtUsd, fmtPct, gradePricesFromRow, historySeries,
  cardFaqInputFrom, priceRowFor, deltaChipStyle, gradingOpportunity,
} from '../_lib/protoUi'

/* ─── nav model ──────────────────────────────────────────────────────────── */

type NavGroup = 'Value' | 'Grading' | 'Collector' | 'Tools' | null
type NavItem = { id: string; label: string; group: NavGroup }

const NAV_ITEMS: NavItem[] = [
  { id: 'overview',       label: 'Overview',        group: null       },
  { id: 'prices',         label: 'Prices',          group: 'Value'    },
  { id: 'price-history',  label: 'Price history',   group: 'Value'    },
  { id: 'grading',        label: 'Grading',         group: 'Grading'  },
  { id: 'grade-ladder',   label: 'Grade ladder',    group: 'Grading'  },
  { id: 'psa-population', label: 'PSA population',  group: 'Grading'  },
  { id: 'market-signals', label: 'Market signals',  group: 'Collector'},
  { id: 'about-set',      label: 'About the set',   group: 'Collector'},
  { id: 'faq',            label: 'FAQ',             group: 'Tools'    },
  { id: 'ask-ai',         label: 'Ask AI',          group: 'Tools'    },
]

/* ─── page ───────────────────────────────────────────────────────────────── */

export default function PrototypeB2Client({ payload }: { payload: PrototypeCardPayload }) {
  const { card, trend, priceHistory, population } = payload
  if (!card) return <div style={{ padding: 40 }}>Card not found.</div>

  const cardName    = String(card.card_name ?? '')
  const displayName = cleanCardName(cardName)
  const setName     = String(card.set_name ?? 'Base Set')
  const cardNum     = String(card.card_number ?? '')
  const cardSlug    = card.card_slug ? String(card.card_slug) : null
  const setAssets   = getSetAssets(setName)
  const gradePrices = gradePricesFromRow(card)
  const series      = historySeries(priceHistory)
  const trendChips  = priceRowFor(card, trend)
  const grading     = gradingOpportunity(card, population?.gem_rate ?? null)

  const cardBundle = { cardName, setName, cardNum, cardSlug }

  // Inline context shown next to some nav rows (kept short so the rail
  // stays scannable rather than data-dense).
  const navContext: Partial<Record<string, string>> = {
    prices:   fmtUsd(card.psa10_usd),
    grading:  grading ? `${grading.multiple.toFixed(1)}×` : undefined,
    'psa-population': population?.total_graded != null
      ? population.total_graded.toLocaleString() : undefined,
  }

  const activeId = useActiveSection(NAV_ITEMS.map(i => i.id))

  return (
    <div style={{ fontFamily: "'Figtree', sans-serif" }}>
      {/* ── Sticky compact horizontal chip strip (below 1200px + mobile) ──── */}
      <MobileNav activeId={activeId} />

      {/* ── Three-column shell ────────────────────────────────────────────── */}
      <div className="b2-shell">
        {/* Left — sticky section nav (wide desktop only) */}
        <aside className="b2-left-nav" aria-label="Card sections">
          <LeftNav
            displayName={displayName}
            cardNum={cardNum}
            setName={setName}
            activeId={activeId}
            context={navContext}
          />
        </aside>

        {/* Centre — the actual dashboard */}
        <main className="b2-main">
          <SectionOverview
            card={card}
            displayName={displayName}
            setName={setName}
            cardNum={cardNum}
            setAssets={setAssets}
            trendChips={trendChips}
            grading={grading}
          />

          <SectionPrices
            card={card}
            {...cardBundle}
          />

          <SectionPriceHistory
            priceHistory={priceHistory}
            series={series}
          />

          <SectionGrading
            card={card}
            grading={grading}
            pop={population}
          />

          <SectionGradeLadder gradePrices={gradePrices} />

          <SectionPsaPopulation pop={population} />

          <SectionMarketSignals
            trend={trend}
            priceHistory={priceHistory}
          />

          <SectionAboutSet
            setName={setName}
            releaseDate={card.set_release_date as string | null | undefined}
          />

          <SectionFaq card={card} />

          <SectionAskAi
            card={card}
            cardName={cardName}
            setName={setName}
            cardNum={cardNum}
            cardSlug={cardSlug}
          />
        </main>

        {/* Right — sticky commercial rail (>=900px) */}
        <aside className="b2-right-rail" aria-label="Buy this card">
          <RightRail
            card={card}
            cardBundle={cardBundle}
            grading={grading}
          />
        </aside>
      </div>

      <ResponsiveCss />
    </div>
  )
}

/* ─── active-section hook ────────────────────────────────────────────────── */

/** Track which section id is currently "active" (closest to the top of the
 *  reading area). Uses IntersectionObserver with a top-biased root margin
 *  so the active state changes as a section crosses ~a third of the way
 *  down the viewport, rather than only when its middle is centred. */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState<string>(ids[0] ?? '')
  const ratios = useRef<Record<string, number>>({})

  useEffect(() => {
    if (typeof window === 'undefined') return
    const els = ids
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          ratios.current[entry.target.id] = entry.isIntersecting ? entry.intersectionRatio : 0
        }
        // Prefer the highest-intersecting section; fall back to the first
        // that has any ratio > 0.
        let bestId = active
        let bestRatio = -1
        for (const id of ids) {
          const r = ratios.current[id] ?? 0
          if (r > bestRatio) { bestRatio = r; bestId = id }
        }
        if (bestRatio > 0 && bestId !== active) setActive(bestId)
      },
      {
        rootMargin: '-20% 0px -55% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    )
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
    // ids is stable per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return active
}

/* ─── left nav (wide desktop) ────────────────────────────────────────────── */

function LeftNav({
  displayName, cardNum, setName, activeId, context,
}: {
  displayName: string
  cardNum: string
  setName: string
  activeId: string
  context: Partial<Record<string, string>>
}) {
  const groups = useMemo(() => {
    const acc: Array<{ group: NavGroup; items: NavItem[] }> = []
    for (const item of NAV_ITEMS) {
      const last = acc[acc.length - 1]
      if (last && last.group === item.group) last.items.push(item)
      else acc.push({ group: item.group, items: [item] })
    }
    return acc
  }, [])

  return (
    <nav
      style={{
        position: 'sticky', top: 60,
        alignSelf: 'flex-start',
        padding: '18px 16px',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        maxHeight: 'calc(100vh - 72px)',
        overflowY: 'auto',
      }}
    >
      <div style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 15, fontWeight: 800,
        letterSpacing: -0.2, lineHeight: 1.2, marginBottom: 2,
      }}>
        {displayName}
      </div>
      <div style={{
        fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 14,
      }}>
        {setName}{cardNum ? ` · #${cardNum}` : ''}
      </div>

      {groups.map((g, i) => (
        <div key={g.group ?? `top-${i}`} style={{ marginBottom: 10 }}>
          {g.group ? (
            <div style={{
              fontSize: 9.5, fontWeight: 900, letterSpacing: 1.2,
              textTransform: 'uppercase', color: 'var(--text-muted)',
              margin: '10px 4px 4px',
            }}>{g.group}</div>
          ) : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {g.items.map(item => (
              <li key={item.id}>
                <NavRow item={item} isActive={activeId === item.id} context={context[item.id]} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function NavRow({ item, isActive, context }: { item: NavItem; isActive: boolean; context?: string }) {
  return (
    <a
      href={`#${item.id}`}
      aria-current={isActive ? 'true' : undefined}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, padding: '7px 10px', borderRadius: 8,
        background: isActive ? 'var(--bg-light)' : 'transparent',
        border: isActive ? '1px solid var(--border)' : '1px solid transparent',
        borderLeft: isActive ? '3px solid var(--primary)' : '3px solid transparent',
        color: isActive ? 'var(--text)' : 'var(--text-muted)',
        fontSize: 13, fontWeight: isActive ? 800 : 600,
        textDecoration: 'none', lineHeight: 1.2,
        transition: 'background 120ms, color 120ms',
      }}
    >
      <span>{item.label}</span>
      {context ? (
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: isActive ? 'var(--primary)' : 'var(--text-muted)',
          fontFeatureSettings: '"tnum"',
        }}>{context}</span>
      ) : null}
    </a>
  )
}

/* ─── mobile / medium horizontal nav ─────────────────────────────────────── */

function MobileNav({ activeId }: { activeId: string }) {
  return (
    <nav
      className="b2-mobile-nav"
      aria-label="Card sections"
      style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        padding: '8px 12px',
        overflowX: 'auto', whiteSpace: 'nowrap',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {NAV_ITEMS.map(i => (
        <a
          key={i.id}
          href={`#${i.id}`}
          aria-current={activeId === i.id ? 'true' : undefined}
          style={{
            display: 'inline-block', padding: '6px 12px', marginRight: 6,
            borderRadius: 999,
            background: activeId === i.id ? 'var(--primary)' : 'var(--bg-light)',
            color: activeId === i.id ? '#fff' : 'var(--text)',
            fontSize: 12, fontWeight: 700, textDecoration: 'none',
            border: '1px solid var(--border)',
          }}
        >{i.label}</a>
      ))}
    </nav>
  )
}

/* ─── right rail (commercial / actions) ──────────────────────────────────── */

function RightRail({
  card, cardBundle, grading,
}: {
  card: NonNullable<PrototypeCardPayload['card']>
  cardBundle: { cardName: string; setName: string; cardNum: string; cardSlug: string | null }
  grading: ReturnType<typeof gradingOpportunity>
}) {
  return (
    <div
      style={{
        position: 'sticky', top: 60,
        alignSelf: 'flex-start',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <RailCard title="Find this card">
        <EbayCardPrimaryAction
          cardName={cardBundle.cardName}
          setName={cardBundle.setName}
          cardNumber={cardBundle.cardNum}
          cardSlug={cardBundle.cardSlug}
          setSlug={cardBundle.setName}
          language={card.language === 'jp' ? 'jp' : 'en'}
        />
        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
          <RailEbay intent="raw"         label="Raw on eBay"          placement="proto_b2_rail_raw"    card={cardBundle} />
          <RailEbay intent="psa9"        label="PSA 9 on eBay"        placement="proto_b2_rail_psa9"   card={cardBundle} />
          <RailEbay intent="psa10"       label="PSA 10 on eBay"       placement="proto_b2_rail_psa10"  card={cardBundle} />
          <RailEbay intent="sold_search" label="Recent sold listings" placement="proto_b2_rail_sold"   card={cardBundle} />
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '10px 0 0', opacity: 0.75 }}>
          Affiliate links · we may earn commission
        </p>
      </RailCard>

      {grading ? (
        <RailCard title="Grading snapshot">
          <MiniStat k="Raw"       v={fmtUsd(card.raw_usd)} />
          <MiniStat k="PSA 10"    v={fmtUsd(card.psa10_usd)} />
          <MiniStat k="Multiple"  v={`${grading.multiple.toFixed(1)}×`} />
          <MiniStat k="Net at PSA 10 (after ~$25 fee)"
                    v={fmtUsd(grading.psa10NetCents)}
                    highlight={grading.psa10NetCents > 0 ? 'up' : 'down'} />
          {grading.expectedValueCents != null ? (
            <MiniStat k="Probability-weighted net"
                      v={fmtUsd(grading.expectedValueCents)}
                      highlight={grading.expectedValueCents > 0 ? 'up' : 'down'} />
          ) : null}
          <a href="#grading" style={{
            display: 'block', textAlign: 'center', marginTop: 10,
            padding: '7px 10px', borderRadius: 8,
            background: 'var(--bg-light)', color: 'var(--text)',
            fontSize: 12, fontWeight: 700, textDecoration: 'none',
            border: '1px solid var(--border)',
          }}>See full grading breakdown →</a>
        </RailCard>
      ) : null}

      <a
        href="#ask-ai"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '11px 14px', borderRadius: 12,
          background: 'var(--card)', border: '1px solid var(--border)',
          color: 'var(--text)', fontSize: 13, fontWeight: 800,
          textDecoration: 'none',
        }}
      >
        <span aria-hidden style={{ fontSize: 15 }}>✨</span>
        Ask AI about this card →
      </a>
    </div>
  )
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: 14, background: 'var(--card)',
      border: '1px solid var(--border)', borderRadius: 12,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 900, letterSpacing: 1.5,
        textTransform: 'uppercase', color: 'var(--text-muted)',
        marginBottom: 8,
      }}>{title}</div>
      {children}
    </div>
  )
}

function MiniStat({ k, v, highlight }: { k: string; v: string; highlight?: 'up' | 'down' }) {
  const color = highlight === 'up' ? '#15803d' : highlight === 'down' ? '#b91c1c' : 'var(--text)'
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', gap: 8,
      padding: '5px 0', borderBottom: '1px dashed var(--border)',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ color, fontWeight: 800, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{v}</span>
    </div>
  )
}

function RailEbay({ intent, label, placement, card }: {
  intent: 'raw' | 'psa9' | 'psa10' | 'sold_search'
  label: string
  placement: string
  card: { cardName: string; setName: string; cardNum: string; cardSlug: string | null }
}) {
  return (
    <EbayCompactLink
      intent={intent}
      cardName={card.cardName} setName={card.setName} cardNumber={card.cardNum}
      cardSlug={card.cardSlug} setSlug={card.setName}
      placement={placement} pageType="card" sourceComponent="proto_b2_rail"
      label={label} icon=""
      style={{
        display: 'block', padding: '8px 10px', borderRadius: 8,
        background: 'var(--bg-light)', color: 'var(--text)',
        fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
        border: '1px solid var(--border)', textAlign: 'center',
      }}
    />
  )
}

/* ─── section building blocks ────────────────────────────────────────────── */

function DashCard({ id, title, subtitle, children }: {
  id: string; title: string; subtitle?: string; children: React.ReactNode
}) {
  return (
    <section id={id} className="b2-section" style={{ marginBottom: 20 }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '20px 22px',
      }}>
        <h2 style={{
          fontSize: 20, margin: '0 0 4px',
          fontFamily: "'Outfit', sans-serif", fontWeight: 800,
          letterSpacing: -0.2,
        }}>{title}</h2>
        {subtitle ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: '0 0 14px' }}>{subtitle}</p>
        ) : null}
        {children}
      </div>
    </section>
  )
}

/* ─── sections ───────────────────────────────────────────────────────────── */

function SectionOverview({
  card, displayName, setName, cardNum, setAssets, trendChips, grading,
}: {
  card: NonNullable<PrototypeCardPayload['card']>
  displayName: string
  setName: string
  cardNum: string
  setAssets: { logoUrl: string | null; symbolUrl: string | null }
  trendChips: ReturnType<typeof priceRowFor>
  grading: ReturnType<typeof gradingOpportunity>
}) {
  return (
    <section id="overview" className="b2-section" style={{ marginBottom: 20 }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 16, padding: '22px 22px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22, flexWrap: 'wrap' }}>
          {/* Image */}
          {card.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={String(card.image_url)}
              alt={displayName}
              style={{
                width: 200, height: 280, objectFit: 'cover',
                borderRadius: 12, background: 'var(--bg-light)',
                boxShadow: '0 4px 18px rgba(0,0,0,0.10)', flexShrink: 0,
              }}
            />
          ) : null}

          {/* Identity + top-line metrics + trend chips */}
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {setAssets.symbolUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={setAssets.symbolUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} loading="lazy" />
              ) : null}
              <span style={{
                fontSize: 11, fontWeight: 800, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 1,
              }}>
                {setName}{cardNum ? ` · #${cardNum}` : ''}
              </span>
            </div>

            <h1 style={{
              fontSize: 32, fontWeight: 800, margin: '2px 0 6px',
              fontFamily: "'Outfit', sans-serif",
              letterSpacing: -0.4, lineHeight: 1.15,
            }}>{displayName}</h1>

            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
              <Link href={`/set/${encodeURIComponent(setName)}`}
                    style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 700 }}>
                {setName}
              </Link>
              {card.card_number_display ? ` · ${card.card_number_display}` :
                cardNum ? ` · #${cardNum}` : ''}
              {card.set_release_date ? ` · Released ${String(card.set_release_date)}` : ''}
            </div>

            {/* Top-line metric strip — Raw / PSA 9 / PSA 10 / multiple */}
            <div style={{
              display: 'grid', gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              marginBottom: 12,
            }}>
              <MetricInline label="Raw"    value={fmtUsd(card.raw_usd)} />
              <MetricInline label="PSA 9"  value={fmtUsd(card.psa9_usd)} />
              <MetricInline label="PSA 10" value={fmtUsd(card.psa10_usd)} emphasise />
              {grading ? (
                <MetricInline label="PSA 10 × raw" value={`${grading.multiple.toFixed(1)}×`} />
              ) : null}
            </div>

            {/* Trend chips — collapsed onto one row when possible */}
            {trendChips.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {trendChips.map(t => (
                  <span key={t.label} style={deltaChipStyle(t.pct)}>
                    Raw {t.label}: {fmtPct(t.pct)}
                  </span>
                ))}
              </div>
            )}

            {/* Fold eBay CTA — visible even before the user scrolls to the right rail */}
            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <a href="#prices" style={{
                padding: '9px 14px', borderRadius: 10,
                background: 'var(--primary)', color: '#fff',
                fontSize: 13, fontWeight: 800, textDecoration: 'none',
                border: '1px solid var(--primary)',
              }}>See all prices →</a>
              <a href="#grading" style={{
                padding: '9px 14px', borderRadius: 10,
                background: 'var(--bg-light)', color: 'var(--text)',
                fontSize: 13, fontWeight: 800, textDecoration: 'none',
                border: '1px solid var(--border)',
              }}>Is it worth grading? →</a>
              <a href="#ask-ai" style={{
                padding: '9px 14px', borderRadius: 10,
                background: 'var(--bg-light)', color: 'var(--text)',
                fontSize: 13, fontWeight: 800, textDecoration: 'none',
                border: '1px solid var(--border)',
              }}>Ask AI ✨</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function SectionPrices({
  card, cardName, setName, cardNum, cardSlug,
}: {
  card: NonNullable<PrototypeCardPayload['card']>
  cardName: string
  setName: string
  cardNum: string
  cardSlug: string | null
}) {
  return (
    <DashCard id="prices" title="Prices"
              subtitle="Every tier we have live data on for this card, in USD.">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: 14 }}>
          <tbody>
            {([
              ['Raw',    card.raw_usd   ],
              ['PSA 8',  card.psa8_usd  ],
              ['PSA 9',  card.psa9_usd  ],
              ['PSA 10', card.psa10_usd ],
              ['BGS 10', card.bgs10_usd ],
              ['CGC 10', card.cgc10_usd ],
            ] as Array<[string, number | null | undefined]>)
              .filter(([, v]) => v != null)
              .map(([label, v]) => (
                <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '9px 0', color: 'var(--text-muted)' }}>{label}</td>
                  <td style={{ padding: '9px 0', textAlign: 'right', fontWeight: 800, fontFeatureSettings: '"tnum"' }}>
                    {fmtUsd(v as number)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12 }}>
        <EbayCardPriceActions
          cardName={cardName}
          setName={setName}
          cardNumber={cardNum}
          cardSlug={cardSlug}
          setSlug={setName}
          pageType="card"
          isSealed={!!card.is_sealed}
          rawPriceCents={card.raw_usd ?? null}
          psa9PriceCents={card.psa9_usd ?? null}
          psa10PriceCents={card.psa10_usd ?? null}
        />
      </div>
    </DashCard>
  )
}

function SectionPriceHistory({
  priceHistory, series,
}: {
  priceHistory: PrototypeCardPayload['priceHistory']
  series: ReturnType<typeof historySeries>
}) {
  return (
    <DashCard id="price-history" title="Price history"
              subtitle="Nightly sold-listing history across every tier we track.">
      <PriceChart data={priceHistory as any[]} series={series as ChartSeries[]} ranges height={340} />
    </DashCard>
  )
}

function SectionGrading({
  card, grading, pop,
}: {
  card: NonNullable<PrototypeCardPayload['card']>
  grading: ReturnType<typeof gradingOpportunity>
  pop: PrototypeCardPayload['population']
}) {
  return (
    <DashCard id="grading" title="Grading — is it worth it?"
              subtitle="High-level answer using current prices and PSA population, before you send anything in.">
      {grading ? (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 32, fontWeight: 900, letterSpacing: -0.5, lineHeight: 1 }}>
              {grading.multiple.toFixed(1)}×
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 700 }}>PSA 10 vs raw</span>
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 14, lineHeight: 1.55 }}>
            Raw is <strong>{fmtUsd(card.raw_usd)}</strong> and a PSA 10 sells for <strong>{fmtUsd(card.psa10_usd)}</strong>.
            After a $25 grading fee, a PSA 10 result would net{' '}
            <strong style={{ color: grading.psa10NetCents > 0 ? '#15803d' : '#b91c1c' }}>
              {fmtUsd(grading.psa10NetCents)}
            </strong>.
          </p>
          {pop?.gem_rate != null ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Only <strong style={{ color: 'var(--text)' }}>{pop.gem_rate.toFixed(1)}%</strong> of submissions grade PSA 10 —
              the probability-weighted net is{' '}
              <strong style={{ color: (grading.expectedValueCents ?? 0) > 0 ? '#15803d' : '#b91c1c' }}>
                {fmtUsd(grading.expectedValueCents)}
              </strong>.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              PSA population data unavailable for this variant — factor in your own gem-rate estimate before submitting.
            </p>
          )}
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a href="#grade-ladder" style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'var(--bg-light)', color: 'var(--text)',
              fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
              border: '1px solid var(--border)',
            }}>See full grade ladder →</a>
            <a href="#psa-population" style={{
              padding: '8px 12px', borderRadius: 8,
              background: 'var(--bg-light)', color: 'var(--text)',
              fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
              border: '1px solid var(--border)',
            }}>PSA population →</a>
          </div>
        </>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          Not enough price data to score grading for this card.
        </p>
      )}
    </DashCard>
  )
}

function SectionGradeLadder({ gradePrices }: { gradePrices: GradePrices }) {
  return (
    <DashCard id="grade-ladder" title="Grade ladder"
              subtitle="Every grading tier and half-grade we have prices for, side by side.">
      <GradeLadder prices={gradePrices} />
    </DashCard>
  )
}

function SectionPsaPopulation({ pop }: { pop: PrototypeCardPayload['population'] }) {
  return (
    <DashCard id="psa-population" title="PSA population"
              subtitle="How many copies of this exact card PSA has graded, by tier.">
      {pop ? (
        <div style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        }}>
          {([
            ['Total graded', pop.total_graded ?? 0],
            ['PSA 10',       pop.psa_10       ?? 0],
            ['PSA 9',        pop.psa_9        ?? 0],
            ['PSA 8',        pop.psa_8        ?? 0],
            ['Gem rate',     pop.gem_rate != null ? `${pop.gem_rate.toFixed(1)}%` : '—'],
          ] as Array<[string, string | number]>).map(([label, v]) => (
            <div key={label} style={{
              padding: '12px 14px', background: 'var(--bg-light)',
              border: '1px solid var(--border)', borderRadius: 10,
            }}>
              <div style={{
                fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: 0.6,
              }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2, fontFeatureSettings: '"tnum"' }}>
                {typeof v === 'number' ? v.toLocaleString() : v}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
          No matching PSA population row for this variant.
        </p>
      )}
    </DashCard>
  )
}

function SectionMarketSignals({
  trend, priceHistory,
}: {
  trend: PrototypeCardPayload['trend']
  priceHistory: PrototypeCardPayload['priceHistory']
}) {
  const nPoints = priceHistory.length
  const oldest  = priceHistory.length ? priceHistory[0]?.date : null
  const newest  = priceHistory.length ? priceHistory[priceHistory.length - 1]?.date : null
  const tiles: Array<[string, string]> = [
    ['Trend as of',    trend?.updated_at ? new Date(trend.updated_at).toLocaleDateString('en-GB') : '—'],
    ['History points', String(nPoints)],
    ['Oldest',         oldest ?? '—'],
    ['Newest',         newest ?? '—'],
  ]
  return (
    <DashCard id="market-signals" title="Market signals"
              subtitle="Freshness and depth of the price history we hold for this card.">
      <div style={{
        display: 'grid', gap: 10,
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
      }}>
        {tiles.map(([label, v]) => (
          <div key={label} style={{
            padding: '12px 14px', background: 'var(--bg-light)',
            border: '1px solid var(--border)', borderRadius: 10,
          }}>
            <div style={{
              fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: 0.6,
            }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>
    </DashCard>
  )
}

function SectionAboutSet({
  setName, releaseDate,
}: {
  setName: string
  releaseDate: string | null | undefined
}) {
  return (
    <DashCard id="about-set" title={`About ${setName}`}
              subtitle="Set context, in one line — deeper set data lives on the set page.">
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        This card was released as part of the Pokémon {setName} set
        {releaseDate ? ` on ${releaseDate}` : ''}.{' '}
        <Link href={`/set/${encodeURIComponent(setName)}`}
              style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 700 }}>
          See every card in {setName} →
        </Link>
      </p>
    </DashCard>
  )
}

function SectionFaq({ card }: { card: NonNullable<PrototypeCardPayload['card']> }) {
  return (
    <DashCard id="faq" title="Common questions">
      <FAQ items={getCardFaqItems(cardFaqInputFrom(card))} title="" intro="" />
    </DashCard>
  )
}

function SectionAskAi({
  card, cardName, setName, cardNum, cardSlug,
}: {
  card: NonNullable<PrototypeCardPayload['card']>
  cardName: string
  setName: string
  cardNum: string
  cardSlug: string | null
}) {
  return (
    <DashCard id="ask-ai" title="Ask AI about this card"
              subtitle="The full assistant already knows which card you are on — grading advice, comps, market context.">
      <InlineChat
        cardContext={{
          cardRecordId:            null,
          cardUrlSlug:             'charizard-1st-edition-4',
          priceChartingProductId:  cardSlug,
          cardName,
          setName,
          cardNumber:              cardNum,
          cardNumberDisplay:       card.card_number_display ?? null,
          language:                (card.language === 'jp' ? 'jp' : 'en'),
        }}
      />
    </DashCard>
  )
}

/* ─── shared inline helpers ──────────────────────────────────────────────── */

function MetricInline({ label, value, emphasise }: { label: string; value: string; emphasise?: boolean }) {
  return (
    <div style={{
      background: emphasise ? 'linear-gradient(135deg, #fffef5, #fff7d1)' : 'var(--bg-light)',
      border: emphasise ? '1px solid var(--accent)' : '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px',
    }}>
      <div style={{
        fontSize: 9.5, fontWeight: 800, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: 0.8,
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 900, color: 'var(--text)',
        letterSpacing: -0.3, marginTop: 2, fontFeatureSettings: '"tnum"',
      }}>{value}</div>
    </div>
  )
}

/* ─── responsive CSS ─────────────────────────────────────────────────────── */

function ResponsiveCss() {
  return (
    <style>{`
      .b2-shell {
        display: grid;
        gap: 20px;
        grid-template-columns: 240px minmax(0, 1fr) 300px;
        max-width: 1400px;
        margin: 0 auto;
        padding: 18px 20px 40px;
        align-items: start;
      }
      .b2-mobile-nav { display: none; }
      .b2-section { scroll-margin-top: 20px; }

      /* Medium desktop — drop the left rail, keep right rail. */
      @media (max-width: 1199px) {
        .b2-shell { grid-template-columns: minmax(0, 1fr) 300px; padding-top: 8px; }
        .b2-left-nav { display: none; }
        .b2-mobile-nav { display: block; }
        .b2-section { scroll-margin-top: 68px; }
      }

      /* Tablet / mobile — collapse to single column. */
      @media (max-width: 899px) {
        .b2-shell { grid-template-columns: 1fr; }
        .b2-right-rail { display: none; }
      }
    `}</style>
  )
}
