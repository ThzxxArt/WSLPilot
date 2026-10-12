import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as tokensNs from '../src/tokens'
import {
  PRIMITIVE_GRADIENTS,
  SEMANTIC_LIGHT,
  ACCENT_MAPS,
  SEMANTIC_TO_CSS,
  SHADOW,
  Z_INDEX,
} from '../src/tokens'
import {
  ACCENT_GRADIENTS,
  ACCENT_PRIMARY,
  ACCENT_MAPS as CONST_ACCENT_MAPS,
} from '../src/constants'

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

describe('死 token 已根治（源侧）', () => {
  it('SPACING 不再导出（space-* 全仓零消费）', () => {
    expect('SPACING' in tokensNs).toBe(false)
  })

  it('ACCENT_MAPS 不含 custom 幽灵键（占位枚举已移除）', () => {
    expect('custom' in ACCENT_MAPS).toBe(false)
    expect(Object.keys(ACCENT_MAPS).sort()).toEqual(['aurora', 'forest', 'ocean', 'sunset'])
  })

  it('SHADOW 只剩 utilities.scss 有消费的 xs/md', () => {
    expect(Object.keys(SHADOW)).toEqual(['shadow-xs', 'shadow-md'])
  })

  it('Z_INDEX 只剩有消费的 z-toast', () => {
    expect(Object.keys(Z_INDEX)).toEqual(['z-toast'])
    expect(Z_INDEX['z-toast']).toBe('1400')
  })
})

describe('死 token 已根治（gen-tokens 生成物与源一致）', () => {
  const scss = readFileSync(
    new URL('../../ui/src/styles/tokens.generated.scss', import.meta.url),
    'utf8',
  )

  it('生成物不含 --space-* / --shadow-glow / --glass-border / 超集 z-*', () => {
    expect(scss).not.toMatch(/--space-/)
    expect(scss).not.toContain('--shadow-glow')
    expect(scss).not.toContain('--glass-border')
    expect(scss).not.toMatch(/--z-(base|dropdown|sticky|drawer|modal|tooltip|command)/)
  })

  it('生成物不含幽灵 gradient-custom（与唯一事实源逐一对账 — review 根治）', () => {
    expect(scss).not.toContain('gradient-custom')
    const sourceKeys = Object.keys(PRIMITIVE_GRADIENTS).sort()
    const generated = [...scss.matchAll(/--gradient-([a-z]+):/g)].map((m) => m[1]!).sort()
    expect(generated).toEqual(sourceKeys)
  })

  it('存活 token 仍在生成物里（shadow-xs/md、z-toast、glass-bg/blur）', () => {
    expect(scss).toContain('--shadow-xs:')
    expect(scss).toContain('--shadow-md:')
    expect(scss).toContain('--z-toast:')
    expect(scss).toContain('--glass-bg:')
    expect(scss).toContain('--glass-blur:')
  })
})
