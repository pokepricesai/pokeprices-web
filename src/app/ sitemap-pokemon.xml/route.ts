// app/sitemap-pokemon.xml/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const BASE_URL = 'https://www.pokeprices.io'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const { data: species } = await supabase
    .from('pokemon_species')
    .select('name')
    .order('id')

  const now = new Date().toISOString()

  const urls = (species || []).map(s => `  <url>
    <loc>${BASE_URL}/pokemon/${s.name.toLowerCase()}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`).join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  })
}
