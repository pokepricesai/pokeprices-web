// Block 5A-W-50E-FIX1 — pin the auth-race safeguards on the browse
// page. These are text-based assertions against BrowsePageClient.tsx
// because the file is a client component and the auth-race window is
// milliseconds wide; a full render harness would add far more setup
// than it saves. Runtime behaviour is proven separately by the
// pending-outbound / smart-back / origin-marker unit tests.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/browse/BrowsePageClient.tsx'),
  'utf8',
)

describe('BrowsePageClient — Block 5A-W-50E-FIX1 auth-race safeguards', () => {
  it('declares an authResolved boolean that starts false', () => {
    expect(SRC).toMatch(/const \[authResolved, setAuthResolved\] = useState\(false\)/)
  })

  it('flips authResolved true after supabase.auth.getSession resolves', () => {
    expect(SRC).toMatch(/setUserId\(session\?\.user\?\.id \?\? null\)\s*\n\s*setAuthResolved\(true\)/)
  })

  it('URL parser accepts completion_desc while auth is unresolved (initial parse)', () => {
    // Initial parse must NOT hard-code canUseCompletion=false because
    // that would strip a legitimately requested completion_desc.
    // The lazy useMemo initialiser must pass canUseCompletion:true.
    expect(SRC).toMatch(/const initialUrlState[\s\S]{0,300}canUseCompletion:\s*true/)
  })

  it('URL parser gates completion_desc on auth resolution for subsequent syncs', () => {
    // The URL -> state sync uses !authResolved || !!userId so
    // completion_desc is preserved during the auth window.
    expect(SRC).toMatch(/canUseCompletion:\s*!authResolved\s*\|\|\s*!!userId/)
  })

  it('sign-out fallback effect is gated on authResolved', () => {
    // Without the gate, a transient userId=null before getSession
    // resolves would drop completion_desc.
    expect(SRC).toMatch(/if \(!authResolved\) return/)
    expect(SRC).toMatch(/if \(!userId && sort === 'completion_desc'\) setSort\('release_desc'\)/)
  })

  it('state -> URL write defers while auth pending AND sort is completion_desc', () => {
    // The URL write skips while auth is unresolved so a transient
    // strip of the sort param cannot occur.
    expect(SRC).toMatch(/if \(!authResolved && sort === 'completion_desc'\) return/)
  })

  it('scroll restoration ready gate requires authResolved for completion_desc', () => {
    // Ordering is not yet finalised while auth is loading; restoring
    // scroll would target the wrong list.
    expect(SRC).toMatch(/authResolved && !!userId && completionReady/)
  })

  it('non-authenticated sort values do not wait on authResolved', () => {
    // The scroll-ready ternary short-circuits sort !== 'completion_desc'
    // to true so restore for release_desc / az / etc. is not delayed
    // by the auth window.
    expect(SRC).toMatch(/sort !== 'completion_desc'\s*\?\s*true\s*:\s*authResolved && !!userId && completionReady/)
  })
})
