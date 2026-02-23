'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { supabase, formatDate } from '@/lib/supabase'

export default function InsightArticle() {
  const params = useParams()
  const slug = params.slug as string
  const [article, setArticle] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('insights')
        .select('*')
        .eq('slug', slug)
        .single()
      if (data) setArticle(data)
      setLoading(false)
    }
    load()
  }, [slug])

  if (loading) return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '60px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
      Loading article...
    </div>
  )

  if (!article) return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28 }}>Article not found</h1>
      <Link href="/insights" style={{ color: 'var(--accent)', textDecoration: 'none' }}>← Back to insights</Link>
    </div>
  )

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 24px' }}>
      <Link href="/insights" style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'inline-block', marginBottom: 16 }}>
        ← All insights
      </Link>

      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 8 }}>
        {article.category}
      </span>
      <h1 style={{
        fontFamily: "'DM Serif Display', serif", fontSize: 34,
        margin: '0 0 8px', color: 'var(--text)', lineHeight: 1.2,
      }}>{article.title}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 32px' }}>
        {formatDate(article.published_at)}
      </p>

      <div style={{
        fontSize: 15, lineHeight: 1.75, color: 'var(--text)',
      }} dangerouslySetInnerHTML={{ __html: article.content || article.body || '' }} />
    </div>
  )
}
