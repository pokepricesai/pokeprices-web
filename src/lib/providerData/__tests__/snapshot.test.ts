import { describe, it, expect, beforeEach } from 'vitest';
import { getProviderSnapshot } from '../snapshot';

// Regression tests for the admin-preview snapshot gate.
// previewMode=true must still enforce pricing_eligibility
// invariants (variant printings never see aggregate graded,
// identity_only never sees prices).

function makeStub(answers: Record<string, { data: unknown; error: unknown }>) {
  const stub: any = {
    from(table: string) {
      const q: any = {
        select() { return q; },
        eq() { return q; },
        maybeSingle() { return Promise.resolve(answers[`${table}:single`] ?? { data: null, error: null }); },
        then(resolve: (r: { data: unknown; error: unknown }) => void) {
          resolve(answers[`${table}:list`] ?? { data: [], error: null });
        },
      };
      return q;
    },
  };
  return stub;
}

/**
 * Build the full stub answer set INCLUDING the effective-eligibility view
 * stub, which defaults to echoing the mapping's own pricing_eligibility.
 * Tests only need to override `v_pokemon_tcg_effective_eligibility:single`
 * when exercising the fail-closed paths.
 */
function makeStubWithEffectiveView(
  mapping: { pricing_eligibility: string; [k: string]: unknown },
  rest: Record<string, { data: unknown; error: unknown }> = {},
  effectiveOverride?: { data: unknown; error: unknown },
  pilotOverride?: { data: unknown; error: unknown },
) {
  return makeStub({
    'pokemon_tcg_mappings:single': { data: mapping, error: null },
    'v_pokemon_tcg_effective_eligibility:single': effectiveOverride ?? {
      data: { effective_eligibility: mapping.pricing_eligibility },
      error: null,
    },
    // Default pilot: all three features ENABLED for the stub so existing
    // behaviour-oriented tests still exercise their intended branches.
    // Tests for the pilot gate itself pass `pilotOverride` explicitly.
    'v_pokemon_tcg_pilot_active:single': pilotOverride ?? {
      data: { prices_enabled: true, images_enabled: true, history_enabled: true },
      error: null,
    },
    ...rest,
  });
}

const APPROVED_BULK_SAFE_MAPPING = {
  tcg_card_id: 'pkm_sv2_125',
  tcg_printing_key: 'normal',
  tcg_set_code: 'sv2',
  tcg_language: 'en',
  tcg_name: 'Mimikyu',
  review_status: 'approved',
  pricing_eligibility: 'bulk_safe',
};
const PENDING_MARKET_ONLY_MAPPING = {
  ...APPROVED_BULK_SAFE_MAPPING,
  review_status: 'pending_review',
  pricing_eligibility: 'market_only',
  tcg_printing_key: '1st-edition',
};
const PENDING_IDENTITY_ONLY_MAPPING = {
  ...APPROVED_BULK_SAFE_MAPPING,
  review_status: 'pending_review',
  pricing_eligibility: 'identity_only',
};
const PENDING_UNCERTAIN_MAPPING = {
  ...APPROVED_BULK_SAFE_MAPPING,
  review_status: 'pending_review',
  pricing_eligibility: 'uncertain',
  confidence: 'medium',
};

describe('getProviderSnapshot — public mode (previewMode=false)', () => {
  beforeEach(() => {
    delete process.env.PP_USE_TCGGRAPH_PRICES;
    delete process.env.PP_USE_TCGGRAPH_IMAGES;
  });

  it('returns null when mapping not approved', async () => {
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PENDING_MARKET_ONLY_MAPPING, error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug');
    expect(r).toBeNull();
  });

  it('returns null when all flags off even for approved rows', async () => {
    const sb = makeStubWithEffectiveView(APPROVED_BULK_SAFE_MAPPING, {
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg', image_source: 'card' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', finish: 'normal' }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 100 }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug');
    expect(r).not.toBeNull();
    expect(r?.market_prices).toEqual([]);
    expect(r?.graded_prices).toEqual([]);
    expect(r?.image_normal).toBeNull();
  });

  it('returns prices when flags enabled + bulk_safe + approved', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1';
    process.env.PP_USE_TCGGRAPH_IMAGES = '1';
    const sb = makeStubWithEffectiveView(APPROVED_BULK_SAFE_MAPPING, {
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg', image_source: 'card' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', finish: 'normal', currency: 'USD', market: 10 }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', currency: 'USD', price: 100 }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug');
    expect(r?.market_prices).toHaveLength(1);
    expect(r?.graded_prices).toHaveLength(1);
    expect(r?.image_normal).toBe('x.jpg');
  });
});

describe('getProviderSnapshot — admin preview mode', () => {
  beforeEach(() => {
    delete process.env.PP_USE_TCGGRAPH_PRICES;
    delete process.env.PP_USE_TCGGRAPH_IMAGES;
  });

  it('returns prices even without flags set (ignoreFlags defaults true)', async () => {
    const sb = makeStubWithEffectiveView(APPROVED_BULK_SAFE_MAPPING, {
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r?.market_prices).toHaveLength(1);
    expect(r?.graded_prices).toHaveLength(1);
    expect(r?.image_normal).toBe('x.jpg');
  });

  it('returns snapshot for a pending (not-yet-approved) mapping', async () => {
    const sb = makeStubWithEffectiveView(PENDING_MARKET_ONLY_MAPPING, {
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r).not.toBeNull();
    expect(r?.pricing_eligibility).toBe('market_only');
  });

  it('market_only suppresses graded (variant printing invariant)', async () => {
    const sb = makeStubWithEffectiveView(PENDING_MARKET_ONLY_MAPPING, {
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 999 }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r?.market_prices).toHaveLength(1);
    expect(r?.graded_prices).toEqual([]);     // the invariant
    expect(r?.image_normal).toBe('x.jpg');
  });

  it('identity_only suppresses both market and graded', async () => {
    const sb = makeStubWithEffectiveView(PENDING_IDENTITY_ONLY_MAPPING, {
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r?.market_prices).toEqual([]);
    expect(r?.graded_prices).toEqual([]);
    expect(r?.image_normal).toBe('x.jpg');     // identity_only still permits image for review
  });

  it('uncertain still returns no prices / no graded', async () => {
    const sb = makeStubWithEffectiveView(PENDING_UNCERTAIN_MAPPING, {
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r?.market_prices).toEqual([]);
    expect(r?.graded_prices).toEqual([]);
  });

  it('unmatched mapping still returns null (no tcg_card_id)', async () => {
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: { ...APPROVED_BULK_SAFE_MAPPING, tcg_card_id: null }, error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r).toBeNull();
  });
});

// PP-TCG-QA-FINAL §3 — fail-closed invariants
describe('getProviderSnapshot — fail-closed on missing QA / view errors', () => {
  beforeEach(() => {
    delete process.env.PP_USE_TCGGRAPH_PRICES;
    delete process.env.PP_USE_TCGGRAPH_IMAGES;
  });

  it('returns null when the effective view errors (even if mapping says bulk_safe)', async () => {
    // Simulate v_pokemon_tcg_effective_eligibility errored — fail closed.
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
      },
      { data: null, error: { message: 'db error' } },
    );
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r).toBeNull();
  });

  it('returns null when the effective view returns no row (no QA ever ran)', async () => {
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
      },
      { data: null, error: null },
    );
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r).toBeNull();
  });

  it('returns null when effective_eligibility is literally null', async () => {
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
      },
      { data: { effective_eligibility: null }, error: null },
    );
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r).toBeNull();
  });

  it('effective view downgrade overrides stale bulk_safe label (ambiguous_variant case)', async () => {
    // The mapping still carries pricing_eligibility='bulk_safe' because the
    // correction hasn't been applied yet. The QA has recommended 'not_eligible'
    // because the mapping is ambiguous_variant. The effective view returns the
    // more restrictive: not_eligible → snapshot must gate everything off.
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 10 }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 100 }], error: null },
      },
      { data: { effective_eligibility: 'not_eligible' }, error: null },
    );
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r?.pricing_eligibility).toBe('not_eligible');
    expect(r?.market_prices).toEqual([]);
    expect(r?.graded_prices).toEqual([]);
    expect(r?.image_normal).toBeNull();
  });

  it('effective view downgrade overrides stale bulk_safe → market_only (pricing_restriction case)', async () => {
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 10 }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 100 }], error: null },
      },
      { data: { effective_eligibility: 'market_only' }, error: null },
    );
    process.env.PP_USE_TCGGRAPH_PRICES = '1';
    process.env.PP_USE_TCGGRAPH_IMAGES = '1';
    const r = await getProviderSnapshot(sb, 'test-slug');
    expect(r?.pricing_eligibility).toBe('market_only');
    expect(r?.market_prices).toHaveLength(1);   // market still shown
    expect(r?.graded_prices).toEqual([]);        // graded suppressed by downgrade
  });

  it('effective view returning "uncertain" blocks everything (conflicting_identity case)', async () => {
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
      },
      { data: { effective_eligibility: 'uncertain' }, error: null },
    );
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r?.pricing_eligibility).toBe('uncertain');
    expect(r?.market_prices).toEqual([]);
    expect(r?.graded_prices).toEqual([]);
    expect(r?.image_normal).toBeNull();
  });
});

// PP-TCG-CUTOVER-PREP-01 §3 — pilot allowlist gate
describe('getProviderSnapshot — pilot cohort allowlist', () => {
  beforeEach(() => {
    delete process.env.PP_USE_TCGGRAPH_PRICES;
    delete process.env.PP_USE_TCGGRAPH_IMAGES;
  });

  it('public mode without pilot row blocks prices + images even when env flags are ON', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1';
    process.env.PP_USE_TCGGRAPH_IMAGES = '1';
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 10 }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 100 }], error: null },
      },
      undefined,
      { data: null, error: null },         // no pilot row → all features off
    );
    const r = await getProviderSnapshot(sb, 'test-slug');
    expect(r?.market_prices).toEqual([]);
    expect(r?.graded_prices).toEqual([]);
    expect(r?.image_normal).toBeNull();
  });

  it('pilot prices_enabled=true + images_enabled=false serves prices only', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1';
    process.env.PP_USE_TCGGRAPH_IMAGES = '1';
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 10 }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 100 }], error: null },
      },
      undefined,
      { data: { prices_enabled: true, images_enabled: false, history_enabled: false }, error: null },
    );
    const r = await getProviderSnapshot(sb, 'test-slug');
    expect(r?.market_prices).toHaveLength(1);
    expect(r?.graded_prices).toHaveLength(1);
    expect(r?.image_normal).toBeNull();      // images gated by pilot
  });

  it('pilot error → fail closed (DB error treated as not in pilot)', async () => {
    process.env.PP_USE_TCGGRAPH_PRICES = '1';
    process.env.PP_USE_TCGGRAPH_IMAGES = '1';
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 10 }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 100 }], error: null },
      },
      undefined,
      { data: null, error: { message: 'pilot view read error' } },
    );
    const r = await getProviderSnapshot(sb, 'test-slug');
    expect(r?.market_prices).toEqual([]);
    expect(r?.image_normal).toBeNull();
  });

  it('preview mode bypasses the pilot gate (ignorePilotCohort defaults true)', async () => {
    const sb = makeStubWithEffectiveView(
      APPROVED_BULK_SAFE_MAPPING,
      {
        'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
        'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer', market: 10 }], error: null },
        'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10', price: 100 }], error: null },
      },
      undefined,
      { data: null, error: null },         // not in pilot — but preview ignores it
    );
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r?.market_prices).toHaveLength(1);
    expect(r?.image_normal).toBe('x.jpg');
  });
});
