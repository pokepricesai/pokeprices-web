// app/creators/page.tsx
'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import CreatorsClient from './CreatorsClient'

export default function CreatorsPage() {
  const [creators, setCreators] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('creators')
        .select('*')
        .eq('status', 'approved')
        .order('featured', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) console.error('Creators fetch error:', error)
      setCreators(data || [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: 'var(--text-muted)', fontFamily: "'Figtree', sans-serif" }}>
      Loading creators...
    </div>
  )

  return <CreatorsClient creators={creators} />
}
