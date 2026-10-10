/**
 * 自动更新（M7，设计书 §17「预留 electron-updater 接入点」→ 完整接入）。
 *
 * - 更新源：electron-builder `publish`（GitHub Releases）生成的 app-update.yml
 * - `autoDownload = false`：检查到新版本后由用户在「设置 → 关于」确认下载（不偷偷下大文件）
 * - `autoInstallOnAppQuit = true`：已下载的更新在退出时自动安装（不打断当前工作）
 * - 状态经 `update:changed` 事件推送到渲染层，`update:status` 可随时查询
 * - 开发/未打包环境：check 明确报「开发模式不检查更新」，不产生假状态
 */
import type { Logger } from '@wslpilot/kit'
import type { UpdateState } from '@wslpilot/shared'

/** electron-updater 的最小接口（测试注入；与 AppUpdater 对齐） */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(event: string, listener: (...args: never[]) => void): unknown
  getFeedURL?: () => string | null | undefined
}

export interface UpdateServiceDeps {
  logger: Logger
  currentVersion: string
  /** app.isPackaged；开发模式跳过真实检查 */
  isPackaged: boolean
  /** 状态变更回调（广播 update:changed） */
  onChange?: (state: UpdateState) => void
  /** 注入实现（默认懒加载 electron-updater） */
  updater?: UpdaterLike
}

export interface UpdateService {
  getState(): UpdateState
  /** 手动/启动时检查更新 */
  check(): Promise<UpdateState>
  /** 下载可用更新 */
  download(): Promise<UpdateState>
  /** 退出并安装（已下载） */
  install(): void
}

/** 开发模式错误识别（electron-updater 未打包时的行为）；不得过宽——打包后 publish 配置损坏不是开发模式 */
export function isDevModeSkipError(message: string): boolean {
  return /not packed|dev-app-update|开发模式/i.test(message)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  const logger = deps.logger
  let state: UpdateState = {
    status: 'idle',
    currentVersion: deps.currentVersion,
    feedUrl: undefined,
  }

  function emit(next: Partial<UpdateState>): UpdateState {
    state = { ...state, ...next, currentVersion: deps.currentVersion }
    deps.onChange?.(state)
    return state
  }

  let updater: UpdaterLike | null = null
  let wired = false

  /** 设定更新策略并挂事件（只挂一次） */
  function setup(u: UpdaterLike): UpdaterLike {
    u.autoDownload = false
    u.autoInstallOnAppQuit = true
    // 更新源回填（update:status 展示用；开发环境可能无 feed）
    try {
      const feed = u.getFeedURL?.()
      if (feed) emit({ feedUrl: feed })
    } catch {
      /* 拿不到 feed 不影响更新功能 */
    }
    if (!wired) {
      wireEvents(u)
      wired = true
    }
    return u
  }

  function getUpdater(): UpdaterLike | null {
    if (updater) return updater
    if (deps.updater) {
      updater = deps.updater
    } else {
      try {
        // 懒加载：测试与开发环境不强依赖 electron-updater 的运行时行为
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('electron-updater') as { autoUpdater: UpdaterLike }
        updater = mod.autoUpdater
      } catch (e) {
        logger.warn('electron-updater unavailable', { error: errorMessage(e) })
        return null
      }
    }
    if (!updater) return null
    return setup(updater)
  }

  // 注入实现时立即接线：事件（update-available / error …）可在任何方法调用前到达
  if (deps.updater) {
    updater = setup(deps.updater)
  }

  function wireEvents(u: UpdaterLike): void {
    u.on('checking-for-update', () => {
      emit({ status: 'checking', error: undefined })
    })
    u.on('update-available', (info: never) => {
      const i = info as unknown as { version?: string; releaseNotes?: string }
      emit({
        status: 'available',
        version: i?.version,
        releaseNotes: typeof i?.releaseNotes === 'string' ? i.releaseNotes : undefined,
        error: undefined,
      })
    })
    u.on('update-not-available', () => {
      emit({ status: 'not-available', version: undefined, error: undefined })
    })
    u.on('download-progress', (p: never) => {
      const progress = p as unknown as { percent?: number }
      emit({
        status: 'downloading',
        percent: typeof progress?.percent === 'number' ? progress.percent : undefined,
      })
    })
    u.on('update-downloaded', (info: never) => {
      const i = info as unknown as { version?: string }
      emit({ status: 'downloaded', version: i?.version, percent: 100, error: undefined })
    })
    u.on('error', (e: never) => {
      const message = errorMessage(e)
      if (isDevModeSkipError(message)) {
        emit({ status: 'idle', error: '开发模式不检查更新（打包后生效）' })
        return
      }
      logger.warn('updater error', { error: message })
      emit({ status: 'error', error: message })
    })
  }

  async function check(): Promise<UpdateState> {
    const u = getUpdater()
    if (!u) {
      return emit({ status: 'error', error: '更新组件不可用（electron-updater 未安装）' })
    }
    if (!deps.isPackaged) {
      return emit({ status: 'idle', error: '开发模式不检查更新（打包后生效）' })
    }
    emit({ status: 'checking', error: undefined })
    try {
      await u.checkForUpdates()
      // 结果状态由事件驱动（update-available / update-not-available）
      return state
    } catch (e) {
      const message = errorMessage(e)
      if (isDevModeSkipError(message)) {
        return emit({ status: 'idle', error: '开发模式不检查更新（打包后生效）' })
      }
      logger.warn('checkForUpdates failed', { error: message })
      return emit({ status: 'error', error: message })
    }
  }

  async function download(): Promise<UpdateState> {
    const u = getUpdater()
    if (!u) {
      return emit({ status: 'error', error: '更新组件不可用（electron-updater 未安装）' })
    }
    if (state.status !== 'available' && state.status !== 'downloaded') {
      return emit({ status: 'error', error: '当前没有可下载的更新，请先检查更新' })
    }
    if (state.status === 'downloaded') return state
    emit({ status: 'downloading', percent: 0, error: undefined })
    try {
      await u.downloadUpdate()
      return state
    } catch (e) {
      const message = errorMessage(e)
      logger.warn('downloadUpdate failed', { error: message })
      return emit({ status: 'error', error: message })
    }
  }

  function install(): void {
    const u = getUpdater()
    if (!u) {
      emit({ status: 'error', error: '更新组件不可用（electron-updater 未安装）' })
      return
    }
    if (state.status !== 'downloaded') {
      emit({ status: 'error', error: '更新尚未下载完成，无法安装' })
      return
    }
    logger.info('quit and install update', { version: state.version })
    u.quitAndInstall(false, true)
  }

  return {
    getState: () => state,
    check,
    download,
    install,
  }
}
