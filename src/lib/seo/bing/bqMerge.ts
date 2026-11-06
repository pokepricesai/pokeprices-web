// src/lib/seo/bing/bqMerge.ts
// ============================================================================
// MERGE-upsert helper — the shared idempotency primitive for every Bing
// source module.
//
// Given:
//   - a target table (project.dataset.table)
//   - a list of key fields (logical primary key)
//   - a list of non-key fields with their BigQuery types
//   - a batch of rows
//
// Emits a single MERGE ... USING UNNEST(@rows) ... statement, which BQ
// executes atomically. Idempotent by construction: a second call with
// the same input writes the same rows, updates 0 semantic content, and
// touches only the ingested_at / ingest_run_id audit columns.
//
// Every table this helper writes to must have the audit columns
//   ingested_at   TIMESTAMP NOT NULL
//   ingest_run_id STRING    NOT NULL
// — bqSchema.ts guarantees this for all six Bing tables.
// ============================================================================

import 'server-only'
import type { BqContext } from '../bqClient'

export type BqType =
  | 'STRING' | 'INT64' | 'FLOAT64' | 'BOOL' | 'DATE' | 'TIMESTAMP'

export type FieldSpec = { name: string; type: BqType }

export type UpsertResult = {
  ok: boolean
  rows_seen: number
  rows_inserted?: number
  rows_updated?: number
  bytes_billed?: number
  /** CN-06.04-P04: rows that reached upsertRows but had null/empty key
   *  fields and were dropped pre-MERGE. Reported so the ingest audit
   *  can surface the count; never silently 0. */
  rows_dropped_null_keys?: number
  /** CN-06.04-P04: when the MERGE fails, we include the first row's
   *  keys so the operator can tell WHICH source shape triggered the
   *  error without redacting the API response. Null-safe. */
  diagnostic_first_row_keys?: string[]
  error?: string
}

/** Perform an idempotent MERGE-upsert into a Bing warehouse table.
 *
 *  Parameters
 *    ctx           BigQuery client + project/location
 *    tableFqn      Fully-qualified `project.dataset.table` (no backticks)
 *    keyFields     Logical primary key fields (must be non-null in rows)
 *    valueFields   All other columns to update on MATCH / insert on NOT MATCH
 *    rows          Batch of row objects — keys AND values, no audit cols
 *    ingestRunId   String written to ingest_run_id for every row
 *
 *  Never throws. Returns { ok:false, error } on any BQ failure. */
/** CN-06.04-P04: drop rows where any key-field value is null/undefined/
 *  empty-string. The BigQuery MERGE target columns for key fields are
 *  declared NOT NULL; silently letting such rows through produced the
 *  "Required field X cannot be null" error on the 2026-11-06 fire
 *  (first run after the IAM unblock). Dropping defensively here is
 *  safer than fabricating a sentinel date, which the brief forbids. */
export function dropRowsWithNullKeys(
  rows: Array<Record<string, unknown>>,
  keyFields: FieldSpec[],
): { kept: Array<Record<string, unknown>>; dropped: number } {
  const kept: Array<Record<string, unknown>> = []
  let dropped = 0
  for (const r of rows) {
    let ok = true
    for (const kf of keyFields) {
      const v = r[kf.name]
      if (v == null) { ok = false; break }
      if (typeof v === 'string' && v.trim() === '') { ok = false; break }
    }
    if (ok) kept.push(r); else dropped++
  }
  return { kept, dropped }
}

/** CN-06.04-P04 (root cause) — wrap DATE / TIMESTAMP values with the
 *  BigQuery helper constructors so the ARRAY<STRUCT> parameter binding
 *  serialises them as DATE / TIMESTAMP rather than STRING.
 *
 *  Why: the shorthand `types: { rows: [{ snapshot_date: 'DATE', ... }] }`
 *  declares the STRUCT field as DATE, but the JS value `'2026-11-06'` is
 *  a plain string. When @google-cloud/bigquery serialises the nested
 *  STRUCT for the query parameter, it passes the string through without
 *  coercion. BigQuery's MERGE `VALUES (S.snapshot_date, ...)` then sees
 *  a STRING-typed STRUCT field and attempts an implicit coercion to the
 *  target NOT NULL DATE column. On some rows the coercion produces NULL
 *  and INSERT fails with "Required field X cannot be null".
 *
 *  The fix: for every DATE / TIMESTAMP / DATETIME field in the struct
 *  schema, wrap the string value in `bq.date()` / `bq.timestamp()` /
 *  `bq.datetime()` so the parameter is sent with the correct wire type.
 *  Null values stay null (type-preserving). The BQ library static/instance
 *  helpers accept either an ISO string or a Date; we pass ISO strings as
 *  produced by parseWcfDate + .slice(0,10).
 *
 *  Supported: @google-cloud/bigquery exposes these as instance methods
 *  on the BigQuery class. We accept `bq` as the already-constructed
 *  client (BqContext.bq); callers that construct a client with a different
 *  class must expose compatible .date()/.timestamp()/.datetime() helpers. */
export function wrapTypedValues(
  row: Record<string, unknown>,
  structSchema: Record<string, BqType>,
  bq: { date(v: unknown): unknown; timestamp(v: unknown): unknown },
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (v == null) { out[k] = null; continue }
    const type = structSchema[k]
    if (type === 'DATE' && typeof v === 'string')      out[k] = bq.date(v)
    else if (type === 'TIMESTAMP' && typeof v === 'string') out[k] = bq.timestamp(v)
    else                                                    out[k] = v
  }
  return out
}

export async function upsertRows(
  ctx: BqContext,
  tableFqn: string,
  keyFields: FieldSpec[],
  valueFields: FieldSpec[],
  rows: Array<Record<string, unknown>>,
  ingestRunId: string,
): Promise<UpsertResult> {
  if (rows.length === 0) {
    return { ok: true, rows_seen: 0, rows_inserted: 0, rows_updated: 0, bytes_billed: 0, rows_dropped_null_keys: 0 }
  }

  // Defensive pre-filter: drop rows where any NOT NULL key field is
  // null/empty before the MERGE. The count is reported in the result
  // so the ingest audit surfaces the drop (never silent).
  const { kept: safeRows, dropped: droppedNullKeys } = dropRowsWithNullKeys(rows, keyFields)
  if (safeRows.length === 0) {
    return {
      ok: true,
      rows_seen: rows.length,
      rows_inserted: 0, rows_updated: 0, bytes_billed: 0,
      rows_dropped_null_keys: droppedNullKeys,
    }
  }

  const allFields = [...keyFields, ...valueFields]
  const structSchema: Record<string, BqType> = {}
  for (const f of allFields) structSchema[f.name] = f.type

  const onClause = keyFields
    .map(f => `T.${f.name} = S.${f.name}`).join(' AND ')

  const updateSet = [
    ...valueFields.map(f => `${f.name} = S.${f.name}`),
    `ingested_at = CURRENT_TIMESTAMP()`,
    `ingest_run_id = @ingest_run_id`,
  ].join(',\n      ')

  const insertColumns = [
    ...keyFields.map(f => f.name),
    ...valueFields.map(f => f.name),
    'ingested_at',
    'ingest_run_id',
  ].join(', ')

  const insertValues = [
    ...keyFields.map(f => `S.${f.name}`),
    ...valueFields.map(f => `S.${f.name}`),
    `CURRENT_TIMESTAMP()`,
    `@ingest_run_id`,
  ].join(', ')

  const sql = `
    MERGE \`${tableFqn}\` T
    USING UNNEST(@rows) S
    ON ${onClause}
    WHEN MATCHED THEN UPDATE SET
      ${updateSet}
    WHEN NOT MATCHED THEN INSERT (${insertColumns})
      VALUES (${insertValues})
  `

  // Serialise DATE / TIMESTAMP string values via the BQ client helpers
  // so the ARRAY<STRUCT> parameter is sent with the correct wire type.
  // Without this, BigQuery receives the STRUCT fields as STRING and
  // implicit coercion into NOT NULL DATE columns produced the Nov 6
  // "Required field X cannot be null" error for 4 of 5 Bing sources.
  const typedRows = safeRows.map(r => wrapTypedValues(r, structSchema, ctx.bq))

  try {
    const [job] = await ctx.bq.createQueryJob({
      query: sql,
      location: ctx.location,
      useLegacySql: false,
      params: { rows: typedRows, ingest_run_id: ingestRunId },
      types:  { rows: [structSchema], ingest_run_id: 'STRING' },
    })
    await job.getQueryResults()
    const md = job.metadata ?? {}
    const dml = md.statistics?.query?.dmlStats ?? {}
    const bytes = Number(md.statistics?.query?.totalBytesBilled ?? 0)
    return {
      ok: true,
      rows_seen: rows.length,
      rows_inserted: Number(dml.insertedRowCount ?? 0),
      rows_updated:  Number(dml.updatedRowCount  ?? 0),
      bytes_billed:  bytes,
      rows_dropped_null_keys: droppedNullKeys,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown bq merge error'
    // Include the first row's keys in the error so the operator can
    // identify which source's shape triggered the BQ rejection. The
    // actual values are NOT included (they may carry PII / query terms).
    const firstRowKeys = safeRows[0] ? Object.keys(safeRows[0]) : []
    return {
      ok: false,
      error: msg.slice(0, 350) + (firstRowKeys.length ? ` | first_row_keys=[${firstRowKeys.join(',')}]` : ''),
      rows_seen: rows.length,
      rows_dropped_null_keys: droppedNullKeys,
      diagnostic_first_row_keys: firstRowKeys,
    }
  }
}
