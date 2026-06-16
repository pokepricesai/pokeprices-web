// Lightweight in-memory fake for the Supabase service client. Only
// implements the surface the email modules actually call:
//
//   .from(table).select(cols).eq(col, val).maybeSingle()
//   .from(table).select(cols).eq(col, val).single()
//   .from(table).select(cols).eq(col, val).is(col2, null)
//   .from(table).select(cols).eq(col, val).order(c, opts).limit(n).maybeSingle()
//   .from(table).insert(row).select(cols).single()
//   .from(table).insert(row).select(cols).maybeSingle()
//   .from(table).upsert(row, opts).select(cols).single()
//   .from(table).upsert(rows, opts).select(cols)
//   .from(table).update(patch).eq(col, val).select(cols).single()
//   .from(table).update(patch).eq(col, val)
//
// The fake is deliberately permissive: tests can pre-seed tables and
// inspect mutations after a run.

type Row = Record<string, any>

export type FakeError = { code: string; message: string } | null

class QueryBuilder {
  private tableName: string
  private rows: Row[]
  private filters: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private inserted: Row[] = []
  private updatePatch: Row | null = null
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  private orderClauses: Array<{ col: string; ascending: boolean }> = []
  private limitN: number | null = null
  private rejectInsert: (() => FakeError) | null = null
  private countMode: 'exact' | null = null
  private headOnly: boolean = false

  constructor(tableName: string, db: FakeDB) {
    this.tableName = tableName
    this.rows = db.rows(tableName)
    this.rejectInsert = db.rejectInsert(tableName)
  }

  select(_cols?: string, opts?: { count?: 'exact'; head?: boolean }): this {
    if (opts?.count === 'exact') this.countMode = 'exact'
    if (opts?.head === true)     this.headOnly  = true
    return this
  }

  eq(col: string, val: any): this {
    this.filters.push(r => r[col] === val)
    return this
  }

  is(col: string, val: any): this {
    // Postgres `IS NULL` matches both unset/null columns; the fake
    // treats `undefined` the same as `null` for this filter.
    this.filters.push(r => {
      if (val === null) return r[col] === null || r[col] === undefined
      return r[col] === val
    })
    return this
  }

  in(col: string, vals: any[]): this {
    this.filters.push(r => vals.includes(r[col]))
    return this
  }

  // Block 3B correction — used by the atomic claim's stale-recovery
  // step. Treats null / undefined as "not less than anything" so a
  // row with no claim does NOT accidentally match this filter; the
  // is(processing_token, null) path handles those.
  lt(col: string, val: any): this {
    this.filters.push(r => {
      const v = r[col]
      if (v === null || v === undefined) return false
      return v < val
    })
    return this
  }

  // Match the bare-claim path: token IS NULL or token IS NOT NULL.
  // Already covered by is() above.
  not(col: string, op: 'is', val: any): this {
    // Used as .not('processing_token', 'is', null) — i.e. NOT NULL.
    if (op === 'is' && val === null) {
      this.filters.push(r => r[col] !== null && r[col] !== undefined)
    }
    return this
  }

  insert(row: Row | Row[]): this {
    this.op = 'insert'
    this.inserted = Array.isArray(row) ? [...row] : [row]
    return this
  }

  update(patch: Row): this {
    this.op = 'update'
    this.updatePatch = patch
    return this
  }

  upsert(row: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = 'upsert'
    this.inserted = Array.isArray(row) ? [...row] : [row]
    this.upsertOpts = opts
    return this
  }

  order(col: string, opts: { ascending?: boolean } = {}): this {
    this.orderClauses.push({ col, ascending: opts.ascending !== false })
    return this
  }

  limit(n: number): this { this.limitN = n; return this }

  private filtered(): Row[] {
    let out = this.rows.filter(r => this.filters.every(f => f(r)))
    for (const { col, ascending } of this.orderClauses) {
      out = [...out].sort((a, b) => {
        const av = a[col], bv = b[col]
        if (av === bv) return 0
        return (av > bv ? 1 : -1) * (ascending ? 1 : -1)
      })
    }
    if (this.limitN != null) out = out.slice(0, this.limitN)
    return out
  }

  private commitInsert(): { data: Row[] | null; error: FakeError } {
    if (this.rejectInsert) {
      const e = this.rejectInsert()
      if (e) return { data: null, error: e }
    }
    const out: Row[] = []
    for (const candidate of this.inserted) {
      if (this.op === 'upsert' && this.upsertOpts.ignoreDuplicates) {
        const conflictCols = (this.upsertOpts.onConflict ?? '').split(',').map(s => s.trim()).filter(Boolean)
        if (conflictCols.length > 0) {
          const dup = this.rows.find(r => conflictCols.every(c => r[c] === candidate[c]))
          if (dup) continue
        }
      }
      const enriched = { id: candidate.id ?? cryptoUuid(), created_at: new Date().toISOString(), ...candidate }
      this.rows.push(enriched)
      out.push(enriched)
    }
    return { data: out, error: null }
  }

  private commitUpdate(): { data: Row[] | null; error: FakeError } {
    const out: Row[] = []
    for (const r of this.filtered()) {
      Object.assign(r, this.updatePatch ?? {})
      out.push(r)
    }
    return { data: out, error: null }
  }

  async single(): Promise<{ data: Row | null; error: FakeError }> {
    if (this.op === 'insert' || this.op === 'upsert') {
      const r = this.commitInsert()
      if (r.error) return { data: null, error: r.error }
      return { data: r.data?.[0] ?? null, error: null }
    }
    if (this.op === 'update') {
      const r = this.commitUpdate()
      return { data: r.data?.[0] ?? null, error: null }
    }
    const rows = this.filtered()
    return { data: rows[0] ?? null, error: null }
  }

  async maybeSingle(): Promise<{ data: Row | null; error: FakeError }> {
    return this.single()
  }

  // Awaiting the builder directly (no .single/.maybeSingle).
  then<T = { data: Row[] | null; error: FakeError; count?: number | null }, R = never>(
    resolve: (v: { data: Row[] | null; error: FakeError; count?: number | null }) => T | PromiseLike<T>,
    reject?: (r: unknown) => R | PromiseLike<R>,
  ): Promise<T | R> {
    return Promise.resolve(this.commit()).then(resolve, reject)
  }

  private commit(): { data: Row[] | null; error: FakeError; count?: number | null } {
    if (this.op === 'insert' || this.op === 'upsert') return this.commitInsert()
    if (this.op === 'update') return this.commitUpdate()
    const filtered = this.filtered()
    const count = this.countMode === 'exact' ? filtered.length : null
    const data  = this.headOnly ? null : filtered
    return { data, error: null, count }
  }
}

function cryptoUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export class FakeDB {
  private tables = new Map<string, Row[]>()
  private rejectMap = new Map<string, () => FakeError>()

  seed(table: string, rows: Row[]): void {
    this.tables.set(table, rows.map(r => ({ ...r })))
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, [])
    return this.tables.get(table)!
  }

  rejectInsert(table: string): (() => FakeError) | null {
    return this.rejectMap.get(table) ?? null
  }

  forceInsertError(table: string, err: NonNullable<FakeError>): void {
    this.rejectMap.set(table, () => err)
  }

  clearInsertError(table: string): void { this.rejectMap.delete(table) }

  from(table: string): QueryBuilder { return new QueryBuilder(table, this) }

  reset(): void { this.tables.clear(); this.rejectMap.clear() }
}
