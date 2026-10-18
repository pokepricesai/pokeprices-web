import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getProviderSnapshot } from '../snapshot';

// Regression tests for the admin-preview snapshot gate.
// previewMode=true must still enforce pricing_eligibility
// invariants (variant printings never see aggregate graded,
// identity_only never sees prices).

type StubbedQuery = {
  select: (...a: unknown[]) => StubbedQuery;
  eq: (...a: unknown[]) => StubbedQuery;
  maybeSingle?: () => Promise<{ data: unknown; error: null }>;
};
type QueryResolver = (table: string) => StubbedQuery | Promise<{ data: unknown[]; error: null }>;

function makeStub(answers: Record<string, { data: unknown; error: null }>) {
  const stub: any = {
    from(table: string) {
      const q: any = {
        select() { return q; },
        eq() { return q; },
        maybeSingle() { return Promise.resolve(answers[`${table}:single`] ?? { data: null, error: null }); },
        then(resolve: (r: { data: unknown; error: null }) => void) {
          resolve(answers[`${table}:list`] ?? { data: [], error: null });
        },
      };
      return q;
    },
  };
  return stub;
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
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: APPROVED_BULK_SAFE_MAPPING, error: null },
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
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: APPROVED_BULK_SAFE_MAPPING, error: null },
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
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: APPROVED_BULK_SAFE_MAPPING, error: null },
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
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PENDING_MARKET_ONLY_MAPPING, error: null },
      'pokemon_tcg_provider_cards:single': { data: { image_normal: 'x.jpg' }, error: null },
      'pokemon_tcg_prices_market:list': { data: [{ source: 'tcgplayer' }], error: null },
      'pokemon_tcg_prices_graded:list': { data: [{ grader: 'psa', grade: '10' }], error: null },
    });
    const r = await getProviderSnapshot(sb, 'test-slug', { previewMode: true });
    expect(r).not.toBeNull();
    expect(r?.pricing_eligibility).toBe('market_only');
  });

  it('market_only suppresses graded (variant printing invariant)', async () => {
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PENDING_MARKET_ONLY_MAPPING, error: null },
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
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PENDING_IDENTITY_ONLY_MAPPING, error: null },
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
    const sb = makeStub({
      'pokemon_tcg_mappings:single': { data: PENDING_UNCERTAIN_MAPPING, error: null },
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
