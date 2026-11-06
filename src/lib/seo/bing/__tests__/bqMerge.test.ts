import { describe, it, expect } from 'vitest'
import { dropRowsWithNullKeys, wrapTypedValues } from '../bqMerge'

/** Fake BigQuery client exposing just the `.date` + `.timestamp` helpers. */
function fakeBq() {
  return {
    date:      (v: unknown) => ({ _kind: 'BqDate',      value: v }),
    timestamp: (v: unknown) => ({ _kind: 'BqTimestamp', value: v }),
  }
}

const KEY = [
  { name: 'date',     type: 'DATE'   as const },
  { name: 'raw_url',  type: 'STRING' as const },
]

describe('dropRowsWithNullKeys — defensive pre-filter before BQ MERGE', () => {
  it('passes rows where every key field is a non-empty string', () => {
    const rows = [
      { date: '2026-11-06', raw_url: 'https://x/a', clicks: 1 },
      { date: '2026-11-06', raw_url: 'https://x/b', clicks: 2 },
    ]
    const { kept, dropped } = dropRowsWithNullKeys(rows, KEY)
    expect(dropped).toBe(0)
    expect(kept).toHaveLength(2)
  })

  it('drops a row with null date (the Nov 6 Bing error signature)', () => {
    const rows = [
      { date: '2026-11-06', raw_url: 'https://x/a' },
      { date: null,         raw_url: 'https://x/b' },  // null date — would cause BQ MERGE error
      { date: '2026-11-06', raw_url: 'https://x/c' },
    ]
    const { kept, dropped } = dropRowsWithNullKeys(rows, KEY)
    expect(dropped).toBe(1)
    expect(kept).toHaveLength(2)
    expect(kept.map(r => r.raw_url)).toEqual(['https://x/a', 'https://x/c'])
  })

  it('drops a row with undefined key', () => {
    const rows = [
      { date: '2026-11-06', raw_url: 'https://x/a' },
      { date: undefined,    raw_url: 'https://x/b' },
    ]
    const { kept, dropped } = dropRowsWithNullKeys(rows, KEY)
    expect(dropped).toBe(1)
    expect(kept).toHaveLength(1)
  })

  it('drops a row with empty-string key (not a valid DATE)', () => {
    const rows = [
      { date: '2026-11-06', raw_url: 'https://x/a' },
      { date: '',           raw_url: 'https://x/b' },
      { date: '   ',        raw_url: 'https://x/c' },  // whitespace-only
    ]
    const { kept, dropped } = dropRowsWithNullKeys(rows, KEY)
    expect(dropped).toBe(2)
    expect(kept).toHaveLength(1)
  })

  it('drops a row where ANY key field is missing (multi-key case)', () => {
    const rows = [
      { date: '2026-11-06', raw_url: 'https://x/a' },
      { date: '2026-11-06', raw_url: null },           // one key null
      { date: null,         raw_url: null },            // both keys null
    ]
    const { kept, dropped } = dropRowsWithNullKeys(rows, KEY)
    expect(dropped).toBe(2)
    expect(kept).toHaveLength(1)
  })

  it('does NOT drop a row whose VALUE field is null (value nullability is schema-defined, not filtered here)', () => {
    // Example: bing_site_daily.source_updated_at is nullable TIMESTAMP.
    // We only filter on key fields; value nulls are legitimate.
    const KEY_ONLY = [{ name: 'date', type: 'DATE' as const }]
    const rows = [
      { date: '2026-11-06', clicks: null, source_updated_at: null },
      { date: '2026-11-06', clicks: 5,    source_updated_at: '2026-11-06T00:00:00Z' },
    ]
    const { kept, dropped } = dropRowsWithNullKeys(rows, KEY_ONLY)
    expect(dropped).toBe(0)
    expect(kept).toHaveLength(2)
  })

  it('returns an empty kept-array when every row is dropped (upstream caller then skips the MERGE)', () => {
    const rows = [
      { date: null, raw_url: 'https://x/a' },
      { date: null, raw_url: 'https://x/b' },
    ]
    const { kept, dropped } = dropRowsWithNullKeys(rows, KEY)
    expect(dropped).toBe(2)
    expect(kept).toHaveLength(0)
  })

  it('returns empty result on empty input', () => {
    const { kept, dropped } = dropRowsWithNullKeys([], KEY)
    expect(dropped).toBe(0)
    expect(kept).toHaveLength(0)
  })
})

describe('wrapTypedValues — serialise DATE/TIMESTAMP via BQ helpers', () => {
  it('wraps a string DATE value with bq.date() so the wire type is DATE, not STRING', () => {
    const bq = fakeBq()
    const row = { snapshot_date: '2026-11-06', feed_url: 'https://x/a', clicks: 5 }
    const schema = { snapshot_date: 'DATE' as const, feed_url: 'STRING' as const, clicks: 'INT64' as const }
    const out = wrapTypedValues(row, schema, bq)
    expect(out.snapshot_date).toEqual({ _kind: 'BqDate', value: '2026-11-06' })
    expect(out.feed_url).toBe('https://x/a')
    expect(out.clicks).toBe(5)
  })

  it('wraps a string TIMESTAMP value with bq.timestamp()', () => {
    const bq = fakeBq()
    const row = { last_crawled: '2026-11-06T07:00:00Z', url_count: 42 }
    const schema = { last_crawled: 'TIMESTAMP' as const, url_count: 'INT64' as const }
    const out = wrapTypedValues(row, schema, bq)
    expect(out.last_crawled).toEqual({ _kind: 'BqTimestamp', value: '2026-11-06T07:00:00Z' })
    expect(out.url_count).toBe(42)
  })

  it('preserves nulls without wrapping (BQ handles null DATE / TIMESTAMP natively)', () => {
    const bq = fakeBq()
    const row = {
      snapshot_date: '2026-11-06',
      last_crawled: null,
      source_updated_at: null,
      clicks: null,
    }
    const schema = {
      snapshot_date: 'DATE' as const,
      last_crawled: 'TIMESTAMP' as const,
      source_updated_at: 'TIMESTAMP' as const,
      clicks: 'INT64' as const,
    }
    const out = wrapTypedValues(row, schema, bq)
    expect(out.snapshot_date).toEqual({ _kind: 'BqDate', value: '2026-11-06' })
    expect(out.last_crawled).toBeNull()
    expect(out.source_updated_at).toBeNull()
    expect(out.clicks).toBeNull()
  })

  it('does NOT wrap INT64 / STRING / FLOAT64 / BOOL — those serialise natively', () => {
    const bq = fakeBq()
    const row = {
      psa_10: 72,
      card_name: 'Blastoise',
      gem_rate: 6.58,
      compressed: true,
    }
    const schema = {
      psa_10: 'INT64' as const,
      card_name: 'STRING' as const,
      gem_rate: 'FLOAT64' as const,
      compressed: 'BOOL' as const,
    }
    const out = wrapTypedValues(row, schema, bq)
    expect(out.psa_10).toBe(72)
    expect(out.card_name).toBe('Blastoise')
    expect(out.gem_rate).toBe(6.58)
    expect(out.compressed).toBe(true)
  })

  it('does not double-wrap a non-string DATE value (idempotent on object inputs)', () => {
    // If a caller has already wrapped the value, wrapTypedValues leaves it.
    const bq = fakeBq()
    const already = { _kind: 'BqDate', value: '2026-11-06' }
    const row = { snapshot_date: already }
    const schema = { snapshot_date: 'DATE' as const }
    const out = wrapTypedValues(row, schema, bq)
    // Non-string → not wrapped again. Passed through verbatim.
    expect(out.snapshot_date).toBe(already)
  })
})
