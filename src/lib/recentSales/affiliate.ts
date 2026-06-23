// src/lib/recentSales/affiliate.ts
// Block 4B-W-8A — derive the affiliate intent / label / analytics
// placement for the currently-selected recent-sales grade tab.
//
// Returns null when the tab does not justify a search link (e.g. an
// "Other" bucket with no specific grade information). The callers
// already centralise URL construction through @/lib/ebayAffiliate so
// nothing here builds eBay URLs directly — keeping the repo audit
// (scripts/audit-ebay-links.mjs) green.

import type { AffiliateIntent, GradingCompany } from '@/lib/ebayAffiliate'

export type RecentSalesAffiliate = {
  intent:          AffiliateIntent
  label:           string
  placement:       string
  gradingCompany?: GradingCompany | string
  grade?:          string
}

const KNOWN_COMPANIES = new Set(['PSA','CGC','BGS','SGC','TAG','ACE','HGA'])

/**
 * Map a grade-tab key (as produced by deriveGradeKey in cardQueries.ts)
 * to the affiliate input for the engine. Returns null when no sensible
 * search exists for the key — caller hides the link in that case.
 */
export function affiliateForGradeKey(key: string): RecentSalesAffiliate | null {
  const k = (key ?? '').toLowerCase().trim()
  if (!k) return null

  if (k === 'all') {
    return {
      intent:    'raw',
      label:     'Find this card on eBay',
      placement: 'recent_sales_all',
    }
  }
  if (k === 'raw') {
    return {
      intent:    'raw',
      label:     'Find raw copies on eBay',
      placement: 'recent_sales_raw',
    }
  }

  // PSA 8 / 9 / 10 — the engine has dedicated intents for these.
  if (k === 'psa-10') return { intent: 'psa10', label: 'Find PSA 10 copies on eBay', placement: 'recent_sales_psa10' }
  if (k === 'psa-9')  return { intent: 'psa9',  label: 'Find PSA 9 copies on eBay',  placement: 'recent_sales_psa9'  }
  if (k === 'psa-8')  return { intent: 'psa8',  label: 'Find PSA 8 copies on eBay',  placement: 'recent_sales_psa8'  }

  // Generic "Graded" fallback when the bucket carried no grade info.
  if (k === 'graded') {
    return {
      intent:    'graded',
      label:     'Find graded copies on eBay',
      placement: 'recent_sales_graded',
    }
  }

  // {company}-{grade} pattern, e.g. cgc-10, bgs-9.5, sgc-9, psa-7.
  const m = /^([a-z]+)-([0-9.]+)$/.exec(k)
  if (m) {
    const company = m[1].toUpperCase()
    const grade   = m[2]
    if (KNOWN_COMPANIES.has(company)) {
      return {
        intent:         'graded',
        gradingCompany: company,
        grade,
        label:          `Find ${company} ${grade} copies on eBay`,
        placement:      `recent_sales_${company.toLowerCase()}_${grade.replace(/\./g, '_')}`,
      }
    }
  }

  // Bare company tag (e.g. "cgc" / "psa") — caller's deriveGradeKey
  // produces this when only the company is known.
  const upper = k.toUpperCase()
  if (KNOWN_COMPANIES.has(upper)) {
    return {
      intent:         'graded',
      gradingCompany: upper,
      label:          `Find ${upper} copies on eBay`,
      placement:      `recent_sales_${k}`,
    }
  }

  // "other" and anything else — no link.
  return null
}
