import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, unknown>) => {
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
  if (expectedArgs.length === 1) {
    // 参数形状必须通过 ipc-schema 校验（契约与校验零漂移）
    expect(() => parseIpcArgs(expectedChannel, expectedArgs)).not.toThrow()
  }
}

describe('preload 契约', () => {
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
        'uninstall',
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
      'distros.uninstall',
      () => exposed.distros.uninstall('U'),
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
    callAndCheck(
      'metrics.sampleOverview',
      () => exposed.metrics.sampleOverview(),
      CH.metricsSample,
      '*',
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
      'fs.reveal',
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
      CH.appOpenLogsDir,
    )
    callAndCheck(
      'diagnostics.exportPackage',
      () => exposed.diagnostics.exportPackage(),
      CH.appExportDiagnostics,
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
})
