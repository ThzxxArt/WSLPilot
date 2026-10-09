import { describe, it, expect, vi } from 'vitest'
import { sampleOverview, EMPTY_OVERVIEW } from '../../src/main/services/metrics-service'
import type { DistroRuntime } from '@wslpilot/shared'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as any
}

const distro = (name: string, state: DistroRuntime['state']): DistroRuntime => ({
  name,
  state,
  version: 2,
  isDefault: false,
})

describe('sampleOverview', () => {
  it('aggregates running distros only', async () => {
    const wsl: any = {
      sampleMetrics: vi.fn(async (name: string) => ({
        memUsedKB: name === 'A' ? 1000 : 2000,
        memTotalKB: 8000,
        diskUsedKB: 1024,
        diskTotalKB: 10240,
        cpuPercent: name === 'A' ? 10 : 30,
        sampledAt: 'T',
      })),
    }
    const result = await sampleOverview(
      wsl,
      [distro('A', 'Running'), distro('B', 'Running'), distro('C', 'Stopped')],
      logger(),
    )
    expect(result.runningCount).toBe(2)
    expect(result.totalCount).toBe(3)
    expect(result.memUsedKB).toBe(3000)
    expect(result.memTotalKB).toBe(16000)
    expect(result.cpuPercent).toBe(20)
    expect(wsl.sampleMetrics).toHaveBeenCalledTimes(2)
    expect(result.perDistro.A).toBeTruthy()
    expect(result.perDistro.C).toBeUndefined()
  })

  it('returns empty overview when nothing running', async () => {
    const wsl: any = { sampleMetrics: vi.fn() }
    const result = await sampleOverview(wsl, [distro('A', 'Stopped')], logger())
    expect(result.runningCount).toBe(0)
    expect(result.cpuPercent).toBe(0)
    expect(result.diskUsedKB).toBe(0)
    expect(result.diskTotalKB).toBe(0)
    expect(wsl.sampleMetrics).not.toHaveBeenCalled()
  })

  it('tolerates per-distro sample failures', async () => {
    const wsl: any = {
      sampleMetrics: vi.fn(async (name: string) => {
        if (name === 'bad') throw new Error('fail')
        return {
          memUsedKB: 100,
          memTotalKB: 200,
          diskUsedKB: 1024,
          diskTotalKB: 2048,
          cpuPercent: 5,
          sampledAt: 'T',
        }
      }),
    }
    const result = await sampleOverview(
      wsl,
      [distro('good', 'Running'), distro('bad', 'Running')],
      logger(),
    )
    expect(result.runningCount).toBe(2)
    expect(result.perDistro.good).toBeTruthy()
    expect(result.perDistro.bad).toBeUndefined()
    expect(result.diskUsedKB).toBe(1024)
  })

  it('sums real disk KB across multiple running distros (no fake formula)', async () => {
    const wsl: any = {
      sampleMetrics: vi.fn(async (name: string) => ({
        memUsedKB: name === 'A' ? 100 : 200,
        memTotalKB: 1000,
        diskUsedKB: name === 'A' ? 5_000_000 : 7_000_000,
        diskTotalKB: name === 'A' ? 10_000_000 : 20_000_000,
        cpuPercent: 1,
        sampledAt: 'T',
      })),
    }
    const result = await sampleOverview(wsl, [distro('A', 'Running'), distro('B', 'Running')], logger())
    expect(result.diskUsedKB).toBe(12_000_000)
    expect(result.diskTotalKB).toBe(30_000_000)
    // 禁止用内存推算磁盘
    expect(result.diskUsedKB).not.toBe(Math.round(result.memUsedKB * 0.1))
    expect(result.diskTotalKB).not.toBe(result.memTotalKB * 2)
  })

  it('EMPTY_OVERVIEW has zero counts', () => {
    expect(EMPTY_OVERVIEW.runningCount).toBe(0)
    expect(EMPTY_OVERVIEW.totalCount).toBe(0)
  })

  it('CPU average uses only successful samples as denominator', async () => {
    const wsl: any = {
      sampleMetrics: vi.fn(async (name: string) => {
        if (name === 'bad') throw new Error('fail')
        return {
          memUsedKB: 10,
          memTotalKB: 100,
          diskUsedKB: 1,
          diskTotalKB: 2,
          cpuPercent: name === 'a' ? 10 : 30,
          sampledAt: 'T',
        }
      }),
    }
    // 3 running, 1 fails → mean of 10 and 30 = 20 (not 40/3)
    const result = await sampleOverview(
      wsl,
      [distro('a', 'Running'), distro('b', 'Running'), distro('bad', 'Running')],
      logger(),
    )
    expect(result.cpuPercent).toBe(20)
    expect(result.runningCount).toBe(3)
    expect(Object.keys(result.perDistro)).toHaveLength(2)
  })
})
