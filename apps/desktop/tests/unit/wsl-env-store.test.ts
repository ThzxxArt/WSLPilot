import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { WslCapabilities, WslEnvInfo } from '@wslpilot/shared'

const flags = {
  compact: true,
  resize: true,
  setDefaultUser: true,
  installLocation: true,
  vhdSize: true,
  fixedVhd: true,
  webDownload: true,
  exportFormats: true,
  importFromFile: true,
  updatePreRelease: true,
  manageSparse: true,
}

const caps: WslCapabilities = {
  source: 'help',
  wslVersion: '3.0.3.0',
  windowsBuild: 26300,
  wslcVersion: '3.0.3.0',
  inbox: false,
  flags,
}

const env: WslEnvInfo = {
  installed: true,
  wslVersion: '3.0.3.0',
  kernelVersion: '6.18.54.1-1',
  defaultDistro: 'Debian',
  defaultVersion: 2,
  statusRaw: '',
  capabilities: caps,
}

const app = { wslEnv: vi.fn(async () => env) }
;(globalThis as any).window = { wslAPI: { app } }

const { useWslEnvStore } = await import('../../src/renderer/stores/wsl-env')

describe('useWslEnvStore（0.1.4 能力单一事实源）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    app.wslEnv.mockClear()
  })

  it('load 后 can() 反映 flags；requirement 含最低版本与当前版本', async () => {
    const s = useWslEnvStore()
    expect(s.can('compact')).toBe(false) // 未加载 fail-soft
    await s.load()
    expect(s.can('compact')).toBe(true)
    expect(s.can('nope' as never)).toBe(false)
    expect(s.requirement('compact')).toContain('2.9.8')
    expect(s.requirement('compact')).toContain('3.0.3.0')
  })

  it('load 幂等：loaded 后不重复调用，refresh 强制重拉', async () => {
    const s = useWslEnvStore()
    await s.load()
    await s.load()
    expect(app.wslEnv).toHaveBeenCalledTimes(1)
    await s.refresh()
    expect(app.wslEnv).toHaveBeenCalledTimes(2)
  })

  it('读取失败 fail-soft：env=null、can 全 false、lastError 记录', async () => {
    app.wslEnv.mockRejectedValueOnce(new Error('boom'))
    const s = useWslEnvStore()
    await s.load()
    expect(s.env).toBeNull()
    expect(s.can('compact')).toBe(false)
    expect(s.lastError).not.toBeNull()
  })
})
