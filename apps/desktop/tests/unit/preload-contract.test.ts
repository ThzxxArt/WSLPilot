import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { WslApi } from '../../src/preload/index'

/**
 * preload 契约测试（review C4 根治）：
 * mock ipcRenderer，逐个调用 window.wslAPI 方法，断言
 * 1) invoke 的通道名正确
 * 2) 参数形状能通过 IPC_SCHEMAS 校验（与 ipc-schema 零漂移）
 * 3) 事件订阅/退订闭环
 */
const invoke = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined)
const on = vi.fn((..._args: unknown[]) => undefined)
const removeListener = vi.fn((..._args: unknown[]) => undefined)
let exposed: Record<string, any> = {}
/** contextBridge 桥名（item 8：此前 _name 被丢弃、'wslAPI' 零断言） */
let exposedName = ''

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: Record<string, unknown>) => {
      exposedName = name
      exposed = api as Record<string, any>
    },
  },
  ipcRenderer: {
    invoke: (...a: unknown[]) => invoke(...a),
    on: (...a: unknown[]) => on(...a),
    removeListener: (...a: unknown[]) => removeListener(...a),
  },
}))

const { CH, parseIpcArgs } = await import('@wslpilot/shared')
await import('../../src/preload/index')

/** invoke 透传哨兵：用于断言 preload 方法把结果 return 出来（丢 return 也是回归） */
const PASSTHROUGH = { __passthrough__: true } as const

/** 非直接透传的方法（内部做了形状变换），单独断言变换结果 */
const DERIVED = new Set(['actions.list', 'network.listRules', 'network.getProxy'])

/**
 * 复用 config 通道的组合方法（API 动词与通道动词天然不同名）：
 * 通道是 config:get/config:set，API 是面向资源的读写包装。白名单即声明，禁止静默扩大。
 */
const COMPOSITIONAL = new Set([
  'actions.list',
  'actions.save',
  'network.listRules',
  'network.saveRules',
  'network.getProxy',
  'network.saveProxy',
])

/** callAndCheck 实际覆盖的 API 路径 → 通道（末位用例做全量对账） */
const invokedByPath = new Map<string, string>()

/** 路径归一：'distros.install 无名' / 'io.listBackups(dir)' → 'distros.install' / 'io.listBackups' */
function normPath(path: string): string {
  return path.split(' ')[0]!.split('(')[0]!
}

/** 事件订阅方法（onXxx）不走 invoke 通道 */
function isEventMethod(key: string): boolean {
  return key.startsWith('on') && key.length > 2 && key[2] === key[2]!.toUpperCase()
}

/**
 * 动词防漂移（review：命名漂移根治）：
 * 通道 `域:动词` 的动词必须与 preload API 方法名一致（允许一方为另一方的后缀，
 * 如 distros.registryDetail ↔ registry:detail、metrics.sampleOverview ↔ metrics:overview、
 * app.close ↔ app:windowClose）；组合方法走 COMPOSITIONAL 白名单。
 */
function assertVerbAligned(path: string, channel: string): void {
  const apiVerb = path.split('.')[1]!.toLowerCase()
  const chVerb = (channel.split(':')[1] ?? '').toLowerCase()
  const aligned = apiVerb === chVerb || apiVerb.endsWith(chVerb) || chVerb.endsWith(apiVerb)
  if (COMPOSITIONAL.has(path)) {
    expect(
      aligned,
      `${path} 在 COMPOSITIONAL 白名单但动词其实一致（${channel}）— 请移出白名单`,
    ).toBe(false)
    return
  }
  expect(aligned, `命名漂移：API ${path} ↔ 通道 ${channel} 动词不一致`).toBe(true)
}

/** 待校验的返回值（afterEach 统一 await，避免把每个用例改 async） */
const pendingResults: Array<{ path: string; result: unknown }> = []

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(PASSTHROUGH)
})

afterEach(async () => {
  const batch = pendingResults.splice(0)
  for (const { path, result } of batch) {
    if (DERIVED.has(path)) continue
    // 丢掉 return 会让 result 变成 undefined —— 这里必须红（review：测试假信心根治）
    await expect(result, `${path} 应透传 invoke 返回值`).resolves.toBe(PASSTHROUGH)
  }
})

/**
 * 调用一个 preload 方法并校验其 invoke 契约：
 * 1) 通道名正确 2) 参数过 ipc-schema 校验 3) 返回值透传
 */
function callAndCheck(
  path: string,
  fn: () => Promise<unknown>,
  expectedChannel: string,
  ...expectedArgs: unknown[]
): void {
  const result = fn()
  pendingResults.push({ path, result })
  expect(invoke, `${path} 应调用 ${expectedChannel}`).toHaveBeenCalledWith(
    expectedChannel,
    ...expectedArgs,
  )
  // 防漂移：API 方法名 ↔ 通道动词一致（命名漂移在此逐调用点即红）
  const key = normPath(path)
  invokedByPath.set(key, expectedChannel)
  assertVerbAligned(key, expectedChannel)
  if (expectedArgs.length === 1) {
    // 参数形状必须通过 ipc-schema 校验（契约与校验零漂移）
    expect(() => parseIpcArgs(expectedChannel, expectedArgs)).not.toThrow()
  }
}

describe('preload 契约', () => {
  it('contextBridge 桥名必须是 wslAPI（Window.wslAPI 类型契约的运行时锚点）', () => {
    expect(exposedName).toBe('wslAPI')
  })

  it('exposed API 面与契约清单零漂移', () => {
    // 新增 preload 域/方法而不补契约测试时，本用例必须红
    expect(Object.keys(exposed).sort()).toEqual(
      [
        'actions',
        'app',
        'config',
        'devices',
        'diagnostics',
        'distros',
        'fs',
        'io',
        'meta',
        'metrics',
        'network',
        'task',
        'terminal',
        'update',
        'wslconf',
      ].sort(),
    )
    expect(Object.keys(exposed.config).sort()).toEqual(
      ['get', 'onChanged', 'onConflict', 'openExternal', 'resolveConflict', 'set'].sort(),
    )
    expect(Object.keys(exposed.network).sort()).toEqual(
      [
        'apply',
        'applyAll',
        'getProxy',
        'listRules',
        'proxyApply',
        'proxyClear',
        'proxyState',
        'remove',
        'saveProxy',
        'saveRules',
        'status',
      ].sort(),
    )
    expect(Object.keys(exposed.devices).sort()).toEqual(
      ['attach', 'bind', 'detach', 'list', 'status', 'unbind'].sort(),
    )
    expect(Object.keys(exposed.diagnostics).sort()).toEqual(['exportPackage', 'openLogsDir'])
    expect(Object.keys(exposed.update).sort()).toEqual(
      ['check', 'download', 'install', 'onChanged', 'status'].sort(),
    )
    expect(Object.keys(exposed.app).sort()).toEqual(
      [
        'close',
        'getVersion',
        'getWslVersion',
        'maximize',
        'minimize',
        'onNavigate',
        'openConfigDir',
        'openPath',
        'pickDirectory',
        'pickOpenFile',
        'pickSaveFile',
        'signatureStatus',
      ].sort(),
    )
    // 其余域的方法面同样全枚举（此前只锁 6 个域 — 新增方法不会红，假信心）
    expect(Object.keys(exposed.distros).sort()).toEqual(
      [
        'install',
        'list',
        'listOnline',
        'registryDetail',
        'setDefault',
        'setVersion',
        'shutdown',
        'start',
        'terminate',
        'unregister',
      ].sort(),
    )
    expect(Object.keys(exposed.meta).sort()).toEqual(['get', 'set'])
    expect(Object.keys(exposed.metrics).sort()).toEqual(['sample', 'sampleOverview'])
    expect(Object.keys(exposed.terminal).sort()).toEqual(
      ['create', 'input', 'kill', 'list', 'maxSessions', 'onData', 'onExit', 'resize'].sort(),
    )
    expect(Object.keys(exposed.io).sort()).toEqual(
      ['cleanupBackups', 'export', 'import', 'listBackups', 'move'].sort(),
    )
    expect(Object.keys(exposed.wslconf).sort()).toEqual(['read', 'write'])
    expect(Object.keys(exposed.actions).sort()).toEqual(['list', 'run', 'save'])
    expect(Object.keys(exposed.fs).sort()).toEqual(['read', 'readDir', 'revealInExplorer', 'write'])
    expect(Object.keys(exposed.task).sort()).toEqual(['cancel', 'onProgress'])
  })

  it('config 域通道与参数形状', () => {
    callAndCheck('config.get', () => exposed.config.get('settings'), CH.configGet, 'settings')
    callAndCheck(
      'config.set',
      () => exposed.config.set('settings', { general: { accent: 'ocean' } }),
      CH.configSet,
      { fileKey: 'settings', patch: { general: { accent: 'ocean' } } },
    )
    callAndCheck(
      'config.openExternal',
      () => exposed.config.openExternal('actions'),
      CH.configOpenExternal,
      'actions',
    )
    callAndCheck(
      'config.resolveConflict',
      () => exposed.config.resolveConflict('settings', 'reload'),
      CH.configResolveConflict,
      { fileKey: 'settings', action: 'reload' },
    )
  })

  it('distros 域通道与参数形状（含 setVersion — review M1 断链根治）', () => {
    callAndCheck('distros.list', () => exposed.distros.list(), CH.distrosList)
    callAndCheck('distros.start', () => exposed.distros.start('U'), CH.distrosStart, 'U')
    callAndCheck(
      'distros.terminate',
      () => exposed.distros.terminate('U'),
      CH.distrosTerminate,
      'U',
    )
    callAndCheck('distros.shutdown', () => exposed.distros.shutdown(), CH.distrosShutdown)
    callAndCheck(
      'distros.setDefault',
      () => exposed.distros.setDefault('U'),
      CH.distrosSetDefault,
      'U',
    )
    callAndCheck(
      'distros.registryDetail',
      () => exposed.distros.registryDetail('U'),
      CH.registryDetail,
      'U',
    )
    callAndCheck('distros.listOnline', () => exposed.distros.listOnline(), CH.distrosListOnline)
    callAndCheck('distros.install', () => exposed.distros.install('U'), CH.distrosInstall, {
      name: 'U',
    })
    callAndCheck('distros.install 无名', () => exposed.distros.install(), CH.distrosInstall, {})
    callAndCheck(
      'distros.setVersion',
      () => exposed.distros.setVersion('U', 2),
      CH.distrosSetVersion,
      { name: 'U', version: 2 },
    )
    callAndCheck(
      'distros.unregister',
      () => exposed.distros.unregister('U'),
      CH.distrosUnregister,
      'U',
    )
  })

  it('meta / metrics 域', () => {
    callAndCheck('meta.get', () => exposed.meta.get('U'), CH.metaGet, 'U')
    const meta = {
      name: 'U',
      alias: '',
      tags: [],
      color: '',
      icon: '',
      note: '',
      startupCwd: '~',
      pinned: false,
      quickActions: [],
    }
    callAndCheck('meta.set', () => exposed.meta.set(meta), CH.metaSet, meta)
    callAndCheck('metrics.sample', () => exposed.metrics.sample('U'), CH.metricsSample, 'U')
    // 全局概览走独立通道 metrics:overview（单通道双返回形状已拆 — review 契约清晰化）
    callAndCheck(
      'metrics.sampleOverview',
      () => exposed.metrics.sampleOverview(),
      CH.metricsOverview,
    )
  })

  it('terminal 域（含 list — 会话恢复用）', () => {
    const opts = { distro: 'U', shell: '/bin/sh', cwd: '/tmp', cols: 80, rows: 24 }
    callAndCheck('terminal.create', () => exposed.terminal.create(opts), CH.ptyCreate, opts)
    callAndCheck('terminal.input', () => exposed.terminal.input('p1', 'ls\n'), CH.ptyInput, {
      ptyId: 'p1',
      data: 'ls\n',
    })
    callAndCheck('terminal.resize', () => exposed.terminal.resize('p1', 100, 40), CH.ptyResize, {
      ptyId: 'p1',
      cols: 100,
      rows: 40,
    })
    callAndCheck('terminal.kill', () => exposed.terminal.kill('p1'), CH.ptyKill, 'p1')
    callAndCheck('terminal.list', () => exposed.terminal.list(), CH.ptyList)
    callAndCheck('terminal.maxSessions', () => exposed.terminal.maxSessions(), CH.ptyMaxSessions)
  })

  it('io 域', () => {
    const exp = { name: 'U', path: 'C:\\b\\u.tar', format: 'tar' as const }
    callAndCheck('io.export', () => exposed.io.export(exp), CH.ioExport, exp)
    const imp = {
      name: 'U',
      installPath: 'C:\\i',
      archivePath: 'C:\\b\\u.tar',
      format: 'tar' as const,
      version: 2 as const,
      inPlace: false,
    }
    callAndCheck('io.import', () => exposed.io.import(imp), CH.ioImport, imp)
    const mv = { name: 'U', path: 'C:\\m', terminateFirst: true }
    callAndCheck('io.move', () => exposed.io.move(mv), CH.ioMove, mv)
    callAndCheck('io.listBackups', () => exposed.io.listBackups(), CH.ioListBackups, {})
    callAndCheck('io.listBackups(dir)', () => exposed.io.listBackups('C:\\b'), CH.ioListBackups, {
      dir: 'C:\\b',
    })
    callAndCheck(
      'io.cleanupBackups',
      () => exposed.io.cleanupBackups({ keep: 3 }),
      CH.ioCleanupBackups,
      { keep: 3 },
    )
    // keep 可选：无参调用只发 {}，缺省 5 由 ipc-schema 默认值统一兜底（preload 不再抄 5）
    callAndCheck(
      'io.cleanupBackups 无参',
      () => exposed.io.cleanupBackups(),
      CH.ioCleanupBackups,
      {},
    )
    expect(parseIpcArgs(CH.ioCleanupBackups, [{}])).toEqual({ keep: 5 })
  })

  it('wslconf / actions / fs 域（M5）', () => {
    callAndCheck('wslconf.read', () => exposed.wslconf.read('U'), CH.wslconfRead, 'U')
    callAndCheck('wslconf.write', () => exposed.wslconf.write('U', '[boot]\n'), CH.wslconfWrite, {
      name: 'U',
      content: '[boot]\n',
    })
    callAndCheck('actions.run', () => exposed.actions.run('a1', 'U'), CH.actionRun, {
      actionId: 'a1',
      distro: 'U',
    })
    callAndCheck('actions.run 无发行版', () => exposed.actions.run('a1'), CH.actionRun, {
      actionId: 'a1',
    })
    callAndCheck('actions.list', () => exposed.actions.list(), CH.configGet, 'actions')
    callAndCheck('actions.save', () => exposed.actions.save([]), CH.configSet, {
      fileKey: 'actions',
      patch: { actions: [] },
    })
    callAndCheck('fs.readDir', () => exposed.fs.readDir('U', '/'), CH.fsReadDir, {
      distro: 'U',
      path: '/',
    })
    callAndCheck('fs.read', () => exposed.fs.read('U', '/etc/x'), CH.fsRead, {
      distro: 'U',
      path: '/etc/x',
    })
    callAndCheck('fs.write', () => exposed.fs.write('U', '/etc/x', 'y'), CH.fsWrite, {
      distro: 'U',
      path: '/etc/x',
      data: 'y',
    })
    callAndCheck(
      'fs.revealInExplorer',
      () => exposed.fs.revealInExplorer('U', '/etc'),
      CH.fsRevealInExplorer,
      {
        distro: 'U',
        path: '/etc',
      },
    )
  })

  it('network / devices 域（M6）', () => {
    callAndCheck('network.status', () => exposed.network.status(), CH.networkStatus)
    callAndCheck(
      'network.apply',
      () => exposed.network.apply('dev-3000'),
      CH.networkApply,
      'dev-3000',
    )
    callAndCheck('network.applyAll', () => exposed.network.applyAll(), CH.networkApplyAll)
    callAndCheck(
      'network.remove',
      () => exposed.network.remove('dev-3000'),
      CH.networkRemove,
      'dev-3000',
    )
    callAndCheck(
      'network.proxyApply',
      () => exposed.network.proxyApply('U'),
      CH.networkProxyApply,
      {
        distro: 'U',
      },
    )
    callAndCheck(
      'network.proxyClear',
      () => exposed.network.proxyClear('U'),
      CH.networkProxyClear,
      {
        distro: 'U',
      },
    )
    callAndCheck(
      'network.proxyState',
      () => exposed.network.proxyState('U'),
      CH.networkProxyState,
      {
        distro: 'U',
      },
    )
    callAndCheck('network.listRules', () => exposed.network.listRules(), CH.configGet, 'network')
    callAndCheck('network.saveRules', () => exposed.network.saveRules([]), CH.configSet, {
      fileKey: 'network',
      patch: { portForwarding: [] },
    })
    callAndCheck('network.getProxy', () => exposed.network.getProxy(), CH.configGet, 'network')
    const proxy = {
      useWindowsProxy: false,
      httpProxy: 'http://a:1',
      httpsProxy: '',
      noProxy: 'localhost',
    }
    callAndCheck('network.saveProxy', () => exposed.network.saveProxy(proxy), CH.configSet, {
      fileKey: 'network',
      patch: { proxy },
    })

    callAndCheck('devices.status', () => exposed.devices.status(), CH.devicesStatus)
    callAndCheck('devices.list', () => exposed.devices.list(), CH.devicesList)
    callAndCheck('devices.bind', () => exposed.devices.bind('1-2'), CH.devicesBind, '1-2')
    callAndCheck('devices.unbind', () => exposed.devices.unbind('1-2'), CH.devicesUnbind, '1-2')
    callAndCheck('devices.attach', () => exposed.devices.attach('1-2', 'U'), CH.devicesAttach, {
      busId: '1-2',
      distro: 'U',
    })
    callAndCheck('devices.attach 无发行版', () => exposed.devices.attach('1-2'), CH.devicesAttach, {
      busId: '1-2',
    })
    callAndCheck('devices.detach', () => exposed.devices.detach('1-2'), CH.devicesDetach, '1-2')
  })

  it('app 域', () => {
    callAndCheck('app.getVersion', () => exposed.app.getVersion(), CH.appGetVersion)
    callAndCheck('app.openConfigDir', () => exposed.app.openConfigDir(), CH.appOpenConfigDir)
    callAndCheck('app.openPath', () => exposed.app.openPath('C:\\x'), CH.appOpenPath, 'C:\\x')
    callAndCheck(
      'app.pickDirectory',
      () => exposed.app.pickDirectory('C:\\x'),
      CH.appPickDirectory,
      { defaultPath: 'C:\\x' },
    )
    callAndCheck(
      'app.pickDirectory 无参',
      () => exposed.app.pickDirectory(),
      CH.appPickDirectory,
      {},
    )
    callAndCheck('app.pickSaveFile', () => exposed.app.pickSaveFile({}), CH.appPickSaveFile, {})
    callAndCheck('app.pickOpenFile', () => exposed.app.pickOpenFile({}), CH.appPickOpenFile, {})
    callAndCheck('app.getWslVersion', () => exposed.app.getWslVersion(), CH.appGetWslVersion)
    callAndCheck('app.minimize', () => exposed.app.minimize(), CH.appWindowMinimize)
    callAndCheck('app.maximize', () => exposed.app.maximize(), CH.appWindowMaximize)
    callAndCheck('app.close', () => exposed.app.close(), CH.appWindowClose)
  })

  it('task 域', () => {
    callAndCheck('task.cancel', () => exposed.task.cancel('t1'), CH.taskCancel, 't1')
  })

  it('diagnostics / update / 签名域（M7）', () => {
    callAndCheck(
      'diagnostics.openLogsDir',
      () => exposed.diagnostics.openLogsDir(),
      CH.diagnosticsOpenLogsDir,
    )
    callAndCheck(
      'diagnostics.exportPackage',
      () => exposed.diagnostics.exportPackage(),
      CH.diagnosticsExportPackage,
      {},
    )
    callAndCheck('app.signatureStatus', () => exposed.app.signatureStatus(), CH.appSignatureStatus)
    callAndCheck('update.status', () => exposed.update.status(), CH.updateStatus)
    callAndCheck('update.check', () => exposed.update.check(), CH.updateCheck)
    callAndCheck('update.download', () => exposed.update.download(), CH.updateDownload)
    callAndCheck('update.install', () => exposed.update.install(), CH.updateInstall)
  })

  it('DERIVED 方法的形状降级真实生效（此前注释承诺但零断言 — 假信心）', async () => {
    // actions.list：非数组/缺省 → []
    invoke.mockResolvedValueOnce({ actions: 'oops' })
    await expect(exposed.actions.list()).resolves.toEqual([])
    invoke.mockResolvedValueOnce(null)
    await expect(exposed.actions.list()).resolves.toEqual([])
    invoke.mockResolvedValueOnce({ actions: [{ id: 'a1' }] })
    await expect(exposed.actions.list()).resolves.toEqual([{ id: 'a1' }])

    // network.listRules：非数组 → []
    invoke.mockResolvedValueOnce({ portForwarding: 'x' })
    await expect(exposed.network.listRules()).resolves.toEqual([])
    invoke.mockResolvedValueOnce({ portForwarding: [{ id: 'r1' }] })
    await expect(exposed.network.listRules()).resolves.toEqual([{ id: 'r1' }])

    // network.getProxy：缺省 → 默认代理对象
    invoke.mockResolvedValueOnce({})
    await expect(exposed.network.getProxy()).resolves.toEqual({
      useWindowsProxy: false,
      httpProxy: '',
      httpsProxy: '',
      noProxy: 'localhost,127.0.0.1',
    })
  })

  it('事件订阅可退订（逐通道校验注册通道名与摘除同 handler）', () => {
    const cases = [
      ['config.onChanged', () => exposed.config.onChanged(() => {}), CH.configChanged],
      ['config.onConflict', () => exposed.config.onConflict(() => {}), CH.configConflict],
      ['terminal.onData', () => exposed.terminal.onData(() => {}), CH.ptyData],
      ['terminal.onExit', () => exposed.terminal.onExit(() => {}), CH.ptyExit],
      ['task.onProgress', () => exposed.task.onProgress(() => {}), CH.taskProgress],
      ['app.onNavigate', () => exposed.app.onNavigate(() => {}), CH.appNavigate],
      ['update.onChanged', () => exposed.update.onChanged(() => {}), CH.updateChanged],
    ] as const
    for (const [name, subscribe, channel] of cases) {
      const onBefore = on.mock.calls.length
      const rmBefore = removeListener.mock.calls.length
      const off = subscribe()
      // 每轮独立增量断言（此前循环内只有 toHaveBeenCalled — 第 2 轮起恒绿）
      expect(on.mock.calls.length, `${name} 应注册一次`).toBe(onBefore + 1)
      expect(on.mock.calls[onBefore]![0], `${name} 应注册到 ${channel}`).toBe(channel)
      expect(typeof off, `${name} 应返回退订函数`).toBe('function')
      const handler = on.mock.calls[onBefore]![1]
      off()
      expect(removeListener.mock.calls.length, `${name} 退订应摘除`).toBe(rmBefore + 1)
      expect(removeListener.mock.calls[rmBefore], `${name} 退订须同通道同 handler`).toEqual([
        channel,
        handler,
      ])
    }
  })

  it('类型精度钉子：terminal 返回 PtySessionInfo 形状、save 系返回配置文件形状、keep 可选', async () => {
    // —— 类型层（vue-tsc 强制；返回类型漂移/丢字段即红）——
    const sessionPin: Awaited<ReturnType<WslApi['terminal']['create']>> = {
      ptyId: 'p1',
      distro: 'U',
      shell: '/bin/sh',
      cwd: '/tmp',
      createdAt: 123,
    }
    const listPin: Awaited<ReturnType<WslApi['terminal']['list']>>[number] = {
      ptyId: 'p1',
      distro: 'U',
      shell: '/bin/sh',
      createdAt: 123,
    }
    const actionsSaved: Awaited<ReturnType<WslApi['actions']['save']>> = {
      $schemaVersion: 1,
      actions: [],
    }
    const networkSaved: Awaited<ReturnType<WslApi['network']['saveRules']>> = {
      $schemaVersion: 1,
      portForwarding: [],
      proxy: { useWindowsProxy: false, httpProxy: '', httpsProxy: '', noProxy: '' },
    }
    // 精确类型可直接取字段（若收窄为 unknown 会在编译期红）
    expect(actionsSaved.actions).toEqual([])
    expect(networkSaved.portForwarding).toEqual([])
    // keep? 可选：空对象与显式 keep 都合法（keep 若变回必填，`{}` 会红）
    const keepEmpty: Parameters<WslApi['io']['cleanupBackups']>[0] = {}
    const keepExplicit: Parameters<WslApi['io']['cleanupBackups']>[0] = { keep: 3, dir: 'D:\\b' }
    expect(keepEmpty).toEqual({})
    expect(keepExplicit.keep).toBe(3)

    // —— 运行时层：完整形状不被 preload 吞掉（cwd/createdAt 等字段透传）——
    invoke.mockResolvedValue(sessionPin)
    await expect(exposed.terminal.create({ distro: 'U', cols: 80, rows: 24 })).resolves.toEqual(
      sessionPin,
    )
    invoke.mockResolvedValue([listPin])
    await expect(exposed.terminal.list()).resolves.toEqual([listPin])
    invoke.mockResolvedValue(actionsSaved)
    await expect(exposed.actions.save([])).resolves.toEqual(actionsSaved)
    invoke.mockResolvedValue(networkSaved)
    await expect(exposed.network.saveRules([])).resolves.toEqual(networkSaved)
    await expect(exposed.network.saveProxy(networkSaved.proxy)).resolves.toEqual(networkSaved)
  })

  /**
   * 末位用例（必须保持最后）：汇总前序 callAndCheck 的路径 → 通道映射，
   * 1) 全 API 面每个 invoke 方法都被契约调用覆盖（漏测即红）
   * 2) COMPOSITIONAL 白名单恰好等于「复用 config 通道」的组合方法，且其中无动词一致项
   */
  it('API ↔ 通道全面对账：契约覆盖零缺口、命名漂移零容忍', () => {
    const surface: string[] = []
    for (const [domain, obj] of Object.entries(exposed)) {
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        if (isEventMethod(key)) continue
        surface.push(`${domain}.${key}`)
      }
    }
    expect([...invokedByPath.keys()].sort(), '存在未被 callAndCheck 覆盖的 API 方法').toEqual(
      [...surface].sort(),
    )
    for (const path of COMPOSITIONAL) {
      const ch = invokedByPath.get(path)
      expect(ch, `COMPOSITIONAL 白名单成员 ${path} 未被契约调用`).toBeTruthy()
      expect([CH.configGet, CH.configSet], `${path} 只应复用 config 通道`).toContain(ch)
      assertVerbAligned(path, ch!)
    }
  })
})
