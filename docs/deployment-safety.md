# Deployment safety

A working note for PokePrices v2. Short, opinionated, kept in-repo so it
moves with the code.

## How Vercel deployments work today

- The repository is connected to a single Vercel project. Pushes to
  `main` trigger an automatic Production deployment. Pushes to any other
  branch (or any PR targeting `main`) trigger a Preview deployment under
  a temporary URL.
- There is **no GitHub Actions workflow** in this repository. Branch
  protection and CI live entirely inside Vercel's build pipeline plus
  the build's exit code.

## Environment-variable scopes Vercel uses

Vercel scopes env vars to one or more of: **Production, Preview,
Development**. The Block 1A audit catalogued every var the app reads;
the current categorisation lives in `src/lib/env.ts` and `.env.example`.

The variables that MUST be present in Production for the routes added
in Blocks 1A and 1B to function are:

| Variable                       | Scopes      | Used by |
|--------------------------------|-------------|---------|
| `NEXT_PUBLIC_SUPABASE_URL`     | All         | Every page and route |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`| All         | Every page and route |
| `SUPABASE_SERVICE_ROLE_KEY`    | Production + Preview | `/api/vendors/submit`, `/api/vendor-logo-upload`, `/api/unsubscribe`, `/api/admin/content-studio/posts` |
| `ADMIN_ALLOWED_EMAILS`         | Production + Preview | `/api/admin/content-studio/posts` |
| `INTEL_PASSWORD`               | Production            | middleware gate on `/intel/*` |

Optional vars (eBay campids, Vendor IP salt, etc.) are listed in
`.env.example` with their fallbacks.

## Known gap: Preview points at production Supabase

There is no separate Supabase project for Preview deployments today.
Unless explicit dev/staging credentials are set on the Preview scope,
Preview builds talk to the **production database**. That means:

- A Preview PR's submission test creates real rows in production.
- A Preview PR's destructive scripts can affect production data.

This is documented as a follow-up to address with either:

1. A dedicated dev/staging Supabase project + Preview-scoped env vars, or
2. A Vercel "production read-only" connection while staging is being
   set up.

Until either lands, treat Preview as if it were Production for any
write path.

## Identifying Production vs Preview at runtime

`process.env.VERCEL_ENV` is set by Vercel:

- `production` — the Production deployment.
- `preview` — every PR / branch Preview.
- `development` — `vercel dev` locally.

Logs should include this when relevant.

## Testing migrations safely

1. Take a current snapshot of production data (Supabase → Database →
   Backups, or `pg_dump` over `psql`).
2. Apply the migration to a dev/staging Supabase project first if one
   exists, otherwise read the migration carefully and dry-run it inside
   a transaction:

   ```sql
   BEGIN;
   -- paste migration here
   ROLLBACK;
   ```

3. Inspect `RAISE NOTICE` output. The Block 1A/B migrations emit
   structured notices.
4. Apply to production only after the application code that depends on
   the migration is live, unless the migration is purely additive (new
   column, new table, new function).

The Block 1B `2026-06-15-vendors-rls-enable.sql` migration carries a
blocking `RAISE EXCEPTION` if any unexpected policy is present.

## Never run against production

- `scripts/verify-security.mjs`, `scripts/verify-vendor-security.mjs`,
  and any future `scripts/verify-*.mjs` script: refuse to run unless
  `VERIFY_ALLOW_NON_PRODUCTION=1` AND the configured `SUPABASE_URL`
  does not match the known production hostname.
- Vitest tests: do not call live Supabase. The current suite uses
  `vi.stubEnv` and pure helpers only.

## Deployment checklist

For any block that introduces new server-side env vars or database
migrations:

1. Open the PR. Read the `Files changed` tab in full.
2. Confirm the Vercel Preview build is **green**.
3. Confirm any new required env var is set in **Production** and
   **Preview** scopes of the Vercel project.
4. Apply any additive migration in the Supabase SQL editor.
5. Merge to `main`. Wait for Vercel Production deploy to reach **Ready**.
6. Apply any tightening migration in the Supabase SQL editor.
7. Smoke-test the most relevant public route, the dashboard, and any
   route added or changed in the block.
8. Tag the commit with the block name (e.g. `block-1b-deployed`) for
   easy rollback reference.

## Rollback checklist

1. Identify the last known-good commit by tag or hash.
2. `git revert <range>` — prefer a forward revert commit over a
   force-push. Push to `main`.
3. Wait for the Vercel Production deploy to reach **Ready**.
4. Decide whether to keep the database changes (preferred) or roll
   them back. The Block 1A/B migrations were designed so the safer
   choice is to keep the tighter RLS posture and revert only the code.
5. If a tightening migration must be rolled back, the rollback SQL is
   at the foot of the migration file. The migration files explicitly
   refuse to restore previously-insecure policies; restore them by
   hand only with a documented time-bound exception.

## Things this document does not cover (yet)

- Distributed rate limiting.
- A real staging Supabase project.
- Stripe / paid plans.
- Email lifecycle ownership.
- CI lint/typecheck/test gates.

## Edge Function type-checking

`npm run typecheck:edge:diagnostic` runs the TypeScript compiler against
`supabase/functions/**`. It is informational only: the TS compiler does
not understand the Deno `Deno` global, `jsr:` imports or `https://…`
URL imports, so it will always report many runtime-resolution errors.
Do **not** treat that script as a pass/fail deploy gate.

The authoritative way to type-check the Supabase Edge Functions is the
Supabase CLI:

```
supabase functions verify smart-endpoint
```

or, inside a Deno environment:

```
deno check supabase/functions/smart-endpoint/index.ts
```
