// PP-TCG migration — bounded content-based public HTML verification.
//
// Replicates the shape of the proven admin batch page's pollUntil, but
// callable from a cron handler without an admin JWT: it does NOT use
// the admin revalidate endpoint. revalidation is already done by the
// caller via Next.js's own revalidatePath (which runs inside the
// cron's own route-handler context). This function ONLY probes the
// resulting public HTML to confirm the content flipped.
import 'server-only'
import type { VerificationEvidence } from './types'

export interface VerifyArgs {
  cardUrl:            string
  pollMaxAttempts:    number
  pollIntervalMs:     number
}

const USER_AGENT = 'PP-TCG-Migration-Verifier/1.0 (+server-side)'

async function probe(url: string): Promise<{ status: number; cache: string | null; age: string | null; body: string }> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': USER_AGENT },
  })
  const body = await res.text()
  return {
    status: res.status,
    cache: res.headers.get('x-vercel-cache'),
    age: res.headers.get('age'),
    body,
  }
}

export function parseSignals(body: string): {
  marketplace_panel_present: boolean
  faq_tcggraph_present:      boolean
  grade_ladder_has_psa10:    boolean
  provider_active:           boolean
} {
  const marketplace_panel_present = /Marketplace Snapshots/.test(body)
  const faq_tcggraph_present      = /TCGGraph.{0,10}realised-sale aggregation/.test(body)
  const grade_ladder_has_psa10    = /PSA\s*10<\/div>[\s\S]{0,400}>\$\d/.test(body)
  // Provider-active signal — matches the admin page's definition.
  const faq = body.match(/currently reads([^"]{0,200})/)?.[1] ?? ''
  const psa9InFaq = /PSA\s*9:/i.test(faq)
  const psa7MutedDash = /PSA\s*7<\/div><div[^>]*color:var\(--border\)[^>]*>—<\/div>/i.test(body)
  const provider_active = marketplace_panel_present || (faq.length > 0 && !psa9InFaq) || psa7MutedDash
  return { marketplace_panel_present, faq_tcggraph_present, grade_ladder_has_psa10, provider_active }
}

export interface VerifyResult {
  succeeded: boolean
  evidence:  VerificationEvidence
}

/** Poll the pilot URL until it reflects provider-active content.
 *  Returns success + full evidence jsonb for the run_item record. */
export async function verifyProviderActive(args: VerifyArgs): Promise<VerifyResult> {
  const started_at = Date.now()
  let last: {
    http_status:    number
    cache:          string | null
    age:            string | null
    signals:        ReturnType<typeof parseSignals>
  } | null = null

  for (let i = 1; i <= args.pollMaxAttempts; i++) {
    const r = await probe(args.cardUrl)
    const signals = parseSignals(r.body)
    last = { http_status: r.status, cache: r.cache, age: r.age, signals }
    if (signals.provider_active) {
      return {
        succeeded: true,
        evidence: {
          cache_status:               r.cache,
          age_sec:                    r.age ? Number(r.age) : null,
          http_status:                r.status,
          poll_attempts:              i,
          activation_duration_ms:     0,
          verification_duration_ms:   Date.now() - started_at,
          faq_tcggraph_present:       signals.faq_tcggraph_present,
          marketplace_panel_present:  signals.marketplace_panel_present,
          grade_ladder_has_psa10:     signals.grade_ladder_has_psa10,
          final_provider_active:      true,
          final_url:                  args.cardUrl,
        },
      }
    }
    if (i < args.pollMaxAttempts) await new Promise(resolve => setTimeout(resolve, args.pollIntervalMs))
  }
  return {
    succeeded: false,
    evidence: {
      cache_status:               last?.cache ?? null,
      age_sec:                    last?.age ? Number(last.age) : null,
      http_status:                last?.http_status ?? 0,
      poll_attempts:              args.pollMaxAttempts,
      activation_duration_ms:     0,
      verification_duration_ms:   Date.now() - started_at,
      faq_tcggraph_present:       last?.signals.faq_tcggraph_present ?? false,
      marketplace_panel_present:  last?.signals.marketplace_panel_present ?? false,
      grade_ladder_has_psa10:     last?.signals.grade_ladder_has_psa10 ?? false,
      final_provider_active:      false,
      final_url:                  args.cardUrl,
    },
  }
}

/** Verify a card has returned to LEGACY rendering (used after rollback). */
export async function verifyLegacyReturned(args: VerifyArgs): Promise<VerifyResult> {
  const started_at = Date.now()
  for (let i = 1; i <= args.pollMaxAttempts; i++) {
    const r = await probe(args.cardUrl)
    const signals = parseSignals(r.body)
    if (!signals.provider_active) {
      return {
        succeeded: true,
        evidence: {
          cache_status: r.cache, age_sec: r.age ? Number(r.age) : null, http_status: r.status,
          poll_attempts: i, activation_duration_ms: 0,
          verification_duration_ms: Date.now() - started_at,
          faq_tcggraph_present: signals.faq_tcggraph_present,
          marketplace_panel_present: signals.marketplace_panel_present,
          grade_ladder_has_psa10: signals.grade_ladder_has_psa10,
          final_provider_active: false, final_url: args.cardUrl,
        },
      }
    }
    if (i < args.pollMaxAttempts) await new Promise(resolve => setTimeout(resolve, args.pollIntervalMs))
  }
  return {
    succeeded: false,
    evidence: {
      cache_status: null, age_sec: null, http_status: 0,
      poll_attempts: args.pollMaxAttempts, activation_duration_ms: 0,
      verification_duration_ms: Date.now() - started_at,
      faq_tcggraph_present: false, marketplace_panel_present: false,
      grade_ladder_has_psa10: false, final_provider_active: true, final_url: args.cardUrl,
    },
  }
}
