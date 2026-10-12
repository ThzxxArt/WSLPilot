/**
 * 组件测试共享支撑（非 *.test.ts，不被 vitest 收集）：
 * wslAPI 全量 mock 工厂、DistroView 夹具、teleport 后的 body 查询助手。
 * 各 *.test.ts 仍自行声明 naive-ui / vue-router mock（vi.mock 工厂需与使用方同文件）。
 */
import { vi } from 'vitest'
import { defaultConfig, type ConfigKey, type DistroView, type WslAction } from '@wslpilot/shared'

export function appError(msg: string) {
  return { code: 'TASK_FAILED', message: msg, recoverable: true }
}

/**
 * config.get 的契约形状实现（唯一事实源：defaultConfig 按 key 返回完整 ConfigMap）。
 * 用途：① createWslAPI 的默认实现；② 各用例 beforeEach 显式复位 ——
 * `vi.clearAllMocks()` 不恢复实现，用例内自定义实现会泄漏到后续用例；
 * 复位为真实契约形状也保证「settings.load 成功路径」在组件层真实可走（review mock 撒谎根治）。
 */
export function configGetImpl() {
  return async (fileKey?: ConfigKey) => {
    if (!fileKey) return {}
    try {
      return defaultConfig(fileKey)
    } catch {
      return {}
    }
  }
}

/** window.wslAPI 全量 mock：默认全部成功 / 空数据，用例内按需覆写 */
export function createWslAPI() {
  return {
    app: {
      getVersion: vi.fn(async () => '0.1.0'),
      getWslVersion: vi.fn(async () => ({
        wslVersion: '2.3.4',
        kernelVersion: '5.15.153',
        raw: '',
      })),
      signatureStatus: vi.fn(async () => ({ checked: true, signed: true, detail: '' })),
      openPath: vi.fn(async () => {}),
      openConfigDir: vi.fn(async () => {}),
      pickDirectory: vi.fn(async (): Promise<string | null> => null),
      pickSaveFile: vi.fn(async (): Promise<string | null> => null),
      pickOpenFile: vi.fn(async (): Promise<string | null> => null),
      onNavigate: vi.fn((_cb: (path: string) => void) => vi.fn()),
      minimize: vi.fn(async () => {}),
      maximize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    },
    config: {
      /** 与真实 preload 契约同形状：按 key 返回完整 ConfigMap（默认值唯一事实源 defaultConfig），
       *  不再返回 `{}` —— 否则 App/DefaultLayout 的 settings.load 会在类型错误中静默失败，
       *  「load 成功路径」从未被任何组件用例真实覆盖（review mock 撒谎根治） */
      get: vi.fn(configGetImpl()),
      set: vi.fn(async () => ({})),
      openExternal: vi.fn(async () => {}),
      onChanged: vi.fn((_cb: (p: { fileKey: string }) => void) => vi.fn()),
      onConflict: vi.fn((_cb: (p: { fileKey: string; detail: string }) => void) => vi.fn()),
      resolveConflict: vi.fn(async () => ({})),
    },
    distros: {
      list: vi.fn(async (): Promise<DistroView[]> => []),
      listOnline: vi.fn(async (): Promise<string[]> => []),
      start: vi.fn(async () => {}),
      terminate: vi.fn(async () => {}),
      shutdown: vi.fn(async () => {}),
      setDefault: vi.fn(async () => {}),
      unregister: vi.fn(async () => {}),
      registryDetail: vi.fn(async (): Promise<Record<string, unknown>> => ({ values: {} })),
      install: vi.fn(async () => ({ taskId: 'ins' })),
      setVersion: vi.fn(async () => ({ taskId: 'cv' })),
    },
    metrics: {
      sample: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
      sampleOverview: vi.fn(async () => ({
        runningCount: 0,
        totalCount: 0,
        memUsedKB: 0,
        memTotalKB: 0,
        diskUsedKB: 0,
        diskTotalKB: 0,
        cpuPercent: 0,
        sampledAt: 't',
        perDistro: {},
      })),
    },
    io: {
      export: vi.fn(async () => ({ taskId: 'e' })),
      import: vi.fn(async () => ({ taskId: 'i' })),
      move: vi.fn(async () => ({ taskId: 'm' })),
      listBackups: vi.fn(async () => []),
      cleanupBackups: vi.fn(async () => ({ removed: 0 })),
    },
    task: {
      cancel: vi.fn(async () => true),
      onProgress: vi.fn((_cb: (p: Record<string, unknown>) => void) => vi.fn()),
    },
    actions: {
      list: vi.fn(async (): Promise<WslAction[]> => []),
      save: vi.fn(async () => ({})),
      run: vi.fn(async () => ({ taskId: 'a' })),
    },
    terminal: {
      create: vi.fn(async () => ({ ptyId: 'p1', distro: 'Ubuntu', createdAt: Date.now() })),
      input: vi.fn(async () => {}),
      resize: vi.fn(async () => {}),
      kill: vi.fn(async () => {}),
      list: vi.fn(
        async (): Promise<Array<{ ptyId: string; distro: string; createdAt: number }>> => [],
      ),
      maxSessions: vi.fn(async () => 10),
      host: vi.fn(async (): Promise<{ platform: string; conptyBuild: number | null }> => ({
        platform: 'win32',
        conptyBuild: 22621,
      })),
      onData: vi.fn((_cb: (p: { ptyId: string; chunk: string }) => void) => vi.fn()),
      onExit: vi.fn((_cb: (p: { ptyId: string; code: number }) => void) => vi.fn()),
    },
    wslconf: {
      read: vi.fn(async () => '[automount]\nenabled = true\n'),
      write: vi.fn(async () => ({ terminated: false })),
    },
    /** 网络（真实 preload 契约有该命名空间；此前缺失导致 NetworkView 用例全在错误态下跑） */
    network: {
      status: vi.fn(async () => ({
        wslconfigPath: 'C:\\Users\\me\\.wslconfig',
        wslconfigExists: false,
        mode: 'unknown',
        modeRaw: '',
        mirrorRecommended: true,
        portProxy: [],
        windowsProxy: null,
      })),
      apply: vi.fn(async () => ({ taskId: 'n-apply' })),
      applyAll: vi.fn(async () => ({ taskId: 'n-apply-all' })),
      remove: vi.fn(async () => ({ taskId: 'n-remove' })),
      proxyApply: vi.fn(async (distro: string) => ({ distro })),
      proxyClear: vi.fn(async (distro: string) => ({ distro })),
      proxyState: vi.fn(async () => ({
        path: '/etc/profile.d/wslpilot-proxy.sh',
        exists: false,
        content: '',
      })),
      listRules: vi.fn(async () => []),
      saveRules: vi.fn(async () => ({})),
      getProxy: vi.fn(async () => ({
        useWindowsProxy: false,
        httpProxy: '',
        httpsProxy: '',
        noProxy: 'localhost,127.0.0.1',
      })),
      saveProxy: vi.fn(async () => ({})),
    },
    /** USB 设备（真实 preload 契约有该命名空间） */
    devices: {
      status: vi.fn(async () => ({ installed: false, version: '' })),
      list: vi.fn(async () => []),
      bind: vi.fn(async () => ({ taskId: 'd-bind' })),
      unbind: vi.fn(async () => ({ taskId: 'd-unbind' })),
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
    },
    fs: {
      readDir: vi.fn(async () => []),
      read: vi.fn(async () => ({ text: '', sizeBytes: 0, truncated: false, binary: false })),
      write: vi.fn(async () => {}),
      revealInExplorer: vi.fn(async () => {}),
    },
    update: {
      status: vi.fn(
        async () => ({ status: 'idle', currentVersion: '0.1.0' }) as Record<string, unknown>,
      ),
      check: vi.fn(
        async (): Promise<Record<string, unknown>> =>
          ({ status: 'not-available', currentVersion: '0.1.0' }) as Record<string, unknown>,
      ),
      download: vi.fn(
        async (): Promise<Record<string, unknown>> =>
          ({ status: 'idle', currentVersion: '0.1.0' }) as Record<string, unknown>,
      ),
      install: vi.fn(async () => {}),
      onChanged: vi.fn((_cb: (s: Record<string, unknown>) => void) => vi.fn()),
    },
    diagnostics: {
      openLogsDir: vi.fn(async () => {}),
      exportPackage: vi.fn(async (): Promise<{ path: string; entries: string[] } | null> => null),
    },
    meta: {
      get: vi.fn(async (): Promise<Record<string, unknown> | null> => null),
      set: vi.fn(async () => ({})),
    },
  }
}

export type WslAPIMock = ReturnType<typeof createWslAPI>

export function distro(over: Partial<DistroView> = {}): DistroView {
  return {
    name: 'Ubuntu',
    state: 'Stopped',
    version: 2,
    isDefault: false,
    meta: {
      name: 'Ubuntu',
      alias: '',
      tags: [],
      color: '',
      icon: 'linux',
      note: '',
      startupCwd: '~',
      pinned: false,
      quickActions: [],
    },
    ...over,
  }
}

export const ACTION_FIXTURE: WslAction = {
  id: 'a1',
  label: '清缓存',
  scope: 'distro',
  program: '/bin/rm',
  args: ['-rf', '/tmp/x'],
  terminal: false,
  confirm: true,
}

export interface BtnLike {
  text(): string
  element: { hasAttribute(name: string): boolean; click(): void }
}

export function findButton(
  root: { findAll(sel: string): BtnLike[] },
  label: string,
): BtnLike | null {
  return root.findAll('button').find((b) => b.text().includes(label)) ?? null
}

/** n-modal / n-drawer 内容 teleport 到 body：一律查 document.body */
export function bodyText(): string {
  return document.body.textContent ?? ''
}

export function findBodyButton(label: string): HTMLButtonElement | null {
  return (
    (Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(label),
    ) as HTMLButtonElement | undefined) ?? null
  )
}

/** 模拟键盘事件（命令面板 / 全局快捷键） */
export function keydown(
  el: Element | Document | Window,
  key: string,
  init: KeyboardEventInit = {},
) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}
