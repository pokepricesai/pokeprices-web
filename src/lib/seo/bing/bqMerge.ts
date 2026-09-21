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
export async function upsertRows(
  ctx: BqContext,
  tableFqn: string,
  keyFields: FieldSpec[],
  valueFields: FieldSpec[],
  rows: Array<Record<string, unknown>>,
  ingestRunId: string,
): Promise<UpsertResult> {
  if (rows.length === 0) {
    return { ok: true, rows_seen: 0, rows_inserted: 0, rows_updated: 0, bytes_billed: 0 }
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

  try {
    const [job] = await ctx.bq.createQueryJob({
      query: sql,
      location: ctx.location,
      useLegacySql: false,
      params: { rows, ingest_run_id: ingestRunId },
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
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown bq merge error'
    return { ok: false, error: msg.slice(0, 400), rows_seen: rows.length }
  }
}
