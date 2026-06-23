// src/lib/recentSales/cardQueries.ts
// Server-only read query that backs the "Recent verified sales"
// section on individual card pages.
//
// Returns operator-safe marketplace facts only — no PII anywhere.
// Filters to parse_status='ok' AND review_status='active', mirroring
// the public-RPC predicate documented in
// docs/recent-sales-architecture.md.

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceClient } from '@/lib/supabaseService'
import { isFreePreviewEnabled } from './flags'

export type CardPageRecentSale = {
  saleDate:           string
  marketplaceSource:  string
  marketplaceCountry: string | null
  observedSection:    string
  rawOrGraded:        string | null
  gradingCompany:     string | null
  grade:              string | null
  conditionBucket:    string | null
  conditionText:      string | null
  bestOfferStatus:    string | null
  salePriceCents:     number
}

export type GradeGroup = {
  key:   string                     // 'all' | 'raw' | 'psa-10' | 'cgc-9.5' | 'graded' | ...
  label: string                     // 'All' | 'Raw' | 'PSA 10' | 'CGC 9.5' | 'Graded'
  rows:  CardPageRecentSale[]
}

export type CardPageRecentSalesData = {
  groups: GradeGroup[]
  total:  number
}

const DEFAULT_LIMIT          = 15
const MAX_LIMIT              = 200
const GROUPED_FETCH_DEFAULT  = 100
const PER_GRADE_LIMIT        = 5

const KNOWN_COMPANIES = ['PSA','CGC','BGS','SGC','TAG','ACE','HGA']

function normalizeCompany(c: string | null): string | null {
  if (!c) return null
  const upper = c.trim().toUpperCase()
  return upper.length === 0 ? null : upper
}

function normalizeGrade(g: string | null): string | null {
  if (!g) return null
  let s = g.trim()
  for (let i = 0; i < 2; i++) {
    const re = new RegExp('^(' + KNOWN_COMPANIES.join('|') + ')\\s+', 'i')
    if (re.test(s)) s = s.replace(re, '').trim()
  }
  return s.length === 0 ? null : s
}

export function deriveGradeKey(row: CardPageRecentSale): { key: string; label: string } {
  const company = normalizeCompany(row.gradingCompany)
  const grade   = normalizeGrade(row.grade)
  if (company && grade) {
    return {
      key:   (company.toLowerCase() + '-' + grade.toLowerCase()).replace(/\s+/g, '-'),
      label: company + ' ' + grade,
    }
  }
  if (row.rawOrGraded === 'raw') return { key: 'raw',    label: 'Raw' }
  if (company)                    return { key: company.toLowerCase(), label: company }
  if (row.rawOrGraded === 'graded') return { key: 'graded', label: 'Graded' }
  return { key: 'other', label: 'Other' }
}

const PRIORITY_KEYS = ['raw','psa-10','psa-9','psa-8','psa-7']

export function groupRecentSalesByGrade(
  rows:          CardPageRecentSale[],
  perGradeLimit: number = PER_GRADE_LIMIT,
): CardPageRecentSalesData {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { groups: [], total: 0 }
  }
  const bounded = Math.max(1, Math.min(20, Math.floor(perGradeLimit)))

  const buckets = new Map<string, GradeGroup>()
  for (const row of rows) {
    const { key, label } = deriveGradeKey(row)
    let g = buckets.get(key)
    if (!g) {
      g = { key, label, rows: [] }
      buckets.set(key, g)
    }
    if (g.rows.length < bounded) g.rows.push(row)
  }

  const remaining = Array.from(buckets.values()).sort((a, b) => {
    const ai = PRIORITY_KEYS.indexOf(a.key)
    const bi = PRIORITY_KEYS.indexOf(b.key)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.label.localeCompare(b.label)
  })

  const all: GradeGroup = { key: 'all', label: 'All', rows: rows.slice(0, bounded) }
  return { groups: [all, ...remaining], total: rows.length }
}

function mapRow(r: Record<string, unknown>): CardPageRecentSale {
  return {
    saleDate:           String(r.sale_date),
    marketplaceSource:  String(r.marketplace_source),
    marketplaceCountry: r.marketplace_country == null ? null : String(r.marketplace_country),
    observedSection:    String(r.observed_section),
    rawOrGraded:        r.raw_or_graded   == null ? null : String(r.raw_or_graded),
    gradingCompany:     r.grading_company == null ? null : String(r.grading_company),
    grade:              r.grade           == null ? null : String(r.grade),
    conditionBucket:    r.condition_bucket== null ? null : String(r.condition_bucket),
    conditionText:      r.condition_text  == null ? null : String(r.condition_text),
    bestOfferStatus:    r.best_offer_status == null ? null : String(r.best_offer_status),
    salePriceCents:     Number(r.sale_price_cents),
  }
}

export async function getRecentSalesForCard(
  supa:  SupabaseClient,
  slug:  string,
  limit: number = DEFAULT_LIMIT,
): Promise<CardPageRecentSale[]> {
  if (!slug || typeof slug !== 'string') return []
  const bounded = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
  const { data, error } = await supa
    .from('recent_sales')
    .select('sale_date, marketplace_source, marketplace_country, observed_section, raw_or_graded, grading_company, grade, condition_bucket, condition_text, best_offer_status, sale_price_cents')
    .eq('internal_card_slug', slug)
    .eq('parse_status',  'ok')
    .eq('review_status', 'active')
    .order('sale_date', { ascending: false })
    .limit(bounded)
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[recent-sales] card page read failed:', error.message)
    return []
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>
  return rows.map(mapRow)
}

export async function getRecentSalesGroupedForCard(
  supa:           SupabaseClient,
  slug:           string,
  fetchLimit:     number = GROUPED_FETCH_DEFAULT,
  perGradeLimit:  number = PER_GRADE_LIMIT,
): Promise<CardPageRecentSalesData> {
  const rows = await getRecentSalesForCard(supa, slug, fetchLimit)
  return groupRecentSalesByGrade(rows, perGradeLimit)
}

export async function loadRecentSalesGroupedForCardIfEnabled(
  slug: string,
): Promise<CardPageRecentSalesData> {
  if (!isFreePreviewEnabled()) return { groups: [], total: 0 }
  return getRecentSalesGroupedForCard(getSupabaseServiceClient(), slug)
}
