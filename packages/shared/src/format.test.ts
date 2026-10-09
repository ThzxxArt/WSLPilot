import { describe, it, expect } from 'vitest'
import { formatKb, formatKbPair } from '../src/format'
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
