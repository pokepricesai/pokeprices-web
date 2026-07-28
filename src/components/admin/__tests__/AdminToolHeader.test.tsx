// Block 5A-W-47C-FIX1 — SSR pin for the shared AdminToolHeader.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AdminToolHeader from '../AdminToolHeader'

describe('AdminToolHeader', () => {
  it('renders the tool name in the pill', () => {
    const html = renderToStaticMarkup(<AdminToolHeader toolName="Insights (Articles)" />)
    expect(html).toContain('Insights (Articles)')
  })
  it('renders an Admin Home link to /admin by default', () => {
    const html = renderToStaticMarkup(<AdminToolHeader toolName="X" />)
    expect(html).toMatch(/<a [^>]*href="\/admin"[^>]*>Admin Home<\/a>/)
  })
  it('renders a Return to site link to /', () => {
    const html = renderToStaticMarkup(<AdminToolHeader toolName="X" />)
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Return to site<\/a>/)
  })
  it('showAdminHome=false hides the Admin Home link (avoids self-loop on /admin)', () => {
    const html = renderToStaticMarkup(<AdminToolHeader toolName="Admin" showAdminHome={false} />)
    expect(html).not.toContain('>Admin Home<')
    // Return to site remains.
    expect(html).toMatch(/href="\/"[^>]*>Return to site<\/a>/)
  })
  it('data-admin-tool-header attribute is present for regression / e2e queries', () => {
    const html = renderToStaticMarkup(<AdminToolHeader toolName="X" />)
    expect(html).toContain('data-admin-tool-header')
  })
})
