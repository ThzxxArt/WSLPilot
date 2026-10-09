import { describe, it, expect, vi } from 'vitest'
import {
  parsePaletteQuery,
  filterPaletteItems,
  groupPaletteItems,
  recentPaletteItems,
  pushRecentId,
  type PaletteItem,
} from '../../src/renderer/features/command/palette'

function item(over: Partial<PaletteItem>): PaletteItem {
  return {
    id: 'x',
    group: '动作',
    label: 'X',
    run: vi.fn(),
    ...over,
  }
}

const ITEMS: PaletteItem[] = [
  item({ id: 'act-update', group: '动作', label: '运行动作：全量更新', hint: 'update-all' }),
  item({ id: 'act-shutdown', group: '动作', label: '全部关机', keywords: 'shutdown' }),
  item({ id: 'term-u', group: '发行版', label: '打开终端：Ubuntu', hint: 'WSL2' }),
  item({ id: 'nav-dash', group: '导航', label: '前往：驾驶舱' }),
  item({ id: 'set-accent', group: '设置', label: '设置：切换强调色' }),
]

describe('parsePaletteQuery', () => {
  it('识别前缀模式', () => {
    expect(parsePaletteQuery('> x')).toEqual({ prefix: '>', text: 'x' })
    expect(parsePaletteQuery('@ u')).toEqual({ prefix: '@', text: 'u' })
    expect(parsePaletteQuery('# s')).toEqual({ prefix: '#', text: 's' })
  })

  it('仅输入前缀字符也进入模式', () => {
    expect(parsePaletteQuery('>')).toEqual({ prefix: '>', text: '' })
    expect(parsePaletteQuery('@')).toEqual({ prefix: '@', text: '' })
    expect(parsePaletteQuery('#')).toEqual({ prefix: '#', text: '' })
  })

  it('无前缀', () => {
    expect(parsePaletteQuery('终端')).toEqual({ prefix: null, text: '终端' })
    expect(parsePaletteQuery('')).toEqual({ prefix: null, text: '' })
  })
})

describe('filterPaletteItems', () => {
  it('空输入返回全部', () => {
    expect(filterPaletteItems(ITEMS, '')).toHaveLength(ITEMS.length)
  })

  it('前缀限定分组', () => {
    const cmds = filterPaletteItems(ITEMS, '>')
    expect(cmds.every((c) => c.group === '动作' || c.group === '导航')).toBe(true)
    const distros = filterPaletteItems(ITEMS, '@')
    expect(distros.map((c) => c.id)).toEqual(['term-u'])
    const settings = filterPaletteItems(ITEMS, '#')
    expect(settings.map((c) => c.id)).toEqual(['set-accent'])
  })

  it('模糊匹配并按分数排序', () => {
    const r = filterPaletteItems(ITEMS, '终端')
    expect(r[0]!.id).toBe('term-u')
  })

  it('前缀 + 过滤词组合', () => {
    const r = filterPaletteItems(ITEMS, '> 关机')
    expect(r.map((c) => c.id)).toEqual(['act-shutdown'])
    expect(filterPaletteItems(ITEMS, '> nope')).toEqual([])
  })

  it('keywords 参与匹配', () => {
    const r = filterPaletteItems(ITEMS, 'shutdown')
    expect(r.map((c) => c.id)).toEqual(['act-shutdown'])
  })
})

describe('groupPaletteItems', () => {
  it('按动作/发行版/导航/设置顺序折叠', () => {
    const g = groupPaletteItems(ITEMS)
    expect(g.map((x) => x.group)).toEqual(['动作', '发行版', '导航', '设置'])
    expect(g[0]!.items).toHaveLength(2)
  })

  it('空列表返回空', () => {
    expect(groupPaletteItems([])).toEqual([])
  })
})

describe('recentPaletteItems / pushRecentId', () => {
  it('按最近顺序返回并去重', () => {
    const r = recentPaletteItems(ITEMS, ['nav-dash', 'term-u', 'nav-dash', 'nope'])
    expect(r.map((x) => x.id)).toEqual(['nav-dash', 'term-u'])
  })

  it('limit 截断', () => {
    const r = recentPaletteItems(ITEMS, ['act-update', 'act-shutdown', 'term-u'], 2)
    expect(r).toHaveLength(2)
  })

  it('pushRecentId 最新在前去重封顶', () => {
    let ids: string[] = []
    ids = pushRecentId(ids, 'a')
    ids = pushRecentId(ids, 'b')
    ids = pushRecentId(ids, 'a')
    expect(ids).toEqual(['a', 'b'])
    for (let i = 0; i < 15; i++) ids = pushRecentId(ids, `x${i}`)
    expect(ids).toHaveLength(10)
    expect(ids[0]).toBe('x14')
  })
})
