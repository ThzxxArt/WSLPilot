import { describe, it, expect } from 'vitest'
import { fuzzyMatch, filterRanked } from './fuzzy'

describe('fuzzyMatch', () => {
  it('空 query 得零分命中', () => {
    expect(fuzzyMatch('', 'abc')).toEqual({ score: 0, indices: [] })
  })

  it('子序列命中返回下标', () => {
    const r = fuzzyMatch('ush', 'Ubuntu Shell')
    expect(r).not.toBeNull()
    expect(r!.indices.length).toBe(3)
    for (let i = 1; i < r!.indices.length; i++) {
      expect(r!.indices[i]!).toBeGreaterThan(r!.indices[i - 1]!)
    }
  })

  it('非子序列返回 null', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull()
    expect(fuzzyMatch('aaa', 'a')).toBeNull()
  })

  it('大小写不敏感', () => {
    expect(fuzzyMatch('UBU', 'ubuntu')).not.toBeNull()
    expect(fuzzyMatch('ubuntu', 'UBUNTU')).not.toBeNull()
  })

  it('连续命中得分高于零散命中', () => {
    const consecutive = fuzzyMatch('term', 'terminal')!
    const scattered = fuzzyMatch('term', 'tolerate-me-raw')!
    expect(consecutive.score).toBeGreaterThan(scattered.score)
  })

  it('前缀命中得分更高', () => {
    const prefix = fuzzyMatch('set', 'settings')!
    const middle = fuzzyMatch('set', 'dataset-info')!
    expect(prefix.score).toBeGreaterThan(middle.score)
  })

  it('词首命中有奖励', () => {
    const boundary = fuzzyMatch('dl', 'distro list')!
    const inner = fuzzyMatch('dl', 'handled')!
    expect(boundary.score).toBeGreaterThan(inner.score)
  })
})

describe('filterRanked', () => {
  const items = ['驾驶舱 Dashboard', '发行版 Distros', '终端 Terminal', '设置 Settings']

  it('空 query 原序返回全部', () => {
    const r = filterRanked(items, '', (s) => s)
    expect(r.map((x) => x.item)).toEqual(items)
  })

  it('过滤并按分数降序', () => {
    const r = filterRanked(items, '设', (s) => s)
    expect(r.length).toBeGreaterThan(0)
    expect(r[0]!.item).toContain('设置')
  })

  it('多词 AND 过滤', () => {
    const r = filterRanked(items, '终 term', (s) => s)
    expect(r.map((x) => x.item)).toEqual(['终端 Terminal'])
    expect(filterRanked(items, '终 zzz', (s) => s)).toEqual([])
  })

  it('返回命中下标去重升序', () => {
    const r = filterRanked(['aab'], 'ab', (s) => s)
    expect(r[0]!.indices).toEqual([0, 2])
  })
})
