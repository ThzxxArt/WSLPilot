import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UpdateState } from '@wslpilot/shared'

/** 真实监听表 mock：能观测「退订后不再收到推送」（review 假信心根治） */
type Listener = (s: UpdateState) => void
const listeners = new Set<Listener>()
const onChanged = vi.fn((cb: Listener): (() => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
})
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

function pushState(s: UpdateState): void {
  for (const l of listeners) l(s)
}

const { useUpdateStore } = await import('../../src/renderer/stores/update')
const { createPinia, setActivePinia } = await import('pinia')

function state(over: Partial<UpdateState> = {}): UpdateState {
  return { status: 'idle', currentVersion: '0.1.0', ...over }
}

describe('useUpdateStore（M7 自动更新）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    listeners.clear()
  })

  it('load 同步主进程状态', async () => {
    wslAPI.update.status.mockResolvedValue(state({ status: 'available', version: '2.0.0' }))
    const s = useUpdateStore()
    await s.load()
    expect(s.status).toBe('available')
    expect(s.version).toBe('2.0.0')
  })

  it('load 失败如实落入 error 字段（状态行可见，不静默）', async () => {
    wslAPI.update.status.mockRejectedValue(new Error('ipc down'))
    const s = useUpdateStore()
    await s.load()
    expect(s.error).toBe('ipc down')
  })

  it('attach 订阅 update:changed；off 后不再接收推送', () => {
    const s = useUpdateStore()
    const off = s.attach()
    expect(onChanged).toHaveBeenCalled()
    expect(typeof off).toBe('function')

    pushState(state({ status: 'downloaded', version: '2.0.0', percent: 100 }))
    expect(s.status).toBe('downloaded')
    expect(s.percent).toBe(100)

    // 退订后回调必须被摘除（此前测试断言的是"退订后仍生效"，语义相反 — 假信心）
    off()
    expect(listeners.size).toBe(0)
    pushState(state({ status: 'error', error: 'x' }))
    expect(s.status).toBe('downloaded')
  })

  it('check / download 成功路径', async () => {
    wslAPI.update.check.mockResolvedValue(state({ status: 'not-available' }))
    wslAPI.update.download.mockResolvedValue(state({ status: 'downloaded', percent: 100 }))
    const s = useUpdateStore()
    expect((await s.check()).status).toBe('not-available')
    expect(s.busy).toBe(false)
    expect((await s.download()).status).toBe('downloaded')
    expect(s.percent).toBe(100)
    // 主进程返回的 error 状态经 applyState 同步到镜像
    wslAPI.update.check.mockResolvedValue(state({ status: 'error', error: 'boom' }))
    await s.check()
    expect(s.status).toBe('error')
    expect(s.error).toBe('boom')
  })

  it('check / download 的 IPC 失败向上抛出且复位 busy', async () => {
    wslAPI.update.check.mockRejectedValue(new Error('network down'))
    wslAPI.update.download.mockRejectedValue(new Error('disk full'))
    const s = useUpdateStore()
    await expect(s.check()).rejects.toThrow('network down')
    expect(s.busy).toBe(false)
    await expect(s.download()).rejects.toThrow('disk full')
    expect(s.busy).toBe(false)
  })

  it('install 成功与失败（失败向上抛）', async () => {
    wslAPI.update.install.mockResolvedValue(undefined)
    const s = useUpdateStore()
    await s.install()
    expect(wslAPI.update.install).toHaveBeenCalled()

    wslAPI.update.install.mockRejectedValue(new Error('boom'))
    await expect(s.install()).rejects.toThrow('boom')
  })

  it('applyState 兼容缺失字段（主进程可能省略可选字段）', () => {
    const s = useUpdateStore()
    s.applyState({ status: 'error', currentVersion: '0.1.0', error: 'x' })
    expect(s.version).toBe('')
    expect(s.releaseNotes).toBe('')
    expect(s.feedUrl).toBe('')
  })
})
