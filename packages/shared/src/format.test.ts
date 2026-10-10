import { describe, it, expect } from 'vitest'
import { distroIconEmoji, formatBytes, formatKb, formatKbPair, stateLabel } from '../src/format'
import { EMPTY_OVERVIEW } from '../src/types'

describe('formatKb', () => {
  it('formats zero/invalid as dash', () => {
    expect(formatKb(0)).toBe('—')
    expect(formatKb(-1)).toBe('—')
  })

  it('formats KB / MB / GB / TB', () => {
    expect(formatKb(512)).toBe('512K')
    expect(formatKb(2048)).toBe('2.0G')
    expect(formatKb(2 * 1024 * 1024)).toBe('2.0T')
  })
})

describe('formatKbPair', () => {
  it('returns dash when total is zero', () => {
    expect(formatKbPair(100, 0)).toBe('—')
  })
  it('formats used/total', () => {
    expect(formatKbPair(1024, 2048)).toBe('1.0G / 2.0G')
  })
})

describe('EMPTY_OVERVIEW', () => {
  it('is all-zero overview', () => {
    expect(EMPTY_OVERVIEW.runningCount).toBe(0)
    expect(EMPTY_OVERVIEW.diskUsedKB).toBe(0)
    expect(EMPTY_OVERVIEW.memTotalKB).toBe(0)
  })
})

describe('distroIconEmoji — meta.icon 真正生效（幽灵字段根治）', () => {
  it('meta.icon 显式声明优先于发行版名推断', () => {
    expect(distroIconEmoji('fedora', 'Ubuntu-22.04')).toBe('🎩')
    expect(distroIconEmoji('ubuntu', 'Debian')).toBe('🐧')
  })

  it('未填 icon 时按发行版名前缀推断', () => {
    expect(distroIconEmoji(undefined, 'Ubuntu-22.04')).toBe('🐧')
    expect(distroIconEmoji('', 'Debian-12')).toBe('🌀')
    expect(distroIconEmoji(undefined, 'Alpine')).toBe('🏔️')
  })

  it('未识别的图标名/发行版名回退 🐧，不抛错', () => {
    expect(distroIconEmoji('nope', 'weird-name')).toBe('🐧')
    expect(distroIconEmoji(undefined, undefined)).toBe('🐧')
  })
})

describe('stateLabel / formatBytes', () => {
  it('stateLabel 中文映射', () => {
    expect(stateLabel('Running')).toBe('运行中')
    expect(stateLabel('Stopped')).toBe('已停止')
    expect(stateLabel('Unknown')).toBe('未知')
    expect(stateLabel('')).toBe('未知')
    expect(stateLabel('Custom')).toBe('Custom')
  })

  it('formatBytes 单位换算', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(512)).toBe('512B')
    expect(formatBytes(2048)).toBe('2.0KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0MB')
    expect(formatBytes(-1)).toBe('0B')
  })
})
