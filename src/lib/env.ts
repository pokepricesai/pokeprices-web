// src/lib/env.ts
// ============================================================================
// Central catalogue + lazy accessors for environment variables.
//
// Design goals
//   * One place to learn what every env var is for, who reads it, and
//     whether it is required.
//   * Lazy reads only — does NOT crash on import; static generation
//     remains unaffected even if a runtime-only secret is absent at
//     build time.
//   * Error messages name the variable but never echo its value.
//   * Public (NEXT_PUBLIC_*) vs. server-only vars are tagged so static
//     analysis can spot accidental client-bundle imports of server-only
//     accessors.
//
// This module is safe to import from anywhere. The catalogue itself
// contains no values. The accessors return strings only when the caller
// asks for them.
// ============================================================================

export type EnvScope = 'public' | 'server'

export type EnvVarSpec = {
  name:        string
  scope:       EnvScope
  required:    boolean
  description: string
  /**
   * Optional default value used by the OPTIONAL accessors when the var
   * is absent. Never used for required vars. Never a secret.
   */
  fallback?: string
}

// ── Catalogue ──────────────────────────────────────────────────────────────
// The single source of truth for every env var the app currently reads.
// Keep names in lock-step with .env.example.

export const ENV_CATALOGUE: ReadonlyArray<EnvVarSpec> = [
  // ── Public (shipped to the browser) ──
  {
    name:        'NEXT_PUBLIC_SUPABASE_URL',
    scope:       'public',
    required:    true,
    description: 'Supabase REST + Auth + Storage base URL. Read by both the public client and the server service-role client.',
  },
  {
    name:        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    scope:       'public',
    required:    true,
    description: 'Supabase anon JWT for public reads and Auth flows.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_UK',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network UK campaign ID. Missing → affiliate links render with empty campid.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_US',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network US campaign ID. Missing → affiliate links render with empty campid.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_CA',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network Canada campaign ID. Block 2D — populating this activates the Canadian marketplace in the resolver; missing → marketplace stays hidden in the selector.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_AU',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network Australia campaign ID. Block 2D — populating this activates the Australian marketplace.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_DE',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network Germany campaign ID. Block 2D — populating this activates the German marketplace.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_FR',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network France campaign ID. Block 2D — populating this activates the French marketplace.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_IT',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network Italy campaign ID. Block 2D — populating this activates the Italian marketplace.',
  },
  {
    name:        'NEXT_PUBLIC_EBAY_CAMPID_ES',
    scope:       'public',
    required:    false,
    description: 'eBay Partner Network Spain campaign ID. Block 2D — populating this activates the Spanish marketplace.',
  },
  {
    name:        'NEXT_PUBLIC_GA4_MEASUREMENT_ID',
    scope:       'public',
    required:    false,
    description: 'GA4 Measurement ID. Currently hard-coded in src/app/layout.tsx; documented here for future migration.',
    fallback:    'G-91WBNN7V11',
  },
  {
    name:        'NEXT_PUBLIC_SITE_URL',
    scope:       'public',
    required:    false,
    description: 'Canonical site origin. Falls back to https://www.pokeprices.io.',
    fallback:    'https://www.pokeprices.io',
  },
  {
    name:        'NEXT_PUBLIC_ADMIN_PASSWORD',
    scope:       'public',
    required:    false,
    description: 'Legacy UI-only password for /admin/content-studio. Holds no security authority after Block 1A.',
  },
  {
    name:        'NEXT_PUBLIC_CONTENT_STUDIO_FN_SLUG',
    scope:       'public',
    required:    false,
    description: 'Optional override for the Supabase Edge Function slug behind Content Studio.',
    fallback:    'smooth-responder',
  },

  // ── Server-only ──
  {
    name:        'SUPABASE_URL',
    scope:       'server',
    required:    false,
    description: 'Alternative Supabase base URL used by some edge functions. Web app uses NEXT_PUBLIC_SUPABASE_URL.',
  },
  {
    name:        'SUPABASE_SERVICE_ROLE_KEY',
    scope:       'server',
    required:    true,
    description: 'Service-role JWT. REQUIRED by /api/vendors/submit, /api/vendor-logo-upload, /api/unsubscribe, /api/admin/content-studio/posts. Production outage if missing.',
  },
  {
    name:        'ADMIN_ALLOWED_EMAILS',
    scope:       'server',
    required:    false,
    description: 'Comma-separated lower-case emails authorised to mutate via /api/admin/content-studio/posts. Empty → admin mutations refused with 503.',
  },
  {
    name:        'INTEL_PASSWORD',
    scope:       'server',
    required:    false,
    description: 'Shared password gating /intel/* via middleware. Defaults to the literal "pokeprices" if absent — set this in production.',
    fallback:    'pokeprices',
  },
  {
    name:        'VENDOR_DAILY_IP_SALT',
    scope:       'server',
    required:    false,
    description: 'Optional salt mixed into the SHA-256 IP hash on vendor_upload_tokens.created_ip_hash. Forensics only.',
    fallback:    'v1',
  },
  {
    name:        'ALERTS_TRIGGER_SECRET',
    scope:       'server',
    required:    false,
    description: 'Bearer secret accepted by the Supabase edge function evaluate-alerts. Set on the cron caller, not the web app.',
  },

  // ── Server-only (consumed only by Supabase Edge Functions, not Next) ──
  // Documented here so the catalogue is complete even though the web
  // app does not read them.
  {
    name:        'CLAUDE_API_KEY',
    scope:       'server',
    required:    false,
    description: 'Anthropic API key. Read by edge functions smart-endpoint, content-studio-generate, scan-card. Not read by the Next app.',
  },
  {
    name:        'OPENAI_API_KEY',
    scope:       'server',
    required:    false,
    description: 'OpenAI API key. Read only by content-studio-generate for AI image actions. Optional.',
  },
  {
    name:        'GOOGLE_VISION_API_KEY',
    scope:       'server',
    required:    false,
    description: 'Google Cloud Vision API key. Read only by the scan-card edge function.',
  },
  {
    name:        'RESEND_API_KEY',
    scope:       'server',
    required:    false,
    description: 'Resend transactional email API key. Read only by the send-pending-emails edge function.',
  },
]

const CATALOGUE_BY_NAME: ReadonlyMap<string, EnvVarSpec> = new Map(
  ENV_CATALOGUE.map(spec => [spec.name, spec]),
)

// ── Accessors ──────────────────────────────────────────────────────────────

/**
 * Returns the value of a REQUIRED server-only env var, or throws an
 * Error whose message names the variable (never its value).
 *
 * Server-only by convention; safe to call from route handlers / lib
 * modules guarded by `import 'server-only'`. Public vars should use
 * `getRequiredPublicEnv` instead.
 */
export function getRequiredServerEnv(name: string): string {
  const spec = CATALOGUE_BY_NAME.get(name)
  if (spec && spec.scope !== 'server') {
    throw new Error(`env: ${name} is a public var; use getRequiredPublicEnv`)
  }
  const v = process.env[name]
  if (v && v.length > 0) return v
  throw new Error(`env: ${name} is not set`)
}

/**
 * Returns the value of a REQUIRED public env var, or throws naming the
 * variable. Public env vars are inlined into the client bundle at build
 * time by Next.
 */
export function getRequiredPublicEnv(name: string): string {
  const spec = CATALOGUE_BY_NAME.get(name)
  if (spec && spec.scope !== 'public') {
    throw new Error(`env: ${name} is a server-only var; use getRequiredServerEnv`)
  }
  const v = process.env[name]
  if (v && v.length > 0) return v
  throw new Error(`env: ${name} is not set`)
}

/**
 * Returns the env value if present and non-empty, otherwise the
 * fallback (the spec's documented fallback if none is passed).
 *
 * Does NOT throw, regardless of scope.
 */
export function getOptionalEnv(name: string, fallback?: string): string | undefined {
  const v = process.env[name]
  if (v && v.length > 0) return v
  if (fallback !== undefined) return fallback
  const spec = CATALOGUE_BY_NAME.get(name)
  return spec?.fallback
}

/**
 * Reports which REQUIRED variables (server + public) are currently
 * missing. Use only in diagnostic contexts (a script, a health-check
 * endpoint). Returns variable NAMES — never values.
 *
 * Does not throw.
 */
export function missingRequiredEnvNames(): string[] {
  const out: string[] = []
  for (const spec of ENV_CATALOGUE) {
    if (!spec.required) continue
    const v = process.env[spec.name]
    if (!v || v.length === 0) out.push(spec.name)
  }
  return out
}
