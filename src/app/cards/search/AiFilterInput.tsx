'use client'
// Block 5A-W-56A — Deep Card Search natural-language input.
// Submits ONE call to /api/deep-search/parse on explicit user submit.
// Never fires on typing. Falls through to visible filters via the
// onParsed callback; the caller applies them and renders results.

import { useState } from 'react'
import { trackEvent } from '@/lib/analytics'
import {
  poundsToUsdCents,
  type DeepCardSearchFilters,
  type DeepCardSearchSort,
  SORT_KEYS,
} from '@/lib/deepSearch/filters'

interface Props {
  onParsed: (
    filters: DeepCardSearchFilters,
    sort: DeepCardSearchSort | undefined,
    unsupportedTerms: string[],
  ) => void
}

const EXAMPLES: { label: string; filters: DeepCardSearchFilters; sort?: DeepCardSearchSort }[] = [
  {
    label: 'PSA 9 Pikachu under £70',
    filters: { pokemonSlug: 'pikachu', psa9Max: poundsToUsdCents(70) },
  },
  {
    label: 'Raw under £20, PSA 10 over £100',
    filters: { rawMax: poundsToUsdCents(20), psa10Min: poundsToUsdCents(100) },
  },
  {
    label: 'Japanese cards before 2010',
    filters: { language: 'jp', releaseYearMax: 2009 },
  },
  {
    label: 'Biggest 30-day gainers',
    filters: {},
    sort: 'change_30d_desc',
  },
  {
    label: 'Cards down 25% in 90 days',
    filters: { change90dMax: -25 },
  },
  {
    label: 'Charizard by PSA 9 price',
    filters: { pokemonSlug: 'charizard' },
    sort: 'psa9_asc',
  },
]

export default function AiFilterInput({ onParsed }: Props) {
  const [text, setText]     = useState('')
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  async function submit() {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    trackEvent('deep_search_ai_submit', {})
    try {
      const res = await fetch('/api/deep-search/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) {
        setError(body?.error || `Sorry, we couldn't parse that (status ${res.status}).`)
        trackEvent('deep_search_ai_unsupported', { reason: 'http_error' })
        setBusy(false)
        return
      }
      const filters = (body.filters ?? {}) as DeepCardSearchFilters
      const rawSort = body.sort as DeepCardSearchSort | undefined
      const sort = rawSort && (SORT_KEYS as readonly string[]).includes(rawSort) ? rawSort : undefined
      const unsupported = Array.isArray(body.unsupported_terms) ? body.unsupported_terms.map(String) : []
      onParsed(filters, sort, unsupported)
    } catch (err: any) {
      setError('Sorry, the parser is temporarily unavailable. Set filters manually below.')
      trackEvent('deep_search_ai_unsupported', { reason: 'network_error' })
    } finally {
      setBusy(false)
    }
  }

  function applyExample(ex: typeof EXAMPLES[number]) {
    onParsed(ex.filters, ex.sort, [])
    trackEvent('deep_search_manual_filter', { source: 'example', filter_keys: Object.keys(ex.filters).join(',') })
  }

  return (
    <section aria-label="Search cards using natural language" style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '16px 18px',
    }}>
      <form
        onSubmit={e => { e.preventDefault(); submit() }}
        style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}
      >
        <label htmlFor="deep-search-ai" style={{ flex: 1, minWidth: 240 }}>
          <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Describe what you're looking for</span>
          <input
            id="deep-search-ai"
            type="text"
            placeholder="Describe what you're looking for — e.g. 'PSA 9 Pikachu under £70'"
            value={text}
            onChange={e => setText(e.target.value)}
            disabled={busy}
            style={{
              width: '100%', padding: '12px 14px',
              fontSize: 14, borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-light)', color: 'var(--text)',
              fontFamily: "'Figtree', sans-serif", outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          style={{
            padding: '10px 20px', borderRadius: 10, border: 'none',
            background: 'var(--primary)', color: '#fff',
            fontSize: 14, fontWeight: 700,
            fontFamily: "'Figtree', sans-serif",
            cursor: busy || !text.trim() ? 'not-allowed' : 'pointer',
            opacity: busy || !text.trim() ? 0.6 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {busy ? 'Parsing…' : 'Search'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{
          fontSize: 12, color: '#dc2626', margin: '10px 0 0',
          fontFamily: "'Figtree', sans-serif",
        }}>{error}</p>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)',
          fontFamily: "'Figtree', sans-serif",
          alignSelf: 'center', marginRight: 4,
        }}>Try:</span>
        {EXAMPLES.map(ex => (
          <button
            key={ex.label}
            onClick={() => applyExample(ex)}
            style={{
              padding: '5px 12px', borderRadius: 999,
              background: 'var(--bg-light)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 12, fontWeight: 700,
              fontFamily: "'Figtree', sans-serif", cursor: 'pointer',
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>
    </section>
  )
}
