import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createNetworkService,
  isElevationError,
  readWindowsProxyFromRegistry,
  type NetworkConfigReader,
} from '../../src/main/services/network-service'
import type { TaskControl } from '../../src/main/services/task-runner'
import type { NetworkConfig, PortForwardRule } from '@wslpilot/shared'

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

const RULES: PortForwardRule[] = [
  {
    id: 'dev-3000',
    distro: 'Ubuntu',
    listenAddress: '0.0.0.0',
    listenPort: 3000,
    connectAddress: '127.0.0.1',
    connectPort: 3000,
    enabled: true,
    protocol: 'tcp',
  },
  {
    id: 'udp-rule',
    distro: 'Ubuntu',
    listenAddress: '0.0.0.0',
    listenPort: 5353,
    connectAddress: '127.0.0.1',
    connectPort: 5353,
    enabled: true,
    protocol: 'udp',
  },
  {
    id: 'off-rule',
    distro: 'Ubuntu',
    listenAddress: '0.0.0.0',
    listenPort: 8080,
    connectAddress: '127.0.0.1',
    connectPort: 80,
    enabled: false,
    protocol: 'tcp',
  },
]

function configReader(rules: PortForwardRule[] = RULES, proxy?: Partial<NetworkConfig['proxy']>) {
  return {
    loadSync: (key: string) => {
      if (key !== 'network') throw new Error(`unexpected key ${key}`)
      return {
        $schemaVersion: 1,
        portForwarding: rules,
        proxy: {
          useWindowsProxy: false,
          httpProxy: '',
          httpsProxy: '',
          noProxy: 'localhost',
          ...proxy,
        },
      }
    },
  } as unknown as NetworkConfigReader
}

function makeCtl(overrides: Partial<TaskControl> = {}): TaskControl {
  const ctl: TaskControl = {
    taskId: 't1',
    type: 'network',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  return ctl
}

type ToolCall = { program: string; args: string[] }

function makeTool(results: Array<{ code?: number; stdout?: string; stderr?: string }>) {
  const calls: ToolCall[] = []
  let i = 0
  const fn = vi.fn(async (program: string, args: string[]) => {
    calls.push({ program, args })
    const r = results[Math.min(i, results.length - 1)] ?? { code: 0 }
    i++
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 }
  })
  return { fn, calls }
}

describe('isElevationError', () => {
  it('识别中英文提权报错', () => {
    expect(isElevationError('The requested operation requires elevation')).toBe(true)
    expect(isElevationError('请求的操作需要提升(作为管理员运行)')).toBe(true)
    expect(isElevationError('Access is denied.')).toBe(true)
    expect(isElevationError('拒绝访问')).toBe(true)
    expect(isElevationError('ok')).toBe(false)
  })
})

describe('readWindowsProxyFromRegistry', () => {
  it('解析 ProxyEnable / ProxyServer', async () => {
    const out = [
      '    ProxyEnable    REG_DWORD    0x1',
      '    ProxyServer    REG_SZ    127.0.0.1:7890',
      '    ProxyOverride    REG_SZ    localhost;<local>',
    ].join('\n')
    const info = await readWindowsProxyFromRegistry(async () => out)
    expect(info).toEqual({ enabled: true, server: '127.0.0.1:7890', override: 'localhost;<local>' })
  })

  it('读取失败返回 null', async () => {
    expect(await readWindowsProxyFromRegistry(async () => '')).toBeNull()
    expect(
      await readWindowsProxyFromRegistry(async () => {
        throw new Error('boom')
      }),
    ).toBeNull()
  })

  it('ProxyEnable=0 视为未启用', async () => {
    const info = await readWindowsProxyFromRegistry(
      async () => '    ProxyEnable    REG_DWORD    0x0',
    )
    expect(info?.enabled).toBe(false)
  })
})

describe('NetworkService.status', () => {
  it('读取 .wslconfig 并解析模式', async () => {
    const tool = makeTool([{ code: 0, stdout: '' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      wslconfigPath: 'C:/Users/u/.wslconfig',
      readFile: async () => '[wsl2]\nnetworkingMode=mirrored',
      runTool: tool.fn,
      readWindowsProxy: async () => null,
    })
    const s = await svc.status()
    expect(s.mode).toBe('mirrored')
    expect(s.mirrorRecommended).toBe(false)
    expect(s.wslconfigExists).toBe(true)
    expect(s.wslconfigPath).toBe('C:/Users/u/.wslconfig')
  })

  it('文件缺失 → unknown + 推荐镜像', async () => {
    const tool = makeTool([{ code: 0, stdout: '' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      wslconfigPath: 'missing',
      readFile: async () => {
        throw new Error('ENOENT')
      },
      runTool: tool.fn,
      readWindowsProxy: async () => ({ enabled: true, server: 'p:1', override: '' }),
    })
    const s = await svc.status()
    expect(s.mode).toBe('unknown')
    expect(s.mirrorRecommended).toBe(true)
    expect(s.wslconfigExists).toBe(false)
    expect(s.windowsProxy?.server).toBe('p:1')
  })

  it('netsh 失败时转发表降级为空', async () => {
    const tool = makeTool([{ code: 1, stderr: 'oops' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      wslconfigPath: 'x',
      readFile: async () => '',
      runTool: tool.fn,
      readWindowsProxy: async () => null,
    })
    const s = await svc.status()
    expect(s.portProxy).toEqual([])
  })
})

describe('NetworkService.findRule', () => {
  it('命中白名单规则', () => {
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: makeTool([]).fn,
    })
    expect(svc.findRule('dev-3000').listenPort).toBe(3000)
  })

  it('不存在 / 非法 id 抛结构化错误', () => {
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: makeTool([]).fn,
    })
    expect(() => svc.findRule('nope')).toThrow(/转发规则不存在/)
    expect(() => svc.findRule('a/b')).toThrow(/规则 id 非法/)
  })
})

describe('NetworkService.applyRule / removeRule', () => {
  it('应用 TCP 规则生成 netsh 参数数组（先查后加，幂等）', async () => {
    // 第一次调用是 `show all`（幂等检查），第二次才是 add
    const tool = makeTool([{ code: 0, stdout: '' }, { code: 0 }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await svc.applyRule('dev-3000', ctl)
    expect(tool.calls[0]!.program).toBe('netsh.exe')
    expect(tool.calls[0]!.args).toEqual(['interface', 'portproxy', 'show', 'all'])
    expect(tool.calls[1]!.args).toEqual([
      'interface',
      'portproxy',
      'add',
      'v4tov4',
      'listenaddress=0.0.0.0',
      'listenport=3000',
      'connectaddress=127.0.0.1',
      'connectport=3000',
    ])
    expect(ctl.log).toHaveBeenCalledWith(expect.stringContaining('netsh.exe'))
    expect(ctl.report).toHaveBeenCalledWith(100, expect.stringContaining('dev-3000'))
  })

  it('已存在监听时先 delete 再 add（改端口不残留）', async () => {
    const tool = makeTool([
      { code: 0, stdout: '0.0.0.0 3000 127.0.0.1 3000' },
      { code: 0 },
      { code: 0 },
    ])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await svc.applyRule('dev-3000', ctl)
    expect(tool.calls.map((c) => c.args[2])).toEqual(['show', 'delete', 'add'])
  })

  it('UDP 规则拒绝应用并给出建议', async () => {
    const tool = makeTool([{ code: 0 }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    await expect(svc.applyRule('udp-rule', makeCtl())).rejects.toMatchObject({
      code: 'TASK_FAILED',
    })
    expect(tool.calls).toHaveLength(0)
  })

  it('提权失败映射 PERMISSION_DENIED 并附等价命令', async () => {
    const tool = makeTool([{ code: 1, stderr: '请求的操作需要提升(作为管理员运行)' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    await expect(svc.applyRule('dev-3000', makeCtl())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
  })

  it('其它 netsh 失败映射 TASK_FAILED', async () => {
    const tool = makeTool([{ code: 2, stderr: 'The parameter is incorrect' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    await expect(svc.applyRule('dev-3000', makeCtl())).rejects.toMatchObject({
      code: 'TASK_FAILED',
    })
  })

  it('removeRule 生成 delete 命令（系统有该监听时）', async () => {
    const tool = makeTool([{ code: 0, stdout: '0.0.0.0 3000 127.0.0.1 3000' }, { code: 0 }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await svc.removeRule('dev-3000', ctl)
    expect(tool.calls[1]!.args).toEqual([
      'interface',
      'portproxy',
      'delete',
      'v4tov4',
      'listenaddress=0.0.0.0',
      'listenport=3000',
    ])
    expect(ctl.report).toHaveBeenCalledWith(100, expect.stringContaining('dev-3000'))
  })

  it('removeRule 幂等：系统中无该监听时直接成功', async () => {
    const tool = makeTool([{ code: 0, stdout: '' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await svc.removeRule('dev-3000', ctl)
    // 只有 show 一次，没有 delete
    expect(tool.calls).toHaveLength(1)
    expect(ctl.report).toHaveBeenCalledWith(100, expect.stringContaining('已无该监听'))
  })
})

describe('NetworkService.applyAll', () => {
  it('跳过 UDP 与停用规则，只应用启用中的 TCP', async () => {
    const tool = makeTool([{ code: 0, stdout: '' }, { code: 0 }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await svc.applyAll(ctl)
    // show 一次 + add 一次
    expect(tool.calls).toHaveLength(2)
    expect(tool.calls[1]!.args).toContain('listenport=3000')
    expect(ctl.log).toHaveBeenCalledWith(expect.stringContaining('跳过 UDP 规则 udp-rule'))
    expect(ctl.report).toHaveBeenCalledWith(100, expect.stringContaining('成功 1 条'))
  })

  it('无启用规则时直接完成', async () => {
    const tool = makeTool([])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader([]),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await svc.applyAll(ctl)
    expect(tool.calls).toHaveLength(0)
    expect(ctl.report).toHaveBeenCalledWith(100, expect.stringContaining('没有启用中的转发规则'))
  })

  it('失败项聚合后抛出汇总错误', async () => {
    const twoRules = [
      { ...RULES[0]!, id: 'a-1', listenPort: 3000 },
      { ...RULES[0]!, id: 'a-2', listenPort: 3001, connectPort: 3001 },
    ]
    // 两条规则的 add 都失败（show 正常）
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 1, stderr: '拒绝访问' },
      { code: 0, stdout: '' },
      { code: 1, stderr: '拒绝访问' },
    ])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(twoRules),
      runTool: tool.fn,
    })
    await expect(svc.applyAll(makeCtl())).rejects.toMatchObject({
      code: 'TASK_FAILED',
    })
    expect(tool.calls).toHaveLength(4)
  })

  it('取消时中断后续应用', async () => {
    let canceled = false
    const calls: string[][] = []
    const runTool = vi.fn(async (_p: string, args: string[]) => {
      calls.push(args)
      canceled = true
      return { stdout: '', stderr: '', code: 0 }
    })
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(RULES),
      runTool,
    })
    const ctl = makeCtl({
      throwIfCanceled: () => {
        if (canceled) throw new Error('canceled')
      },
    })
    await expect(svc.applyAll(ctl)).rejects.toThrow(/canceled/)
    // 第一条规则：show（触发取消信号）→ add 前的 throwIfCanceled 抛出，不再往下
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('show')
  })
})

describe('NetworkService 代理脚本', () => {
  it('proxyState：文件存在 / 不存在', async () => {
    const runWsl = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'export http_proxy=1', stderr: '' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'cat: No such file or directory' })
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runWsl,
    })
    expect(await svc.proxyState('Ubuntu')).toEqual({
      path: '/etc/profile.d/wslpilot-proxy.sh',
      exists: true,
      content: 'export http_proxy=1',
    })
    expect(await svc.proxyState('Ubuntu')).toMatchObject({ exists: false, content: '' })
  })

  it('proxyState：其它错误抛 IO_ERROR', async () => {
    const runWsl = vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'wsl 已停止' })
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runWsl,
    })
    await expect(svc.proxyState('Ubuntu')).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('proxyApply 写入脚本（含系统代理兜底）', async () => {
    const runIn = vi.fn(
      async (_args: string[], _input: string, _opts?: { timeoutMs?: number }) => ({
        code: 0,
        stdout: '',
        stderr: '',
      }),
    )
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(RULES, {
        useWindowsProxy: true,
        httpProxy: '',
        httpsProxy: 'https://s:1',
      }),
      runWslWithStdin: runIn,
      readWindowsProxy: async () => ({ enabled: true, server: 'p:8080', override: '' }),
    })
    await svc.proxyApply('Ubuntu')
    expect(runIn).toHaveBeenCalledWith(
      ['-d', 'Ubuntu', '-u', 'root', '-e', 'tee', '/etc/profile.d/wslpilot-proxy.sh'],
      expect.stringContaining('http_proxy='),
      expect.anything(),
    )
    const script = runIn.mock.calls[0]![1] as string
    expect(script).toContain("'http://p:8080'")
    expect(script).toContain("'https://s:1'")
  })

  it('proxyApply 权限失败映射 PERMISSION_DENIED', async () => {
    const runIn = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'permission denied' }))
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runWslWithStdin: runIn,
    })
    await expect(svc.proxyApply('Ubuntu')).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('proxyClear 删除脚本，失败映射 IO_ERROR', async () => {
    const runWsl = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'boom' })
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runWsl,
    })
    await svc.proxyClear('Ubuntu')
    expect(runWsl.mock.calls[0]![0]).toEqual([
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '-e',
      'rm',
      '-f',
      '/etc/profile.d/wslpilot-proxy.sh',
    ])
    await expect(svc.proxyClear('Ubuntu')).rejects.toMatchObject({ code: 'IO_ERROR' })
  })

  it('非法发行版名被拒绝', async () => {
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runWsl: vi.fn(),
    })
    await expect(svc.proxyApply('a\u0000b')).rejects.toMatchObject({ code: 'DISTRO_NOT_FOUND' })
  })
})

describe('NetworkService 默认依赖', () => {
  beforeEach(() => vi.clearAllMocks())

  it('未注入 readFile 时按路径读取真实文件（不存在即缺失）', async () => {
    const tool = makeTool([{ code: 0, stdout: '' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      wslconfigPath: '/definitely/not/here/.wslconfig',
      runTool: tool.fn,
      readWindowsProxy: async () => null,
    })
    const s = await svc.status()
    expect(s.wslconfigExists).toBe(false)
    expect(s.mode).toBe('unknown')
  })
})
