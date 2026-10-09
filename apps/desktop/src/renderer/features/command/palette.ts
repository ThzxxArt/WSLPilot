/**
 * 命令面板纯逻辑（M5 ⌘K — 设计书 §13.3）：
 * 前缀模式 `> ` 命令 / `@ ` 发行版 / `# ` 设置；模糊匹配；分组；最近使用。
 */
import { filterRanked } from '@shared/fuzzy'

export type PaletteGroup = '导航' | '发行版' | '动作' | '设置'

export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  hint?: string
  /** 图标（emoji / 图标名） */
  icon?: string
  /** 快捷键提示（Kbd） */
  keys?: string[]
  /** 附加可搜索文本 */
  keywords?: string
  run: () => unknown
}

export type PalettePrefix = '>' | '@' | '#' | null

/** 解析输入前缀（`> ` / `@ ` / `# `） */
export function parsePaletteQuery(query: string): { prefix: PalettePrefix; text: string } {
  const q = query ?? ''
  if (q.startsWith('> ')) return { prefix: '>', text: q.slice(2) }
  if (q.startsWith('@ ')) return { prefix: '@', text: q.slice(2) }
  if (q.startsWith('# ')) return { prefix: '#', text: q.slice(2) }
  // 仅输入前缀字符（还没打空格）也算进入该模式
  if (q === '>') return { prefix: '>', text: '' }
  if (q === '@') return { prefix: '@', text: '' }
  if (q === '#') return { prefix: '#', text: '' }
  return { prefix: null, text: q }
}

const PREFIX_GROUPS: Record<Exclude<PalettePrefix, null>, PaletteGroup[]> = {
  '>': ['动作', '导航'],
  '@': ['发行版'],
  '#': ['设置'],
}

/** 过滤 + 模糊排序（前缀限定分组；空输入原序） */
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const { prefix, text } = parsePaletteQuery(query)
  const scoped = prefix ? items.filter((i) => PREFIX_GROUPS[prefix].includes(i.group)) : items
  const ranked = filterRanked(scoped, text, (i) =>
    [i.label, i.hint ?? '', i.keywords ?? ''].join(' '),
  )
  return ranked.map((r) => r.item)
}

/** 按分组折叠（保持分组顺序） */
export function groupPaletteItems(
  items: PaletteItem[],
): Array<{ group: PaletteGroup; items: PaletteItem[] }> {
  const order: PaletteGroup[] = ['动作', '发行版', '导航', '设置']
  const map = new Map<PaletteGroup, PaletteItem[]>()
  for (const i of items) {
    const list = map.get(i.group) ?? []
    list.push(i)
    map.set(i.group, list)
  }
  return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }))
}

/** 最近使用（按 recency 顺序取前 N 个，去重） */
export function recentPaletteItems(
  items: PaletteItem[],
  recentIds: string[],
  limit = 6,
): PaletteItem[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out: PaletteItem[] = []
  const seen = new Set<string>()
  for (const id of recentIds) {
    if (seen.has(id)) continue
    const item = byId.get(id)
    if (item) {
      out.push(item)
      seen.add(id)
    }
    if (out.length >= limit) break
  }
  return out
}

/** 执行后记录（最新在前，去重，上限 10） */
export function pushRecentId(recentIds: string[], id: string): string[] {
  return [id, ...recentIds.filter((x) => x !== id)].slice(0, 10)
}
