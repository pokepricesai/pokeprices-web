// app/sitemap-sets.xml/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const { data: sets } = await supabase
    .from('set_metadata')
    .select('set_name, updated_at')
    .order('set_name')

  const now = new Date().toISOString()

  const urls = (sets || []).map(s => `  <url>
    <loc>${BASE_URL}/set/${encodeURIComponent(s.set_name)}</loc>
    <lastmod>${s.updated_at ? new Date(s.updated_at).toISOString() : now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.85</priority>
  </url>`).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
