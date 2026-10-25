/**
 * 终端分屏面板树（0.1.3）— 纯逻辑、可单测。
 *
 * 每个「标签」持有一棵 `TerminalLayoutNode` 树：叶子 = 一个 pty 会话 id。
 * 不变量：叶子 id 唯一；split.ratio 夹在 [PANE_MIN_RATIO, PANE_MAX_RATIO]。
 * 序列化结构定义在 `@wslpilot/shared`（`TerminalLayoutNode`），与 `ui-state.terminalLayout` 同源。
 */
import type { TerminalLayoutNode } from '@wslpilot/shared'

export type PaneNode = TerminalLayoutNode
export type PaneDir = 'row' | 'col'

export const PANE_MIN_RATIO = 0.15
export const PANE_MAX_RATIO = 0.85
/** 单标签最大面板数（会话总量另受 MAX_PTY_SESSIONS 约束） */
export const MAX_PANES_PER_TAB = 4
/** 恢复持久化布局时的最大深度（防脏数据/深嵌套） */
export const MAX_LAYOUT_DEPTH = 8

export function makeLeaf(ptyId: string): PaneNode {
  return { kind: 'leaf', ptyId }
}

export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0.5
  return Math.min(PANE_MAX_RATIO, Math.max(PANE_MIN_RATIO, ratio))
}

/** 全部叶子 id（前序：先 a 后 b，与渲染顺序一致） */
export function leafIds(node: PaneNode): string[] {
  if (node.kind === 'leaf') return [node.ptyId]
  return [...leafIds(node.a), ...leafIds(node.b)]
}

export function paneCount(node: PaneNode): number {
  return leafIds(node).length
}

/** 第一个叶子（活动面板回退目标） */
export function firstLeafId(node: PaneNode): string {
  let cur: PaneNode = node
  while (cur.kind === 'split') cur = cur.a
  return cur.ptyId
}

export function containsLeaf(node: PaneNode, ptyId: string): boolean {
  if (node.kind === 'leaf') return node.ptyId === ptyId
  return containsLeaf(node.a, ptyId) || containsLeaf(node.b, ptyId)
}

/**
 * 把目标叶子替换为 split(target, newLeaf)（新面板在 b 侧）。
 * 目标不存在返回 null（调用方回滚已建会话）。
 */
export function splitLeaf(
  root: PaneNode,
  targetPtyId: string,
  newPtyId: string,
  dir: PaneDir,
): PaneNode | null {
  if (root.kind === 'leaf') {
    if (root.ptyId !== targetPtyId) return null
    return { kind: 'split', dir, ratio: 0.5, a: makeLeaf(targetPtyId), b: makeLeaf(newPtyId) }
  }
  const a = splitLeaf(root.a, targetPtyId, newPtyId, dir)
  if (a) return { ...root, a }
  const b = splitLeaf(root.b, targetPtyId, newPtyId, dir)
  if (b) return { ...root, b }
  return null
}

/**
 * 移除叶子并折叠父 split（兄弟上提）。
 * 返回 null 表示树已空（调用方移除标签）；目标不存在时原样返回。
 */
export function removeLeaf(root: PaneNode, ptyId: string): PaneNode | null {
  if (root.kind === 'leaf') return root.ptyId === ptyId ? null : root
  const a = removeLeaf(root.a, ptyId)
  if (a === null) return root.b
  const b = removeLeaf(root.b, ptyId)
  if (b === null) return root.a
  return { ...root, a, b }
}

/**
 * 按路径（'a' | 'b' 序列）设置 split 比例。
 * 路径不指向 split 时原样返回（脏路径静默忽略，不抛）。
 */
export function setRatioAt(root: PaneNode, path: readonly ('a' | 'b')[], ratio: number): PaneNode {
  if (path.length === 0) {
    return root.kind === 'split' ? { ...root, ratio: clampRatio(ratio) } : root
  }
  if (root.kind !== 'split') return root
  const [head, ...rest] = path as ('a' | 'b')[]
  if (head !== 'a' && head !== 'b') return root
  return { ...root, [head]: setRatioAt(root[head], rest, ratio) }
}

/** 收集 split 节点路径（渲染分割条用）：{ path, dir, ratio } */
export function splitPaths(
  node: PaneNode,
  path: ('a' | 'b')[] = [],
): Array<{ path: ('a' | 'b')[]; dir: PaneDir; ratio: number }> {
  if (node.kind === 'leaf') return []
  return [
    { path, dir: node.dir, ratio: node.ratio },
    ...splitPaths(node.a, [...path, 'a']),
    ...splitPaths(node.b, [...path, 'b']),
  ]
}

/** 归一化矩形（0..1，相对终端容器） */
export interface PaneRect {
  x: number
  y: number
  w: number
  h: number
}

/** 叶子面板的绝对位置（0.1.4：扁平渲染，XtermPane 实例不再随 split 重建） */
export interface PanePlacement extends PaneRect {
  ptyId: string
}

/** 分割条的父矩形 + 比例（组件据此换算像素位置与拖拽） */
export interface PaneDividerPlacement {
  path: ('a' | 'b')[]
  dir: PaneDir
  ratio: number
  parent: PaneRect
}

const FULL_RECT: PaneRect = { x: 0, y: 0, w: 1, h: 1 }

/**
 * 计算每个叶子的归一化矩形（前序，与 leafIds 顺序一致）。
 * 纯函数：分屏树怎么变，已有 ptyId 的矩形只变 x/y/w/h，组件实例保持不变。
 */
export function layoutRects(node: PaneNode, rect: PaneRect = FULL_RECT): PanePlacement[] {
  if (node.kind === 'leaf') return [{ ptyId: node.ptyId, ...rect }]
  const ratio = clampRatio(node.ratio)
  if (node.dir === 'row') {
    const aw = rect.w * ratio
    return [
      ...layoutRects(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }),
      ...layoutRects(node.b, { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h }),
    ]
  }
  const ah = rect.h * ratio
  return [
    ...layoutRects(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }),
    ...layoutRects(node.b, { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah }),
  ]
}

/** 计算全部分割条的父矩形与比例（扁平渲染，不再递归挂组件） */
export function layoutDividers(
  node: PaneNode,
  rect: PaneRect = FULL_RECT,
  path: ('a' | 'b')[] = [],
): PaneDividerPlacement[] {
  if (node.kind === 'leaf') return []
  const ratio = clampRatio(node.ratio)
  const out: PaneDividerPlacement[] = [{ path, dir: node.dir, ratio, parent: rect }]
  if (node.dir === 'row') {
    const aw = rect.w * ratio
    out.push(
      ...layoutDividers(node.a, { x: rect.x, y: rect.y, w: aw, h: rect.h }, [...path, 'a']),
      ...layoutDividers(node.b, { x: rect.x + aw, y: rect.y, w: rect.w - aw, h: rect.h }, [
        ...path,
        'b',
      ]),
    )
  } else {
    const ah = rect.h * ratio
    out.push(
      ...layoutDividers(node.a, { x: rect.x, y: rect.y, w: rect.w, h: ah }, [...path, 'a']),
      ...layoutDividers(node.b, { x: rect.x, y: rect.y + ah, w: rect.w, h: rect.h - ah }, [
        ...path,
        'b',
      ]),
    )
  }
  return out
}

/**
 * 恢复持久化布局：丢弃不在 `aliveIds` 中的叶子并折叠单子 split。
 * 深度超限视为脏数据**整树拒绝**（返回 null，调用方退化为独立标签）；空树返回 null。
 */
export function pruneLayout(node: unknown, aliveIds: ReadonlySet<string>): PaneNode | null {
  const state = { tooDeep: false, seen: new Set<string>() }
  const result = pruneInner(node, aliveIds, 0, state)
  return state.tooDeep ? null : result
}

function pruneInner(
  node: unknown,
  aliveIds: ReadonlySet<string>,
  depth: number,
  state: { tooDeep: boolean; seen: Set<string> },
): PaneNode | null {
  if (depth > MAX_LAYOUT_DEPTH) {
    state.tooDeep = true
    return null
  }
  if (node === null || typeof node !== 'object') return null
  const n = node as Partial<PaneNode> & { kind?: unknown }
  if (n.kind === 'leaf') {
    const id = (n as { ptyId?: unknown }).ptyId
    if (typeof id !== 'string' || id === '' || !aliveIds.has(id)) return null
    // 叶子 id 唯一不变量（文档声明）：手改脏数据里的重复 id 只保留首个，
    // 否则同一会话会绑两个面板（双渲染/双监听）
    if (state.seen.has(id)) return null
    state.seen.add(id)
    return makeLeaf(id)
  }
  if (n.kind === 'split') {
    const dir = (n as { dir?: unknown }).dir
    const ratio = (n as { ratio?: unknown }).ratio
    if ((dir !== 'row' && dir !== 'col') || typeof ratio !== 'number') return null
    const a = pruneInner((n as { a?: unknown }).a, aliveIds, depth + 1, state)
    const b = pruneInner((n as { b?: unknown }).b, aliveIds, depth + 1, state)
    if (!a) return b
    if (!b) return a
    return { kind: 'split', dir, ratio: clampRatio(ratio), a, b }
  }
  return null
}
