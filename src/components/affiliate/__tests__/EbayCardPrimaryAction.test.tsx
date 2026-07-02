// Block 5A-W-39B — pin the null-render guards for the new
// EbayCardPrimaryAction component. The rendered path relies on
// browser-only hooks (useMarketplace, IntersectionObserver) and is
// not exercised here; the placement + query semantics are pinned
// by the placement tests in `../../../lib/__tests__/`.
//
// The transitive imports pull in the module-level supabase browser
// client (via useMarketplace → marketplaceClient → supabase), which
// throws at import if env vars are missing. Stub the tiny surface
// the components touch — nothing actually gets called on the null
// paths we test here.

import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase:      { auth: { getSession: async () => ({ data: { session: null } }) } },
  CHAT_ENDPOINT: 'https://stub.example.com/functions/v1/chat',
}))
vi.mock('@/lib/marketplaceClient', () => ({
  useMarketplace: () => ({ marketplace: 'UK' as const }),
}))
vi.mock('@/lib/affiliateEventClient', () => ({
  postAffiliateEvent: async () => undefined,
}))

import EbayCardPrimaryAction from '../EbayCardPrimaryAction'

describe('EbayCardPrimaryAction — null guards', () => {
  it('renders null when isSealed=true (sealed products have their own path)', () => {
    const out = EbayCardPrimaryAction({
      cardName: 'Test Booster Box',
      setName:  'Test Set',
      isSealed: true,
    })
    expect(out).toBeNull()
  })

  it('renders null when cardName is missing / blank', () => {
    expect(EbayCardPrimaryAction({ cardName: '',     setName: 'Base Set' })).toBeNull()
    expect(EbayCardPrimaryAction({ cardName: '   ',  setName: 'Base Set' })).toBeNull()
    expect(EbayCardPrimaryAction({
      cardName: undefined as unknown as string,
      setName:  'Base Set',
    })).toBeNull()
  })

  it('renders null when setName is missing / blank', () => {
    expect(EbayCardPrimaryAction({ cardName: 'Pikachu', setName: '' })).toBeNull()
    expect(EbayCardPrimaryAction({ cardName: 'Pikachu', setName: '  ' })).toBeNull()
    expect(EbayCardPrimaryAction({
      cardName: 'Pikachu',
      setName:  undefined as unknown as string,
    })).toBeNull()
  })

  it('returns a React element when identity + non-sealed', () => {
    // Doesn't render the tree (would trigger EbayCompactLink hooks);
    // just asserts the wrapper node exists and has the expected shape.
    const out = EbayCardPrimaryAction({
      cardName: 'Umbreon VMAX #215',
      setName:  'Evolving Skies',
      cardNumber: '215/203',
      cardSlug: 'umbreon-vmax-215',
    })
    expect(out).not.toBeNull()
    // React element shape: { type, props, ... }
    const el = out as { type: unknown; props: Record<string, unknown> }
    expect(typeof el.type).toBeDefined()
    expect(el.props).toBeDefined()
  })
})
