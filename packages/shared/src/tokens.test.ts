import { describe, it, expect } from 'vitest'
import {
  PRIMITIVE_GRADIENTS,
  SEMANTIC_LIGHT,
  ACCENT_MAPS,
  SEMANTIC_TO_CSS,
} from '../src/tokens'
import { ACCENT_GRADIENTS, ACCENT_PRIMARY, ACCENT_MAPS as CONST_ACCENT_MAPS } from '../src/constants'

describe('设计令牌单源一致性', () => {
  it('constants re-exports match tokens source of truth', () => {
    expect(ACCENT_GRADIENTS).toBe(PRIMITIVE_GRADIENTS)
    expect(CONST_ACCENT_MAPS).toBe(ACCENT_MAPS)
  })

  it('every semantic key has a CSS variable mapping', () => {
    for (const key of Object.keys(SEMANTIC_LIGHT)) {
      expect(SEMANTIC_TO_CSS[key as keyof typeof SEMANTIC_TO_CSS]).toBeTruthy()
    }
  })

  it('accent primary colors match accentMaps', () => {
    for (const [name, map] of Object.entries(ACCENT_MAPS)) {
      if (name === 'custom') continue
      expect(ACCENT_PRIMARY[name as keyof typeof ACCENT_PRIMARY]).toBe(map.accent)
    }
  })

  it('all accents have required fields', () => {
    for (const [name, map] of Object.entries(ACCENT_MAPS)) {
      expect(map.accent, name).toBeTruthy()
      expect(map.accentHover, name).toBeTruthy()
      expect(map.accentSoft, name).toBeTruthy()
      expect(map.bgActive, name).toBeTruthy()
    }
  })
})
