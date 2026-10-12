import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createNetworkService,
  isElevationError,
  readWindowsProxyFromRegistry,
  type NetworkConfigReader,
} from '../../src/main/services/network-service'
import type { TaskControl } from '../../src/main/services/task-runner'
import type {
  ElevationRequest,
  ElevationRunResult,
  NetworkConfig,
  PortForwardRule,
} from '@wslpilot/shared'

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

  it('netsh 查询失败时 status 抛错（不伪装空表）', async () => {
    const tool = makeTool([{ code: 1, stderr: 'oops' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      wslconfigPath: 'x',
      readFile: async () => '',
      runTool: tool.fn,
      readWindowsProxy: async () => null,
    })
    // 查询失败 ≠ 确为空：抛错让渲染层如实展示（review 假成功根治）
    await expect(svc.status()).rejects.toMatchObject({ code: 'TASK_FAILED' })
    await expect(svc.status()).rejects.toThrow(/无法查询系统端口转发状态/)
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
    // 旧条目 connect 端口 9999（≠ 规则的 3000）→ 需 delete 后 add
    const tool = makeTool([
      { code: 0, stdout: '0.0.0.0 3000 127.0.0.1 9999' },
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
    // call1: show 空表；call2: add 权限不足
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 1, stderr: '请求的操作需要提升(作为管理员运行)' },
    ])
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
    // call1: show 空表；call2: add 参数错误
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 2, stderr: 'The parameter is incorrect' },
    ])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    await expect(svc.applyRule('dev-3000', makeCtl())).rejects.toMatchObject({
      code: 'TASK_FAILED',
    })
  })

  it('add 失败且旧监听已删时回滚恢复旧条目', async () => {
    // call1: show 有旧条目（connect 端口不同）；call2: delete 成功；call3: add 失败；call4: 回滚 add 旧条目成功
    const tool = makeTool([
      { code: 0, stdout: '0.0.0.0 3000 127.0.0.1 9999' },
      { code: 0 },
      { code: 2, stderr: 'The parameter is incorrect' },
      { code: 0 },
    ])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await expect(svc.applyRule('dev-3000', ctl)).rejects.toMatchObject({
      message: expect.stringContaining('旧监听已恢复'),
    })
    // 回滚用旧条目的 connect 端口（9999），不是规则的（3000）
    expect(tool.calls[3]!.args).toEqual([
      'interface',
      'portproxy',
      'add',
      'v4tov4',
      'listenaddress=0.0.0.0',
      'listenport=3000',
      'connectaddress=127.0.0.1',
      'connectport=9999',
    ])
  })

  it('add 失败且回滚失败时给出手动恢复命令行', async () => {
    const tool = makeTool([
      { code: 0, stdout: '0.0.0.0 3000 127.0.0.1 9999' },
      { code: 0 },
      { code: 2, stderr: 'The parameter is incorrect' },
      { code: 1, stderr: '拒绝访问' },
    ])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    await expect(svc.applyRule('dev-3000', makeCtl())).rejects.toMatchObject({
      message: expect.stringContaining('旧监听已移除且新规则未建立'),
    })
  })

  it('已是目标状态时跳过 delete/add（真幂等）', async () => {
    const tool = makeTool([{ code: 0, stdout: '0.0.0.0 3000 127.0.0.1 3000' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await svc.applyRule('dev-3000', ctl)
    // 仅 show 一次，无 delete/add（不制造破坏窗口）
    expect(tool.calls).toHaveLength(1)
  })

  it('removeRule 查询失败时报错（不误报已无监听）', async () => {
    const tool = makeTool([{ code: 1, stderr: 'oops' }])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await expect(svc.removeRule('dev-3000', ctl)).rejects.toMatchObject({
      code: 'TASK_FAILED',
    })
    // 绝不 report 成功
    expect(ctl.report).not.toHaveBeenCalledWith(100, expect.anything())
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

  it('汇总按规则计数且进度封顶 99：成功+跳过+失败=总数', async () => {
    // 4 条启用 TCP + 1 UDP：1 直败（add 参数错误）、3 成功；UDP 跳过
    const rules = [
      { ...RULES[0]!, id: 'ok-1', listenPort: 3000 },
      { ...RULES[0]!, id: 'bad-1', listenPort: 3001, connectPort: 3001 },
      { ...RULES[0]!, id: 'ok-2', listenPort: 3002, connectPort: 3002 },
      { ...RULES[0]!, id: 'ok-3', listenPort: 3003, connectPort: 3003 },
      RULES[1]!, // udp → skip
    ]
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 0 }, // ok-1
      { code: 0, stdout: '' },
      { code: 2, stderr: 'The parameter is incorrect' }, // bad-1 直败
      { code: 0, stdout: '' },
      { code: 0 }, // ok-2
      { code: 0, stdout: '' },
      { code: 0 }, // ok-3
    ])
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader(rules),
      runTool: tool.fn,
    })
    const ctl = makeCtl()
    await expect(svc.applyAll(ctl)).rejects.toThrow(/成功 3 条，跳过 1 条，失败 1 条/)
    // 进度：循环内不打 100（假满格），100 只在最终汇总
    const progressValues = (ctl.report as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .filter((p): p is number => typeof p === 'number')
    const inLoop = progressValues.filter((p) => p < 100)
    expect(Math.max(...inLoop)).toBeLessThanOrEqual(99)
    expect(progressValues[progressValues.length - 1]).toBe(100)
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

  it('批量提权部分失败（delete 成 / add 败）→ 回滚恢复旧监听并计入失败（review 根治）', async () => {
    const rule = { ...RULES[0]!, id: 'r1', listenPort: 3000, connectPort: 3000 }
    const tool = makeTool([
      { code: 0, stdout: '0.0.0.0 3000 127.0.0.1 9999' }, // show：旧监听指向不同端口
      { code: 1, stderr: 'Access is denied.' }, // delete 提权（延迟）
      { code: 1, stderr: 'Access is denied.' }, // add 提权（延迟）
      { code: 0 }, // 回滚：恢复旧监听
    ])
    const elevation = {
      runOne: vi.fn(),
      run: vi.fn(async (reqs: readonly ElevationRequest[]): Promise<ElevationRunResult> => ({
        canceled: false,
        results: reqs.map((r, i) => ({
          op: r.op,
          ok: i === 0, // delete（idx 0）成功、add（idx 1）失败
          code: i === 0 ? 0 : 1,
          stdout: '',
          stderr: i === 0 ? '' : 'denied',
        })),
      })),
    }
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader([rule]),
      runTool: tool.fn,
      elevation,
    })
    const ctl = makeCtl()
    const err: any = await svc.applyAll(ctl).catch((e) => e)
    expect(err.code).toBe('TASK_FAILED')
    // 合并一次 UAC：delete + add 两个请求
    expect(elevation.run).toHaveBeenCalledTimes(1)
    const reqs = elevation.run.mock.calls[0]![0] as readonly { op: string }[]
    expect(reqs.map((r) => r.op)).toEqual(['netsh.portproxy.delete', 'netsh.portproxy.add'])
    // 回滚：第 4 次工具调用恢复旧监听（connectport=9999）
    expect(tool.calls[3]!.args).toContain('connectport=9999')
    const logLines = (ctl.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join('\n')
    expect(logLines).toContain('旧监听已恢复')
  })

  it('批量提权 UAC 取消 → 待执行项全记失败，汇总可见（不静默）', async () => {
    const rule = { ...RULES[0]!, id: 'r1', listenPort: 3000, connectPort: 3000 }
    const tool = makeTool([
      { code: 0, stdout: '0.0.0.0 3000 127.0.0.1 9999' },
      { code: 1, stderr: 'Access is denied.' }, // delete → defer
      { code: 1, stderr: 'Access is denied.' }, // add → defer
    ])
    const elevation = {
      runOne: vi.fn(),
      run: vi.fn(async (): Promise<ElevationRunResult> => ({ canceled: true, results: [] })),
    }
    const svc = createNetworkService({
      logger: logger(),
      configService: configReader([rule]),
      runTool: tool.fn,
      elevation,
    })
    const ctl = makeCtl()
    const err: any = await svc.applyAll(ctl).catch((e) => e)
    expect(err.code).toBe('TASK_FAILED')
    expect(err.message).toContain('成功 0 条')
    const logLines = (ctl.log as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .join('\n')
    expect(logLines).toContain('已取消管理员授权')
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
