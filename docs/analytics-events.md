# Analytics events (PokePrices v2 Block 2B)

The single source of truth for this codebase. Every event flows through
`src/lib/analytics.ts`. Feature code must call `trackEvent(name, params)`
— direct `gtag()` calls anywhere else in `src/**` are a regression.

## Auto-attached dimensions

Every event automatically carries:

- `auth_state` — `anonymous` | `authenticated`
- `user_plan`  — `anonymous` | `free` | `pro` (no paid tier exists yet, so authenticated users currently resolve to `free`)
- `page_type`  — derived from `window.location.pathname` via `classifyPageType`

`signup_completed` and `affiliate_click` also receive first-touch and
last-touch UTM dimensions via `trackEventWithAttribution`.

## PII exclusions enforced at runtime

The sanitiser drops any parameter whose lower-cased name matches:

`email`, `email_address`, `emailaddress`, `user_id`, `userid`, `uid`,
`display_name`, `name`, `password`, `pw`, `secret`, `token`,
`access_token`, `refresh_token`, `session`, `jwt`, `prompt`, `question`,
`query_text`, `query`, `message`, `response_text`, `notes`, `note`,
`purchase_price`, `price_paid`, `price`, `portfolio_value`,
`collection_value`, `total_value`, `address`, `phone`.

Strings are truncated at 100 characters. Arrays, plain objects, and
functions are dropped (never serialised). A development-only
`console.warn` surfaces the offending parameter name during QA — its
value is never logged.

## Event catalogue

### Auth

| Event | Purpose | Parameters | Example |
|---|---|---|---|
| `signup_started` | User initiated a signup flow. | `auth_method`, `return_context`, `source_component` | `{ auth_method: 'google', return_context: 'watchlist', source_component: 'login_google' }` |
| `signup_completed` | New account created (recommend as GA4 key event). Attribution attached. | `auth_method`, `return_context` | `{ auth_method: 'email_password', return_context: 'direct', ft_utm_source: 'newsletter' }` |
| `login_completed` | Existing user signed in. | `auth_method`, `return_context` | `{ auth_method: 'email_password', return_context: 'portfolio' }` |
| `logout_completed` | User signed out. | `source_component` | `{ source_component: 'navbar' }` |
| `auth_callback_failed` | The `/auth/callback` route returned an error. | `failure_stage` | `{ failure_stage: 'callback' }` |
| `password_reset_requested` | User clicked "Forgot password" and submitted. | `source_component` | `{ source_component: 'login_forgot_password' }` |
| `password_reset_completed` | New password successfully saved on `/auth/reset-password`. | `source_component` | `{ source_component: 'reset_password_form' }` |

Implementation: `src/app/dashboard/login/page.tsx`, `src/components/Navbar.tsx`, `src/app/auth/reset-password/ResetPasswordClient.tsx`.

### Watchlist

| Event | Purpose | Parameters |
|---|---|---|
| `watchlist_add_attempt` | User clicked save (or a logged-out save that will round-trip via login). | `card_slug`, `set_slug`, `source_component` |
| `watchlist_add_success` | Insert into `watchlist` confirmed. (GA4 key-event candidate.) | `card_slug`, `set_slug`, `source_component` |
| `watchlist_remove` | Item removed. | `card_slug`, `set_slug`, `source_component` |
| `watchlist_replay_after_auth` | The Block 2A intended-action mechanism fired on mount. | `card_slug`, `set_slug` |

Implementation: `src/components/CardQuickActions.tsx`.

### Portfolio

| Event | Purpose | Parameters |
|---|---|---|
| `portfolio_add_attempt` | "Add to portfolio" clicked. | `card_slug`, `source_component` |
| `portfolio_add_success` | Insert into `portfolio_items` confirmed. (GA4 key-event candidate.) | `card_slug`, `holding_type`, `grading_company`, `grade`, `source_component` |
| `portfolio_item_updated` | (Reserved for future surfaces.) | `card_slug`, `holding_type`, `source_component` |
| `portfolio_item_removed` | (Reserved for future surfaces.) | `card_slug`, `holding_type`, `source_component` |

Quantity, purchase price, currency, manual value and notes are never sent.

### Card shows

| Event | Purpose | Parameters |
|---|---|---|
| `card_show_favourite_attempt` | Star clicked (logged-in or logged-out). | `show_id`, `country_code`, `source_component` |
| `card_show_favourite_success` | Row inserted into `card_show_stars`. (GA4 key-event candidate.) | `show_id`, `country_code`, `source_component` |
| `card_show_unfavourite` | Row deleted. | `show_id`, `country_code`, `source_component` |
| `card_show_replay_after_auth` | Block 2A intended-action mechanism fired. | `show_id`, `country_code` |

Implementation: `src/app/card-shows/StarButton.tsx`.

### AI assistant

| Event | Purpose | Parameters |
|---|---|---|
| `ai_question_submitted` | User pressed Send. **Question text is intentionally not sent.** | `source_component` |
| `ai_response_received` | Smart-endpoint returned a non-error response. | `query_type`, `response_status`, `card_found` |
| `ai_error` | Network or endpoint error. | `failure_stage`, `response_status` |
| `ai_card_clicked` | (Reserved — wire once card-link click handlers are centralised.) | `card_slug`, `query_type`, `source_component` |
| `ai_ebay_clicked` | (Reserved — wire once eBay-link click handlers are centralised in AI answers.) | `card_slug`, `marketplace`, `intent`, `source_component` |

Implementation: `src/components/InlineChat.tsx`.

### Affiliate

| Event | Purpose | Parameters |
|---|---|---|
| `affiliate_link_view` | First time at least 50% of an affiliate placement entered the viewport (per mount). | `card_slug`, `set_slug`, `placement`, `marketplace`, `intent`, `grading_company`, `grade`, `language`, `custom_tracking_id`, `source_component` |
| `affiliate_click` | User clicked an affiliate link. (GA4 key-event candidate.) Attach attribution via `trackEventWithAttribution` for higher-fidelity reporting in a future commerce block. | same as above |

Implementation: `src/components/EbayLiveListings.tsx`, `src/components/CardQuickActions.tsx`. Block 2B does **not** add any new placements.

#### `placement` values used today

- `card_page_chips` — the four chips in `CardQuickActions` (UK raw, US raw, UK sold, US sold).
- `unknown` — `EbayLiveListings` without an explicit `placement` prop.
- `inline` — `EbayInlineLink` without an explicit `placement` prop.

Callers that already know their context can pass `placement / intent / cardSlug / setSlug / sourceComponent` to the affiliate components without changing the UI.

### Account / dashboard

| Event | Purpose | Parameters |
|---|---|---|
| `dashboard_view` | Entered a `/dashboard/*` route. Fired by `AnalyticsInit` on route change. | `feature_name`, `source_component` |
| `profile_saved` | Profile updated successfully via Settings. | `source_component` |
| `settings_saved` | Email-pref / currency / cadence change persisted. | `feature_name`, `source_component` |
| `account_feature_view` | (Reserved for future per-feature tracking.) | `feature_name`, `source_component` |

### Vendor

| Event | Purpose | Parameters |
|---|---|---|
| `vendor_submission_started` | "Submit for Review" clicked. | `country_code`, `vendor_type` |
| `vendor_submission_completed` | Server route returned a `vendorId`. (GA4 key-event candidate.) | `country_code`, `vendor_type`, `has_logo` |
| `vendor_logo_upload_success` | Logo committed via `/api/vendor-logo-upload`. | `vendor_type` |
| `vendor_logo_upload_failed` | Logo upload failed (covers both first attempt and retry). | `vendor_type`, `failure_stage` |

Implementation: `src/app/vendors/submit/VendorSubmitClient.tsx`.

## Recommended GA4 key events (conversions)

Set these manually in GA4 → Admin → Events → Mark as key event:

- `signup_completed`
- `watchlist_add_success`
- `portfolio_add_success`
- `card_show_favourite_success`
- `affiliate_click`
- `vendor_submission_completed`

## Recommended GA4 custom dimensions

These are **registered manually** in GA4 → Admin → Custom definitions → Custom dimensions. None of them is created automatically by code; the dimension only becomes useful once registered.

Scope `event` unless noted otherwise.

| Dimension | Parameter | Notes |
|---|---|---|
| Auth state | `auth_state` | `anonymous` / `authenticated` |
| User plan  | `user_plan`  | `anonymous` / `free` / `pro` |
| Page type  | `page_type`  | `card`, `set`, `pokemon`, … |
| Auth method | `auth_method` | `google`, `email_password`, `magic_link`, … |
| Return context | `return_context` | `watchlist`, `portfolio`, … |
| Card slug | `card_slug` | URL slug only — never a user-readable card name |
| Set slug | `set_slug` | |
| Placement | `placement` | Affiliate placement identifier |
| Marketplace | `marketplace` | `UK`, `US`, `EU`, … |
| Intent | `intent` | `raw`, `psa10`, `sold_search`, … |
| Grading company | `grading_company` | |
| Grade | `grade` | |
| Custom tracking ID | `custom_tracking_id` | The eBay `customid` we passed. Useful for EPN reconciliation. |
| Source component | `source_component` | Free-text component label |
| Feature name | `feature_name` | e.g. `weekly_digest_enabled` |
| Show ID | `show_id` | Card show identifier |
| Country code | `country_code` | ISO 3166-1 alpha-2 (vendor / show) |
| Vendor type | `vendor_type` | |
| Has logo | `has_logo` | `yes` / `no` |
| Failure stage | `failure_stage` | |
| Query type | `query_type` | AI classifier output |
| Response status | `response_status` | `ok`, `http_400`, `network_error` |
| Card found | `card_found` | `yes` / `no` |
| First-touch UTM | `ft_utm_source`, `ft_utm_medium`, `ft_utm_campaign`, `ft_utm_content`, `ft_utm_term` | Attached only to `signup_completed` and `affiliate_click` |
| Last-touch UTM | `lt_utm_source`, `lt_utm_medium`, `lt_utm_campaign`, `lt_utm_content`, `lt_utm_term` | same |
| First-touch referrer domain | `ft_referrer_domain` | hostname only |
| Last-touch referrer domain | `lt_referrer_domain` | hostname only |

## Proposed EPN custom-id v2 (documented only)

Current state: `ebayAffiliate.ts` accepts a freeform `customId` string. Today the helper is called with values like the bare `card_slug` or `mover-<slug>` / `set-<setName>` / `pokemon-<slug>`. These already appear in live EPN reports and **must not** be retroactively renamed.

For the next affiliate block, the proposed v2 schema:

```
pp:<placement>:<intent>:<marketplace>:<page_type>:<ref>
```

Where:

- `pp` — fixed prefix, helps EPN report filtering.
- `placement` — short slug (`card_chips`, `inline_mover`, `set_hero`, …).
- `intent` — `raw`, `psa10`, `sold`, `set`, `pokemon`, …
- `marketplace` — `uk`, `us`, …
- `page_type` — `card`, `set`, `pokemon`, …
- `ref` — `card_slug` or `set_slug` or `pokemon_slug`.

Constraints to respect:
- eBay Partner Network allows up to 256 characters; `:`-delimited fields keep this readable and well under the cap.
- No PII (no email, no user identifier).
- Deterministic so the same card on the same placement always produces the same custom-id, enabling clean joins.
- Compatibility: the affiliate optimisation block should ship v2 alongside v1 for at least one EPN reporting cycle. The helper can accept a v1 fallback per placement until the reconciliation window passes.

This block does **not** change any affiliate URL. The schema lives here for the next block to pick up.

## Manual QA — GA4 DebugView

GA4 only shows events in DebugView when the browser is in debug mode.

1. In production, append `?gtm_debug=x` (or use the Chrome **GA Debugger** extension) — DebugView will list events live.
2. From the **Sign in** page, perform each flow (Google, email, magic link, recovery). Watch for `signup_started`, `login_completed`, `signup_completed`, `password_reset_requested`, `password_reset_completed`.
3. From a card page (logged out and logged in), click **Watch** and each eBay chip. Expect `watchlist_add_attempt`, `watchlist_add_success`, `affiliate_link_view`, `affiliate_click`.
4. From a card-show page, click ★. Expect `card_show_favourite_attempt`, `card_show_favourite_success`.
5. From a card page, open the AI assistant; submit one question. Expect `ai_question_submitted`, `ai_response_received`.
6. From `/vendors/submit`, fill the form and submit. Expect `vendor_submission_started`, `vendor_submission_completed`, `vendor_logo_upload_success` (when a logo was uploaded).
7. From `/dashboard/settings`, change profile + email-prefs. Expect `profile_saved` and `settings_saved`.

### Local debug

- Open DevTools, run `localStorage.setItem('pp_analytics_debug', '1')`. Every event is logged via `console.debug`. Run `localStorage.removeItem('pp_analytics_debug')` to turn it off.
- To verify a build without polluting production GA4, run `localStorage.setItem('pp_analytics_local_only', '1')`. Events still appear in the console but no `gtag('event', …)` call is made.

## Consent and compliance

Block 2B does **not** introduce a cookie banner or consent management. Today the only client storage is the two attribution keys (`pp_first_touch_v1`, `pp_last_touch_v1`) and the GA4 default cookies set by `gtag.js`. A formal compliance review is documented as a future follow-up before paid marketing scales.
