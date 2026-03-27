// app/creators/page.tsx
import { createClient } from '@supabase/supabase-js'
import CreatorsClient from './CreatorsClient'

export const revalidate = 3600

async function getCreators() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
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
