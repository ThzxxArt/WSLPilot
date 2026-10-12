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

  /** byId 幽灵 getter 已删：测试直接观测 rules 数组 */
  const ruleById = (s: { rules: PortForwardRule[] }, id: string) =>
    s.rules.find((r) => r.id === id) ?? null

  it('load 读取规则与代理', async () => {
    wslAPI.network.listRules.mockResolvedValue([RULE])
    wslAPI.network.getProxy.mockResolvedValue(PROXY)
    const s = useNetworkStore()
    await s.load()
    expect(s.rules).toHaveLength(1)
    expect(s.proxy.httpProxy).toBe('http://127.0.0.1:7890')
    expect(ruleById(s, 'dev-3000')).toBeTruthy()
  })

  it('load 失败记录错误且不抛', async () => {
    wslAPI.network.listRules.mockRejectedValue(new Error('boom'))
    wslAPI.network.getProxy.mockResolvedValue(PROXY)
    const s = useNetworkStore()
    await s.load()
    expect(s.lastError).toBeTruthy()
    expect(s.rules).toEqual([])
  })

  it('getProxy 失败时不留混合态（规则与代理一次提交）', async () => {
    wslAPI.network.listRules.mockResolvedValue([RULE])
    wslAPI.network.getProxy.mockRejectedValue(new Error('proxy down'))
    const s = useNetworkStore()
    await s.load()
    // 全部成功才提交：不得出现「规则已刷新、代理还是旧值」的混合态
    expect(s.rules).toEqual([])
    expect(s.proxy.httpProxy).not.toBe('http://127.0.0.1:7890')
    expect(s.lastError).toBeTruthy()
  })

  it('load 旧响应晚到不覆盖新状态', async () => {
    let resolveFirst!: (v: PortForwardRule[]) => void
    const first = new Promise<PortForwardRule[]>((r) => (resolveFirst = r))
    wslAPI.network.listRules
      .mockReturnValueOnce(first as never)
      .mockResolvedValueOnce([{ ...RULE, id: 'dev-9000' }])
    wslAPI.network.getProxy.mockResolvedValue(PROXY)
    const s = useNetworkStore()
    const p1 = s.load()
    const p2 = s.load()
    await p2
    expect(ruleById(s, 'dev-9000')).toBeTruthy()
    resolveFirst([{ ...RULE, id: 'dev-1000' }])
    await p1
    expect(ruleById(s, 'dev-1000')).toBeNull()
    expect(ruleById(s, 'dev-9000')).toBeTruthy()
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
    expect(ruleById(s, 'dev-3000')!.listenPort).toBe(3001)
  })

  it('upsert 传 originalId = 重命名：总数不变、旧 id 消失', async () => {
    wslAPI.network.saveRules.mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE, { ...RULE, id: 'other', listenPort: 4000 }]
    await s.upsert({ ...RULE, id: 'renamed-3000' }, 'dev-3000')
    expect(s.rules).toHaveLength(2)
    expect(ruleById(s, 'dev-3000')).toBeNull()
    expect(ruleById(s, 'renamed-3000')!.listenPort).toBe(3000)
    expect(ruleById(s, 'other')).toBeTruthy()
  })

  it('upsert 不传 originalId 时新 id 只新增不误替换', async () => {
    wslAPI.network.saveRules.mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE]
    await s.upsert({ ...RULE, id: 'dev-4000', listenPort: 4000 })
    expect(s.rules.map((r) => r.id).sort()).toEqual(['dev-3000', 'dev-4000'])
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

  it('并发连续 remove 两条规则都生效（写队列防 RMW 丢更新 — review 0.1.2 根治）', async () => {
    let releaseFirst!: () => void
    wslAPI.network.saveRules
      .mockImplementationOnce(
        () =>
          new Promise<void>((r) => {
            releaseFirst = r
          }),
      )
      .mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE, { ...RULE, id: 'dev-4000', listenPort: 4000 }]
    const p1 = s.remove('dev-3000')
    const p2 = s.remove('dev-4000')
    // 等第一次落盘真正开始（挂起），再放行
    await new Promise((r) => setTimeout(r, 0))
    expect(wslAPI.network.saveRules).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([p1, p2])
    // 两次删除都生效：第二次基于第一次的结果（而不是同一旧快照互相覆盖）
    expect(s.rules).toHaveLength(0)
    expect(wslAPI.network.saveRules).toHaveBeenCalledTimes(2)
    expect(wslAPI.network.saveRules).toHaveBeenLastCalledWith([])
  })

  it('remove 返回被删快照；连续删除后各自撤销恢复各自（review 0.1.2 根治）', async () => {
    wslAPI.network.saveRules.mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE, { ...RULE, id: 'dev-4000', listenPort: 4000 }]
    const r1 = await s.remove('dev-3000')
    const r2 = await s.remove('dev-4000')
    expect(r1?.id).toBe('dev-3000')
    expect(r2?.id).toBe('dev-4000')
    expect(s.lastRemoved?.id).toBe('dev-4000')
    // 快照撤销只恢复自己的动作，不清掉其他人的撤销缓冲
    await s.undoRestore(r1!)
    expect(s.rules.map((r) => r.id)).toEqual(['dev-3000'])
    expect(s.lastRemoved?.id).toBe('dev-4000')
    await s.undoRestore(r2!)
    expect(s.rules.map((r) => r.id).sort()).toEqual(['dev-3000', 'dev-4000'])
    expect(s.lastRemoved).toBeNull()
  })

  it('setEnabled 写回', async () => {
    wslAPI.network.saveRules.mockResolvedValue({})
    const s = useNetworkStore()
    s.rules = [RULE]
    await s.setEnabled('dev-3000', false)
    expect(ruleById(s, 'dev-3000')!.enabled).toBe(false)
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

  it('proxyApply 的迟到脚本结果不覆盖后发起的 loadProxyState（代际守卫 — review 0.1.2 根治）', async () => {
    const scriptA = { path: '/etc/profile.d/a.sh', exists: true, content: 'A' }
    const scriptB = { path: '/etc/profile.d/b.sh', exists: true, content: 'B' }
    let releaseApplyState!: (v: unknown) => void
    wslAPI.network.proxyApply.mockResolvedValue({ distro: 'A' })
    wslAPI.network.proxyState
      // apply 内部那次 proxyState 查询挂起（模拟慢响应）
      .mockReturnValueOnce(
        new Promise((r) => {
          releaseApplyState = r
        }) as never,
      )
      .mockResolvedValueOnce(scriptB)
    const s = useNetworkStore()
    const pApply = s.proxyApply('A')
    // 等 apply 走到挂起的 proxyState
    await new Promise((r) => setTimeout(r, 0))
    // 用户随后查看 B 发行版的脚本（后发起，应赢）
    await s.loadProxyState('B')
    expect(s.proxyScript).toEqual(scriptB)
    // 放行 apply 的迟到结果：不得覆盖 B 的展示
    releaseApplyState(scriptA)
    await pApply
    expect(s.proxyScript).toEqual(scriptB)
  })

  it('enabledRules getter', () => {
    const s = useNetworkStore()
    s.rules = [RULE, { ...RULE, id: 'x', enabled: false }]
    expect(s.enabledRules).toHaveLength(1)
  })
})
