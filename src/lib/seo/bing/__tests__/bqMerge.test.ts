import { describe, it, expect } from 'vitest'
import { dropRowsWithNullKeys } from '../bqMerge'

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
