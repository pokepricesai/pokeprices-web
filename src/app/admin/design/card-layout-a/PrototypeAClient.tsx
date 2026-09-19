'use client'

// src/app/admin/design/card-layout-a/PrototypeAClient.tsx
// ============================================================================
// Prototype A — MARKET / AFFILIATE FIRST
//
// Information architecture:
//   • Above fold: image (left), price panel (centre), sticky eBay + nav rail (right).
//   • Every headline price gets its own contextual eBay CTA immediately.
//   • Primary "Find this card on eBay" button sits at the top of the value stack.
//   • Below fold in order: Price history · Grade ladder (expanded) · Grading calc
//     · PSA population · FAQ · AI Assistant (moved to the bottom on purpose).
//   • Section nav: sticky right rail on desktop; horizontal chip strip on mobile
//     that scroll-anchors to the same section ids.
//
// This is the most commercially aggressive of the three layouts.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
  cardFaqInputFrom, priceRowFor, deltaChipStyle,
} from '../_lib/protoUi'

const NAV_ITEMS = [
  { id: 'overview',    label: 'Overview'      },
  { id: 'prices',      label: 'Prices'        },
  { id: 'ebay',        label: 'Buy on eBay'   },
  { id: 'history',     label: 'Price history' },
  { id: 'grading',     label: 'Grading'       },
  { id: 'population',  label: 'PSA pop'       },
  { id: 'faq',         label: 'FAQ'           },
  { id: 'ai',          label: 'Ask the AI'    },
]

export default function PrototypeAClient({ payload }: { payload: PrototypeCardPayload }) {
  const { card, trend, priceHistory, population } = payload
  if (!card) return <div style={{ padding: 40 }}>Card not found.</div>

  const cardName    = String(card.card_name ?? '')
  const displayName = cleanCardName(cardName)
  const setName     = String(card.set_name ?? 'Base Set')
  const cardNum     = String(card.card_number ?? '')
  const cardSlug    = card.card_slug ? String(card.card_slug) : null
  const setAssets   = getSetAssets(setName)
  const gradePrices = gradePricesFromRow(card)
  const seriesKeys  = historySeries(priceHistory)
  const trendCards  = priceRowFor(card, trend)

  return (
    <div style={{ fontFamily: "'Figtree', sans-serif" }}>
      {/* ── Sticky mobile section nav (chips) ─────────────────────────────── */}
      <MobileNav />

      {/* ── Above-the-fold ─────────────────────────────────────────────────
          Desktop: 3-column grid — image · value column · sticky eBay rail. */}
      <section id="overview" style={{
        padding: '18px 20px 8px', maxWidth: 1280, margin: '0 auto',
      }}>
        <div style={{
          display: 'grid',
          gap: 20,
          gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr) minmax(0, 300px)',
        }} className="proto-a-fold">
          {/* Column 1 — image */}
          <div>
            {card.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={String(card.image_url)}
                alt={displayName}
                style={{
                  width: '100%', maxWidth: 320, height: 'auto',
                  aspectRatio: '2.5 / 3.5', objectFit: 'cover',
                  borderRadius: 14, background: 'var(--bg-light)',
                  boxShadow: '0 6px 24px rgba(0,0,0,0.10)',
                }}
              />
            ) : null}
          </div>

          {/* Column 2 — identity + value */}
          <div>
            <IdentityLine setName={setName} cardNum={cardNum} setAssets={setAssets} />
            <h1 style={{
              fontSize: 34, fontWeight: 800, margin: '6px 0 4px',
              fontFamily: "'Outfit', sans-serif", letterSpacing: -0.4, lineHeight: 1.1,
            }}>{displayName}</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
              <Link href={`/set/${encodeURIComponent(setName)}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 700 }}>
                {setName}
              </Link>
              {cardNum ? <> · #{cardNum}{card.card_number_display ? ` (${card.card_number_display})` : ''}</> : null}
              {card.set_release_date ? <> · Released {String(card.set_release_date)}</> : null}
            </div>

            {/* BIG value panel */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
              marginTop: 4,
            }}>
              <ValueTile
                label="Raw"
                cents={card.raw_usd}
                pct={trend?.raw_pct_30d}
                cta={{
                  label: 'Find raw on eBay →',
                  intent: 'raw',
                  placement: 'proto_a_raw',
                }}
                card={{ cardName, setName, cardNum, cardSlug }}
                emphasise
              />
              <ValueTile
                label="PSA 9"
                cents={card.psa9_usd}
                cta={{
                  label: 'Find PSA 9 on eBay →',
                  intent: 'psa9',
                  placement: 'proto_a_psa9',
                }}
                card={{ cardName, setName, cardNum, cardSlug }}
                emphasise
              />
              <ValueTile
                label="PSA 10"
                cents={card.psa10_usd}
                pct={trend?.psa10_pct_30d}
                cta={{
                  label: 'Find PSA 10 on eBay →',
                  intent: 'psa10',
                  placement: 'proto_a_psa10',
                }}
                card={{ cardName, setName, cardNum, cardSlug }}
                emphasise
                highlight
              />
            </div>

            {/* Trend strip */}
            {trendCards.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {trendCards.map(t => (
                  <span key={t.label} style={{
                    ...deltaChipStyle(t.pct),
                    fontFamily: "'Figtree', sans-serif",
                  }}>
                    Raw {t.label}: {fmtPct(t.pct)}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Column 3 — STICKY affiliate rail + section nav (desktop only) */}
          <aside className="proto-a-rail" style={{
            position: 'sticky', top: 16, alignSelf: 'flex-start',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <div style={{
              padding: 16, background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 14,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 900, letterSpacing: 1.5,
                textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8,
              }}>
                Buy / find this card
              </div>
              <EbayCardPrimaryAction
                cardName={cardName}
                setName={setName}
                cardNumber={cardNum}
                cardSlug={cardSlug}
                setSlug={setName}
                language={card.language === 'jp' ? 'jp' : 'en'}
              />
              <div style={{ display: 'grid', gap: 6, marginTop: 12 }}>
                <RailEbayButton intent="raw"   label="Raw copies"     placement="proto_a_rail_raw"
                                card={{ cardName, setName, cardNum, cardSlug }} />
                <RailEbayButton intent="psa9"  label="PSA 9 copies"   placement="proto_a_rail_psa9"
                                card={{ cardName, setName, cardNum, cardSlug }} />
                <RailEbayButton intent="psa10" label="PSA 10 copies"  placement="proto_a_rail_psa10"
                                card={{ cardName, setName, cardNum, cardSlug }} />
                <RailEbayButton intent="sold_search" label="Sold in last 90d" placement="proto_a_rail_sold"
                                card={{ cardName, setName, cardNum, cardSlug }} />
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '10px 0 0', opacity: 0.75 }}>
                Affiliate links · we may earn commission
              </p>
            </div>

            <nav aria-label="Sections" style={{
              padding: 14, background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 14,
            }}>
              <div style={{
                fontSize: 10, fontWeight: 900, letterSpacing: 1.5,
                textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8,
              }}>On this page</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
                {NAV_ITEMS.map(i => (
                  <li key={i.id}>
                    <a href={`#${i.id}`} style={{
                      display: 'block', padding: '6px 8px', borderRadius: 6,
                      color: 'var(--text)', fontSize: 13, textDecoration: 'none',
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-light)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >{i.label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        </div>
      </section>

      {/* Also emit the price-tier eBay chip row for redundancy — same
          affiliate helper the production page uses. */}
      <section id="prices" style={{ padding: '4px 20px 24px', maxWidth: 1280, margin: '0 auto' }}>
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
      </section>

      {/* ── Price history ─────────────────────────────────────────────────── */}
      <Section id="history" title="Price history" subtitle="Nightly sold-listing history across every tier we track.">
        <PriceChart data={priceHistory as any[]} series={seriesKeys as ChartSeries[]} ranges height={320} />
      </Section>

      {/* ── Grading & grade ladder ────────────────────────────────────────── */}
      <Section id="grading" title="Grading & full grade ladder"
               subtitle="Every tier stored in daily_prices — expandable below the headline row.">
        <GradeLadder prices={gradePrices as GradePrices} />
      </Section>

      {/* ── PSA population ────────────────────────────────────────────────── */}
      <Section id="population" title="PSA population">
        {population ? (
          <PopulationSummary pop={population} />
        ) : (
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
            No PSA population row matched this variant. The production page uses a
            broader matcher; this prototype shows the raw single-row lookup only.
          </p>
        )}
      </Section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <Section id="faq" title="Common questions">
        <FAQ items={getCardFaqItems(cardFaqInputFrom(card))} title="" intro="" />
      </Section>

      {/* ── AI Assistant — deliberately at the bottom in this layout ──────── */}
      <Section id="ai" title="Ask the AI about this card"
               subtitle="The full AI Assistant is here so it does not compete with value / grading / eBay above.">
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
      </Section>

      <ResponsiveCss />
    </div>
  )
}

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{
      padding: '32px 20px', maxWidth: 1280, margin: '0 auto',
      scrollMarginTop: 76,
    }}>
      <h2 style={{ fontSize: 22, margin: '0 0 4px', fontFamily: "'Outfit', sans-serif", fontWeight: 800 }}>{title}</h2>
      {subtitle ? <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 14px' }}>{subtitle}</p> : null}
      {children}
    </section>
  )
}

function IdentityLine({ setName, cardNum, setAssets }: { setName: string; cardNum: string; setAssets: { logoUrl: string | null; symbolUrl: string | null } }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
      {setAssets.symbolUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={setAssets.symbolUrl} alt="" style={{ width: 20, height: 20, objectFit: 'contain' }} loading="lazy" />
      ) : null}
      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: 0.3, textTransform: 'uppercase' }}>
        {setName}{cardNum ? ` · #${cardNum}` : ''}
      </span>
    </div>
  )
}

function ValueTile({ label, cents, pct, cta, card, emphasise, highlight }: {
  label: string
  cents?: number | null
  pct?: number | null
  cta: { label: string; intent: 'raw' | 'psa9' | 'psa10'; placement: string }
  card: { cardName: string; setName: string; cardNum: string; cardSlug: string | null }
  emphasise?: boolean
  highlight?: boolean
}) {
  return (
    <div style={{
      background: highlight ? 'linear-gradient(135deg, #fffef5, #fff7d1)' : 'var(--card)',
      border: highlight ? '2px solid var(--accent)' : '1px solid var(--border)',
      borderRadius: 14, padding: '14px 16px',
      boxShadow: highlight ? '0 4px 14px rgba(255,203,5,0.20)' : undefined,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2,
        color: 'var(--text-muted)', marginBottom: 6,
      }}>{label}</div>
      <div style={{
        fontSize: emphasise ? 26 : 20, fontWeight: 900,
        fontFamily: "'Figtree', sans-serif", letterSpacing: -0.4,
        color: 'var(--text)', lineHeight: 1,
      }}>{fmtUsd(cents)}</div>
      {pct != null ? (
        <div style={{ marginTop: 6 }}>
          <span style={deltaChipStyle(pct)}>30d: {fmtPct(pct)}</span>
        </div>
      ) : null}
      <div style={{ marginTop: 10 }}>
        <EbayCompactLink
          intent={cta.intent}
          cardName={card.cardName}
          setName={card.setName}
          cardNumber={card.cardNum}
          cardSlug={card.cardSlug}
          setSlug={card.setName}
          placement={cta.placement}
          pageType="card"
          sourceComponent="proto_a_value_tile"
          label={cta.label}
          icon=""
          style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '6px 10px', borderRadius: 8,
            background: 'var(--primary)', color: '#fff',
            fontSize: 11.5, fontWeight: 800, textDecoration: 'none',
            border: '1px solid var(--primary)',
          }}
        />
      </div>
    </div>
  )
}

function RailEbayButton({ intent, label, placement, card }: {
  intent: 'raw' | 'psa9' | 'psa10' | 'sold_search'
  label: string
  placement: string
  card: { cardName: string; setName: string; cardNum: string; cardSlug: string | null }
}) {
  return (
    <EbayCompactLink
      intent={intent}
      cardName={card.cardName}
      setName={card.setName}
      cardNumber={card.cardNum}
      cardSlug={card.cardSlug}
      setSlug={card.setName}
      placement={placement}
      pageType="card"
      sourceComponent="proto_a_rail"
      label={label}
      icon=""
      style={{
        display: 'block', padding: '9px 12px', borderRadius: 8,
        background: 'var(--bg-light)', color: 'var(--text)',
        fontSize: 12.5, fontWeight: 700, textDecoration: 'none',
        border: '1px solid var(--border)', textAlign: 'center',
      }}
    />
  )
}

function PopulationSummary({ pop }: { pop: NonNullable<PrototypeCardPayload['population']> }) {
  const tiles = [
    { label: 'Total graded', value: pop.total_graded ?? 0 },
    { label: 'PSA 10',       value: pop.psa_10       ?? 0 },
    { label: 'PSA 9',        value: pop.psa_9        ?? 0 },
    { label: 'PSA 8',        value: pop.psa_8        ?? 0 },
    { label: 'Gem rate',     value: pop.gem_rate != null ? `${(pop.gem_rate).toFixed(1)}%` : '—' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ padding: '12px 14px', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{t.label}</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'var(--text)', marginTop: 2 }}>{t.value}</div>
        </div>
      ))}
    </div>
  )
}

function MobileNav() {
  return (
    <nav className="proto-a-mobile-nav" aria-label="Sections" style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: 'var(--bg)', borderBottom: '1px solid var(--border)',
      padding: '8px 12px', display: 'none',
      overflowX: 'auto', whiteSpace: 'nowrap',
    }}>
      {NAV_ITEMS.map(i => (
        <a key={i.id} href={`#${i.id}`} style={{
          display: 'inline-block', padding: '6px 12px', marginRight: 6,
          borderRadius: 999, background: 'var(--bg-light)', color: 'var(--text)',
          fontSize: 12, fontWeight: 700, textDecoration: 'none',
          border: '1px solid var(--border)',
        }}>{i.label}</a>
      ))}
    </nav>
  )
}

/** Inline CSS handles the desktop → mobile fold reflow. Keeping media
 *  queries inside the component so this prototype ships without touching
 *  global CSS. */
function ResponsiveCss() {
  return (
    <style>{`
      @media (max-width: 900px) {
        .proto-a-fold { grid-template-columns: 1fr !important; }
        .proto-a-rail { position: static !important; }
        .proto-a-mobile-nav { display: block !important; }
      }
    `}</style>
  )
}
