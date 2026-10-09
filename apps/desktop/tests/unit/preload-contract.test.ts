import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * preload 契约测试（review C4 根治）：
 * mock ipcRenderer，逐个调用 window.wslAPI 方法，断言
 * 1) invoke 的通道名正确
 * 2) 参数形状能通过 IPC_SCHEMAS 校验（与 ipc-schema 零漂移）
 * 3) 事件订阅/退订闭环
 */
const invoke = vi.fn(async (..._args: unknown[]) => undefined)
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

beforeEach(() => {
  vi.clearAllMocks()
})

/** 调用一个 preload 方法并校验其 invoke 契约 */
function callAndCheck(
  path: string,
  fn: () => Promise<unknown>,
  expectedChannel: string,
  ...expectedArgs: unknown[]
): void {
  void fn()
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

  it('事件订阅可退订（config/pty/task/navigate）', () => {
    for (const [name, subscribe] of [
      ['config.onChanged', () => exposed.config.onChanged(() => {})],
      ['config.onConflict', () => exposed.config.onConflict(() => {})],
      ['terminal.onData', () => exposed.terminal.onData(() => {})],
      ['terminal.onExit', () => exposed.terminal.onExit(() => {})],
      ['task.onProgress', () => exposed.task.onProgress(() => {})],
      ['app.onNavigate', () => exposed.app.onNavigate(() => {})],
    ] as const) {
      const off = subscribe()
      expect(on, `${name} 应注册监听`).toHaveBeenCalled()
      expect(typeof off, `${name} 应返回退订函数`).toBe('function')
      off()
      expect(removeListener, `${name} 退订应摘除监听`).toHaveBeenCalled()
    }
  })
})
