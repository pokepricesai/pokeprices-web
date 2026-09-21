// src/lib/seo/bqClient.ts
// ============================================================================
// Shared BigQuery client factory for the SEO measurement warehouse.
//
// Two consumers today:
//   - src/lib/seo/pipeline/bqPageDaily.ts   (Google Search Console ingest)
//   - src/lib/seo/bing/**                   (Bing Webmaster ingest — Stage 5B)
//
// Auth
//   Production (Vercel):  OIDC → WIF → SA impersonation via @vercel/oidc +
//                         google-auth-library ExternalAccountClient. Needs
//                         GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID,
//                         GCP_WORKLOAD_IDENTITY_PROVIDER_ID,
//                         GCP_SERVICE_ACCOUNT_EMAIL.
//   Local dev:            Application Default Credentials via gcloud.
//
// Non-production Vercel environments (preview) are rejected because the WIF
// provider only trusts the production environment attestation.
// ============================================================================

import 'server-only'

export type BqContext = {
  bq: any
  authMode: string
  projectId: string
  location: string
}

export async function makeBigQueryClient(): Promise<BqContext> {
  const { BigQuery } = await import('@google-cloud/bigquery')
  const PROJECT_ID = process.env.SEO_BQ_PROJECT_ID
  const LOCATION   = process.env.SEO_BQ_LOCATION || 'EU'
  if (!PROJECT_ID) throw new Error('SEO_BQ_PROJECT_ID env var is not set')

  const IS_VERCEL = process.env.VERCEL === '1'
  const VERCEL_ENV = process.env.VERCEL_ENV || null
  const IS_VERCEL_PRODUCTION = IS_VERCEL && VERCEL_ENV === 'production'

  if (IS_VERCEL && !IS_VERCEL_PRODUCTION) {
    throw new Error(
      `Vercel environment '${VERCEL_ENV}' is not authorised for BigQuery. ` +
      'WIF provider currently allows only owner:lukepierce:project:pokeprices-web:environment:production.'
    )
  }

  if (IS_VERCEL_PRODUCTION) {
    const need = (n: string) => {
      const v = process.env[n]
      if (!v) throw new Error(`${n} env var is not set`)
      return v
    }
    const PROJECT_NUMBER = need('GCP_PROJECT_NUMBER')
    const POOL_ID        = need('GCP_WORKLOAD_IDENTITY_POOL_ID')
    const PROVIDER_ID    = need('GCP_WORKLOAD_IDENTITY_PROVIDER_ID')
    const SA_EMAIL       = need('GCP_SERVICE_ACCOUNT_EMAIL')

    const { getVercelOidcToken } = await import('@vercel/oidc')
    const { ExternalAccountClient } = await import('google-auth-library')

    const authClient = (ExternalAccountClient as any).fromJSON({
      type: 'external_account',
      audience:
        `//iam.googleapis.com/projects/${PROJECT_NUMBER}` +
        `/locations/global/workloadIdentityPools/${POOL_ID}` +
        `/providers/${PROVIDER_ID}`,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      token_url: 'https://sts.googleapis.com/v1/token',
      service_account_impersonation_url:
        `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts` +
        `/${SA_EMAIL}:generateAccessToken`,
      subject_token_supplier: {
        getSubjectToken: async () => {
          const token = await getVercelOidcToken()
          if (!token) throw new Error('Vercel OIDC token is empty')
          return token
        },
      },
    })
    return {
      bq: new (BigQuery as any)({ projectId: PROJECT_ID, authClient, location: LOCATION }),
      authMode: 'vercel-wif-production',
      projectId: PROJECT_ID,
      location: LOCATION,
    }
  }

  return {
    bq: new (BigQuery as any)({ projectId: PROJECT_ID, location: LOCATION }),
    authMode: 'adc-local',
    projectId: PROJECT_ID,
    location: LOCATION,
  }
}
