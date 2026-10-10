/**
 * M7 提权委托链回归（review 假信心根治 H4）：
 * 直接执行权限不足 → 服务层改由提权助手执行（op 白名单 + 参数），此前 4 条链路零测试。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@wslpilot/kit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wslpilot/kit')>()
  return {
    ...actual,
    runWsl: vi.fn(),
    spawnWsl: vi.fn(),
  }
})

import {
  createNetworkService,
  type NetworkConfigReader,
} from '../../src/main/services/network-service'
import { createUsbipdService } from '../../src/main/services/usbipd-service'
import { createWslService } from '../../src/main/services/wsl-service'
import { spawnWsl } from '@wslpilot/kit'
import type { TaskControl } from '../../src/main/services/task-runner'
import type {
  ElevationOpResult,
  ElevationRequest,
  ElevationRunResult,
  PortForwardRule,
} from '@wslpilot/shared'

const ELEVATION_DENIED = 'The requested operation requires elevation'

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

function makeCtl(): TaskControl {
  return {
    taskId: 't1',
    type: 'network',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: vi.fn(),
    onCancel: vi.fn(),
  } as TaskControl
}

function makeTool(results: Array<{ code?: number; stdout?: string; stderr?: string }>) {
  const calls: Array<{ program: string; args: string[] }> = []
  let i = 0
  const fn = vi.fn(async (program: string, args: string[]) => {
    calls.push({ program, args })
    const r = results[Math.min(i, results.length - 1)] ?? { code: 0 }
    i++
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 }
  })
  return { fn, calls }
}

function okResult(op: ElevationRequest['op'], ok = true): ElevationOpResult {
  return { op, ok, code: ok ? 0 : 1, stdout: ok ? 'ok' : '', stderr: ok ? '' : 'denied' }
}

function elevationMock() {
  const runOne = vi.fn(async (req: ElevationRequest): Promise<ElevationOpResult> => {
    return okResult(req.op)
  })
  const run = vi.fn(async (reqs: readonly ElevationRequest[]): Promise<ElevationRunResult> => ({
    canceled: false,
    results: reqs.map((r) => okResult(r.op)),
  }))
  return { runOne, run }
}

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
const RULE2: PortForwardRule = {
  ...RULE,
  id: 'dev-3001',
  listenPort: 3001,
  connectPort: 3001,
}

function netConfig(rules: PortForwardRule[]): NetworkConfigReader {
  return {
    loadSync: () =>
      ({
        $schemaVersion: 1,
        portForwarding: rules,
        proxy: { useWindowsProxy: false, httpProxy: '', httpsProxy: '', noProxy: '' },
      }) as any,
  }
}

describe('network-service 提权委托', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applyRule：直接执行权限不足 → runOne（op+参数白名单），成功即完成', async () => {
    // call1: show all（空表）；call2: add → 权限不足
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 1, stderr: ELEVATION_DENIED },
    ])
    const elevation = elevationMock()
    const svc = createNetworkService({
      logger: logger(),
      configService: netConfig([RULE]),
      runTool: tool.fn,
      elevation,
    })
    await svc.applyRule('dev-3000', makeCtl())
    expect(elevation.runOne).toHaveBeenCalledTimes(1)
    expect(elevation.runOne).toHaveBeenCalledWith({
      op: 'netsh.portproxy.add',
      params: {
        listenAddress: '0.0.0.0',
        listenPort: 3000,
        connectAddress: '127.0.0.1',
        connectPort: 3000,
      },
    })
  })

  it('applyAll：多条规则的待提权项合并为一次 UAC（run 批量，§14.3）', async () => {
    // call1: show all → 空；then 每条规则 add → 权限不足
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 1, stderr: ELEVATION_DENIED },
    ])
    const elevation = elevationMock()
    const svc = createNetworkService({
      logger: logger(),
      configService: netConfig([RULE, RULE2]),
      runTool: tool.fn,
      elevation,
    })
    await svc.applyAll(makeCtl())
    // 批量：run 只调一次，内含两条 add 请求；runOne 不参与
    expect(elevation.run).toHaveBeenCalledTimes(1)
    const reqs = elevation.run.mock.calls[0]![0]
    expect(reqs).toHaveLength(2)
    expect(reqs.map((r) => r.op)).toEqual(['netsh.portproxy.add', 'netsh.portproxy.add'])
    expect(elevation.runOne).not.toHaveBeenCalled()
  })

  it('applyAll：批量提权部分失败 → 汇总进任务错误（不吞）', async () => {
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 1, stderr: ELEVATION_DENIED },
    ])
    const elevation = elevationMock()
    elevation.run.mockResolvedValueOnce({
      canceled: false,
      results: [okResult('netsh.portproxy.add'), { ...okResult('netsh.portproxy.add', false) }],
    })
    const svc = createNetworkService({
      logger: logger(),
      configService: netConfig([RULE, RULE2]),
      runTool: tool.fn,
      elevation,
    })
    await expect(svc.applyAll(makeCtl())).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('UAC 取消 → PERMISSION_DENIED + 可执行建议', async () => {
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 1, stderr: ELEVATION_DENIED },
    ])
    const elevation = elevationMock()
    elevation.runOne.mockRejectedValueOnce(
      Object.assign(new Error('已取消管理员授权'), {
        code: 'PERMISSION_DENIED',
        message: '已取消管理员授权',
        recoverable: true,
        suggestion: '请重新运行该任务并在 UAC 弹窗中选择「是」',
      }),
    )
    const svc = createNetworkService({
      logger: logger(),
      configService: netConfig([RULE]),
      runTool: tool.fn,
      elevation,
    })
    await expect(svc.applyRule('dev-3000', makeCtl())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
  })

  it('未注入提权助手：保持 PERMISSION_DENIED + 等价命令行（降级路径）', async () => {
    const tool = makeTool([
      { code: 0, stdout: '' },
      { code: 1, stderr: ELEVATION_DENIED },
    ])
    const svc = createNetworkService({
      logger: logger(),
      configService: netConfig([RULE]),
      runTool: tool.fn,
    })
    await expect(svc.applyRule('dev-3000', makeCtl())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
  })
})

describe('usbipd-service 提权委托', () => {
  it('bind/unbind 权限不足 → runOne（busid 白名单参数）', async () => {
    const tool = makeTool([{ code: 1, stderr: ELEVATION_DENIED }])
    const elevation = elevationMock()
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn, elevation })
    await svc.bind('1-2', makeCtl())
    expect(elevation.runOne).toHaveBeenCalledWith({
      op: 'usbipd.bind',
      params: { busId: '1-2' },
    })

    await svc.unbind('2-3', makeCtl())
    expect(elevation.runOne).toHaveBeenCalledWith({
      op: 'usbipd.unbind',
      params: { busId: '2-3' },
    })
  })

  it('提权执行失败 → PERMISSION_DENIED + 等价命令行', async () => {
    const tool = makeTool([{ code: 1, stderr: ELEVATION_DENIED }])
    const elevation = elevationMock()
    elevation.runOne.mockResolvedValueOnce({
      op: 'usbipd.bind',
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'denied',
    })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn, elevation })
    await expect(svc.bind('1-2', makeCtl())).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })
})

describe('wsl-service 提权委托', () => {
  beforeEach(() => vi.clearAllMocks())

  it('install 权限不足 → runOne wsl.install（结构化参数）', async () => {
    vi.mocked(spawnWsl).mockImplementation((_args, handlers) => {
      handlers.onLine(ELEVATION_DENIED)
      handlers.onExit(1)
      return { kill: vi.fn() } as any
    })
    const elevation = elevationMock()
    const svc = createWslService(logger(), { elevation })
    await svc.install('Ubuntu', makeCtl())
    expect(elevation.runOne).toHaveBeenCalledWith({ op: 'wsl.install', params: { name: 'Ubuntu' } })
  })

  it('setVersion 权限不足 → runOne wsl.setVersion；提权失败映射 PERMISSION_DENIED', async () => {
    vi.mocked(spawnWsl).mockImplementation((_args, handlers) => {
      handlers.onLine(ELEVATION_DENIED)
      handlers.onExit(1)
      return { kill: vi.fn() } as any
    })
    const elevation = elevationMock()
    elevation.runOne.mockResolvedValueOnce({
      op: 'wsl.setVersion',
      ok: false,
      code: 1,
      stdout: '',
      stderr: 'denied',
    })
    const svc = createWslService(logger(), { elevation })
    await expect(svc.setVersion('Ubuntu', 2, makeCtl())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
    expect(elevation.runOne).toHaveBeenCalledWith({
      op: 'wsl.setVersion',
      params: { name: 'Ubuntu', version: 2 },
    })
  })
})
