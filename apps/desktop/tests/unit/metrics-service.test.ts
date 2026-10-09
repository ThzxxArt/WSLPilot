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
        diskUsed: '1G',
        diskTotal: '10G',
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
    expect(result.diskUsed).toBe('0B')
    expect(wsl.sampleMetrics).not.toHaveBeenCalled()
  })

  it('tolerates per-distro sample failures', async () => {
    const wsl: any = {
      sampleMetrics: vi.fn(async (name: string) => {
        if (name === 'bad') throw new Error('fail')
        return {
          memUsedKB: 100,
          memTotalKB: 200,
          diskUsed: '1G',
          diskTotal: '2G',
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
  })

  it('uses single-distro disk strings when exactly one running', async () => {
    const wsl: any = {
      sampleMetrics: vi.fn(async () => ({
        memUsedKB: 1,
        memTotalKB: 2,
        diskUsed: '12.3G',
        diskTotal: '251G',
        cpuPercent: 1,
        sampledAt: 'T',
      })),
    }
    const result = await sampleOverview(wsl, [distro('only', 'Running')], logger())
    expect(result.diskUsed).toBe('12.3G')
    expect(result.diskTotal).toBe('251G')
  })

  it('EMPTY_OVERVIEW has zero counts', () => {
    expect(EMPTY_OVERVIEW.runningCount).toBe(0)
    expect(EMPTY_OVERVIEW.totalCount).toBe(0)
  })
})
