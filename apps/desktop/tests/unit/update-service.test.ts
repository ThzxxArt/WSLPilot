import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createUpdateService,
  isDevModeSkipError,
  type UpdaterLike,
} from '../../src/main/updater/auto-update'
import type { UpdateState } from '@wslpilot/shared'

const logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  setLevel: vi.fn(),
}

/** 可手动派发事件的假 updater */
function makeUpdater(): UpdaterLike & {
  emit(event: string, ...args: unknown[]): void
  checkForUpdates: ReturnType<typeof vi.fn>
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
} {
  const listeners = new Map<string, Array<(...args: never[]) => void>>()
  return {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    getFeedURL: () => 'https://github.com/ThzxxArt/WSLPilot',
    on(event: string, listener: (...args: never[]) => void) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return this
    },
    emit(event: string, ...args: unknown[]) {
      for (const l of listeners.get(event) ?? []) l(...(args as never[]))
    },
  }
}

describe('自动更新服务（M7 §17）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('打包环境：check → available / not-available 由事件驱动', async () => {
    const updater = makeUpdater()
    const changes: UpdateState[] = []
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
      onChange: (s) => changes.push({ ...s }),
    })

    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('checking-for-update')
      updater.emit('update-available', { version: '1.1.0', releaseNotes: 'fix' })
      return null
    })
    const state = await svc.check()
    expect(state.status).toBe('available')
    expect(state.version).toBe('1.1.0')
    expect(state.currentVersion).toBe('0.1.0')
    expect(changes.at(-1)!.status).toBe('available')

    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-not-available')
      return null
    })
    await svc.check()
    expect(svc.getState().status).toBe('not-available')
  })

  it('开发模式：check 返回明确提示，不产生假状态', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: false,
      updater,
    })
    const state = await svc.check()
    expect(state.status).toBe('idle')
    expect(state.error).toContain('开发模式')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(isDevModeSkipError('Skip checkForUpdates because application is not packed')).toBe(true)
  })

  it('check 异常：仅「未打包/开发」归为 idle；其余如实 error（不过宽误判）', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
    })
    updater.checkForUpdates.mockRejectedValueOnce(
      new Error('Skip checkForUpdates because application is not packed'),
    )
    expect((await svc.check()).status).toBe('idle')

    // 回归：这些不是开发模式（此前 app-update.yml/cannot check updates 被误判为开发，
    // 打包环境 publish 配置损坏时给出误导状态）
    expect(isDevModeSkipError('Cannot find app-update.yml')).toBe(false)
    expect(isDevModeSkipError('Cannot check updates: ENOTFOUND')).toBe(false)
    updater.checkForUpdates.mockRejectedValueOnce(new Error('Cannot find app-update.yml'))
    expect((await svc.check()).status).toBe('error')

    updater.checkForUpdates.mockRejectedValueOnce(new Error('network down'))
    const state = await svc.check()
    expect(state.status).toBe('error')
    expect(state.error).toBe('network down')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('download：仅在 available 后可下载；进度与完成由事件驱动', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
    })

    // 未检查更新就下载 → 明确错误
    expect((await svc.download()).status).toBe('error')
    expect(updater.downloadUpdate).not.toHaveBeenCalled()

    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2.0.0' })
      return null
    })
    await svc.check()

    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('download-progress', { percent: 42 })
      updater.emit('update-downloaded', { version: '2.0.0' })
      return []
    })
    const state = await svc.download()
    expect(state.status).toBe('downloaded')
    expect(state.percent).toBe(100)
    expect(updater.downloadUpdate).toHaveBeenCalled()
    // autoDownload 关闭：检查到新版本不偷偷下载（由用户决定）
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('download 失败 → error 状态', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
    })
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2.0.0' })
      return null
    })
    await svc.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('disk full'))
    const state = await svc.download()
    expect(state.status).toBe('error')
    expect(state.error).toBe('disk full')
  })

  it('install：仅 downloaded 后可安装；触发 quitAndInstall', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
    })

    svc.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(svc.getState().error).toContain('尚未下载')

    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2.0.0' })
      return null
    })
    await svc.check()
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('update-downloaded', { version: '2.0.0' })
      return []
    })
    await svc.download()
    svc.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
    expect(logger.info).toHaveBeenCalled()
  })

  it('download 已是 downloaded 状态直接返回（不重复下载）', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
    })
    updater.checkForUpdates.mockImplementation(async () => {
      updater.emit('update-available', { version: '2.0.0' })
      return null
    })
    await svc.check()
    updater.downloadUpdate.mockImplementation(async () => {
      updater.emit('update-downloaded', { version: '2.0.0' })
      return []
    })
    await svc.download()
    const second = await svc.download()
    expect(second.status).toBe('downloaded')
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('初始状态可查询（update:status 用）；feedUrl 从 getFeedURL 回填（非幽灵字段）', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
    })
    expect(svc.getState()).toEqual({
      status: 'idle',
      currentVersion: '0.1.0',
      version: undefined,
      releaseNotes: undefined,
      percent: undefined,
      error: undefined,
      feedUrl: 'https://github.com/ThzxxArt/WSLPilot',
    })
  })

  it('updater 事件：error 事件进入 error 状态', async () => {
    const updater = makeUpdater()
    const svc = createUpdateService({
      logger,
      currentVersion: '0.1.0',
      isPackaged: true,
      updater,
    })
    updater.emit('error', new Error('boom'))
    expect(svc.getState().status).toBe('error')
    expect(svc.getState().error).toBe('boom')

    updater.emit('error', new Error('Skip checkForUpdates because application is not packed'))
    expect(svc.getState().status).toBe('idle')
    expect(svc.getState().error).toContain('开发模式')
  })
})
