// src/lib/editorial/writer/hash.ts
//
// EIC Block 9 — stable hash of a Studio bodyDoc so the Fact Checker
// can tell when the document has changed since its last verdict.
//
// SHA-1 over the deterministic JSON of the doc. Not a security hash;
// only used to trigger "Fact check: Out of date".

import { createHash } from 'crypto'

export function hashStudioBody(bodyDoc: unknown): string {
  return createHash('sha1').update(JSON.stringify(bodyDoc ?? null)).digest('hex')
}
