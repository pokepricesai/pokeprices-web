// app/vendors/[slug]/page.tsx
import { createClient } from '@supabase/supabase-js'
import VendorDetailClient from './VendorDetailClient'
import { notFound } from 'next/navigation'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export default async function VendorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { data } = await supabase
    .from('vendors')
    .select('*')
    .eq('slug', slug)
    .eq('active', true)
    .single()

  if (!data) notFound()
  return <VendorDetailClient vendor={data} />
}