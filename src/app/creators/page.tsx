// app/creators/page.tsx
import { createClient } from '@supabase/supabase-js'
import CreatorsClient from './CreatorsClient'

export const dynamic = 'force-dynamic'

async function getCreators() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseKey) return []

  const supabase = createClient(supabaseUrl, supabaseKey)
  const { data } = await supabase
    .from('creators')
    .select('*')
    .eq('status', 'approved')
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
  return data || []
}

export default async function CreatorsPage() {
  const creators = await getCreators()
  return <CreatorsClient creators={creators} />
}
