// Anonymous device identifier persisted in localStorage. Used for the
// scan quota when no auth session is available. Easy to bypass (clear
// storage) but fair-use intent.
export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''
  const KEY = 'pp_device_id'
  try {
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return ''
  }
}
