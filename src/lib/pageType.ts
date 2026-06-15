// src/lib/pageType.ts
// Pure classifier for the analytics page_type dimension. Operates on the
// public URL path only; never reads cookies, auth state or any user data.

export type PageType =
  | 'homepage'
  | 'card'
  | 'set'
  | 'pokemon'
  | 'illustrator'
  | 'creator'
  | 'insight'
  | 'card_show'
  | 'vendor'
  | 'dashboard'
  | 'ai_assistant'
  | 'browse'
  | 'quick_price'
  | 'grading'
  | 'auth'
  | 'other'

export function classifyPageType(pathname: string | null | undefined): PageType {
  if (typeof pathname !== 'string' || pathname.length === 0) return 'other'
  if (pathname === '/') return 'homepage'

  // Sub-paths under /dashboard come first so quick-price / grading are
  // not classified as generic dashboard.
  if (pathname.startsWith('/dashboard/quick-price')) return 'quick_price'
  if (pathname.startsWith('/dashboard/grading'))     return 'grading'
  if (pathname.startsWith('/dashboard'))             return 'dashboard'

  if (pathname.startsWith('/auth/'))                 return 'auth'
  if (pathname.startsWith('/ai-assistant'))          return 'ai_assistant'

  if (pathname.startsWith('/set/') && pathname.includes('/card/')) return 'card'
  if (pathname.startsWith('/set/'))                  return 'set'

  if (pathname.startsWith('/pokemon'))               return 'pokemon'
  if (pathname.startsWith('/creators'))              return 'creator'
  if (pathname.startsWith('/illustrators'))          return 'illustrator'
  if (pathname.startsWith('/insights'))              return 'insight'
  if (pathname.startsWith('/card-shows'))            return 'card_show'
  if (pathname.startsWith('/vendors'))               return 'vendor'
  if (pathname.startsWith('/browse'))                return 'browse'

  return 'other'
}
