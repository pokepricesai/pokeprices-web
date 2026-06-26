// src/lib/alerts/weeklyDigestEmail.ts
// Block 5A-W-15 — pure renderer for the weekly portfolio/watchlist
// digest. Takes a WeeklyDigestData (from weeklyDigest.ts) and produces
// { subject, previewText, html, text } ready for sendEmail. NOTHING in
// this file talks to a database, to Resend, or to the browser — the
// builder is a deterministic pure function so a small snapshot of unit
// tests can pin the shape AND the absence of PII.
//
// Brand chrome mirrors the alert digest renderer (emailDigest.ts) so
// both emails feel like the same product.

import type {
  WeeklyDigestData,
  WeeklyDigestItem,
  WeeklyDigestAlertCardBlock,
  WeeklyDigestItemReason,
  DigestDisplayCurrency,
} from './weeklyDigest'
import type { AlertRule } from './preferences'

// Block 5A-W-16B — keep the digest renderer's money math IDENTICAL to
// the portfolio dashboard (PortfolioDashboard.tsx::fmtBig). The
// dashboard treats daily_prices.*_usd columns as USD-cents and:
//   * for USD display, divides by 100
//   * for GBP display, divides by 127 (≈ 1 USD * 0.79 GBP, i.e. a
//     fixed approximate FX with no per-day rate)
// Any drift between this constant and the dashboard's would produce a
// figure the user can't reconcile against their own portfolio page.
const USD_CENTS_PER_GBP_APPROX = 127

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type WeeklyDigestEmailOutput = {
  subject:     string
  previewText: string
  html:        string
  text:        string
}

export type BuildWeeklyDigestEmailOptions = {
  /** Prefixes subject with [SAMPLE] and renders a yellow banner. */
  sample?: boolean
  /** Prefixes subject with [TEST] so a test-send cannot be confused
   *  with a production digest at a glance in the inbox. Stacks with
   *  `sample` — the resulting prefix is `[TEST] [SAMPLE] …`. */
  test?:   boolean
}

// ─────────────────────────────────────────────────────────────────────
// Copy + brand
// ─────────────────────────────────────────────────────────────────────

const BRAND_TAGLINE = 'Your weekly portfolio and watchlist update'
// Block 5A-W-18 — alert management moved to the unified Watchlist &
// Alerts page. Keeps the weekly digest's "Manage alerts" link in sync
// with the instant alert digest so users land in the same place from
// either email.
const MANAGE_URL    = 'https://www.pokeprices.io/dashboard/watchlist-alerts'
const PORTFOLIO_URL = 'https://www.pokeprices.io/dashboard/portfolio'
const WATCHLIST_URL = 'https://www.pokeprices.io/dashboard'   // closest landing

// Hex literals (no CSS variables) because most email clients strip
// CSS custom properties. Identical palette to emailDigest.ts.
const BRAND = {
  navy:        '#0d2747',
  primary:     '#1a5fad',
  primarySoft: '#eaf1f9',
  text:        '#1a1a1a',
  muted:       '#5f6b7a',
  mutedSoft:   '#8a93a0',
  border:      '#e6e9ee',
  cardBg:      '#fbfbfd',
  red:         '#c83737',
  green:       '#2e8c4d',
} as const

const REASON_LABEL: Record<WeeklyDigestItemReason, string> = {
  biggest_riser:      'Biggest riser',
  biggest_faller:     'Biggest faller',
  most_active:        'Most active',
  most_valuable:      'Most valuable',
  new_sales_activity: 'New sales activity',
}

const RULE_LABEL: Record<AlertRule, string> = {
  price_move:      'Price move',
  raw_change:      'Raw change',
  psa10_change:    'PSA 10 change',
  spread_change:   'Spread shift',
  recent_sales:    'Fresh sales',
  market_activity: 'Market activity',
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Block 5A-W-16B — currency-aware money formatter.
 *
 *  daily_prices.*_usd columns store USD-CENTS (despite the suffix);
 *  the digest data layer keeps everything as USD-cents until the
 *  render step. Here we convert + format using the same divisors the
 *  portfolio dashboard uses, so a user comparing the email subject
 *  line to their dashboard sees the SAME-CURRENCY headline number
 *  (subject to per-card source differences documented in the block
 *  report). Currency defaults to GBP for callers that don't specify,
 *  matching the dashboard's initial state. */
export function fmtCents(cents: number | null | undefined, currency: DigestDisplayCurrency = 'GBP'): string {
  if (cents == null || !Number.isFinite(cents)) return '—'
  if (currency === 'USD') {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return '£' + (cents / USD_CENTS_PER_GBP_APPROX).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

function changeColour(value: number | null | undefined): string {
  if (value == null || value === 0) return BRAND.muted
  return value > 0 ? BRAND.green : BRAND.red
}

function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

// ─────────────────────────────────────────────────────────────────────
// Sample data (admin preview when no real data exists)
// ─────────────────────────────────────────────────────────────────────

/** Hand-crafted WeeklyDigestData covering every section. Lets an
 *  admin preview the layout on an empty system without firing
 *  evaluator/delivery. */
export function buildSampleWeeklyDigestData(): WeeklyDigestData {
  return {
    status:       'ok',
    asOf:         '2026-06-25T12:00:00Z',
    lookbackDays: 7,
    currency:     'GBP',
    portfolio: {
      itemCount:          14,
      currentTotalCents:  248_750,
      // Block 5A-W-16E — headline change suppressed (no dashboard-
      // equivalent historical total). Sample mirrors production.
      previousTotalCents: null,
      absChangeCents:     null,
      pctChange:          null,
      scopeLabel:         'My Collection',
      scopeIsAllPortfolios: false,
      sinceLastDigest:    {
        lastSentAt:     '2026-06-18T12:00:00Z',
        lastTotalCents: 240_500,
        lastCurrency:   'GBP',
        absChangeCents: 8_250,
        pctChange:      3.4,
      },
      movement30d: {
        best:        { cardName: 'Meowstic',    setName: 'Generations', pct: 121.4 },
        worst:       { cardName: 'Aegislash',   setName: 'Sun & Moon',  pct: -57.5 },
        risingCount: 14,
        fallingCount: 9,
      },
      topItems: [
        {
          cardSlug: '1450205', cardName: "Lt. Surge's Raichu", setName: 'Gym Challenge',
          cardUrl:  'https://www.pokeprices.io/set/Gym%20Challenge/card/lt-surges-raichu-1st-edition-11',
          currentCents: 16875, previousCents: null, pctChange: 35.0, absChangeCents: null,
          recentSalesCount: 4, reason: 'biggest_riser', pctChangeWindowDays: 30,
        },
        {
          cardSlug: '959616', cardName: 'Charizard', setName: 'Base Set',
          cardUrl:  'https://www.pokeprices.io/set/Base%20Set/card/charizard-base-set-4-102',
          currentCents: 38400, previousCents: null, pctChange: -21.6, absChangeCents: null,
          recentSalesCount: 2, reason: 'biggest_faller', pctChangeWindowDays: 30,
        },
        {
          cardSlug: '12054014', cardName: 'Energy Coins [Poke Ball]', setName: 'Black Bolt',
          cardUrl:  'https://www.pokeprices.io/set/Black%20Bolt/card/energy-coins-poke-ball-81',
          currentCents: 800, previousCents: null, pctChange: 6.7, absChangeCents: null,
          recentSalesCount: 9, reason: 'most_active', pctChangeWindowDays: 30,
        },
        {
          cardSlug: '1450205', cardName: 'Charizard', setName: 'Base Set',
          cardUrl:  'https://www.pokeprices.io/set/Base%20Set/card/charizard-base-set-4-102',
          currentCents: 29_074, previousCents: null, pctChange: null, absChangeCents: null,
          recentSalesCount: 0, reason: 'most_valuable', pctChangeWindowDays: null,
        },
      ],
    },
    watchlist: {
      itemCount: 22,
      topItems: [
        {
          cardSlug: '9536051', cardName: 'Haunter [Incomplete Holo Error]', setName: 'Fossil',
          cardUrl:  'https://www.pokeprices.io/set/Fossil/card/haunter-incomplete-holo-error-6',
          currentCents: 39500, previousCents: 35250, pctChange: 12.1, absChangeCents: 4250,
          recentSalesCount: 1, reason: 'biggest_riser',
        },
        {
          cardSlug: '11870547', cardName: "Larry's Starly [Energy]", setName: 'Ascended Heroes',
          cardUrl:  'https://www.pokeprices.io/set/Ascended%20Heroes/card/larrys-starly-energy-168',
          currentCents: 410, previousCents: 530, pctChange: -22.6, absChangeCents: -120,
          recentSalesCount: 6, reason: 'biggest_faller',
        },
      ],
    },
    alertSummary: {
      totalEvents: 5,
      cardBlocks: [
        {
          cardSlug: '1450205', cardName: "Lt. Surge's Raichu", setName: 'Gym Challenge',
          cardUrl:  'https://www.pokeprices.io/set/Gym%20Challenge/card/lt-surges-raichu-1st-edition-11',
          eventCount: 2, severities: { high: 1, normal: 1, low: 0 },
          rules: ['raw_change', 'recent_sales'],
        },
        {
          cardSlug: '9536051', cardName: 'Haunter [Incomplete Holo Error]', setName: 'Fossil',
          cardUrl:  'https://www.pokeprices.io/set/Fossil/card/haunter-incomplete-holo-error-6',
          eventCount: 1, severities: { high: 0, normal: 1, low: 0 },
          rules: ['psa10_change'],
        },
      ],
    },
    diagnostics: {
      portfolioCardsConsidered:    14,
      watchlistCardsConsidered:    22,
      cardsWithNoSlugResolution:   0,
      cardsWithNoPriceData:        2,
      cardsWithNoRecentSales:      12,
      portfolioPriceBasisCounts:   { raw_usd: 10, psa10_usd: 3, psa9_usd: 1, unknown_fallback: 0 },
      displayCurrency:             'GBP',
      portfolioValueSource:              'shared_valuation_helper',
      portfolioMovementSource:           'dashboard_30d',
      portfolioItemMovementWindowDays:   30,
      portfolioHeadlineChangeSuppressed: true,
      portfolioHeadlineSuppressedReason:
        'card_trends only stores current prices, so a dashboard-equivalent headline change is not available',
      portfolioValueSourceCounts:        { card_trends: 11, daily_prices: 3, manual: 0, missing: 0 },
      portfolioPortfoliosLoaded:          1,
      portfolioItemsLoaded:               14,
      portfolioItemsMissingCardName:      0,
      portfolioItemsValuedAsMissing:      0,
      portfolioHoldingsPricedCount:        14,
      portfolioHoldingsMissingPriceCount:  0,
      portfolioScope:                'selected_dashboard_portfolio',
      portfolioNamesIncluded:        ['My Collection'],
      portfolioItemsIncludedInTotal: 14,
      portfolioReconciliation:       [],
      alertCardsResolvedBySlug:      2,
      alertCardsResolvedByNameSet:   0,
      alertCardsWithNoUrl:           0,
      sectionsOmittedByPreferences: [],
      generatedAt:                 '2026-06-25T12:00:00Z',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────
// Subject + preview text
// ─────────────────────────────────────────────────────────────────────

function buildSubject(data: WeeklyDigestData, sample: boolean, test: boolean): string {
  const tags: string[] = []
  if (test)   tags.push('[TEST]')
  if (sample) tags.push('[SAMPLE]')
  const prefix = tags.length > 0 ? tags.join(' ') + ' ' : ''
  return `${prefix}Your weekly PokePrices update`
}

function buildPreviewText(data: WeeklyDigestData, sample: boolean): string {
  if (data.status === 'disabled_master') return 'Smart alerts are turned off.'
  if (data.status === 'disabled_weekly') return 'Weekly overview is turned off.'
  if (sample) return 'Sample preview of your weekly portfolio and watchlist update.'
  const pieces: string[] = []
  if (data.portfolio) {
    const n = data.portfolio.itemCount
    pieces.push(`${n} ${pluralize(n, 'portfolio item', 'portfolio items')}`)
  }
  if (data.watchlist) {
    const n = data.watchlist.itemCount
    pieces.push(`${n} ${pluralize(n, 'watchlist card', 'watchlist cards')}`)
  }
  if (data.alertSummary.totalEvents > 0) {
    const n = data.alertSummary.totalEvents
    pieces.push(`${n} ${pluralize(n, 'alert', 'alerts')}`)
  }
  if (pieces.length === 0) return 'A quiet week — no major moves to report.'
  return `This week: ${pieces.join(' · ')}.`
}

// ─────────────────────────────────────────────────────────────────────
// HTML section renderers
// ─────────────────────────────────────────────────────────────────────

function renderItemRow(item: WeeklyDigestItem, currency: DigestDisplayCurrency): string {
  const reasonChip = `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${BRAND.primarySoft};color:${BRAND.primary};font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.7px;">${esc(REASON_LABEL[item.reason])}</span>`

  const priceLine = item.currentCents != null
    ? `<span style="font-weight:700;color:${BRAND.text};">${esc(fmtCents(item.currentCents, currency))}</span>` +
      (item.previousCents != null
        ? ` <span style="color:${BRAND.mutedSoft};font-size:11px;">was ${esc(fmtCents(item.previousCents, currency))}</span>`
        : '')
    : `<span style="color:${BRAND.mutedSoft};font-size:11px;">No price data this week</span>`

  // Block 5A-W-16E — append window suffix (e.g. "(30d)") whenever the
  // item carries a known measurement window so a 30-day dashboard
  // value is never read as a 7-day move.
  const windowSuffix = item.pctChangeWindowDays != null
    ? ` <span style="color:${BRAND.muted};font-size:11px;">(${item.pctChangeWindowDays}d)</span>`
    : ''
  const pctLine = item.pctChange != null
    ? `<span style="color:${changeColour(item.pctChange)};font-weight:700;">${esc(fmtPct(item.pctChange))}</span>${windowSuffix}`
    : ''

  const salesLine = item.recentSalesCount > 0
    ? ` <span style="color:${BRAND.muted};font-size:11px;">· ${item.recentSalesCount} ${pluralize(item.recentSalesCount, 'sale', 'sales')} this week</span>`
    : ''

  const linkBtn = item.cardUrl
    ? `<a href="${esc(item.cardUrl)}" style="display:inline-block;margin-top:8px;padding:6px 12px;border-radius:8px;background:${BRAND.primary};color:#ffffff;font-family:'Figtree',sans-serif;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">View card →</a>`
    : ''

  return `
    <tr><td style="padding:12px 14px;background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:10px;">
      <div style="margin-bottom:6px;">${reasonChip}</div>
      <div style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:700;color:${BRAND.text};">${esc(item.cardName ?? '(unknown card)')}</div>
      <div style="font-family:'Figtree',sans-serif;font-size:11.5px;color:${BRAND.muted};margin-top:2px;">${esc(item.setName ?? '')}</div>
      <div style="font-family:'Figtree',sans-serif;font-size:12.5px;color:${BRAND.text};margin-top:8px;">
        ${priceLine} ${pctLine ? '· ' + pctLine : ''}${salesLine}
      </div>
      ${linkBtn}
    </td></tr>
    <tr><td style="height:8px;line-height:8px;">&nbsp;</td></tr>`
}

function renderPortfolioSectionHtml(data: WeeklyDigestData): string {
  if (!data.portfolio) return ''
  const p = data.portfolio
  const currency = data.currency
  const heading = `<h2 style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:800;color:${BRAND.navy};margin:24px 0 10px;text-transform:uppercase;letter-spacing:0.8px;">Portfolio overview</h2>`

  if (p.itemCount === 0) {
    return `${heading}
      <p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0 0 10px;line-height:1.5;">
        No portfolio items yet. <a href="${PORTFOLIO_URL}" style="color:${BRAND.primary};font-weight:700;text-decoration:none;">Add some cards</a> to get a weekly value summary.
      </p>`
  }

  // Block 5A-W-16D — items exist on the user's portfolio but the
  // valuation helper couldn't price any of them. Distinct from the
  // "no items" state above so a real-world user doesn't see "Add
  // some cards" when they already have 35 holdings.
  if (p.currentTotalCents == null && p.topItems.length === 0) {
    return `${heading}
      <p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0 0 10px;line-height:1.5;">
        We're tracking ${p.itemCount} ${pluralize(p.itemCount, 'item', 'items')} in your portfolio, but we couldn't calculate a weekly value this time.
        Check back next week — or open <a href="${PORTFOLIO_URL}" style="color:${BRAND.primary};font-weight:700;text-decoration:none;">your portfolio</a> for live values.
      </p>`
  }

  const totalLine = p.currentTotalCents != null
    ? `<div style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:800;color:${BRAND.navy};">${esc(fmtCents(p.currentTotalCents, currency))}</div>`
    : `<div style="font-family:'Figtree',sans-serif;font-size:12px;color:${BRAND.muted};">Estimated total unavailable this week.</div>`

  // Block 5A-W-16E — headline change is rendered ONLY when both sides
  // exist. The orchestrator now sets pctChange = null whenever the
  // dashboard-equivalent historical total is unavailable, so we
  // never emit "vs N days ago" with a fabricated number. Per-card
  // movement is still shown on individual rows, labelled by window.
  const changeLine = (p.absChangeCents != null || p.pctChange != null)
    ? `<div style="font-family:'Figtree',sans-serif;font-size:13px;margin-top:4px;">
         <span style="color:${changeColour(p.absChangeCents)};font-weight:700;">${esc(fmtCents(p.absChangeCents, currency))}</span>
         <span style="color:${BRAND.mutedSoft};"> · </span>
         <span style="color:${changeColour(p.pctChange)};font-weight:700;">${esc(fmtPct(p.pctChange))}</span>
         <span style="color:${BRAND.muted};"> vs ${data.lookbackDays} days ago</span>
       </div>`
    : ''

  // Block 5A-W-16G — three-way header copy.
  //   1. Scoped + named portfolio → "My Collection · 35 items"
  //   2. Scoped + unnamed         → "Portfolio · 35 items"
  //   3. All portfolios (legacy)  → "Estimated value across all portfolios · 35 items"
  const scopeLine = p.scopeIsAllPortfolios
    ? `Estimated value across all portfolios · ${p.itemCount} ${pluralize(p.itemCount, 'item', 'items')}`
    : p.scopeLabel
      ? `${esc(p.scopeLabel)} · ${p.itemCount} ${pluralize(p.itemCount, 'item', 'items')}`
      : `Portfolio · ${p.itemCount} ${pluralize(p.itemCount, 'item', 'items')}`

  // Block 5A-W-16G — since-last-digest line. Real baseline only — no
  // fabricated comparison. On first-ever delivery (or any path where
  // no snapshot exists yet) we show a subtle "First weekly update"
  // note so the user knows there's no comparison data yet.
  const sinceLine = p.sinceLastDigest
    ? `<div style="font-family:'Figtree',sans-serif;font-size:12px;margin-top:4px;color:${BRAND.muted};">
         Since last weekly:
         <span style="color:${changeColour(p.sinceLastDigest.absChangeCents)};font-weight:700;">${esc(fmtCents(p.sinceLastDigest.absChangeCents, currency))}</span>
         ${p.sinceLastDigest.pctChange != null ? `· <span style="color:${changeColour(p.sinceLastDigest.pctChange)};font-weight:700;">${esc(fmtPct(p.sinceLastDigest.pctChange))}</span>` : ''}
       </div>`
    : `<div style="font-family:'Figtree',sans-serif;font-size:11px;margin-top:4px;color:${BRAND.mutedSoft};font-style:italic;">First weekly update — we'll show change-since-last-week from the next one.</div>`

  // Block 5A-W-16H — 30-day movement summary, rendered between the
  // headline value and the top-items list. Shows even when the
  // since-last snapshot is missing so a first-weekly user still has
  // fixed-period context.
  const movementBlock = p.movement30d
    ? `<div style="font-family:'Figtree',sans-serif;font-size:12px;margin:8px 0 0;padding:8px 10px;background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:8px;color:${BRAND.text};line-height:1.6;">
         <div style="font-size:10px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.7px;font-weight:700;margin-bottom:4px;">30-day snapshot</div>
         <div><strong>Best 30d:</strong> ${esc(p.movement30d.best.cardName ?? '(unknown)')}${p.movement30d.best.setName ? ' · ' + esc(p.movement30d.best.setName) : ''} <span style="color:${changeColour(p.movement30d.best.pct)};font-weight:700;">${esc(fmtPct(p.movement30d.best.pct))}</span></div>
         <div><strong>Worst 30d:</strong> ${esc(p.movement30d.worst.cardName ?? '(unknown)')}${p.movement30d.worst.setName ? ' · ' + esc(p.movement30d.worst.setName) : ''} <span style="color:${changeColour(p.movement30d.worst.pct)};font-weight:700;">${esc(fmtPct(p.movement30d.worst.pct))}</span></div>
         <div><strong>Cards rising:</strong> ${p.movement30d.risingCount} · <strong>Cards falling:</strong> ${p.movement30d.fallingCount}</div>
       </div>`
    : ''

  const summary = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 12px;"><tr><td>
      <div style="font-family:'Figtree',sans-serif;font-size:11px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">${scopeLine}</div>
      ${totalLine}
      ${changeLine}
      ${sinceLine}
      ${movementBlock}
    </td></tr></table>`

  // Block 5A-W-16H — explicit "Top portfolio items" sub-heading so
  // the card list can never be visually mistaken for the alert
  // highlights that follow.
  const topItemsSubhead = `<div style="font-family:'Figtree',sans-serif;font-size:10px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.7px;font-weight:700;margin:14px 0 6px;">Top portfolio items</div>`
  const items = p.topItems.length > 0
    ? `${topItemsSubhead}<table role="presentation" style="width:100%;border-collapse:collapse;"><tbody>${p.topItems.map(i => renderItemRow(i, currency)).join('')}</tbody></table>`
    : `<p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:8px 0 0;line-height:1.5;">No major portfolio changes this week.</p>`

  return heading + summary + items
}

function renderWatchlistSectionHtml(data: WeeklyDigestData): string {
  if (!data.watchlist) return ''
  const w = data.watchlist
  const heading = `<h2 style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:800;color:${BRAND.navy};margin:28px 0 10px;text-transform:uppercase;letter-spacing:0.8px;">Watchlist overview</h2>`

  if (w.itemCount === 0) {
    return `${heading}
      <p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0 0 10px;line-height:1.5;">
        Your watchlist is empty. <a href="${WATCHLIST_URL}" style="color:${BRAND.primary};font-weight:700;text-decoration:none;">Add some cards</a> and we'll track them for you.
      </p>`
  }

  const summary = `<div style="font-family:'Figtree',sans-serif;font-size:11px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.7px;font-weight:700;margin-bottom:6px;">${w.itemCount} watched ${pluralize(w.itemCount, 'card', 'cards')}</div>`

  const items = w.topItems.length > 0
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;"><tbody>${w.topItems.map(i => renderItemRow(i, data.currency)).join('')}</tbody></table>`
    : `<p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0;line-height:1.5;">No major watchlist changes this week.</p>`

  return heading + summary + items
}

function renderAlertBlockHtml(block: WeeklyDigestAlertCardBlock): string {
  // Block 5A-W-16G — user-friendly severity copy. The previous design
  // exposed internal severity names ("2 normal") which confused
  // collectors. Now: count + rule list is the main line; an
  // "Important" badge only appears when at least one event is high.
  const importantBadge = block.severities.high > 0
    ? `<span style="background:${BRAND.red};color:#fff;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">Important</span>`
    : ''
  const rulesLine = block.rules.map(r => esc(RULE_LABEL[r])).join(' · ')
  const linkBtn = block.cardUrl
    ? `<a href="${esc(block.cardUrl)}" style="display:inline-block;margin-top:8px;padding:6px 12px;border-radius:8px;background:${BRAND.primary};color:#ffffff;font-family:'Figtree',sans-serif;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">View card →</a>`
    : ''
  return `
    <tr><td style="padding:12px 14px;background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:10px;">
      ${importantBadge ? `<div style="margin-bottom:6px;">${importantBadge}</div>` : ''}
      <div style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:700;color:${BRAND.text};">${esc(block.cardName)}</div>
      <div style="font-family:'Figtree',sans-serif;font-size:11.5px;color:${BRAND.muted};margin-top:2px;">${esc(block.setName)}</div>
      <div style="font-family:'Figtree',sans-serif;font-size:12.5px;color:${BRAND.text};margin-top:8px;">
        ${block.eventCount} ${pluralize(block.eventCount, 'alert', 'alerts')} this week · ${rulesLine}
      </div>
      ${linkBtn}
    </td></tr>
    <tr><td style="height:8px;line-height:8px;">&nbsp;</td></tr>`
}

function renderAlertSectionHtml(data: WeeklyDigestData): string {
  if (data.alertSummary.cardBlocks.length === 0) return ''
  const heading = `<h2 style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:800;color:${BRAND.navy};margin:28px 0 10px;text-transform:uppercase;letter-spacing:0.8px;">Alert highlights</h2>`
  const intro   = `<div style="font-family:'Figtree',sans-serif;font-size:11px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.7px;font-weight:700;margin-bottom:6px;">${data.alertSummary.totalEvents} ${pluralize(data.alertSummary.totalEvents, 'alert', 'alerts')} this week</div>`
  const items   = `<table role="presentation" style="width:100%;border-collapse:collapse;"><tbody>${data.alertSummary.cardBlocks.map(renderAlertBlockHtml).join('')}</tbody></table>`
  return heading + intro + items
}

function renderDisabledBodyHtml(status: 'disabled_master' | 'disabled_weekly'): string {
  const heading = status === 'disabled_master'
    ? 'Smart alerts are turned off'
    : 'Weekly overview is turned off'
  return `
    <p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0 0 10px;line-height:1.5;">
      <strong style="color:${BRAND.text};">${esc(heading)}.</strong>
      You're seeing this preview because you asked for it from the admin. Turn it on at <a href="${MANAGE_URL}" style="color:${BRAND.primary};font-weight:700;text-decoration:none;">Smart alert settings</a>.
    </p>`
}

// ─────────────────────────────────────────────────────────────────────
// Top-level HTML + text
// ─────────────────────────────────────────────────────────────────────

function renderHtml(data: WeeklyDigestData, sample: boolean): string {
  const header = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;">
      <tr>
        <td style="padding:0 0 12px;border-bottom:2px solid ${BRAND.primary};">
          <div style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:800;color:${BRAND.navy};letter-spacing:-0.2px;">PokePrices</div>
          <div style="font-family:'Figtree',sans-serif;font-size:12px;color:${BRAND.muted};margin-top:2px;">${esc(BRAND_TAGLINE)}</div>
        </td>
      </tr>
    </table>`

  const sampleBanner = sample ? `
    <div style="background:#fff7e0;border:1px solid #f3d36b;color:#704a00;padding:10px 12px;border-radius:8px;margin:0 0 20px;font-size:13px;font-family:'Figtree',sans-serif;">
      <strong>Sample data</strong> — this email was generated from hand-crafted values for design review. It would NOT be sent to a recipient.
    </div>` : ''

  let body: string
  if (data.status === 'disabled_master' || data.status === 'disabled_weekly') {
    body = renderDisabledBodyHtml(data.status)
  } else {
    const sections = [
      renderPortfolioSectionHtml(data),
      renderWatchlistSectionHtml(data),
      renderAlertSectionHtml(data),
    ].filter(Boolean)
    body = sections.length > 0
      ? sections.join('')
      : `<p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0;line-height:1.5;">A quiet week — nothing meaningful to report across your portfolio, watchlist or alerts.</p>`
  }

  const footer = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:32px 0 0;border-top:1px solid ${BRAND.border};">
      <tr>
        <td style="padding:18px 0 0;">
          <div style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:800;color:${BRAND.navy};letter-spacing:-0.1px;">PokePrices</div>
          <p style="font-family:'Figtree',sans-serif;font-size:11px;color:${BRAND.mutedSoft};line-height:1.6;margin:6px 0 0;">
            You are receiving this because you enabled the weekly overview.<br>
            <a href="${MANAGE_URL}" style="color:${BRAND.primary};text-decoration:none;font-weight:700;">Manage Watchlist &amp; Alerts</a> ·
            <a href="${PORTFOLIO_URL}" style="color:${BRAND.primary};text-decoration:none;font-weight:700;">Your portfolio</a> ·
            <a href="${WATCHLIST_URL}" style="color:${BRAND.primary};text-decoration:none;font-weight:700;">Your dashboard</a>
            · We never share your address. We never sell your data.
          </p>
        </td>
      </tr>
    </table>`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your weekly PokePrices update</title>
</head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:'Figtree',sans-serif;color:${BRAND.text};">
  <div style="max-width:560px;margin:0 auto;">
    ${header}
    ${sampleBanner}
    ${body}
    ${footer}
  </div>
</body>
</html>`
}

function renderText(data: WeeklyDigestData, sample: boolean): string {
  const lines: string[] = []
  lines.push('PokePrices')
  lines.push(BRAND_TAGLINE)
  lines.push('='.repeat(Math.max(BRAND_TAGLINE.length, 'PokePrices'.length)))
  lines.push('')
  if (sample) { lines.push('[SAMPLE DATA — preview only; would NOT be sent.]'); lines.push('') }

  if (data.status === 'disabled_master') {
    lines.push('Smart alerts are turned off.')
    lines.push(`Turn them on at ${MANAGE_URL}`)
    lines.push('')
  } else if (data.status === 'disabled_weekly') {
    lines.push('Weekly overview is turned off.')
    lines.push(`Turn it on at ${MANAGE_URL}`)
    lines.push('')
  } else {
    if (data.portfolio) {
      lines.push('PORTFOLIO OVERVIEW')
      lines.push('------------------')
      if (data.portfolio.itemCount === 0) {
        lines.push('No portfolio items yet.')
      } else if (data.portfolio.currentTotalCents == null && data.portfolio.topItems.length === 0) {
        // Block 5A-W-16D — items exist but the valuation pipeline
        // couldn't price them this week.
        lines.push(`Tracking ${data.portfolio.itemCount} ${pluralize(data.portfolio.itemCount, 'item', 'items')}, but no weekly value could be calculated.`)
      } else {
        // Block 5A-W-16G — three-way scope copy mirrored from the HTML.
        const headerLabel = data.portfolio.scopeIsAllPortfolios
          ? 'Estimated value across all portfolios'
          : data.portfolio.scopeLabel ?? 'Portfolio'
        lines.push(`${headerLabel}: ${fmtCents(data.portfolio.currentTotalCents, data.currency)}  (was ${fmtCents(data.portfolio.previousTotalCents, data.currency)})`)
        lines.push(`Change: ${fmtCents(data.portfolio.absChangeCents, data.currency)}  (${fmtPct(data.portfolio.pctChange)})`)
        if (data.portfolio.sinceLastDigest) {
          lines.push(`Since last weekly: ${fmtCents(data.portfolio.sinceLastDigest.absChangeCents, data.currency)}  (${fmtPct(data.portfolio.sinceLastDigest.pctChange)})`)
        } else {
          lines.push(`First weekly update — change-since-last-week will appear from the next one.`)
        }
        // Block 5A-W-16H — 30-day movement block in the text body.
        if (data.portfolio.movement30d) {
          const m = data.portfolio.movement30d
          lines.push(``)
          lines.push(`30-day snapshot:`)
          lines.push(`  Best 30d: ${m.best.cardName ?? '(unknown)'}${m.best.setName ? ' · ' + m.best.setName : ''}  (${fmtPct(m.best.pct)})`)
          lines.push(`  Worst 30d: ${m.worst.cardName ?? '(unknown)'}${m.worst.setName ? ' · ' + m.worst.setName : ''}  (${fmtPct(m.worst.pct)})`)
          lines.push(`  Cards rising: ${m.risingCount} · Cards falling: ${m.fallingCount}`)
        }
        lines.push(`Items: ${data.portfolio.itemCount}`)
        if (data.portfolio.topItems.length === 0) {
          lines.push('No major portfolio changes this week.')
        } else {
          for (const item of data.portfolio.topItems) lines.push(...itemTextLines(item, data.currency))
        }
      }
      lines.push('')
    }
    if (data.watchlist) {
      lines.push('WATCHLIST OVERVIEW')
      lines.push('------------------')
      if (data.watchlist.itemCount === 0) {
        lines.push('Your watchlist is empty.')
      } else {
        lines.push(`Watched cards: ${data.watchlist.itemCount}`)
        if (data.watchlist.topItems.length === 0) {
          lines.push('No major watchlist changes this week.')
        } else {
          for (const item of data.watchlist.topItems) lines.push(...itemTextLines(item, data.currency))
        }
      }
      lines.push('')
    }
    if (data.alertSummary.cardBlocks.length > 0) {
      lines.push('ALERT HIGHLIGHTS')
      lines.push('----------------')
      lines.push(`${data.alertSummary.totalEvents} ${pluralize(data.alertSummary.totalEvents, 'alert', 'alerts')} this week`)
      for (const block of data.alertSummary.cardBlocks) {
        // Block 5A-W-16G — user-friendly text-body copy. Drop the
        // "X normal / X low" word list; keep an "Important" flag only
        // when at least one event is high severity.
        const importantPrefix = block.severities.high > 0 ? '[Important] ' : ''
        lines.push(`* ${importantPrefix}${block.cardName} (${block.setName})`)
        lines.push(`    ${block.eventCount} ${pluralize(block.eventCount, 'alert', 'alerts')} this week · ${block.rules.map(r => RULE_LABEL[r]).join(' · ')}`)
        if (block.cardUrl) lines.push(`    ${block.cardUrl}`)
      }
      lines.push('')
    }
    const anyContent = (data.portfolio && data.portfolio.itemCount > 0)
                    || (data.watchlist && data.watchlist.itemCount > 0)
                    || data.alertSummary.cardBlocks.length > 0
    if (!anyContent) {
      lines.push('A quiet week — nothing meaningful to report across your portfolio, watchlist or alerts.')
      lines.push('')
    }
  }
  lines.push('---')
  lines.push('PokePrices')
  lines.push('You are receiving this because you enabled the weekly overview.')
  lines.push(`Manage Watchlist & Alerts at ${MANAGE_URL}`)
  return lines.join('\n')
}

function itemTextLines(item: WeeklyDigestItem, currency: DigestDisplayCurrency): string[] {
  const out: string[] = []
  out.push(`* [${REASON_LABEL[item.reason]}] ${item.cardName ?? '(unknown)'} (${item.setName ?? ''})`)
  const priceBit = item.currentCents != null
    ? `${fmtCents(item.currentCents, currency)}${item.previousCents != null ? ' (was ' + fmtCents(item.previousCents, currency) + ')' : ''}`
    : 'no price data'
  const pctBit   = item.pctChange != null
    ? ` · ${fmtPct(item.pctChange)}${item.pctChangeWindowDays != null ? ' (' + item.pctChangeWindowDays + 'd)' : ''}`
    : ''
  const salesBit = item.recentSalesCount > 0 ? ` · ${item.recentSalesCount} ${pluralize(item.recentSalesCount, 'sale', 'sales')}` : ''
  out.push(`    ${priceBit}${pctBit}${salesBit}`)
  if (item.cardUrl) out.push(`    ${item.cardUrl}`)
  return out
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export function buildWeeklyDigestEmail(
  data: WeeklyDigestData,
  opts: BuildWeeklyDigestEmailOptions = {},
): WeeklyDigestEmailOutput {
  const sample = opts.sample === true
  const test   = opts.test   === true
  return {
    subject:     buildSubject(data, sample, test),
    previewText: buildPreviewText(data, sample),
    html:        renderHtml(data, sample),
    text:        renderText(data, sample),
  }
}
