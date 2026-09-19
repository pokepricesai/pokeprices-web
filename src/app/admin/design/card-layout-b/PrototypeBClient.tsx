'use client'

// src/app/admin/design/card-layout-b/PrototypeBClient.tsx
// ============================================================================
// Prototype B — COLLECTOR DASHBOARD
//
// Information architecture:
//   • The whole page reads as ONE dashboard rather than stacked widgets.
//   • Fold: identity (with image inset) → summary metrics row →
//     side-by-side value & grading opportunity → sticky RIGHT rail with
//     key facts, section nav, and grading-opportunity CTA + eBay actions.
//   • Sections below are dashboard "cards" of consistent chrome:
//     price history, grade ladder, PSA population, market intelligence,
//     related cards, then AI, then FAQ.
//   • Aim: highest all-round UX quality, not maximum commercial pressure.
// ============================================================================

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
  cardFaqInputFrom, priceRowFor, deltaChipStyle, gradingOpportunity,
} from '../_lib/protoUi'

const NAV_ITEMS = [
  { id: 'summary',    label: 'Summary'         },
  { id: 'value',      label: 'Value'           },
  { id: 'history',    label: 'Price history'   },
  { id: 'grade',      label: 'Grade ladder'    },
  { id: 'population', label: 'PSA population'  },
  { id: 'market',     label: 'Market signals'  },
  { id: 'ai',         label: 'Ask about it'    },
  { id: 'faq',        label: 'FAQ'             },
]

export default function PrototypeBClient({ payload }: { payload: PrototypeCardPayload }) {
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

  return (
    <div style={{ fontFamily: "'Figtree', sans-serif" }}>
      {/* ── Above the fold ─────────────────────────────────────────────────
          Desktop: 2-col grid with the sticky right rail. Fold contains a
          dense identity + value + grading summary. */}
      <section id="summary" style={{ padding: '20px 20px 8px', maxWidth: 1200, margin: '0 auto' }}>
        <div className="proto-b-fold" style={{
          display: 'grid', gap: 20,
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 300px)',
        }}>
          {/* Column 1 — dense identity + value */}
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
              {/* Image (medium, inset — dashboard feel) */}
              {card.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={String(card.image_url)} alt={displayName}
                  style={{
                    width: 200, height: 280, objectFit: 'cover',
                    borderRadius: 12, background: 'var(--bg-light)',
                    boxShadow: '0 4px 18px rgba(0,0,0,0.10)', flexShrink: 0,
                  }} />
              ) : null}

              {/* Identity block */}
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {setAssets.symbolUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={setAssets.symbolUrl} alt="" style={{ width: 18, height: 18, objectFit: 'contain' }} />
                  ) : null}
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {setName}{cardNum ? ` · #${cardNum}` : ''}
                  </span>
                </div>
                <h1 style={{
                  fontSize: 30, fontWeight: 800, margin: '4px 0 6px',
                  fontFamily: "'Outfit', sans-serif", letterSpacing: -0.4, lineHeight: 1.15,
                }}>{displayName}</h1>
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 10 }}>
                  <Link href={`/set/${encodeURIComponent(setName)}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 700 }}>{setName}</Link>
                  {card.card_number_display ? ` · ${card.card_number_display}` : cardNum ? ` · #${cardNum}` : ''}
                  {card.set_release_date ? ` · Released ${card.set_release_date}` : ''}
                </div>

                {/* Summary metrics row — the "collector's headline" */}
                <div style={{
                  display: 'grid', gap: 8,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  marginTop: 8,
                }}>
                  <MetricInline label="Raw"    value={fmtUsd(card.raw_usd)} />
                  <MetricInline label="PSA 9"  value={fmtUsd(card.psa9_usd)} />
                  <MetricInline label="PSA 10" value={fmtUsd(card.psa10_usd)} emphasise />
                  {grading ? (
                    <MetricInline label="PSA 10 × raw" value={`${grading.multiple.toFixed(1)}×`} />
                  ) : null}
                </div>

                {/* Trend chips */}
                {trendChips.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {trendChips.map(t => (
                      <span key={t.label} style={deltaChipStyle(t.pct)}>
                        {t.label}: {fmtPct(t.pct)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Side-by-side: Value / Grading opportunity — dashboard duo */}
            <div id="value" style={{
              marginTop: 24, display: 'grid', gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            }}>
              <ValueCard card={card} />
              <GradingCard card={card} grading={grading} pop={population} />
            </div>

            {/* Contextual eBay row — same helper the live page uses */}
            <div style={{ marginTop: 14 }}>
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
          </div>

          {/* Column 2 — STICKY collector rail */}
          <aside className="proto-b-rail" style={{
            position: 'sticky', top: 16, alignSelf: 'flex-start',
            display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <RailCard title="Key facts">
              <FactRow k="Set"           v={setName} />
              <FactRow k="Number"        v={card.card_number_display ?? (cardNum ? `#${cardNum}` : '—')} />
              <FactRow k="Released"      v={card.set_release_date ? String(card.set_release_date) : '—'} />
              <FactRow k="Printing"      v={card.language === 'jp' ? 'Japanese' : 'English'} />
              <FactRow k="Product type"  v={card.is_sealed ? 'Sealed product' : 'Single card'} />
            </RailCard>

            {grading ? (
              <RailCard title="Grading opportunity">
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text)' }}>
                  <strong>PSA 10 = {grading.multiple.toFixed(1)}×</strong> the raw price.
                </p>
                {grading.expectedValueCents != null ? (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Probability-weighted net at a {population?.gem_rate?.toFixed(1)}% gem rate: <strong style={{ color: grading.expectedValueCents > 0 ? '#15803d' : '#b91c1c' }}>{fmtUsd(grading.expectedValueCents)}</strong>
                  </p>
                ) : null}
              </RailCard>
            ) : null}

            <RailCard title="On eBay">
              <EbayCardPrimaryAction
                cardName={cardName} setName={setName} cardNumber={cardNum}
                cardSlug={cardSlug} setSlug={setName}
                language={card.language === 'jp' ? 'jp' : 'en'}
              />
              <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                <RailEbay intent="raw"   label="Raw"    placement="proto_b_rail_raw"   card={{ cardName, setName, cardNum, cardSlug }} />
                <RailEbay intent="psa9"  label="PSA 9"  placement="proto_b_rail_psa9"  card={{ cardName, setName, cardNum, cardSlug }} />
                <RailEbay intent="psa10" label="PSA 10" placement="proto_b_rail_psa10" card={{ cardName, setName, cardNum, cardSlug }} />
              </div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '10px 0 0', opacity: 0.75 }}>
                Affiliate links · we may earn commission
              </p>
            </RailCard>

            <nav aria-label="Sections" style={{
              padding: 14, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
            }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Jump to</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 3 }}>
                {NAV_ITEMS.map(i => (
                  <li key={i.id}><a href={`#${i.id}`} style={{ display: 'block', padding: '5px 8px', borderRadius: 6, color: 'var(--text)', fontSize: 13, textDecoration: 'none' }}>{i.label}</a></li>
                ))}
              </ul>
            </nav>
          </aside>
        </div>
      </section>

      {/* ── Dashboard sections ─────────────────────────────────────────────── */}
      <DashSection id="history" title="Price history" subtitle="Every tier the daily scrape captures for this card.">
        <PriceChart data={priceHistory as any[]} series={series as ChartSeries[]} ranges height={340} />
      </DashSection>

      <DashSection id="grade" title="Full grade ladder">
        <GradeLadder prices={gradePrices as GradePrices} />
      </DashSection>

      <DashSection id="population" title="PSA population">
        {population ? <PopulationCard pop={population} /> : (
          <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 13 }}>
            No matching PSA population row — production uses a broader matcher.
          </p>
        )}
      </DashSection>

      <DashSection id="market" title="Market signals">
        <MarketSignals card={card} trend={trend} priceHistory={priceHistory} />
      </DashSection>

      <DashSection id="ai" title="Ask the AI about this card"
                   subtitle="Moved lower so it doesn't compete with value / grading / eBay above.">
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
      </DashSection>

      <DashSection id="faq" title="Common questions">
        <FAQ items={getCardFaqItems(cardFaqInputFrom(card))} title="" intro="" />
      </DashSection>

      <ResponsiveCss />
    </div>
  )
}

/* ─── dashboard building blocks ──────────────────────────────────────────── */

function DashSection({ id, title, subtitle, children }: { id: string; title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ padding: '24px 20px', maxWidth: 1200, margin: '0 auto', scrollMarginTop: 76 }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16,
        padding: '20px 22px',
      }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px', fontFamily: "'Outfit', sans-serif", fontWeight: 800 }}>{title}</h2>
        {subtitle ? <p style={{ color: 'var(--text-muted)', fontSize: 12.5, margin: '0 0 14px' }}>{subtitle}</p> : null}
        {children}
      </div>
    </section>
  )
}

function MetricInline({ label, value, emphasise }: { label: string; value: string; emphasise?: boolean }) {
  return (
    <div style={{
      background: emphasise ? 'linear-gradient(135deg, #fffef5, #fff7d1)' : 'var(--bg-light)',
      border: emphasise ? '1px solid var(--accent)' : '1px solid var(--border)',
      borderRadius: 10, padding: '10px 12px',
    }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', letterSpacing: -0.3, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function ValueCard({ card }: { card: PrototypeCardPayload['card'] & object }) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 8 }}>Value now</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          {([
            ['Raw',     card.raw_usd    ],
            ['PSA 8',   card.psa8_usd   ],
            ['PSA 9',   card.psa9_usd   ],
            ['PSA 10',  card.psa10_usd  ],
            ['BGS 10',  card.bgs10_usd  ],
            ['CGC 10',  card.cgc10_usd  ],
          ] as Array<[string, number | null | undefined]>).filter(([, v]) => v != null).map(([label, v]) => (
            <tr key={label} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 0', color: 'var(--text-muted)' }}>{label}</td>
              <td style={{ padding: '7px 0', textAlign: 'right', fontWeight: 800 }}>{fmtUsd(v as number)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GradingCard({ card, grading, pop }: {
  card: PrototypeCardPayload['card'] & object
  grading: ReturnType<typeof gradingOpportunity>
  pop: PrototypeCardPayload['population']
}) {
  return (
    <div style={{ padding: '16px 18px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 1.2, color: 'var(--text-muted)', marginBottom: 8 }}>Grading opportunity</div>
      {!grading ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Not enough price data to score grading.</p>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.3 }}>{grading.multiple.toFixed(1)}×</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>PSA 10 vs raw</span>
          </div>
          <p style={{ margin: '4px 0 8px', fontSize: 13, color: 'var(--text)' }}>
            After a ~$25 grading fee, a PSA 10 result would net <strong>{fmtUsd(grading.psa10NetCents)}</strong>.
          </p>
          {pop?.gem_rate != null ? (
            <p style={{ margin: '0 0 4px', fontSize: 12.5, color: 'var(--text-muted)' }}>
              Only <strong style={{ color: 'var(--text)' }}>{pop.gem_rate.toFixed(1)}%</strong> of submitted copies grade PSA 10 —
              probability-weighted net is <strong style={{ color: (grading.expectedValueCents ?? 0) > 0 ? '#15803d' : '#b91c1c' }}>{fmtUsd(grading.expectedValueCents)}</strong>.
            </p>
          ) : (
            <p style={{ margin: '0 0 4px', fontSize: 12.5, color: 'var(--text-muted)' }}>
              PSA population data unavailable for this variant — factor in your own gem-rate estimate.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function RailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 14, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

function FactRow({ k, v }: { k: string; v: string | number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0', borderBottom: '1px dashed var(--border)', fontSize: 12.5 }}>
      <span style={{ color: 'var(--text-muted)' }}>{k}</span>
      <span style={{ color: 'var(--text)', fontWeight: 700, textAlign: 'right' }}>{v}</span>
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
      placement={placement} pageType="card" sourceComponent="proto_b_rail"
      label={label} icon=""
      style={{
        display: 'block', padding: '7px 10px', borderRadius: 8,
        background: 'var(--bg-light)', color: 'var(--text)',
        fontSize: 12, fontWeight: 700, textDecoration: 'none',
        border: '1px solid var(--border)', textAlign: 'center',
      }}
    />
  )
}

function PopulationCard({ pop }: { pop: NonNullable<PrototypeCardPayload['population']> }) {
  const tiles: Array<[string, string | number]> = [
    ['Total graded', pop.total_graded ?? 0],
    ['PSA 10',       pop.psa_10       ?? 0],
    ['PSA 9',        pop.psa_9        ?? 0],
    ['PSA 8',        pop.psa_8        ?? 0],
    ['Gem rate',     pop.gem_rate != null ? `${pop.gem_rate.toFixed(1)}%` : '—'],
  ]
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
      {tiles.map(([label, v]) => (
        <div key={label} style={{ padding: '12px 14px', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--text)', marginTop: 2 }}>{v}</div>
        </div>
      ))}
    </div>
  )
}

function MarketSignals({ card, trend, priceHistory }: { card: PrototypeCardPayload['card'] & object; trend: PrototypeCardPayload['trend']; priceHistory: PrototypeCardPayload['priceHistory'] }) {
  const nPoints = priceHistory.length
  const oldest  = priceHistory.length ? priceHistory[0]?.date : null
  const newest  = priceHistory.length ? priceHistory[priceHistory.length - 1]?.date : null
  const tiles: Array<[string, string]> = [
    ['Trend as of',       trend?.updated_at ? new Date(trend.updated_at).toLocaleDateString('en-GB') : '—'],
    ['History points',    String(nPoints)],
    ['Oldest',            oldest ?? '—'],
    ['Newest',            newest ?? '—'],
  ]
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
      {tiles.map(([label, v]) => (
        <div key={label} style={{ padding: '12px 14px', background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>{v}</div>
        </div>
      ))}
    </div>
  )
}

function ResponsiveCss() {
  return (
    <style>{`
      @media (max-width: 900px) {
        .proto-b-fold { grid-template-columns: 1fr !important; }
        .proto-b-rail { position: static !important; }
      }
    `}</style>
  )
}
