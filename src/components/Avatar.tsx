'use client'

const AVATAR_COLOURS = ['#1a5fad', '#0ea5e9', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']

export function avatarColour(seed: string | null | undefined): string {
  if (!seed) return AVATAR_COLOURS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_COLOURS[Math.abs(h) % AVATAR_COLOURS.length]
}

export function avatarInitial(displayName: string | null | undefined, email: string | null | undefined): string {
  const source = displayName || email || ''
  const ch = source.trim().charAt(0).toUpperCase()
  return ch || '?'
}

export function pokemonSpriteUrl(id: number): string {
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`
}

interface AvatarProps {
  pokemonId: number | null
  seed: string | null | undefined
  displayName: string | null | undefined
  email: string | null | undefined
  size?: number
  ringColour?: string
}

export default function Avatar({ pokemonId, seed, displayName, email, size = 36, ringColour }: AvatarProps) {
  const base: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, overflow: 'hidden',
    border: ringColour ? `2px solid ${ringColour}` : 'none',
    boxSizing: 'border-box',
  }

  if (pokemonId) {
    return (
      <div style={{ ...base, background: '#fff' }}>
        <img
          src={pokemonSpriteUrl(pokemonId)}
          alt=""
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          loading="lazy"
        />
      </div>
    )
  }

  return (
    <div style={{
      ...base,
      background: avatarColour(seed),
      color: '#fff',
      fontSize: Math.round(size * 0.42),
      fontWeight: 800,
      fontFamily: "'Outfit', sans-serif",
    }}>
      {avatarInitial(displayName, email)}
    </div>
  )
}
