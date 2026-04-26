# Dashboard tools — deployment notes

Three new logged-in tools live under `/dashboard`:
- `/dashboard/portfolio` — existing portfolio (moved from `/portfolio`)
- `/dashboard/watchlist` — new
- `/dashboard/alerts` — new
- `/dashboard/settings` — email preferences

## 1. Apply the database migration

In the Supabase SQL editor, run:
```
supabase/migrations/20260426_dashboard_tools.sql
```

This creates `watchlist`, `user_alerts`, `user_email_preferences`, `pending_emails`, plus two RPCs (`get_watchlist_with_prices`, `get_alerts_with_prices`) and a helper (`ensure_email_preferences`). All tables have RLS scoped to `auth.uid()`.

## 2. Set up Resend

1. Sign up at resend.com
2. Add and verify the domain `pokeprices.io` (DKIM + return-path records)
3. Create an API key

## 3. Add Supabase Edge Function secrets

In Supabase Studio → Project Settings → Edge Functions → Secrets, add:
- `RESEND_API_KEY` — from step 2
- `EMAIL_FROM` — `PokePrices <noreply@pokeprices.io>` (or whatever domain you verified)
- `PUBLIC_SITE_URL` — `https://www.pokeprices.io`
- `ALERTS_TRIGGER_SECRET` — any long random string; used by the scraper to call `evaluate-alerts`

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already injected by Supabase.

## 4. Deploy the edge functions

From the project root:
```
supabase functions deploy evaluate-alerts
supabase functions deploy send-pending-emails
supabase functions deploy enqueue-weekly-digest
```

## 5. Schedule the jobs

Recommended schedule (use Supabase's built-in cron or your existing GH Actions):

| Function | Cadence | Purpose |
|---|---|---|
| `evaluate-alerts` | After each nightly price refresh | Find triggered alerts, queue emails |
| `send-pending-emails` | Every 10 minutes | Drain the email queue (Resend) |
| `enqueue-weekly-digest` | Sunday 09:00 UK time | Build weekly digest payloads for opted-in users |

### Option A — Supabase pg_cron (cleanest)

Run once in SQL editor:

```sql
-- Send queued emails every 10 min
SELECT cron.schedule(
  'send-pending-emails',
  '*/10 * * * *',
  $$ SELECT net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/send-pending-emails',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
  ) $$
);

-- Weekly digest, Sunday 09:00 UTC
SELECT cron.schedule(
  'enqueue-weekly-digest',
  '0 9 * * 0',
  $$ SELECT net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/enqueue-weekly-digest',
    headers := jsonb_build_object('Authorization', 'Bearer <SERVICE_ROLE_KEY>')
  ) $$
);
```

### Option B — call from the existing scraper

In your nightly scraper (`pokeprices` repo), after price upserts complete, add:

```bash
curl -X POST \
  -H "Authorization: Bearer $ALERTS_TRIGGER_SECRET" \
  https://<your-project-ref>.supabase.co/functions/v1/evaluate-alerts
```

This way alerts evaluate exactly when fresh prices land. The send-pending-emails cron then picks up queued mails on its next tick.

## 6. Auth redirect URLs

In Supabase Studio → Authentication → URL Configuration, add:
- `https://www.pokeprices.io/dashboard/**` to allowed redirects
- (Old `https://www.pokeprices.io/portfolio` can be left for now — it's harmless)

## 7. Test before announcing

- Sign in via `/dashboard/login`
- Add a card to watchlist via the new "Watch" button on a card page
- Create an alert with a threshold the current price already crosses
- Manually trigger evaluate-alerts: should mark it triggered + queue an email
- Manually trigger send-pending-emails: should send via Resend, you receive it
- Click the unsubscribe link at the bottom: should disable both flags in `user_email_preferences`
