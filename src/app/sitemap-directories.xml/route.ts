// src/app/sitemap-directories.xml/route.ts
// ============================================================================
// Stage 6A — new sub-sitemap covering the community directory URLs that
// were public but sitemap-invisible: approved creators + active vendors.
//
// Small denominator (~20 URLs today) but the divergence between "route
// exists" and "sitemap knows about it" was the shape flagged by the
// 2026-09-28 audit. Adding these to the sitemap index makes Bing/Google
// discovery match the rest of the site.
// ============================================================================

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const [{ data: creators }, { data: vendors }] = await Promise.all([
    supabase.from('creators').select('slug, updated_at').eq('status', 'approved'),
    supabase.from('vendors' ).select('slug, updated_at').eq('active',  true),
  ])

  const nowIso = new Date().toISOString()

  const creatorEntries = ((creators ?? []) as Array<{ slug: string; updated_at?: string | null }>)
    .filter(r => typeof r.slug === 'string' && r.slug.length > 0)
    .map(r => xmlEntry(
      `${BASE_URL}/creators/${encodeURIComponent(r.slug)}`,
      r.updated_at ?? nowIso,
      'weekly', 0.55,
    ))

  const vendorEntries = ((vendors ?? []) as Array<{ slug: string; updated_at?: string | null }>)
    .filter(r => typeof r.slug === 'string' && r.slug.length > 0)
    .map(r => xmlEntry(
      `${BASE_URL}/vendors/${encodeURIComponent(r.slug)}`,
      r.updated_at ?? nowIso,
      'weekly', 0.55,
    ))

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...creatorEntries,
    ...vendorEntries,
    '</urlset>',
  ].join('\n')

  return new NextResponse(body, { headers: { 'Content-Type': 'application/xml' } })
}

function xmlEntry(loc: string, lastmodIso: string, changefreq: string, priority: number): string {
  return `  <url>
    <loc>${escape(loc)}</loc>
    <lastmod>${new Date(lastmodIso).toISOString()}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority.toFixed(2)}</priority>
  </url>`
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
