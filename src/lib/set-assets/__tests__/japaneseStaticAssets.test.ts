// Block 5A-W-50I-LITE — Japanese set assets live in the same static
// bundled maps as English ones. This test is the whole contract:
// Battle Partners resolves through LOGO_MAP + SYMBOL_MAP, another JP
// set with no mapping still returns null (consumer applies its
// existing first-card fallback), representative English mappings are
// untouched, and no new database / RPC / storage code appears.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { getSetAssets } from '@/lib/setAssets'

const SET_ASSETS_SRC = readFileSync(join(process.cwd(), 'src', 'lib', 'setAssets.ts'), 'utf8')

describe('Japanese Battle Partners — static pilot mapping', () => {
  it('resolves to the static logo at /set-assets/logos/Japanese Battle Partners.webp', () => {
    const a = getSetAssets('Japanese Battle Partners')
    expect(a.logoUrl).toBe('/set-assets/logos/Japanese Battle Partners.webp')
  })

  it('resolves to the static symbol at /set-assets/symbols/Japanese Battle Partners.png', () => {
    const a = getSetAssets('Japanese Battle Partners')
    expect(a.symbolUrl).toBe('/set-assets/symbols/Japanese Battle Partners.png')
  })

  it('the mapped static files actually exist on disk under public/set-assets/', () => {
    expect(existsSync(join(process.cwd(), 'public', 'set-assets', 'logos',   'Japanese Battle Partners.webp'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'public', 'set-assets', 'symbols', 'Japanese Battle Partners.png'))).toBe(true)
  })
})

describe('additional Japanese static pilots', () => {
  it('Japanese Abyss Eye resolves to logo + symbol PNGs', () => {
    const a = getSetAssets('Japanese Abyss Eye')
    expect(a.logoUrl).toBe('/set-assets/logos/Japanese Abyss Eye.png')
    expect(a.symbolUrl).toBe('/set-assets/symbols/Japanese Abyss Eye.png')
    expect(existsSync(join(process.cwd(), 'public', 'set-assets', 'logos',   'Japanese Abyss Eye.png'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'public', 'set-assets', 'symbols', 'Japanese Abyss Eye.png'))).toBe(true)
  })

  it('Japanese Ruler of the Black Flame resolves to logo PNG (no symbol supplied yet)', () => {
    const a = getSetAssets('Japanese Ruler of the Black Flame')
    expect(a.logoUrl).toBe('/set-assets/logos/Japanese Ruler of the Black Flame.png')
    expect(a.symbolUrl).toBeNull()
    expect(existsSync(join(process.cwd(), 'public', 'set-assets', 'logos', 'Japanese Ruler of the Black Flame.png'))).toBe(true)
  })
})

describe('unmapped Japanese sets still return null (consumer applies first-card fallback)', () => {
  it('Japanese Old Maid — no mapping → logoUrl null → tile falls back to set_image_url', () => {
    const a = getSetAssets('Japanese Old Maid')
    expect(a.logoUrl).toBeNull()
    expect(a.symbolUrl).toBeNull()
  })
})

describe('representative English mappings unchanged by 50I-LITE', () => {
  it('Base Set resolves exactly as before', () => {
    const a = getSetAssets('Base Set')
    expect(a.logoUrl).toBe('/set-assets/logos/Base Set.webp')
    expect(a.symbolUrl).toBeNull() // Base Set has no symbol entry today
  })

  it('Jungle resolves exactly as before', () => {
    const a = getSetAssets('Jungle')
    expect(a.logoUrl).toBe('/set-assets/logos/Jungle.webp')
    expect(a.symbolUrl).toBe('/set-assets/symbols/Jungle.png')
  })
})

describe('50I-LITE introduces no database / RPC / storage code', () => {
  it('setAssets.ts still performs no DB / RPC / storage calls', () => {
    expect(SET_ASSETS_SRC).not.toMatch(/supabase/i)
    expect(SET_ASSETS_SRC).not.toMatch(/\.rpc\(/)
    expect(SET_ASSETS_SRC).not.toMatch(/\.from\(/)
    expect(SET_ASSETS_SRC).not.toMatch(/\.storage\./)
    expect(SET_ASSETS_SRC).not.toMatch(/set_metadata/)
  })

  it('getSetAssets stays a sync, single-argument, DB-free function', () => {
    expect(SET_ASSETS_SRC).toMatch(/export function getSetAssets\(setName: string\): SetAssets/)
  })
})
