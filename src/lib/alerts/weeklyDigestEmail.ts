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
const MANAGE_URL    = 'https://www.pokeprices.io/dashboard/settings'
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
      previousTotalCents: 231_200,
      absChangeCents:     17_550,
      pctChange:          7.6,
      topItems: [
        {
          cardSlug: '1450205', cardName: "Lt. Surge's Raichu", setName: 'Gym Challenge',
          cardUrl:  'https://www.pokeprices.io/set/Gym%20Challenge/card/lt-surges-raichu-1st-edition-11',
          currentCents: 16875, previousCents: 12500, pctChange: 35.0, absChangeCents: 4375,
          recentSalesCount: 4, reason: 'biggest_riser',
        },
        {
          cardSlug: '959616', cardName: 'Charizard', setName: 'Base Set',
          cardUrl:  'https://www.pokeprices.io/set/Base%20Set/card/charizard-base-set-4-102',
          currentCents: 38400, previousCents: 49000, pctChange: -21.6, absChangeCents: -10600,
          recentSalesCount: 2, reason: 'biggest_faller',
        },
        {
          cardSlug: '12054014', cardName: 'Energy Coins [Poke Ball]', setName: 'Black Bolt',
          cardUrl:  'https://www.pokeprices.io/set/Black%20Bolt/card/energy-coins-poke-ball-81',
          currentCents: 800, previousCents: 750, pctChange: 6.7, absChangeCents: 50,
          recentSalesCount: 9, reason: 'most_active',
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
      portfolioValueSource:        'daily_prices_pivot',
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

  const pctLine = item.pctChange != null
    ? `<span style="color:${changeColour(item.pctChange)};font-weight:700;">${esc(fmtPct(item.pctChange))}</span>`
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

  const totalLine = p.currentTotalCents != null
    ? `<div style="font-family:'Outfit',sans-serif;font-size:22px;font-weight:800;color:${BRAND.navy};">${esc(fmtCents(p.currentTotalCents, currency))}</div>`
    : `<div style="font-family:'Figtree',sans-serif;font-size:12px;color:${BRAND.muted};">Estimated total unavailable this week.</div>`

  const changeLine = (p.absChangeCents != null || p.pctChange != null)
    ? `<div style="font-family:'Figtree',sans-serif;font-size:13px;margin-top:4px;">
         <span style="color:${changeColour(p.absChangeCents)};font-weight:700;">${esc(fmtCents(p.absChangeCents, currency))}</span>
         <span style="color:${BRAND.mutedSoft};"> · </span>
         <span style="color:${changeColour(p.pctChange)};font-weight:700;">${esc(fmtPct(p.pctChange))}</span>
         <span style="color:${BRAND.muted};"> vs ${data.lookbackDays} days ago</span>
       </div>`
    : ''

  const summary = `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 12px;"><tr><td>
      <div style="font-family:'Figtree',sans-serif;font-size:11px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.7px;font-weight:700;">Estimated value across all portfolios · ${p.itemCount} ${pluralize(p.itemCount, 'item', 'items')}</div>
      ${totalLine}
      ${changeLine}
    </td></tr></table>`

  const items = p.topItems.length > 0
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;"><tbody>${p.topItems.map(i => renderItemRow(i, currency)).join('')}</tbody></table>`
    : `<p style="font-family:'Figtree',sans-serif;font-size:13px;color:${BRAND.muted};margin:0;line-height:1.5;">No major portfolio changes this week.</p>`

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
  const sevChips: string[] = []
  if (block.severities.high   > 0) sevChips.push(`<span style="background:${BRAND.red};color:#fff;padding:2px 7px;border-radius:999px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">${block.severities.high} high</span>`)
  if (block.severities.normal > 0) sevChips.push(`<span style="background:${BRAND.primarySoft};color:${BRAND.primary};padding:2px 7px;border-radius:999px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">${block.severities.normal} normal</span>`)
  if (block.severities.low    > 0) sevChips.push(`<span style="background:#f4f5f7;color:${BRAND.muted};padding:2px 7px;border-radius:999px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.6px;">${block.severities.low} low</span>`)
  const rulesLine = block.rules.map(r => esc(RULE_LABEL[r])).join(' · ')
  const linkBtn = block.cardUrl
    ? `<a href="${esc(block.cardUrl)}" style="display:inline-block;margin-top:8px;padding:6px 12px;border-radius:8px;background:${BRAND.primary};color:#ffffff;font-family:'Figtree',sans-serif;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">View card →</a>`
    : ''
  return `
    <tr><td style="padding:12px 14px;background:${BRAND.cardBg};border:1px solid ${BRAND.border};border-radius:10px;">
      <div style="margin-bottom:6px;">${sevChips.join(' ')}</div>
      <div style="font-family:'Outfit',sans-serif;font-size:14px;font-weight:700;color:${BRAND.text};">${esc(block.cardName)}</div>
      <div style="font-family:'Figtree',sans-serif;font-size:11.5px;color:${BRAND.muted};margin-top:2px;">${esc(block.setName)}</div>
      <div style="font-family:'Figtree',sans-serif;font-size:12.5px;color:${BRAND.text};margin-top:8px;">
        ${block.eventCount} ${pluralize(block.eventCount, 'alert', 'alerts')} · ${rulesLine}
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
            <a href="${MANAGE_URL}" style="color:${BRAND.primary};text-decoration:none;font-weight:700;">Manage alerts</a> ·
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
      } else {
        lines.push(`Estimated value across all portfolios: ${fmtCents(data.portfolio.currentTotalCents, data.currency)}  (was ${fmtCents(data.portfolio.previousTotalCents, data.currency)})`)
        lines.push(`Change: ${fmtCents(data.portfolio.absChangeCents, data.currency)}  (${fmtPct(data.portfolio.pctChange)})`)
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
        lines.push(`* ${block.cardName} (${block.setName})`)
        const sevs: string[] = []
        if (block.severities.high   > 0) sevs.push(`${block.severities.high} high`)
        if (block.severities.normal > 0) sevs.push(`${block.severities.normal} normal`)
        if (block.severities.low    > 0) sevs.push(`${block.severities.low} low`)
        lines.push(`    ${block.eventCount} ${pluralize(block.eventCount, 'alert', 'alerts')} · ${sevs.join(', ')} · ${block.rules.map(r => RULE_LABEL[r]).join(' · ')}`)
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
  lines.push(`Manage alerts at ${MANAGE_URL}`)
  return lines.join('\n')
}

function itemTextLines(item: WeeklyDigestItem, currency: DigestDisplayCurrency): string[] {
  const out: string[] = []
  out.push(`* [${REASON_LABEL[item.reason]}] ${item.cardName ?? '(unknown)'} (${item.setName ?? ''})`)
  const priceBit = item.currentCents != null
    ? `${fmtCents(item.currentCents, currency)}${item.previousCents != null ? ' (was ' + fmtCents(item.previousCents, currency) + ')' : ''}`
    : 'no price data'
  const pctBit   = item.pctChange != null ? ` · ${fmtPct(item.pctChange)}` : ''
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
