import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@wslpilot/kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wslpilot/kit')>()
  return {
    ...actual,
    runWsl: vi.fn(),
  }
})

import { createWslService, normalizeState } from '../../src/main/services/wsl-service'
import { runWsl } from '@wslpilot/kit'

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

function ok(stdout: string) {
  return { stdout, stderr: '', code: 0 }
}

describe('normalizeState', () => {
  it('maps English and Chinese state strings', () => {
    expect(normalizeState('Running')).toBe('Running')
    expect(normalizeState('Stopped')).toBe('Stopped')
    expect(normalizeState('正在运行')).toBe('Running')
    expect(normalizeState('已停止')).toBe('Stopped')
    expect(normalizeState('Installing')).toBe('Installing')
    expect(normalizeState('')).toBe('Unknown')
    expect(normalizeState('weird')).toBe('Unknown')
  })
})

describe('WslService', () => {
  const svc = createWslService(logger())

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('list', () => {
    it('parses verbose list', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok('  NAME            STATE           VERSION\r\n* Ubuntu-22.04    Running         2\r\n  Debian          Stopped         1'),
      )
      const list = await svc.list()
      expect(list).toHaveLength(2)
      expect(list[0]).toMatchObject({
        name: 'Ubuntu-22.04',
        state: 'Running',
        version: 2,
        isDefault: true,
      })
      expect(list[1]).toMatchObject({ name: 'Debian', version: 1, isDefault: false })
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--list', '--verbose'])
    })

    it('throws WSL_NOT_FOUND when wsl.exe missing', async () => {
      ;(runWsl as any).mockResolvedValue({
        stdout: '',
        stderr: "'wsl.exe' is not recognized",
        code: 1,
      })
      await expect(svc.list()).rejects.toMatchObject({ code: 'WSL_NOT_FOUND' })
    })

    it('throws WSL_NOT_INSTALLED when WSL disabled', async () => {
      ;(runWsl as any).mockResolvedValue({
        stdout: '',
        stderr: 'Windows Subsystem for Linux is not installed',
        code: 1,
      })
      await expect(svc.list()).rejects.toMatchObject({ code: 'WSL_NOT_INSTALLED' })
    })

    it('throws TASK_FAILED for other errors', async () => {
      ;(runWsl as any).mockResolvedValue({ stdout: '', stderr: 'boom', code: 3 })
      await expect(svc.list()).rejects.toMatchObject({ code: 'TASK_FAILED' })
    })
  })

  describe('listWithMeta', () => {
    it('merges meta from map and fills defaults', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok('NAME STATE VERSION\n* Ubuntu  Running  2\n  Alpine  Stopped  2'),
      )
      const meta = new Map([
        [
          'Ubuntu',
          {
            name: 'Ubuntu',
            alias: '主力',
            tags: ['work'],
            color: '#E95420',
            icon: 'ubuntu',
            note: '',
            startupCwd: '~',
            pinned: true,
            quickActions: [],
          },
        ],
      ])
      const views = await svc.listWithMeta(meta)
      expect(views[0]!.meta?.alias).toBe('主力')
      expect(views[1]!.meta?.alias).toBe('')
      expect(views[1]!.meta?.name).toBe('Alpine')
    })
  })

  describe('start / terminate / shutdown / setDefault', () => {
    it('start uses -d name -e true', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.start('Ubuntu-22.04')
      expect((runWsl as any).mock.calls[0][0]).toEqual(['-d', 'Ubuntu-22.04', '-e', 'true'])
    })

    it('terminate uses --terminate', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.terminate('Debian')
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--terminate', 'Debian'])
    })

    it('shutdown uses --shutdown', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.shutdown()
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--shutdown'])
    })

    it('setDefault uses --set-default', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await svc.setDefault('Ubuntu')
      expect((runWsl as any).mock.calls[0][0]).toEqual(['--set-default', 'Ubuntu'])
    })

    it('rejects empty name', async () => {
      await expect(svc.start('  ')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })

    it('rejects path-like name', async () => {
      await expect(svc.terminate('../etc')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })

    it('rejects control characters and path traversal', async () => {
      await expect(svc.start('bad\nname')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
      await expect(svc.start('bad\0name')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
      await expect(svc.terminate('..')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
      await expect(svc.setDefault('a/../b')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })

    it('allows spaces and unicode in real WSL names', async () => {
      ;(runWsl as any).mockResolvedValue(ok(''))
      await expect(svc.start('Ubuntu 22.04 LTS')).resolves.toBeUndefined()
      await expect(svc.start('测试发行版')).resolves.toBeUndefined()
    })

    it('propagates DISTRO_NOT_FOUND on failure', async () => {
      ;(runWsl as any).mockResolvedValue({
        stdout: '',
        stderr: 'Error: not found',
        code: 1,
      })
      await expect(svc.start('Nope')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })
  })

  describe('getVersion', () => {
    it('extracts wsl and kernel versions', async () => {
      ;(runWsl as any)
        .mockResolvedValueOnce(ok('WSL version: 2.3.26\r\nKernel version: 5.15.153.1'))
        .mockResolvedValueOnce(ok('OK'))
      const v = await svc.getVersion()
      expect(v.wslVersion).toBe('2.3.26')
      expect(v.kernelVersion).toContain('5.15')
    })
  })

  describe('sampleMetrics', () => {
    it('parses free/df/loadavg output', async () => {
      ;(runWsl as any).mockResolvedValue(
        ok('4194304 812345\n263168000 12884900\n0.25 0.30 0.40 1/100 1'),
      )
      const m = await svc.sampleMetrics('Ubuntu')
      expect(m.memTotalKB).toBe(4194304)
      expect(m.memUsedKB).toBe(812345)
      expect(m.diskUsedKB).toBe(263168000)
      expect(m.diskTotalKB).toBe(12884900)
      expect(m.cpuPercent).toBeGreaterThan(0)
      expect(m.sampledAt).toBeTruthy()
    })

    it('returns zeros when command fails', async () => {
      ;(runWsl as any).mockResolvedValue({ stdout: '', stderr: 'no', code: 1 })
      const m = await svc.sampleMetrics('Ubuntu')
      expect(m.memUsedKB).toBe(0)
      expect(m.diskUsedKB).toBe(0)
      expect(m.diskTotalKB).toBe(0)
      expect(m.cpuPercent).toBe(0)
    })

    it('rejects empty name', async () => {
      await expect(svc.sampleMetrics('')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
    })
  })
})
