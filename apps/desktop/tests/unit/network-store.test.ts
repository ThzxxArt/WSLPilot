import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NetworkConfig, NetworkStatus, PortForwardRule } from '@wslpilot/shared'

const wslAPI = {
  network: {
    listRules: vi.fn(),
    saveRules: vi.fn(),
    getProxy: vi.fn(),
    saveProxy: vi.fn(),
    status: vi.fn(),
    apply: vi.fn(),
    applyAll: vi.fn(),
    remove: vi.fn(),
    proxyApply: vi.fn(),
    proxyClear: vi.fn(),
    proxyState: vi.fn(),
  },
  task: { cancel: vi.fn(), onProgress: vi.fn(() => () => {}) },
}
;(globalThis as any).window = { wslAPI }

const { useNetworkStore } = await import('../../src/renderer/stores/network')
const { createPinia, setActivePinia } = await import('pinia')

const RULE: PortForwardRule = {
  id: 'dev-3000',
  distro: 'Ubuntu',
  listenAddress: '0.0.0.0',
  listenPort: 3000,
  connectAddress: '127.0.0.1',
  connectPort: 3000,
  enabled: true,
  protocol: 'tcp',
}

const PROXY: NetworkConfig['proxy'] = {
  useWindowsProxy: false,
  httpProxy: 'http://127.0.0.1:7890',
  httpsProxy: '',
  noProxy: 'localhost',
}

const STATUS: NetworkStatus = {
  wslconfigPath: 'C:\\Users\\u\\.wslconfig',
  wslconfigExists: true,
  mode: 'nat',
  modeRaw: 'nat',
  mirrorRecommended: true,
  portProxy: [
    {
      listenAddress: '0.0.0.0',
      listenPort: 3000,
      connectAddress: '127.0.0.1',
      connectPort: 3000,
      kind: 'v4tov4',
    },
  ],
  windowsProxy: null,
}

describe('useNetworkStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('load 读取规则与代理', async () => {
    wslAPI.network.listRules.mockResolvedValue([RULE])
    wslAPI.network.getProxy.mockResolvedValue(PROXY)
    const s = useNetworkStore()
    await s.load()
    expect(s.rules).toHaveLength(1)
    expect(s.proxy.httpProxy).toBe('http://127.0.0.1:7890')
    expect(s.byId('dev-3000')).toBeTruthy()
  })

  it('load 失败记录错误且不抛', async () => {
    wslAPI.network.listRules.mockRejectedValue(new Error('boom'))
    wslAPI.network.getProxy.mockResolvedValue(PROXY)
    const s = useNetworkStore()
    await s.load()
    expect(s.lastError).toBeTruthy()
    expect(s.rules).toEqual([])
  })

  it('异常形状的规则清单降级为空', async () => {
    wslAPI.network.listRules.mockResolvedValue(null)
    wslAPI.network.getProxy.mockResolvedValue(PROXY)
    const s = useNetworkStore()
    await s.load()
    expect(s.rules).toEqual([])
  })

  it('loadStatus 与 appliedCount', async () => {
    wslAPI.network.status.mockResolvedValue(STATUS)
    const s = useNetworkStore()
    s.rules = [RULE, { ...RULE, id: 'dev-4000', listenPort: 4000 }]
    await s.loadStatus()
    expect(s.status?.mode).toBe('nat')
    expect(s.appliedCount).toBe(1)
  })

  it('upsert 新增与更新', async () => {
    wslAPI.network.saveRules.mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE]
    await s.upsert({ ...RULE, id: 'dev-4000', listenPort: 4000 })
    expect(s.rules).toHaveLength(2)
    await s.upsert({ ...RULE, listenPort: 3001 })
    expect(s.rules).toHaveLength(2)
    expect(s.byId('dev-3000')!.listenPort).toBe(3001)
  })

  it('remove + undoRestore', async () => {
    wslAPI.network.saveRules.mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE]
    await s.remove('dev-3000')
    expect(s.rules).toHaveLength(0)
    expect(s.lastRemoved?.id).toBe('dev-3000')
    await s.undoRestore()
    expect(s.rules).toHaveLength(1)
    expect(s.lastRemoved).toBeNull()
  })

  it('setEnabled 写回', async () => {
    wslAPI.network.saveRules.mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE]
    await s.setEnabled('dev-3000', false)
    expect(s.byId('dev-3000')!.enabled).toBe(false)
    expect(wslAPI.network.saveRules).toHaveBeenCalled()
  })

  it('saveProxy 与失败路径', async () => {
    wslAPI.network.saveProxy.mockResolvedValue({})
    const s = useNetworkStore()
    await s.saveProxy(PROXY)
    expect(s.proxy.httpProxy).toBe(PROXY.httpProxy)

    wslAPI.network.saveProxy.mockRejectedValue(new Error('nope'))
    await expect(s.saveProxy(PROXY)).rejects.toBeTruthy()
    expect(s.lastError).toBeTruthy()
  })

  it('persistRules 失败抛出并记录', async () => {
    wslAPI.network.saveRules.mockRejectedValue(new Error('disk full'))
    const s = useNetworkStore()
    s.rules = [RULE]
    await expect(s.remove('dev-3000')).rejects.toBeTruthy()
    expect(s.lastError).toBeTruthy()
  })

  it('applyRule / applyAll / removeFromSystem 返回任务句柄', async () => {
    wslAPI.network.apply.mockResolvedValue({ taskId: 'a' })
    wslAPI.network.applyAll.mockResolvedValue({ taskId: 'b' })
    wslAPI.network.remove.mockResolvedValue({ taskId: 'c' })
    const s = useNetworkStore()
    expect((await s.applyRule('dev-3000')).taskId).toBe('a')
    expect((await s.applyAll()).taskId).toBe('b')
    expect((await s.removeFromSystem('dev-3000')).taskId).toBe('c')
  })

  it('apply 失败记录错误并抛出', async () => {
    wslAPI.network.apply.mockRejectedValue(new Error('denied'))
    const s = useNetworkStore()
    await expect(s.applyRule('x')).rejects.toBeTruthy()
    expect(s.lastError).toBeTruthy()
  })

  it('proxyApply / proxyClear / loadProxyState', async () => {
    wslAPI.network.proxyApply.mockResolvedValue({ distro: 'Ubuntu' })
    wslAPI.network.proxyClear.mockResolvedValue({ distro: 'Ubuntu' })
    wslAPI.network.proxyState.mockResolvedValue({
      path: '/etc/profile.d/wslpilot-proxy.sh',
      exists: true,
      content: 'x',
    })
    const s = useNetworkStore()
    await s.proxyApply('Ubuntu')
    expect(s.proxyScript?.exists).toBe(true)
    await s.proxyClear('Ubuntu')
    expect(s.proxyScript?.exists).toBe(true)
    wslAPI.network.proxyState.mockRejectedValue(new Error('down'))
    await s.loadProxyState('Ubuntu')
    expect(s.proxyScript).toBeNull()
    expect(s.lastError).toBeTruthy()
  })

  it('proxyApply 失败抛出', async () => {
    wslAPI.network.proxyApply.mockRejectedValue(new Error('perm'))
    const s = useNetworkStore()
    await expect(s.proxyApply('Ubuntu')).rejects.toBeTruthy()
  })

  it('enabledRules getter', () => {
    const s = useNetworkStore()
    s.rules = [RULE, { ...RULE, id: 'x', enabled: false }]
    expect(s.enabledRules).toHaveLength(1)
  })
})
