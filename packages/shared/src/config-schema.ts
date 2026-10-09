import { z } from 'zod'

/** settings.jsonc schema — v2 */
export const generalSettingsSchema = z.object({
  autoRefreshOnStart: z.boolean().default(true),
  pollIntervalMs: z.number().int().min(1000).max(60_000).default(5000),
  locale: z.enum(['system', 'zh-CN', 'en-US']).default('system'),
  theme: z.literal('light').default('light'),
  accent: z.enum(['aurora', 'sunset', 'ocean', 'forest', 'custom']).default('aurora'),
  closeBehavior: z.enum(['minimizeToTray', 'quit']).default('minimizeToTray'),
  launchAtLogin: z.boolean().default(false),
  reduceMotion: z.boolean().default(false),
})

export const wslSettingsSchema = z.object({
  defaultShell: z.string().default(''),
  autoShutdownAfterConfigChange: z.boolean().default(false),
})

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().default('Cascadia Mono, Consolas, monospace'),
  fontSize: z.number().min(8).max(32).default(14),
  lineHeight: z.number().min(1).max(2.5).default(1.2),
  cursorStyle: z.enum(['block', 'underline', 'bar']).default('block'),
  cursorBlink: z.boolean().default(true),
  scrollback: z.number().int().min(100).max(100_000).default(5000),
  copyOnSelect: z.boolean().default(false),
  theme: z.enum(['auto', 'follow-app', 'custom']).default('auto'),
})

export const backupSettingsSchema = z.object({
  defaultDir: z.string().default('%USERPROFILE%\\WSL-Backups'),
  format: z.enum(['tar', 'vhd']).default('tar'),
  keepRecent: z.number().int().min(1).max(50).default(5),
  autoBackupBeforeDestructive: z.boolean().default(true),
})

export const advancedSettingsSchema = z.object({
  showRawCommand: z.boolean().default(false),
  confirmDestructive: z.boolean().default(true),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  hardwareAcceleration: z.boolean().default(true),
})

export const appSettingsSchema = z.object({
  $schemaVersion: z.number().int().default(2),
  general: generalSettingsSchema.default({}),
  wsl: wslSettingsSchema.default({}),
  terminal: terminalSettingsSchema.default({}),
  backup: backupSettingsSchema.default({}),
  advanced: advancedSettingsSchema.default({}),
})

/** distros.jsonc */
export const distroMetaSchema = z.object({
  name: z.string().min(1),
  alias: z.string().default(''),
  tags: z.array(z.string()).default([]),
  color: z.string().default(''),
  icon: z.string().default(''),
  note: z.string().default(''),
  startupCwd: z.string().default('~'),
  pinned: z.boolean().default(false),
  quickActions: z.array(z.string()).default([]),
})

export const distrosFileSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  distros: z.array(distroMetaSchema).default([]),
})

/** actions.jsonc */
export const wslActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  scope: z.enum(['distro', 'global']).default('distro'),
  program: z.string().min(1),
  args: z.array(z.string()).default([]),
  user: z.string().optional(),
  cwd: z.string().optional(),
  terminal: z.boolean().default(false),
  confirm: z.boolean().default(false),
})

export const actionsFileSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  actions: z.array(wslActionSchema).default([]),
})

/** network.jsonc */
export const networkFileSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  portForwarding: z
    .array(
      z.object({
        id: z.string(),
        distro: z.string(),
        listenAddress: z.string().default('0.0.0.0'),
        listenPort: z.number().int().min(1).max(65535),
        connectAddress: z.string().default('127.0.0.1'),
        connectPort: z.number().int().min(1).max(65535),
        enabled: z.boolean().default(true),
        protocol: z.enum(['tcp', 'udp']).default('tcp'),
      }),
    )
    .default([]),
  proxy: z
    .object({
      useWindowsProxy: z.boolean().default(false),
      httpProxy: z.string().default(''),
      httpsProxy: z.string().default(''),
      noProxy: z.string().default('localhost,127.0.0.1'),
    })
    .default({}),
})

/** ui-state.jsonc */
export const uiStateFileSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  window: z
    .object({
      width: z.number().default(1180),
      height: z.number().default(760),
      x: z.number().default(200),
      y: z.number().default(120),
      maximized: z.boolean().default(false),
    })
    .default({}),
  lastSelectedDistro: z.string().default(''),
  sidebarCollapsed: z.boolean().default(false),
  activeView: z.string().default('dashboard'),
  tableSort: z
    .object({ key: z.string().default('name'), dir: z.enum(['asc', 'desc']).default('asc') })
    .default({}),
  recentCommands: z.array(z.string()).default([]),
})

/** state.jsonc */
export const stateFileSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  lastScanAt: z.string().default(''),
  lastMetrics: z
    .record(
      z.object({
        memUsedKB: z.number(),
        memTotalKB: z.number(),
        diskUsedKB: z.number().default(0),
        diskTotalKB: z.number().default(0),
        cpuPercent: z.number(),
        sampledAt: z.string(),
      }),
    )
    .default({}),
  lastTaskResult: z
    .object({
      // 与 types.ts 联合类型对齐（review M8）：zod 是唯一运行时校验器
      type: z.enum(['install', 'export', 'import', 'move', 'convert', 'action']),
      distro: z.string(),
      status: z.enum(['running', 'success', 'failed', 'canceled']),
      finishedAt: z.string(),
    })
    .optional(),
})

export const CONFIG_SCHEMAS = {
  settings: appSettingsSchema,
  distros: distrosFileSchema,
  actions: actionsFileSchema,
  network: networkFileSchema,
  uiState: uiStateFileSchema,
  state: stateFileSchema,
} as const

/**
 * 各配置文件当前 schema 版本 — 唯一事实源（review M8）。
 * constants / config-service 的目标版本一律引用此处，禁止另抄一份。
 */
export const SCHEMA_VERSIONS = {
  settings: 2,
  distros: 1,
  actions: 1,
  network: 1,
  uiState: 1,
  state: 1,
} as const satisfies Record<keyof typeof CONFIG_SCHEMAS, number>

export type ConfigKeyOf = keyof typeof CONFIG_SCHEMAS

/** 各配置文件的默认值（首次启动写入） */
export function defaultConfig<K extends ConfigKeyOf>(key: K): z.infer<(typeof CONFIG_SCHEMAS)[K]> {
  return CONFIG_SCHEMAS[key].parse({}) as z.infer<(typeof CONFIG_SCHEMAS)[K]>
}
