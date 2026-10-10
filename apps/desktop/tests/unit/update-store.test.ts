import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UpdateState } from '@wslpilot/shared'

const onChanged = vi.fn((_cb: (s: UpdateState) => void): (() => void) => () => {})
const wslAPI = {
  update: {
    status: vi.fn(),
    check: vi.fn(),
    download: vi.fn(),
    install: vi.fn(),
    onChanged,
  },
}
;(globalThis as any).window = { wslAPI }

const { useUpdateStore } = await import('../../src/renderer/stores/update')
const { createPinia, setActivePinia } = await import('pinia')

function state(over: Partial<UpdateState> = {}): UpdateState {
  return { status: 'idle', currentVersion: '0.1.0', ...over }
}

describe('useUpdateStore（M7 自动更新）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    onChanged.mockReturnValue(() => {})
  })

  it('load 同步主进程状态', async () => {
    wslAPI.update.status.mockResolvedValue(state({ status: 'available', version: '2.0.0' }))
    const s = useUpdateStore()
    await s.load()
    expect(s.status).toBe('available')
    expect(s.version).toBe('2.0.0')
  })

  it('attach 订阅 update:changed 并可退订', () => {
    const s = useUpdateStore()
    const off = s.attach()
    expect(onChanged).toHaveBeenCalled()
    expect(typeof off).toBe('function')
    off()
    // 事件回调 → applyState
    const cb = onChanged.mock.calls[0]![0]
    cb(state({ status: 'downloaded', version: '2.0.0', percent: 100 }))
    expect(s.status).toBe('downloaded')
    expect(s.percent).toBe(100)
  })

  it('check / download 成功路径', async () => {
    wslAPI.update.check.mockResolvedValue(state({ status: 'not-available' }))
    wslAPI.update.download.mockResolvedValue(state({ status: 'downloaded', percent: 100 }))
    const s = useUpdateStore()
    expect((await s.check()).status).toBe('not-available')
    expect(s.busy).toBe(false)
    expect((await s.download()).status).toBe('downloaded')
    expect(s.percent).toBe(100)
  })

  it('check / download 失败：记录 lastError 并重抛', async () => {
    wslAPI.update.check.mockRejectedValue(
      new Error('WSLPILOT:{"code":"IO_ERROR","message":"网络不可用","recoverable":true}'),
    )
    wslAPI.update.download.mockRejectedValue(new Error('disk full'))
    const s = useUpdateStore()
    await expect(s.check()).rejects.toThrow()
    expect(s.lastError?.code).toBe('IO_ERROR')
    expect(s.errorAt).toBeGreaterThan(0)
    expect(s.busy).toBe(false)
    await expect(s.download()).rejects.toThrow()
  })

  it('install 成功与失败', async () => {
    wslAPI.update.install.mockResolvedValue(undefined)
    const s = useUpdateStore()
    await s.install()
    expect(wslAPI.update.install).toHaveBeenCalled()

    wslAPI.update.install.mockRejectedValue(new Error('boom'))
    await expect(s.install()).rejects.toThrow()
    expect(s.lastError).toBeTruthy()
  })

  it('applyState 兼容缺失字段（主进程可能省略可选字段）', () => {
    const s = useUpdateStore()
    s.applyState({ status: 'error', currentVersion: '0.1.0', error: 'x' })
    expect(s.version).toBe('')
    expect(s.releaseNotes).toBe('')
    expect(s.feedUrl).toBe('')
  })
})
