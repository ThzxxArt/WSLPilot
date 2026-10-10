import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { UsbDevice } from '@wslpilot/shared'

const wslAPI = {
  devices: {
    status: vi.fn(),
    list: vi.fn(),
    bind: vi.fn(),
    unbind: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
  },
  task: { cancel: vi.fn(), onProgress: vi.fn(() => () => {}) },
}
;(globalThis as any).window = { wslAPI }

const { useDevicesStore } = await import('../../src/renderer/stores/devices')
const { createPinia, setActivePinia } = await import('pinia')

const DEV: UsbDevice = {
  busId: '1-2',
  vid: '046d',
  pid: 'c534',
  description: 'USB Receiver',
  state: 'shared',
}

describe('useDevicesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load 读取状态与设备', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: true, version: '2.4.1' })
    wslAPI.devices.list.mockResolvedValue([DEV])
    const s = useDevicesStore()
    await s.load()
    expect(s.status.installed).toBe(true)
    expect(s.items).toHaveLength(1)
    expect(s.byBusId('1-2')?.description).toBe('USB Receiver')
    expect(s.sharedCount).toBe(1)
  })

  it('未安装时不请求列表', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: false, version: '' })
    const s = useDevicesStore()
    await s.load()
    expect(s.items).toEqual([])
    expect(wslAPI.devices.list).not.toHaveBeenCalled()
  })

  it('异常形状清单降级为空', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: true, version: '' })
    wslAPI.devices.list.mockResolvedValue(null)
    const s = useDevicesStore()
    await s.load()
    expect(s.items).toEqual([])
  })

  it('load 失败记录错误', async () => {
    wslAPI.devices.status.mockRejectedValue(new Error('boom'))
    const s = useDevicesStore()
    await s.load()
    expect(s.lastError).toBeTruthy()
    expect(s.items).toEqual([])
  })

  it('bind / unbind 返回任务句柄', async () => {
    wslAPI.devices.bind.mockResolvedValue({ taskId: 'b' })
    wslAPI.devices.unbind.mockResolvedValue({ taskId: 'u' })
    const s = useDevicesStore()
    expect((await s.bind('1-2')).taskId).toBe('b')
    expect((await s.unbind('1-2')).taskId).toBe('u')
  })

  it('bind 失败抛出并记录', async () => {
    wslAPI.devices.bind.mockRejectedValue(new Error('denied'))
    const s = useDevicesStore()
    await expect(s.bind('1-2')).rejects.toBeTruthy()
    expect(s.lastError).toBeTruthy()
  })

  it('attach / detach 成功与失败', async () => {
    wslAPI.devices.attach.mockResolvedValue(undefined)
    wslAPI.devices.detach.mockResolvedValue(undefined)
    const s = useDevicesStore()
    await s.attach('1-2', 'Ubuntu')
    await s.detach('1-2')
    expect(wslAPI.devices.attach).toHaveBeenCalledWith('1-2', 'Ubuntu')

    wslAPI.devices.detach.mockRejectedValue(new Error('nope'))
    await expect(s.detach('1-2')).rejects.toBeTruthy()
    expect(s.lastError).toBeTruthy()
  })

  it('attachedCount getter', () => {
    const s = useDevicesStore()
    s.items = [DEV, { ...DEV, busId: '1-3', state: 'attached' }]
    expect(s.attachedCount).toBe(1)
  })
})
