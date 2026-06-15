import { describe, it, expect } from 'vitest'
import { safeReturnTo } from '../returnTo'

describe('safeReturnTo', () => {
  it('accepts a plain internal path', () => {
    expect(safeReturnTo('/dashboard')).toBe('/dashboard')
  })

  it('preserves the query string and hash', () => {
    expect(safeReturnTo('/set/foo/card/bar?x=1#y')).toBe('/set/foo/card/bar?x=1#y')
  })

  it('rejects protocol-relative URLs', () => {
    expect(safeReturnTo('//evil.com')).toBeNull()
    expect(safeReturnTo('//evil.com/path')).toBeNull()
  })

  it('rejects absolute URLs', () => {
    expect(safeReturnTo('https://evil.com')).toBeNull()
    expect(safeReturnTo('http://evil.com/path')).toBeNull()
  })

  it('rejects javascript and data schemes', () => {
    expect(safeReturnTo('javascript:alert(1)')).toBeNull()
    expect(safeReturnTo('data:text/html,evil')).toBeNull()
  })

  it('rejects backslash-prefixed paths and embedded backslashes', () => {
    expect(safeReturnTo('/\\evil')).toBeNull()
    expect(safeReturnTo('/dashboard\\evil')).toBeNull()
  })

  it('rejects non-string and empty input', () => {
    expect(safeReturnTo(undefined)).toBeNull()
    expect(safeReturnTo(null)).toBeNull()
    expect(safeReturnTo(42 as any)).toBeNull()
    expect(safeReturnTo('')).toBeNull()
    expect(safeReturnTo('   ')).toBeNull()
  })

  it('rejects paths that do not start with /', () => {
    expect(safeReturnTo('dashboard')).toBeNull()
    expect(safeReturnTo('./dashboard')).toBeNull()
    expect(safeReturnTo('../etc/passwd')).toBeNull()
  })

  it('rejects overly long inputs', () => {
    expect(safeReturnTo('/' + 'a'.repeat(2000))).toBeNull()
  })
})
