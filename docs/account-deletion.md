# Account deletion

State at 2026-06-15. Block 2A intentionally does NOT build automated
self-service deletion. The settings UI already calls out the current
support-based process honestly:

> Removes your watchlist, alerts and portfolio. Email contact@pokeprices.io
> to fully delete the auth record.

This document is the inventory and the proposed design that a later
block can implement.

## What "delete account" must touch

For a single user identified by `auth.users.id = U`:

### Cascade-deleted by ON DELETE CASCADE on `auth.users`

- `public.profiles` (Block 2A)
- `public.watchlist`
- `public.user_alerts`
- `public.user_email_preferences`
- `public.card_show_stars`
- `public.pending_emails`

### Deleted only when the parent row is deleted

- `public.portfolios` where `user_id = U`
- `public.portfolio_items` where `portfolio_id` belongs to U (cascade
  from `portfolios.id`)
- `public.vendor_upload_tokens` rows pointing at a vendor row authored
  by U (rare — vendor submissions are anonymous)

### Not associated with the user

- `public.vendors` is anonymous in the current submission flow; there
  is no user_id to delete against.
- `public.social_content_posts` is admin-authored, not user-owned.
- `public.scan_logs` carries `user_id` and `device_id`; the user_id rows
  should be deleted but device_id rows of the same user are not
  identifiable without the device_id.

### Storage

- `vendor-logos/pending/*.{png,jpg,webp}` — orphaned uploads from
  vendor submissions. Not tied to any auth user.
- Any future avatar storage path — none today; avatars are picked
  from a fixed sprite set referenced via `user_metadata.avatar_pokemon_id`
  and Block 2A's `profiles.avatar_key` placeholder.

### Auth records

- `auth.users` itself — must be deleted via the Supabase Admin API
  using the service-role key. The Next.js `/api/admin/...` surface does
  not currently expose this. A dedicated `/api/account/delete` route
  guarded by a one-shot confirmation token is the natural future home.

## Proposed future design (NOT Block 2A)

1. New route `POST /api/account/delete-request` — verified Supabase
   session required, issues a single-use email confirmation link with a
   10-minute expiry stored in a new `account_delete_tokens` table.
2. The email link routes to `GET /api/account/delete?token=…`, which:
   - Verifies the token and matches the current session's `auth.uid()`.
   - Calls `supabase.auth.admin.deleteUser(user.id)` under the
     service-role helper. The cascade rules then take down all the rows
     listed above.
   - Best-effort sweeps `scan_logs` rows for `user_id = U`.
   - Signs the user out client-side.
3. UI in settings replaces the current "email support" copy with a
   real "Delete account" button and a confirmation modal.
4. Compliance: a "data export" button (CSV / JSON dump of watchlist,
   alerts, portfolio, profile) is the partner of "delete". Out of
   scope for this design.

## Why this is deferred

- The cascade rules currently in place are correct only for the
  `auth.users`-referenced tables. Portfolios and portfolio_items were
  created outside this repository (per Block 1A inspection) and their
  ON DELETE rules have not been read by this codebase. A self-service
  deletion that did not also remove the user's portfolio would be
  worse than the support flow.
- Confirming the portfolios cascade is a one-line check (`pg_constraint`
  inspection) but it is best paired with the work to wire the deletion
  route, not as a standalone change.

Until Block 2B (or whichever block lands self-service deletion), the
settings UI continues to direct the user to `contact@pokeprices.io`. The
copy in `SettingsClient.tsx` was already honest about this; no change
is required for Block 2A.
