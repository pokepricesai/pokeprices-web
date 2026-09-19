'use client'

// src/app/admin/design/card-layout-c/PrototypeCClient.tsx
// ============================================================================
// Prototype C — SEO / ANSWER-FIRST
//
// Information architecture:
//   • The top of the page reads as the best possible answer to "how much
//     is this card worth" queries: H1 → factual data-driven summary
//     paragraph → prices TABLE → contextual eBay CTAs → image on the
//     right at natural reading height.
//   • Sections use proper semantic h2 / h3 headings. Data appears in
//     TABLES rather than a wall of visual cards where a table is more
//     honest to the query.
//   • FAQs sit high (below grading intelligence) because that's the
//     answer-first shape.
//   • Strong internal links to set + Pokémon entities.
//   • AI Assistant is last so it doesn't compete with the semantic
//     structure or eBay CTAs.
//   • No compact horizontal top nav — Prototype C tests whether pure
//     linear semantic flow performs better than sticky navigation for
//     the answer-seeker persona.
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
  cardFaqInputFrom, deltaChipStyle, gradingOpportunity,
} from '../_lib/protoUi'

export default function PrototypeCClient({ payload }: { payload: PrototypeCardPayload }) {
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
  const grading     = gradingOpportunity(card, population?.gem_rate ?? null)
  const asOfDate    = trend?.updated_at
    ? new Date(trend.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : (priceHistory[priceHistory.length - 1]?.date ?? '')

  const parts: string[] = []
  if (card.raw_usd  != null) parts.push(`${fmtUsd(card.raw_usd)} raw`)
  if (card.psa9_usd != null) parts.push(`${fmtUsd(card.psa9_usd)} PSA 9`)
  if (card.psa10_usd != null) parts.push(`${fmtUsd(card.psa10_usd)} PSA 10`)
  const factualSummary =
    `${displayName}${cardNum ? ` (#${cardNum})` : ''} from Pokémon ${setName} is currently worth ` +
    `${parts.length ? `approximately ${parts.join(', ')}` : 'a price we do not yet track'}` +
    `${asOfDate ? `, based on nightly sold-listing data as of ${asOfDate}.` : '.'}`

  return (
    <article style={{ fontFamily: "'Figtree', sans-serif", maxWidth: 900, margin: '0 auto', padding: '20px 20px 60px' }}>
      {/* Breadcrumb-style linked context */}
      <nav aria-label="Breadcrumb" style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 10 }}>
        <Link href="/browse" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Sets</Link>
        {' → '}
        <Link href={`/set/${encodeURIComponent(setName)}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 700 }}>{setName}</Link>
        {cardNum ? <> → <span style={{ color: 'var(--text)' }}>#{cardNum} {displayName}</span></> : null}
      </nav>

      {/* Identity + set logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        {setAssets.symbolUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={setAssets.symbolUrl} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }} />
        ) : null}
        <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-muted)' }}>
          {setName} · #{cardNum}
        </span>
      </div>

      {/* H1 tuned for search intent */}
      <h1 style={{
        fontFamily: "'Outfit', sans-serif", fontSize: 32, fontWeight: 800,
        margin: '2px 0 10px', letterSpacing: -0.4, lineHeight: 1.15,
      }}>
        {displayName} #{cardNum} — Pokémon {setName} price guide
      </h1>

      {/* Two-column above-the-fold: factual answer + image */}
      <div className="proto-c-fold" style={{
        display: 'grid', gap: 22,
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 240px)',
        alignItems: 'start',
      }}>
        <div>
          {/* THE factual data-driven answer paragraph */}
          <p style={{
            fontSize: 16, lineHeight: 1.55, color: 'var(--text)',
            margin: '0 0 14px', fontWeight: 500,
          }}>
            {factualSummary}
          </p>

          {/* Prices table (semantic — good for both users and search) */}
          <table style={{
            width: '100%', borderCollapse: 'collapse', marginTop: 6,
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
            overflow: 'hidden',
          }}>
            <caption style={{ captionSide: 'top', textAlign: 'left', padding: '0 0 6px', color: 'var(--text-muted)', fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>
              Current value by grade
            </caption>
            <thead>
              <tr style={{ background: 'var(--bg-light)' }}>
                <th style={thStyle}>Condition</th>
                <th style={thStyle}>Value (USD)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>eBay</th>
              </tr>
            </thead>
            <tbody>
              {([
                { label: 'Ungraded (raw)', v: card.raw_usd,    intent: 'raw'   as const, place: 'proto_c_table_raw'   },
                { label: 'PSA 8',          v: card.psa8_usd,   intent: null,               place: null                 },
                { label: 'PSA 9',          v: card.psa9_usd,   intent: 'psa9'  as const, place: 'proto_c_table_psa9'  },
                { label: 'PSA 10',         v: card.psa10_usd,  intent: 'psa10' as const, place: 'proto_c_table_psa10' },
                { label: 'CGC 10',         v: card.cgc10_usd,  intent: null,               place: null                 },
                { label: 'BGS 10',         v: card.bgs10_usd,  intent: null,               place: null                 },
              ] as Array<{ label: string; v: number | null | undefined; intent: 'raw' | 'psa9' | 'psa10' | null; place: string | null }>)
                .filter(row => row.v != null)
                .map(row => (
                <tr key={row.label} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={tdStyle}>{row.label}</td>
                  <td style={{ ...tdStyle, fontWeight: 800 }}>{fmtUsd(row.v)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {row.intent && row.place ? (
                      <EbayCompactLink
                        intent={row.intent}
                        cardName={cardName} setName={setName} cardNumber={cardNum}
                        cardSlug={cardSlug} setSlug={setName}
                        placement={row.place}
                        pageType="card" sourceComponent="proto_c_table"
                        label={`Find ${row.label} →`} icon=""
                        style={{
                          fontSize: 11.5, fontWeight: 700, color: 'var(--primary)',
                          textDecoration: 'none',
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', margin: '6px 0 0', opacity: 0.75 }}>
            Data updated nightly from PriceCharting sold-listing history. Affiliate links · we may earn commission.
          </p>

          {/* Primary CTA below the table */}
          <div style={{ marginTop: 14 }}>
            <EbayCardPrimaryAction
              cardName={cardName} setName={setName} cardNumber={cardNum}
              cardSlug={cardSlug} setSlug={setName}
              language={card.language === 'jp' ? 'jp' : 'en'}
            />
          </div>

          {/* Trend chips — supporting evidence */}
          {trend && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              {trend.raw_pct_30d  != null && <span style={deltaChipStyle(trend.raw_pct_30d)}>Raw 30d: {fmtPct(trend.raw_pct_30d)}</span>}
              {trend.raw_pct_90d  != null && <span style={deltaChipStyle(trend.raw_pct_90d)}>Raw 90d: {fmtPct(trend.raw_pct_90d)}</span>}
              {trend.raw_pct_365d != null && <span style={deltaChipStyle(trend.raw_pct_365d)}>Raw 1y: {fmtPct(trend.raw_pct_365d)}</span>}
              {trend.psa10_pct_30d != null && <span style={deltaChipStyle(trend.psa10_pct_30d)}>PSA 10 30d: {fmtPct(trend.psa10_pct_30d)}</span>}
            </div>
          )}
        </div>

        {/* Small aspect-honest image on the right */}
        <aside>
          {card.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={String(card.image_url)} alt={displayName}
              style={{ width: '100%', maxWidth: 240, height: 'auto', aspectRatio: '2.5 / 3.5', objectFit: 'cover', borderRadius: 10, background: 'var(--bg-light)', boxShadow: '0 4px 14px rgba(0,0,0,0.10)' }} />
          ) : null}
        </aside>
      </div>

      {/* ─── Section: price history ─────────────────────────────────────────── */}
      <h2 id="history" style={h2Style}>Price history</h2>
      <p style={pMuted}>Every daily sold-listing price point we have for this card, across the tiers with data.</p>
      <PriceChart data={priceHistory as any[]} series={series as ChartSeries[]} ranges height={320} />

      {/* Redundant compact eBay chips for scannability further down */}
      <div style={{ marginTop: 12 }}>
        <EbayCardPriceActions
          cardName={cardName} setName={setName} cardNumber={cardNum}
          cardSlug={cardSlug} setSlug={setName}
          pageType="card" isSealed={!!card.is_sealed}
          rawPriceCents={card.raw_usd ?? null}
          psa9PriceCents={card.psa9_usd ?? null}
          psa10PriceCents={card.psa10_usd ?? null}
        />
      </div>

      {/* ─── Section: is it worth grading? ─────────────────────────────────── */}
      <h2 id="grading" style={h2Style}>Is {displayName} #{cardNum} worth grading?</h2>
      {grading ? (
        <>
          <p style={{ fontSize: 15, lineHeight: 1.55, margin: '0 0 12px' }}>
            The PSA 10 price of <strong>{fmtUsd(card.psa10_usd)}</strong> is <strong>{grading.multiple.toFixed(1)}×</strong> the raw price of <strong>{fmtUsd(card.raw_usd)}</strong>.
            After a $25 grading fee, a PSA 10 result would net approximately <strong>{fmtUsd(grading.psa10NetCents)}</strong>.
            {population?.gem_rate != null ? (
              <> Only <strong>{population.gem_rate.toFixed(1)}%</strong> of submitted copies grade PSA 10, so the probability-weighted net is <strong style={{ color: (grading.expectedValueCents ?? 0) > 0 ? '#15803d' : '#b91c1c' }}>{fmtUsd(grading.expectedValueCents)}</strong>.</>
            ) : (
              <> PSA population data is unavailable for this variant — build in your own gem-rate estimate.</>
            )}
          </p>
        </>
      ) : (
        <p style={pMuted}>Not enough price data to score this card for grading.</p>
      )}

      {/* ─── Section: full grade ladder ────────────────────────────────────── */}
      <h2 id="ladder" style={h2Style}>Full grade ladder</h2>
      <p style={pMuted}>Every grading tier we track from the daily scrape — click through to eBay for current listings.</p>
      <GradeLadder prices={gradePrices as GradePrices} />

      {/* ─── Section: PSA population ──────────────────────────────────────── */}
      <h2 id="population" style={h2Style}>PSA population and gem rate</h2>
      {population ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: 'var(--bg-light)' }}>
              <th style={thStyle}>Metric</th>
              <th style={thStyle}>Value</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: '1px solid var(--border)' }}><td style={tdStyle}>Total graded</td><td style={{ ...tdStyle, fontWeight: 800 }}>{population.total_graded?.toLocaleString() ?? '—'}</td></tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}><td style={tdStyle}>PSA 10</td>       <td style={{ ...tdStyle, fontWeight: 800 }}>{population.psa_10?.toLocaleString() ?? '—'}</td></tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}><td style={tdStyle}>PSA 9</td>        <td style={{ ...tdStyle, fontWeight: 800 }}>{population.psa_9?.toLocaleString() ?? '—'}</td></tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}><td style={tdStyle}>PSA 8</td>        <td style={{ ...tdStyle, fontWeight: 800 }}>{population.psa_8?.toLocaleString() ?? '—'}</td></tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}><td style={tdStyle}>Gem rate</td>     <td style={{ ...tdStyle, fontWeight: 800 }}>{population.gem_rate != null ? `${population.gem_rate.toFixed(1)}%` : '—'}</td></tr>
          </tbody>
        </table>
      ) : (
        <p style={pMuted}>No matching PSA population row — production uses a broader matcher.</p>
      )}

      {/* ─── Section: FAQ (early, per answer-first pattern) ────────────────── */}
      <h2 id="faq" style={h2Style}>Common questions about {displayName} #{cardNum}</h2>
      <FAQ items={getCardFaqItems(cardFaqInputFrom(card))} title="" intro="" />

      {/* ─── Section: about the set (internal linking) ─────────────────────── */}
      <h2 id="set-context" style={h2Style}>About {setName}</h2>
      <p style={{ fontSize: 14, lineHeight: 1.55, margin: '0 0 8px' }}>
        This card was released as part of the Pokémon {setName} set{card.set_release_date ? ` on ${card.set_release_date}` : ''}.
        {' '}
        <Link href={`/set/${encodeURIComponent(setName)}`} style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 700 }}>See every card in {setName} →</Link>
      </p>

      {/* ─── Section: AI assistant (last so it doesn't dominate) ───────────── */}
      <h2 id="ai" style={h2Style}>Ask the PokePrices AI about this card</h2>
      <p style={pMuted}>Grading advice, comparable cards, market context — the assistant already knows which card you are looking at.</p>
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

      <ResponsiveCss />
    </article>
  )
}

/* ─── styling constants ─────────────────────────────────────────────────── */

const h2Style: React.CSSProperties = {
  fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 800,
  margin: '32px 0 6px', letterSpacing: -0.2,
  scrollMarginTop: 20,
}
const pMuted: React.CSSProperties = {
  color: 'var(--text-muted)', fontSize: 13, margin: '0 0 12px',
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800,
  textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--text-muted)',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 14, color: 'var(--text)',
}

function ResponsiveCss() {
  return (
    <style>{`
      @media (max-width: 700px) {
        .proto-c-fold { grid-template-columns: 1fr !important; }
      }
    `}</style>
  )
}
