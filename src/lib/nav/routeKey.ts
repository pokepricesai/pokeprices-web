// src/lib/nav/routeKey.ts
//
// Block 5A-W-50E — deterministic string keys derived from a pathname
// plus a small set of relevant query parameters. Used as the storage
// key for saved scroll positions so different views of the same
// pathname (browse language=jp vs language=en, or set sort=raw_desc
// vs sort=name_asc) each save to their own slot.
//
// Only meaningful params should be passed in; unrelated tracking or
// third-party query params must be excluded by the caller so they do
// not fragment the storage key.

export function normaliseRouteKey(
  pathname: string,
  params: Record<string, string | null | undefined> = {},
): string {
  const cleanedPath = pathname.split('#')[0].split('?')[0]
  const entries: Array<[string, string]> = []
  for (const key of Object.keys(params)) {
    const v = params[key]
    if (v == null) continue
    const s = String(v)
    if (s.length === 0) continue
    entries.push([key, s])
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (entries.length === 0) return cleanedPath
  const search = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  return `${cleanedPath}?${search}`
}
