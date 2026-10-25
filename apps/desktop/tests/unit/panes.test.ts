import { describe, it, expect } from 'vitest'
import {
  clampRatio,
  containsLeaf,
  firstLeafId,
  leafIds,
  makeLeaf,
  paneCount,
  pruneLayout,
  removeLeaf,
  setRatioAt,
  splitLeaf,
  splitPaths,
  layoutRects,
  layoutDividers,
  MAX_LAYOUT_DEPTH,
  PANE_MAX_RATIO,
  PANE_MIN_RATIO,
  type PaneNode,
} from '../../src/renderer/features/terminal/panes'

const leaf = (id: string): PaneNode => ({ kind: 'leaf', ptyId: id })

describe('panes 纯逻辑（0.1.3 终端分屏）', () => {
  it('leafIds / paneCount / firstLeafId / containsLeaf', () => {
    const tree: PaneNode = {
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: leaf('a'),
      b: { kind: 'split', dir: 'col', ratio: 0.4, a: leaf('b'), b: leaf('c') },
    }
    expect(leafIds(tree)).toEqual(['a', 'b', 'c'])
    expect(paneCount(tree)).toBe(3)
    expect(firstLeafId(tree)).toBe('a')
    expect(containsLeaf(tree, 'b')).toBe(true)
    expect(containsLeaf(tree, 'zzz')).toBe(false)
    expect(makeLeaf('x')).toEqual({ kind: 'leaf', ptyId: 'x' })
  })

  it('splitLeaf：命中的叶子替换为 split（新面板在 b 侧）；未命中返回 null（调用方回滚）', () => {
    const out = splitLeaf(leaf('a'), 'a', 'b', 'row') as PaneNode
    expect(out).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: { kind: 'leaf', ptyId: 'a' },
      b: { kind: 'leaf', ptyId: 'b' },
    })
    // 嵌套树内命中
    const nested = splitLeaf(out, 'b', 'c', 'col') as PaneNode
    expect(leafIds(nested)).toEqual(['a', 'b', 'c'])
    expect(splitLeaf(nested, 'zzz', 'd', 'row')).toBeNull()
  })

  it('removeLeaf：折叠父 split（兄弟上提）；空树返回 null；未命中原样返回', () => {
    const tree: PaneNode = {
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: leaf('a'),
      b: { kind: 'split', dir: 'col', ratio: 0.4, a: leaf('b'), b: leaf('c') },
    }
    const afterB = removeLeaf(tree, 'b') as PaneNode
    // 内层 split 折叠为单个 c，外层保持不变
    expect(afterB).toEqual({ ...tree, b: { kind: 'leaf', ptyId: 'c' } })
    const afterAll: PaneNode | null = removeLeaf(removeLeaf(removeLeaf(tree, 'b')!, 'c')!, 'a')
    expect(afterAll).toBeNull()
    expect(removeLeaf(tree, 'zzz')).toEqual(tree)
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
  })

  it('setRatioAt：按路径更新 + 夹取 [0.15, 0.85]；脏路径静默忽略', () => {
    const tree: PaneNode = {
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: leaf('a'),
      b: { kind: 'split', dir: 'col', ratio: 0.5, a: leaf('b'), b: leaf('c') },
    }
    const rootSet = setRatioAt(tree, [], 0.99) as { ratio: number }
    expect(rootSet.ratio).toBe(PANE_MAX_RATIO)
    const innerSet = setRatioAt(tree, ['b'], -5) as { b: { ratio: number } }
    expect(innerSet.b.ratio).toBe(PANE_MIN_RATIO)
    // 不指向 split 的路径：原样返回不抛
    expect(setRatioAt(tree, ['a'], 0.3)).toEqual(tree)
    expect(setRatioAt(leaf('a'), [], 0.3)).toEqual(leaf('a'))
    expect(clampRatio(Number.NaN)).toBe(0.5)
  })

  it('splitPaths：枚举全部分割条（含嵌套路径）', () => {
    const tree: PaneNode = {
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: leaf('a'),
      b: { kind: 'split', dir: 'col', ratio: 0.4, a: leaf('b'), b: leaf('c') },
    }
    expect(splitPaths(tree)).toEqual([
      { path: [], dir: 'row', ratio: 0.5 },
      { path: ['b'], dir: 'col', ratio: 0.4 },
    ])
    expect(splitPaths(leaf('a'))).toEqual([])
  })

  it('pruneLayout：丢弃死叶子并折叠；比例夹取；空树/脏数据/超深返回 null', () => {
    const alive = new Set(['p1', 'p2'])
    const saved = {
      kind: 'split',
      dir: 'row',
      ratio: 1.7,
      a: { kind: 'leaf', ptyId: 'p1' },
      b: {
        kind: 'split',
        dir: 'col',
        ratio: 0.5,
        a: { kind: 'leaf', ptyId: 'dead' },
        b: { kind: 'leaf', ptyId: 'p2' },
      },
    }
    expect(pruneLayout(saved, alive)).toEqual({
      kind: 'split',
      dir: 'row',
      ratio: PANE_MAX_RATIO,
      a: { kind: 'leaf', ptyId: 'p1' },
      b: { kind: 'leaf', ptyId: 'p2' },
    })
    // 全部死叶子 → null（调用方跳过该标签）
    expect(pruneLayout({ kind: 'leaf', ptyId: 'dead' }, alive)).toBeNull()
    // 脏数据
    expect(pruneLayout(null, alive)).toBeNull()
    expect(pruneLayout({ kind: 'split', dir: 'x', ratio: 0.5, a: null, b: null }, alive)).toBeNull()
    expect(pruneLayout({ kind: 'leaf', ptyId: '' }, alive)).toBeNull()
    // 超深嵌套 → null（防脏数据栈溢出）
    let deep: unknown = { kind: 'leaf', ptyId: 'p1' }
    for (let i = 0; i < MAX_LAYOUT_DEPTH + 3; i++) {
      deep = { kind: 'split', dir: 'row', ratio: 0.5, a: deep, b: { kind: 'leaf', ptyId: 'p1' } }
    }
    expect(pruneLayout(deep, alive)).toBeNull()

    // 叶子 id 唯一不变量：手改脏数据重复 id → 只保留首个（同会话不绑两个面板）
    const dup = {
      kind: 'split',
      dir: 'row',
      ratio: 0.5,
      a: { kind: 'leaf', ptyId: 'p1' },
      b: { kind: 'leaf', ptyId: 'p1' },
    }
    expect(pruneLayout(dup, new Set(['p1']))).toEqual({ kind: 'leaf', ptyId: 'p1' })
  })

  it('layoutRects：归一化矩形无缝铺满，split/close 只改几何不换 ptyId', () => {
    const tree: PaneNode = {
      kind: 'split',
      dir: 'row',
      ratio: 0.3,
      a: leaf('a'),
      b: { kind: 'split', dir: 'col', ratio: 0.6, a: leaf('b'), b: leaf('c') },
    }
    const rects = layoutRects(tree)
    expect(rects.map((r) => r.ptyId)).toEqual(['a', 'b', 'c'])
    expect(rects[0]).toMatchObject({ x: 0, y: 0, w: 0.3, h: 1 })
    expect(rects[1]!.x).toBeCloseTo(0.3)
    expect(rects[1]!.h).toBeCloseTo(0.6)
    expect(rects[2]!.y).toBeCloseTo(0.6)
    // 面积和 = 1（没有重叠/空洞）
    const area = rects.reduce((s, r) => s + r.w * r.h, 0)
    expect(area).toBeCloseTo(1)
  })

  it('layoutDividers：每个 split 一条，父矩形用于拖拽换算', () => {
    const tree: PaneNode = {
      kind: 'split',
      dir: 'col',
      ratio: 0.25,
      a: leaf('a'),
      b: { kind: 'split', dir: 'row', ratio: 0.5, a: leaf('b'), b: leaf('c') },
    }
    const ds = layoutDividers(tree)
    expect(ds).toHaveLength(2)
    expect(ds[0]).toMatchObject({ dir: 'col', path: [], parent: { x: 0, y: 0, w: 1, h: 1 } })
    expect(ds[1]!.parent.h).toBeCloseTo(0.75)
    expect(ds[1]!.parent.y).toBeCloseTo(0.25)
  })
})
