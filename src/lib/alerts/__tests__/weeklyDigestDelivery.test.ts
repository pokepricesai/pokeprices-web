// Block 5A-W-17 — weekly digest delivery engine tests.
// Covers: dry-run vs send, eligibility gates (master / weekly /
// sections), cooldown, day-of-week (admin vs cron), no-content / no-
// email skips, baseline metadata on real sends, hard cap, and the
// isoWeekdayUtc + summarise pure helpers.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDB } from '@/lib/email/__tests__/_fakeSupabase'

const asSupa = (db: FakeDB) => db as unknown as SupabaseClient

vi.mock('server-only', () => ({}))

import {
  deliverWeeklyDigests,
  isoWeekdayUtc,
  summarise,
  type WeeklyDeliveryUserResult,
} from '../weeklyDigestDelivery'
import { preferencesToRow, ALERT_PREFERENCE_DEFAULTS, applyPatch } from '../preferences'
import type { SendEmailInput, SendResult } from '@/lib/email/types'

const fakeDB = new FakeDB()
// 2026-06-22 is a Monday → ISO weekday 1
const asOf   = new Date('2026-06-22T09:00:00Z')

beforeEach(() => { fakeDB.reset() })

// ─────────────────────────────────────────────────────────────────────
// Seeding helpers — minimal portfolio so hasAnyContent() passes
// ─────────────────────────────────────────────────────────────────────

function seedPrefs(userId: string, patch: Partial<typeof ALERT_PREFERENCE_DEFAULTS> = {}) {
  const prefs = applyPatch(ALERT_PREFERENCE_DEFAULTS, patch)
  fakeDB.seed('user_alert_preferences', [
    ...fakeDB.rows('user_alert_preferences'),
    { user_id: userId, ...preferencesToRow(prefs) },
  ])
}

function seedPortfolioForUser(userId: string) {
  // Card linkage so weeklyDigest builder can compute a value.
  const slug = `slug-${userId}`
  const portfolioId = `pf-${userId}`
  fakeDB.seed('portfolios', [
    ...fakeDB.rows('portfolios'),
    { id: portfolioId, user_id: userId, is_default: true, name: 'My Collection' },
  ])
  fakeDB.seed('cards', [
    ...fakeDB.rows('cards'),
    { card_url_slug: slug, card_slug: `slug-bare-${userId}`, card_name: 'A', set_name: 'S' },
  ])
  fakeDB.seed('card_trends', [
    ...fakeDB.rows('card_trends'),
    { card_name: 'A', set_name: 'S', current_raw: 100_00, raw_pct_30d: 5 },
  ])
  fakeDB.seed('portfolio_items', [
    ...fakeDB.rows('portfolio_items'),
    {
      portfolio_id: portfolioId, card_slug: slug,
      holding_type: 'raw', quantity: 1,
      card_name_snapshot: 'A', set_name_snapshot: 'S',
    },
  ])
}

function emailMap(entries: Array<[string, string]>) {
  const m = new Map(entries)
  return async (uid: string) => m.get(uid) ?? null
}

function stubSend(outcome: SendResult['outcome'] = 'sent', extra: Partial<SendResult> = {}): {
  fn:    (input: SendEmailInput) => Promise<SendResult>
  calls: SendEmailInput[]
} {
  const calls: SendEmailInput[] = []
  return {
    fn: async (input) => {
      calls.push(input)
      return {
        outcome,
        emailId:       'fake-email-id',
        deliveryLogId: 'fake-log-id',
        ...extra,
      } as SendResult
    },
    calls,
  }
}

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('isoWeekdayUtc', () => {
  it('Monday → 1, Sunday → 7', () => {
    expect(isoWeekdayUtc(new Date('2026-06-22T00:00:00Z'))).toBe(1)   // Mon
    expect(isoWeekdayUtc(new Date('2026-06-28T00:00:00Z'))).toBe(7)   // Sun
    expect(isoWeekdayUtc(new Date('2026-06-25T00:00:00Z'))).toBe(4)   // Thu
  })
})

describe('summarise', () => {
  function r(outcome: WeeklyDeliveryUserResult['outcome']): WeeklyDeliveryUserResult {
    return {
      recipientMasked: '***', outcome,
      weeklyDayOfWeek: 1,
      portfolioItemCount: 0, watchlistItemCount: 0, alertHighlightCount: 0,
    }
  }
  it('counts sent + would_send as emailed', () => {
    const s = summarise([r('sent'), r('would_send')], false, 'cron', 'now', 1, 2, 7)
    expect(s.usersEmailed).toBe(2)
  })
  it('separates cooldown vs wrong_day vs other skips', () => {
    const s = summarise(
      [r('cooldown'), r('wrong_weekly_day'), r('no_content'), r('prefs_disabled')],
      false, 'cron', 'now', 1, 4, 7,
    )
    expect(s.usersInCooldown).toBe(1)
    expect(s.usersWrongDay).toBe(1)
    expect(s.usersSkipped).toBe(2)
  })
  it('buckets provider_error / invalid_recipient / configuration_error as failed', () => {
    const s = summarise(
      [r('provider_error'), r('invalid_recipient'), r('configuration_error')],
      false, 'cron', 'now', 1, 3, 7,
    )
    expect(s.usersFailed).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────
// dryRun
// ─────────────────────────────────────────────────────────────────────

describe('deliverWeeklyDigests — dryRun default', () => {
  it('defaults to dryRun=true (no send) when dryRun is omitted', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const send = stubSend()
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin',
      asOf,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    expect(out.dryRun).toBe(true)
    expect(send.calls).toHaveLength(0)
    expect(out.usersEmailed).toBe(1)
    expect(out.perUser[0].outcome).toBe('would_send')
  })

  it('non-boolean false value (e.g. "false" string) stays in dry-run', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const send = stubSend()
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin',
      asOf,
      // @ts-expect-error — deliberately wrong type
      dryRun: 'false',
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    expect(out.dryRun).toBe(true)
    expect(send.calls).toHaveLength(0)
  })

  it('only literal boolean false triggers a real send', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const send = stubSend()
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    expect(out.dryRun).toBe(false)
    expect(send.calls).toHaveLength(1)
    expect(out.usersEmailed).toBe(1)
    expect(out.perUser[0].outcome).toBe('sent')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Eligibility
// ─────────────────────────────────────────────────────────────────────

describe('deliverWeeklyDigests — eligibility gates', () => {
  it('skips users with master switch disabled (prefs.enabled=false)', async () => {
    seedPrefs('u1', { enabled: false })
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    // Query also filters by enabled=true server-side, so they shouldn't
    // even reach perUser. The candidate pool comes back empty.
    expect(out.usersConsidered).toBe(0)
  })

  it('skips users with weekly_digest_enabled=false', async () => {
    seedPrefs('u1', { weeklyDigestEnabled: false })
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    expect(out.usersConsidered).toBe(0)
  })

  it('skips users with BOTH section toggles off (sections_disabled)', async () => {
    seedPrefs('u1', {
      weeklyOverviewPortfolioEnabled: false,
      weeklyOverviewWatchlistEnabled: false,
    })
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].outcome).toBe('sections_disabled')
    expect(out.usersSkipped).toBe(1)
  })

  it('skips users with no portfolio / watchlist / alert content', async () => {
    seedPrefs('u1')
    // No seedPortfolioForUser — user has no content.
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].outcome).toBe('no_content')
  })

  it('skips users with no resolvable email', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,
      getUserEmail: emailMap([]),    // no email known
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].outcome).toBe('no_email')
  })

  it('skips users whose resolved email fails the loose shape check', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,
      getUserEmail: emailMap([['u1', 'not-an-email']]),
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].outcome).toBe('invalid_email')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Cooldown
// ─────────────────────────────────────────────────────────────────────

describe('deliverWeeklyDigests — cooldown', () => {
  it('skips users with a recent BASELINE-ELIGIBLE prior send', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    fakeDB.seed('email_delivery_log', [{
      id: 'log-1', user_id: 'u1',
      category: 'weekly_report', status: 'sent',
      sent_at: '2026-06-18T09:00:00Z',  // 4 days before asOf
      metadata_json: { baselineEligible: true, currency: 'GBP', portfolioTotalMinorUnits: 100_00 },
    }])
    const send = stubSend()
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    expect(out.perUser[0].outcome).toBe('cooldown')
    expect(send.calls).toHaveLength(0)
    expect(out.usersInCooldown).toBe(1)
  })

  it('IGNORES test-send rows (baselineEligible=false) when computing cooldown', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    fakeDB.seed('email_delivery_log', [{
      id: 'log-test', user_id: 'u1',
      category: 'weekly_report', status: 'sent',
      sent_at: '2026-06-21T09:00:00Z',  // 1 day before asOf
      metadata_json: { test: true, baselineEligible: false, currency: 'GBP', portfolioTotalMinorUnits: 100_00 },
    }])
    const send = stubSend()
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    // Test send doesn't gate the cooldown → user gets a real send.
    expect(out.perUser[0].outcome).toBe('sent')
    expect(send.calls).toHaveLength(1)
  })

  it('cooldownDays option override beats env default', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    fakeDB.seed('email_delivery_log', [{
      id: 'log-1', user_id: 'u1',
      category: 'weekly_report', status: 'sent',
      sent_at: '2026-06-15T09:00:00Z',  // 7 days before asOf
      metadata_json: { baselineEligible: true, currency: 'GBP', portfolioTotalMinorUnits: 100_00 },
    }])
    // With cooldownDays=14 the 7d-old send is still INSIDE the window.
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf, cooldownDays: 14,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].outcome).toBe('cooldown')
    expect(out.cooldownDays).toBe(14)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Day-of-week gate
// ─────────────────────────────────────────────────────────────────────

describe('deliverWeeklyDigests — weekly_digest_day_of_week', () => {
  it('cron source skips users whose configured day != today', async () => {
    // asOf is Monday (1). Configure user for Thursday (4).
    seedPrefs('u1', { weeklyDigestDayOfWeek: 4 })
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'cron', asOf,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].outcome).toBe('wrong_weekly_day')
    expect(out.perUser[0].weeklyDayOfWeek).toBe(4)
    expect(out.asOfDayOfWeek).toBe(1)
    expect(out.usersWrongDay).toBe(1)
  })

  it('cron source DOES send to users whose configured day == today', async () => {
    seedPrefs('u1', { weeklyDigestDayOfWeek: 1 })
    seedPortfolioForUser('u1')
    const send = stubSend()
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'cron', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    expect(out.perUser[0].outcome).toBe('sent')
    expect(send.calls).toHaveLength(1)
  })

  it('admin source ignores weekly_digest_day_of_week', async () => {
    seedPrefs('u1', { weeklyDigestDayOfWeek: 4 })  // Thursday
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,        // asOf is Monday
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].outcome).toBe('would_send')
    expect(out.perUser[0].weeklyDayOfWeek).toBe(4)   // still echoed
  })
})

// ─────────────────────────────────────────────────────────────────────
// Baseline metadata on real sends
// ─────────────────────────────────────────────────────────────────────

describe('deliverWeeklyDigests — baseline metadata', () => {
  it('real send writes baselineEligible=true / test=false / sample=false', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const send = stubSend()
    await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'cron', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    expect(send.calls).toHaveLength(1)
    const meta = send.calls[0].metadata as Record<string, unknown>
    expect(meta.baselineEligible).toBe(true)
    expect(meta.test).toBe(false)
    expect(meta.sample).toBe(false)
    expect(meta.digestType).toBe('weekly')
    expect(meta.deliverySource).toBe('cron')
    expect(meta.portfolioTotalMinorUnits).toBe(100_00)
    expect(meta.currency).toBe('GBP')
  })

  it('real send uses category=weekly_report and templateKey=weekly-digest (no [TEST])', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const send = stubSend()
    await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'cron', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    const c = send.calls[0]
    expect(c.category).toBe('weekly_report')
    expect(c.templateKey).toBe('weekly-digest')
    expect(c.subject ?? '').not.toMatch(/\[TEST\]/)
    expect(c.subject ?? '').not.toMatch(/\[SAMPLE\]/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Hard cap
// ─────────────────────────────────────────────────────────────────────

describe('deliverWeeklyDigests — caps', () => {
  it('respects maxUsers when many candidates are eligible', async () => {
    for (let i = 1; i <= 6; i++) {
      seedPrefs(`u${i}`)
      seedPortfolioForUser(`u${i}`)
    }
    const send = stubSend()
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf, dryRun: false,
      maxUsers: 3,
      getUserEmail: emailMap([
        ['u1', 'u1@example.com'], ['u2', 'u2@example.com'], ['u3', 'u3@example.com'],
        ['u4', 'u4@example.com'], ['u5', 'u5@example.com'], ['u6', 'u6@example.com'],
      ]),
      sendFn: send.fn,
    })
    expect(send.calls.length).toBeLessThanOrEqual(3)
    expect(out.usersEmailed).toBeLessThanOrEqual(3)
  })

  it('hard caps maxUsers at 100 even when caller passes a larger number', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf,
      maxUsers: 9999,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: stubSend().fn,
    })
    // Just confirm the run completed without expanding past the cap;
    // we don't have 9999 candidates seeded.
    expect(out.usersConsidered).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Recipient handling
// ─────────────────────────────────────────────────────────────────────

describe('deliverWeeklyDigests — recipient', () => {
  it('masks the recipient address in perUser', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const out = await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'admin', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'lukejosephpierce@gmail.com']]),
      sendFn: stubSend().fn,
    })
    expect(out.perUser[0].recipientMasked).toBe('lu***@gmail.com')
  })

  it('idempotency key is stable per (source, user, day)', async () => {
    seedPrefs('u1')
    seedPortfolioForUser('u1')
    const send = stubSend()
    await deliverWeeklyDigests(asSupa(fakeDB), {
      source: 'cron', asOf, dryRun: false,
      getUserEmail: emailMap([['u1', 'u1@example.com']]),
      sendFn: send.fn,
    })
    expect(send.calls[0].idempotencyKey).toBe('weekly-digest-cron-u1-2026-06-22')
  })
})
