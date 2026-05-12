'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { pokemonSpriteUrl } from './Avatar'

// Gen 1 names indexed by national-dex id (1..151). Trimmed to what fits a
// reasonable picker; users get an iconic, recognisable set rather than 1025.
const GEN1: { id: number; name: string }[] = [
  { id: 1,   name: 'Bulbasaur'  }, { id: 4,   name: 'Charmander' }, { id: 7,   name: 'Squirtle'   },
  { id: 6,   name: 'Charizard'  }, { id: 9,   name: 'Blastoise'  }, { id: 3,   name: 'Venusaur'   },
  { id: 25,  name: 'Pikachu'    }, { id: 26,  name: 'Raichu'     }, { id: 35,  name: 'Clefairy'   },
  { id: 39,  name: 'Jigglypuff' }, { id: 52,  name: 'Meowth'     }, { id: 54,  name: 'Psyduck'    },
  { id: 63,  name: 'Abra'       }, { id: 66,  name: 'Machop'     }, { id: 74,  name: 'Geodude'    },
  { id: 79,  name: 'Slowpoke'   }, { id: 81,  name: 'Magnemite'  }, { id: 92,  name: 'Gastly'     },
  { id: 94,  name: 'Gengar'     }, { id: 95,  name: 'Onix'       }, { id: 104, name: 'Cubone'     },
  { id: 113, name: 'Chansey'    }, { id: 122, name: 'Mr. Mime'   }, { id: 124, name: 'Jynx'       },
  { id: 130, name: 'Gyarados'   }, { id: 131, name: 'Lapras'     }, { id: 132, name: 'Ditto'      },
  { id: 133, name: 'Eevee'      }, { id: 134, name: 'Vaporeon'   }, { id: 135, name: 'Jolteon'    },
  { id: 136, name: 'Flareon'    }, { id: 143, name: 'Snorlax'    }, { id: 144, name: 'Articuno'   },
  { id: 145, name: 'Zapdos'     }, { id: 146, name: 'Moltres'    }, { id: 147, name: 'Dratini'    },
  { id: 149, name: 'Dragonite'  }, { id: 150, name: 'Mewtwo'     }, { id: 151, name: 'Mew'        },
]

interface AvatarPickerProps {
  open: boolean
  currentPokemonId: number | null
  onClose: () => void
  onSaved: (newId: number | null) => void
}

export default function AvatarPicker({ open, currentPokemonId, onClose, onSaved }: AvatarPickerProps) {
  const [selectedId, setSelectedId] = useState<number | null>(currentPokemonId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSelectedId(currentPokemonId)
      setError(null)
    }
  }, [open, currentPokemonId])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  async function save(newId: number | null) {
    setSaving(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({
      data: { avatar_pokemon_id: newId },
    })
    setSaving(false)
    if (err) {
      setError(err.message || 'Could not save avatar — try again.')
      return
    }
    onSaved(newId)
    onClose()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, fontFamily: "'Figtree', sans-serif",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--card)', borderRadius: 18, border: '1px solid var(--border)',
          maxWidth: 640, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 22px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
            <div>
              <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20, margin: '0 0 4px', color: 'var(--text)' }}>
                Pick your avatar
              </h2>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                Pick a Gen 1 Pokémon. Shows next to your name across the site.
              </p>
            </div>
            <button onClick={onClose}
              aria-label="Close"
              style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'var(--bg-light)', border: '1px solid var(--border)', cursor: 'pointer',
                fontSize: 14, color: 'var(--text-muted)', padding: 0, lineHeight: 1,
              }}>×</button>
          </div>
        </div>

        {/* Grid */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 10,
          }}>
            {GEN1.map(p => {
              const selected = selectedId === p.id
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  title={p.name}
                  style={{
                    background: selected ? 'rgba(26,95,173,0.10)' : 'var(--bg-light)',
                    border: selected ? '2px solid var(--primary)' : '1px solid var(--border)',
                    borderRadius: 12, padding: '6px 6px 8px', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    transition: 'transform 0.12s, border-color 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.transform = ''}
                >
                  <img src={pokemonSpriteUrl(p.id)} alt="" width={48} height={48} loading="lazy"
                    style={{ width: 48, height: 48, objectFit: 'contain' }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                    {p.name}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          {error ? (
            <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>{error}</span>
          ) : (
            <button
              onClick={() => save(null)}
              disabled={saving}
              style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', padding: 0,
                textDecoration: 'underline', fontFamily: "'Figtree', sans-serif",
              }}
            >
              Clear avatar
            </button>
          )}

          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button onClick={onClose}
              disabled={saving}
              style={{
                background: 'transparent', border: '1px solid var(--border)', color: 'var(--text)',
                fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 10,
                cursor: saving ? 'wait' : 'pointer', fontFamily: "'Figtree', sans-serif",
              }}
            >Cancel</button>
            <button onClick={() => selectedId != null && save(selectedId)}
              disabled={saving || selectedId == null || selectedId === currentPokemonId}
              style={{
                background: 'var(--primary)', border: '1px solid var(--primary)', color: '#fff',
                fontSize: 13, fontWeight: 800, padding: '7px 14px', borderRadius: 10,
                cursor: (saving || selectedId == null || selectedId === currentPokemonId) ? 'not-allowed' : 'pointer',
                opacity: (selectedId == null || selectedId === currentPokemonId) ? 0.5 : 1,
                fontFamily: "'Figtree', sans-serif",
              }}
            >{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
