import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ContainerRunSpec, WslcCapabilities } from '@wslpilot/shared'
import { createWslcService } from '../../src/main/services/wslc-service'
import type { TaskControl } from '../../src/main/services/task-runner'
import type { Logger } from '@wslpilot/kit'

function mockLogger(): Logger {
  const noop = () => {}
  return { trace: noop, debug: noop, info: noop, warn: noop, error: noop, setLevel: noop }
}

function caps(over: Partial<WslcCapabilities> = {}): WslcCapabilities {
  return {
    installed: true,
    version: '2.9.3',
    jsonLists: true,
    jsonStats: true,
    events: true,
    health: true,
    copy: true,
    restart: true,
    systemInfo: true,
    session: true,
    mount: true,
    gpu: true,
    networks: true,
    volumes: true,
    settingsFile: true,
    ...over,
  }
}

function ctl(over: Partial<TaskControl> = {}): TaskControl {
  return {
    taskId: 't1',
    type: 'container-run',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: () => {},
    onCancel: vi.fn(),
    ...over,
  }
}

const EMPTY_SPEC: ContainerRunSpec = {
  image: 'ubuntu:latest',
  ports: [],
  mounts: [],
  env: {},
}

function ok(stdout = '') {
  return { stdout, stderr: '', code: 0 }
}

describe('WslcService', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), `wslpilot-wslc-${randomUUID()}-`))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('capabilities 缓存：非 force 复用，force 重新探测，invalidate 清空', async () => {
    const probe = vi.fn(async () => caps())
    const svc = createWslcService({ logger: mockLogger(), probe })
    await svc.capabilities()
    await svc.capabilities()
    expect(probe).toHaveBeenCalledTimes(1)
    await svc.capabilities(true)
    expect(probe).toHaveBeenCalledTimes(2)
    svc.invalidateCapabilities()
    await svc.capabilities()
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('未安装：所有需要 wslc 的操作 → WSL_FEATURE_UNSUPPORTED', async () => {
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps({ installed: false }),
      runTool: vi.fn(async () => ok()),
    })
    await expect(svc.listContainers()).rejects.toMatchObject({ code: 'WSL_FEATURE_UNSUPPORTED' })
    await expect(svc.runContainer(EMPTY_SPEC, ctl())).rejects.toMatchObject({
      code: 'WSL_FEATURE_UNSUPPORTED',
    })
    await expect(svc.stats()).rejects.toMatchObject({ code: 'WSL_FEATURE_UNSUPPORTED' })
  })

  it('listContainers：优先 JSON，空数组时仍返回空；表格回退', async () => {
    const runTool = vi.fn(async (_p: string, args: string[]) => {
      if (args[0] === 'container' && args[1] === 'list') {
        return ok('{"ID":"a","Name":"web","State":"running"}')
      }
      return ok()
    })
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool,
    })
    expect(await svc.listContainers()).toHaveLength(1)

    const runToolTable = vi.fn(async () => ok('ID   IMAGE   COMMAND   STATUS   PORTS   NAMES\n'))
    const svc2 = createWslcService({
      logger: mockLogger(),
      probe: async () => caps({ jsonLists: false }),
      runTool: runToolTable,
    })
    expect(await svc2.listContainers()).toEqual([])
  })

  it('inspectContainer：解析详情；失败映射 TASK_FAILED', async () => {
    const runTool = vi.fn(async (_p: string, args: string[]) => {
      if (args.includes('inspect')) return ok('{"ID":"a","Name":"web","Config":{"Env":["A=1"]}}')
      return ok()
    })
    const svc = createWslcService({ logger: mockLogger(), probe: async () => caps(), runTool })
    const detail = await svc.inspectContainer('web')
    expect(detail?.env).toEqual({ A: '1' })

    const bad = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ({ stdout: '', stderr: 'no such container', code: 1 })),
    })
    await expect(bad.inspectContainer('web')).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('缺失 wslc 的输出映射为 WSL_FEATURE_UNSUPPORTED', async () => {
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ({
        stdout: '',
        stderr: "'wslc.exe' is not recognized as an internal or external command",
        code: 1,
      })),
    })
    await expect(svc.listContainers()).rejects.toMatchObject({ code: 'WSL_FEATURE_UNSUPPORTED' })
  })

  it('stats / networks / volumes：能力缺失时返回空数组而不是报错', async () => {
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps({ jsonStats: false, networks: false, volumes: false }),
      runTool: vi.fn(async () => ok()),
    })
    expect(await svc.stats()).toEqual([])
    expect(await svc.listNetworks()).toEqual([])
    expect(await svc.listVolumes()).toEqual([])
  })

  it('systemInfo：旧版无 system info 时降级为容器数量', async () => {
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps({ systemInfo: false }),
      runTool: vi.fn(async () => ok('{"ID":"a","Name":"web"}')),
    })
    const info = await svc.systemInfo()
    expect(info).toEqual({ version: '2.9.3', raw: 'containers=1' })
  })

  it('流式 run：exit 0 resolve，日志包含等价命令', async () => {
    let opts: any
    const spawnTool = vi.fn((_p: string, _a: string[], o: any) => {
      opts = o
      return { kill: vi.fn(), pid: 1 }
    })
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ok()),
      spawnTool: spawnTool as never,
    })
    const control = ctl()
    const p = svc.runContainer({ ...EMPTY_SPEC, name: 'web' }, control)
    await vi.waitFor(() => expect(spawnTool).toHaveBeenCalled())
    expect(control.log).toHaveBeenCalledWith(expect.stringContaining('wslc.exe run'))
    opts.onLine('pulling…')
    expect(control.log).toHaveBeenCalledWith('pulling…')
    opts.onExit(0)
    await expect(p).resolves.toBeUndefined()
  })

  it('流式 run：非 0 退出 → TASK_FAILED；取消 → TASK_CANCELED；spawn 错误 → TASK_FAILED', async () => {
    const make = () => {
      let opts: any
      const spawnTool = vi.fn((_p: string, _a: string[], o: any) => {
        opts = o
        return { kill: vi.fn(), pid: 1 }
      })
      const svc = createWslcService({
        logger: mockLogger(),
        probe: async () => caps(),
        runTool: vi.fn(async () => ok()),
        spawnTool: spawnTool as never,
      })
      return { svc, getOpts: () => opts }
    }

    const a = make()
    const pa = a.svc.runContainer(EMPTY_SPEC, ctl())
    await vi.waitFor(() => expect(a.getOpts()).toBeDefined())
    a.getOpts().onExit(1)
    await expect(pa).rejects.toMatchObject({ code: 'TASK_FAILED' })

    const b = make()
    const pb = b.svc.runContainer(EMPTY_SPEC, ctl({ isCanceled: () => true }))
    await vi.waitFor(() => expect(b.getOpts()).toBeDefined())
    b.getOpts().onExit(1)
    await expect(pb).rejects.toMatchObject({ code: 'TASK_CANCELED' })

    const c = make()
    const pc = c.svc.runContainer(EMPTY_SPEC, ctl())
    await vi.waitFor(() => expect(c.getOpts()).toBeDefined())
    c.getOpts().onError(new Error('ENOENT'))
    await expect(pc).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('取消注册会 kill 子进程', async () => {
    let opts: any
    let cancelFn: (() => void) | null = null
    const kill = vi.fn()
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ok()),
      spawnTool: ((_p: string, _a: string[], o: any) => {
        opts = o
        return { kill, pid: 1 }
      }) as never,
    })
    const control = ctl({
      isCanceled: () => kill.mock.calls.length > 0,
      onCancel: (fn: () => void) => {
        cancelFn = fn
      },
    })
    const p = svc.pruneContainers(control)
    await vi.waitFor(() => expect(cancelFn).toBeTypeOf('function'))
    cancelFn!()
    expect(kill).toHaveBeenCalled()
    opts.onExit(1)
    await expect(p).rejects.toMatchObject({ code: 'TASK_CANCELED' })
  })

  it('logs 使用 --tail 并走流式；events 返回 stop 且 kill 子进程', async () => {
    const spawnCalls: Array<{ args: string[]; opts: any }> = []
    const kill = vi.fn()
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ok()),
      spawnTool: ((_p: string, args: string[], o: any) => {
        spawnCalls.push({ args, opts: o })
        return { kill, pid: 1 }
      }) as never,
    })
    const p = svc.logs('web', ctl(), true)
    await vi.waitFor(() => expect(spawnCalls).toHaveLength(1))
    expect(spawnCalls[0]!.args).toEqual(['container', 'logs', '-f', '--tail', '500', 'web'])
    spawnCalls[0]!.opts.onExit(0)
    await p

    const stop = svc.events(vi.fn())
    await vi.waitFor(() => expect(spawnCalls).toHaveLength(2))
    expect(spawnCalls[1]!.args).toEqual(['events'])
    stop.stop()
    expect(kill).toHaveBeenCalled()
  })

  it('settings：读取缺失文件、保存合法 YAML、拒绝非法 YAML、reset', async () => {
    const settingsPath = join(dir, 'wslc', 'settings.yaml')
    const runTool = vi.fn(async () => ok())
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool,
      settingsPath,
    })
    const missing = await svc.readSettings()
    expect(missing.exists).toBe(false)
    expect(missing.model).toEqual({ session: {} })

    const saved = await svc.writeSettings('session:\n  cpuCount: 2\n')
    expect(saved.path).toBe(settingsPath)
    const read = await svc.readSettings()
    expect(read.exists).toBe(true)
    expect(read.model.session.cpuCount).toBe(2)

    await expect(svc.writeSettings('- not\n- an object\n')).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
    await expect(svc.writeSettings('{a:')).rejects.toMatchObject({ code: 'CONFIG_INVALID' })

    await svc.resetSettings()
    expect(runTool).toHaveBeenCalledWith('wslc.exe', ['settings', 'reset'], expect.anything())
  })

  it('settings：损坏 YAML 仍返回原始内容（不丢用户文件）', async () => {
    const settingsPath = join(dir, 'settings.yaml')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(settingsPath, '{broken:', 'utf8')
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ok()),
      settingsPath,
    })
    const r = await svc.readSettings()
    expect(r.exists).toBe(true)
    expect(r.content).toBe('{broken:')
    expect(r.model).toEqual({ session: {} })
  })

  it('网络 / 卷 / 镜像操作生成正确 argv', async () => {
    const runTool = vi.fn(async (_p: string, _a: string[]) => ok('[]'))
    const svc = createWslcService({ logger: mockLogger(), probe: async () => caps(), runTool })
    await svc.startContainer('web')
    await svc.stopContainer('web', 5)
    await svc.restartContainer('web')
    await svc.removeContainer('web', true)
    await svc.copy('D:\\a', 'web:/b')
    await svc.removeImage('nginx:latest')
    await svc.createNetwork('net', { driver: 'bridge' })
    await svc.removeNetwork('net')
    await svc.connectNetwork('net', 'web')
    await svc.disconnectNetwork('net', 'web')
    await svc.createVolume('vol')
    await svc.removeVolume('vol')
    const calls = runTool.mock.calls.map((c) => c[1])
    expect(calls).toContainEqual(['start', 'web'])
    expect(calls).toContainEqual(['stop', '-t', '5', 'web'])
    expect(calls).toContainEqual(['container', 'restart', 'web'])
    expect(calls).toContainEqual(['container', 'remove', '-f', 'web'])
    expect(calls).toContainEqual(['container', 'cp', 'D:/a', 'web:/b'])
    expect(calls).toContainEqual(['image', 'remove', 'nginx:latest'])
    expect(calls).toContainEqual(['network', 'create', '-d', 'bridge', 'net'])
    expect(calls).toContainEqual(['network', 'remove', 'net'])
    expect(calls).toContainEqual(['network', 'connect', 'net', 'web'])
    expect(calls).toContainEqual(['network', 'disconnect', 'net', 'web'])
    expect(calls).toContainEqual(['volume', 'create', 'vol'])
    expect(calls).toContainEqual(['volume', 'remove', 'vol'])
  })
})

describe('WslcService 输出成功路径', () => {
  it('systemInfo / sessionList 解析 JSON', async () => {
    const runTool = vi.fn(async (_p: string, args: string[]) => {
      if (args.includes('session')) return ok('{"Name":"default","State":"running","CpuCount":4}')
      if (args[0] === 'system') return ok('{"Version":"2.9.3","StoragePath":"D:/wslc"}')
      return ok('')
    })
    const svc = createWslcService({ logger: mockLogger(), probe: async () => caps(), runTool })
    await expect(svc.systemInfo()).resolves.toMatchObject({ version: '2.9.3' })
    await expect(svc.sessionList()).resolves.toEqual([
      expect.objectContaining({ name: 'default', cpuCount: 4 }),
    ])
  })

  it('stats / images / networks / volumes 解析列表', async () => {
    const runTool = vi.fn(async (_p: string, args: string[]) => {
      if (args[0] === 'stats') return ok('{"Container":"c1","CPU":"1%","Name":"web"}')
      if (args[0] === 'image') return ok('{"ID":"i1","Repository":"nginx","Tag":"latest"}')
      if (args[0] === 'network') return ok('{"ID":"n1","Name":"net","Driver":"bridge"}')
      if (args[0] === 'volume') return ok('{"Name":"vol","Driver":"local"}')
      return ok()
    })
    const svc = createWslcService({ logger: mockLogger(), probe: async () => caps(), runTool })
    expect(await svc.stats()).toHaveLength(1)
    expect(await svc.listImages()).toHaveLength(1)
    expect(await svc.listNetworks()).toHaveLength(1)
    expect(await svc.listVolumes()).toHaveLength(1)
  })

  it('pull / build / prune 走流式并生成正确 argv', async () => {
    const seen: string[][] = []
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ok()),
      spawnTool: ((_p: string, args: string[], o: any) => {
        seen.push(args)
        queueMicrotask(() => o.onExit(0))
        return { kill: vi.fn(), pid: 1 }
      }) as never,
    })
    await svc.pullImage('nginx:latest', ctl({ type: 'image-pull' }))
    await svc.buildImage('app:dev', 'D:\\ctx', ctl({ type: 'image-build' }))
    await svc.pruneImages(true, ctl({ type: 'image-prune' }))
    await svc.pruneContainers(ctl({ type: 'container-prune' }))
    await svc.pruneNetworks(ctl({ type: 'network-remove' }))
    await svc.pruneVolumes(ctl({ type: 'volume-remove' }))
    expect(seen).toEqual([
      ['pull', 'nginx:latest'],
      ['build', '-t', 'app:dev', 'D:/ctx'],
      ['image', 'prune', '--all'],
      ['container', 'prune'],
      ['network', 'prune'],
      ['volume', 'prune'],
    ])
  })

  it('inspect 空输出返回 null；sessionTerminate 无 ctl 也能执行', async () => {
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps({ session: true }),
      runTool: vi.fn(async () => ok('')),
      spawnTool: ((_p: string, _a: string[], o: any) => {
        queueMicrotask(() => o.onExit(0))
        return { kill: vi.fn(), pid: 1 }
      }) as never,
    })
    expect(await svc.inspectContainer('web')).toBeNull()
    await expect(svc.sessionTerminate()).resolves.toBeUndefined()

    const noSession = createWslcService({
      logger: mockLogger(),
      probe: async () => caps({ session: false }),
      runTool: vi.fn(async () => ok()),
    })
    await expect(noSession.sessionTerminate()).rejects.toMatchObject({
      code: 'WSL_FEATURE_UNSUPPORTED',
    })
  })

  it('resetSettings 失败映射 TASK_FAILED；缺失工具映射 WSL_FEATURE_UNSUPPORTED', async () => {
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ({ stdout: '', stderr: 'denied', code: 1 })),
    })
    await expect(svc.resetSettings()).rejects.toMatchObject({ code: 'TASK_FAILED' })

    const missing = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ({
        stdout: '',
        stderr: '找不到 wslc 命令',
        code: 1,
      })),
    })
    await expect(missing.resetSettings()).rejects.toMatchObject({
      code: 'WSL_FEATURE_UNSUPPORTED',
    })
  })
})

describe('WslcService 设置/会话分支', () => {
  it('readSettings 非 ENOENT 错误 → IO_ERROR', async () => {
    const dirPath = await fs.mkdtemp(join(tmpdir(), 'wslpilot-wslc-dir-'))
    try {
      const svc = createWslcService({
        logger: mockLogger(),
        probe: async () => caps(),
        runTool: vi.fn(async () => ok()),
        settingsPath: dirPath, // 目录：readFile 报 EISDIR
      })
      await expect(svc.readSettings()).rejects.toMatchObject({ code: 'IO_ERROR' })
    } finally {
      await fs.rm(dirPath, { recursive: true, force: true })
    }
  })

  it('sessionList 能力缺失返回空；events spawn 错误记录 warn', async () => {
    const logger = mockLogger()
    const warn = vi.spyOn(logger, 'warn')
    let opts: any
    const svc = createWslcService({
      logger,
      probe: async () => caps({ session: false }),
      runTool: vi.fn(async () => ok()),
      spawnTool: ((_p: string, _a: string[], o: any) => {
        opts = o
        return { kill: vi.fn(), pid: 1 }
      }) as never,
    })
    expect(await svc.sessionList()).toEqual([])
    svc.events(vi.fn())
    opts.onError(new Error('events failed'))
    expect(warn).toHaveBeenCalledWith('wslc events error', { error: 'events failed' })
  })
})

describe('WslcService inspect 泛化失败分支', () => {
  it('inspect 非缺失工具错误 → TASK_FAILED 且带 rawCommand', async () => {
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool: vi.fn(async () => ({ stdout: '', stderr: 'boom', code: 1 })),
    })
    await expect(svc.inspectContainer('web')).rejects.toMatchObject({
      code: 'TASK_FAILED',
      rawCommand: expect.stringContaining('wslc.exe container inspect web'),
    })
  })
})

describe('WslcService 空列表/会话控制分支', () => {
  it('JSON 空数组走 JSON 分支返回空（不回退表格）；sessionTerminate 接受注入 ctl', async () => {
    const runTool = vi.fn(async (_p: string, args: string[]) => {
      if (args[0] === 'container' && args[1] === 'list') return ok('[]')
      return ok()
    })
    let opts: any
    const svc = createWslcService({
      logger: mockLogger(),
      probe: async () => caps(),
      runTool,
      spawnTool: ((_p: string, _a: string[], o: any) => {
        opts = o
        return { kill: vi.fn(), pid: 1 }
      }) as never,
    })
    expect(await svc.listContainers()).toEqual([])
    const p = svc.sessionTerminate(ctl({ type: 'wslc-session' }))
    await vi.waitFor(() => expect(opts).toBeDefined())
    opts.onExit(0)
    await expect(p).resolves.toBeUndefined()
  })
})
