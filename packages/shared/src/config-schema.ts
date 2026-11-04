import { z } from 'zod'
import { assertSafeRuleId, MAX_PORT_FORWARD_RULES } from './network'
import { assertSafeDistroName } from './errors'
import { assertSafeActionId } from './actions'
import {
  assertContainerName,
  assertEnvKey,
  assertEnvValue,
  assertHostMountPath,
  assertImageRef,
  assertLinuxContainerPath,
  assertPortAddress,
} from './containers'
import { DEFAULT_BACKUP_KEEP, DEFAULT_POLL_INTERVAL_MS } from './constants'

/** settings.jsonc schema — v2 */
export const generalSettingsSchema = z.object({
  autoRefreshOnStart: z.boolean().default(true),
  pollIntervalMs: z.number().int().min(1000).max(60_000).default(DEFAULT_POLL_INTERVAL_MS),
  locale: z.enum(['system', 'zh-CN', 'en-US']).default('system'),
  // 浅色是唯一主题（不提供深色）；该策略不做成可写配置（幽灵字段根治）
  accent: z.enum(['aurora', 'sunset', 'ocean', 'forest']).default('aurora'),
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
  lineHeight: z.number().min(1).max(2.5).default(1.25),
  letterSpacing: z.number().min(-2).max(4).default(0),
  cursorStyle: z.enum(['block', 'underline', 'bar']).default('bar'),
  cursorBlink: z.boolean().default(true),
  cursorInactiveStyle: z.enum(['outline', 'block', 'bar', 'underline', 'none']).default('outline'),
  scrollback: z.number().int().min(100).max(100_000).default(10000),
  copyOnSelect: z.boolean().default(false),
  rightClickBehavior: z.enum(['contextMenu', 'paste', 'selectWord']).default('contextMenu'),
  pasteWarning: z.enum(['always', 'multiline', 'never']).default('multiline'),
  theme: z.enum(['light', 'dark', 'follow-app', 'high-contrast']).default('light'),
  bell: z.enum(['none', 'visual', 'sound']).default('none'),
  webgl: z.enum(['auto', 'on', 'off']).default('auto'),
  smoothScroll: z.boolean().default(true),
  minimumContrastRatio: z.number().min(1).max(21).default(4.5),
  shellIntegration: z.enum(['off', 'prompt', 'on']).default('off'),
  confirmCloseWithRunningProcess: z.boolean().default(true),
  defaultProfileId: z.string().default(''),
  profiles: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        label: z.string().min(1).max(100),
        launch: z.discriminatedUnion('kind', [
          z.object({
            kind: z.literal('distro'),
            distro: z.string().min(1).max(200),
            shell: z.string().max(200).optional(),
            cwd: z.string().max(500).optional(),
            user: z.string().max(100).optional(),
            env: z.record(z.string().max(100), z.string().max(8192)).optional(),
          }),
          z.object({
            kind: z.literal('container'),
            containerId: z.string().min(1).max(200),
            shell: z.string().max(200).optional(),
            user: z.string().max(100).optional(),
            env: z.record(z.string().max(100), z.string().max(8192)).optional(),
          }),
          z.object({
            kind: z.literal('command'),
            distro: z.string().min(1).max(200),
            program: z.string().min(1).max(500),
            args: z.array(z.string().max(8192)).max(200).default([]),
            user: z.string().max(100).optional(),
            cwd: z.string().max(500).optional(),
          }),
        ]),
        theme: z.enum(['light', 'dark', 'follow-app', 'high-contrast']).optional(),
        shellIntegration: z.boolean().optional(),
      }),
    )
    .max(50)
    .default([])
    .superRefine((profiles, ctx) => {
      const seen = new Set<string>()
      profiles.forEach((profile, index) => {
        if (seen.has(profile.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'id'],
            message: `终端 Profile id 重复：${profile.id}`,
          })
        }
        seen.add(profile.id)
        if (profile.launch.kind !== 'container') {
          try {
            assertSafeDistroName(profile.launch.distro)
          } catch (e) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, 'launch', 'distro'],
              message: e instanceof Error ? e.message : '发行版名非法',
            })
          }
        }
        if ('env' in profile.launch && profile.launch.env) {
          for (const key of Object.keys(profile.launch.env)) {
            try {
              assertEnvKey(key)
            } catch (e) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index, 'launch', 'env', key],
                message: e instanceof Error ? e.message : '环境变量名非法',
              })
            }
          }
        }
      })
    }),
})

export const workbenchSettingsSchema = z.object({
  defaultRoute: z.enum(['dashboard', 'terminal', 'last']).default('dashboard'),
  autoCollapseSidebar: z.boolean().default(true),
  tabPosition: z.enum(['top', 'left']).default('top'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  showStatusLine: z.boolean().default(true),
  showPaneHeaders: z.enum(['auto', 'always', 'never']).default('auto'),
  sessionRailWidth: z.number().int().min(180).max(360).default(240),
  confirmClosePane: z.boolean().default(true),
})

export const containerSettingsSchema = z.object({
  pollIntervalMs: z.number().int().min(1000).max(60_000).default(3000),
  statsIntervalMs: z.number().int().min(500).max(60_000).default(1000),
  confirmPrune: z.boolean().default(true),
  confirmRemoveRunning: z.boolean().default(true),
  defaultStopTimeoutSec: z.number().int().min(1).max(300).default(10),
  maskEnvValues: z.boolean().default(true),
  lastImage: z.string().default('ubuntu:latest'),
})

export const backupSettingsSchema = z.object({
  defaultDir: z.string().default('%USERPROFILE%\\WSL-Backups'),
  format: z.enum(['tar', 'tar.gz', 'vhd']).default('tar'),
  keepRecent: z.number().int().min(1).max(50).default(DEFAULT_BACKUP_KEEP),
  autoBackupBeforeDestructive: z.boolean().default(true),
})

export const advancedSettingsSchema = z.object({
  showRawCommand: z.boolean().default(false),
  confirmDestructive: z.boolean().default(true),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  hardwareAcceleration: z.boolean().default(true),
  // M7 自动更新：启动时后台检查新版本（electron-updater，见 updater/auto-update.ts）
  autoUpdate: z.boolean().default(true),
})

export const appSettingsSchema = z.object({
  $schemaVersion: z.number().int().default(3),
  general: generalSettingsSchema.prefault({}),
  workbench: workbenchSettingsSchema.prefault({}),
  terminal: terminalSettingsSchema.prefault({}),
  containers: containerSettingsSchema.prefault({}),
  wsl: wslSettingsSchema.prefault({}),
  backup: backupSettingsSchema.prefault({}),
  advanced: advancedSettingsSchema.prefault({}),
})

/** distros.jsonc */
export const distroMetaSchema = z.object({
  // name 是稳定键：接入执行侧同名断言（此前仅 min(1)，含控制字符/非法形态的名字可入库 —
  // 之后所有按名调用 wsl.exe 的入口都会带着脏名字 — review 0.1.2 根治）
  name: z
    .string()
    .trim()
    .min(1)
    .superRefine((s, ctx) => {
      try {
        assertSafeDistroName(s)
      } catch (e) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: e instanceof Error ? e.message : '发行版名非法',
        })
      }
    }),
  alias: z.string().default(''),
  tags: z.array(z.string().max(64)).max(20).default([]),
  color: z.string().default(''),
  icon: z.string().default(''),
  note: z.string().default(''),
  startupCwd: z.string().default('~'),
  pinned: z.boolean().default(false),
  // 0.2.0 终端 profile / 隐藏内部发行版 / 覆盖全局 Shell
  terminalProfileId: z.string().max(100).default(''),
  hidden: z.boolean().default(false),
  defaultShell: z.string().max(200).default(''),
  quickActions: z
    .array(
      z
        .string()
        .trim()
        // 与 wslActionSchema.id 同一个 100 上限；否则 65–100 字符的动作可创建/运行却无法置顶
        .max(100)
        .superRefine((s, ctx) => {
          try {
            assertSafeActionId(s)
          } catch (e) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: e instanceof Error ? e.message : '动作 id 非法',
            })
          }
        }),
    )
    .max(20)
    .default([]),
})

export const distrosFileSchema = z.object({
  $schemaVersion: z.number().int().default(3),
  distros: z.array(distroMetaSchema).default([]),
})

/** actions.jsonc */
export const wslActionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .superRefine((s, ctx) => {
      try {
        assertSafeActionId(s)
      } catch (e) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: e instanceof Error ? e.message : '动作 id 非法',
        })
      }
    }),
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
  $schemaVersion: z.number().int().default(2),
  portForwarding: z
    .array(
      z.object({
        // 规则是 netsh 应用的执行白名单键：id 必须可安全引用（与 IPC/执行边界同一规则）
        id: z
          .string()
          .min(1)
          .max(100)
          .superRefine((s, ctx) => {
            try {
              assertSafeRuleId(s)
            } catch (e) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: e instanceof Error ? e.message : '规则 id 非法',
              })
            }
          }),
        distro: z.string().min(1),
        listenAddress: z.string().default('0.0.0.0'),
        listenPort: z.number().int().min(1).max(65535),
        connectAddress: z.string().default('127.0.0.1'),
        connectPort: z.number().int().min(1).max(65535),
        enabled: z.boolean().default(true),
        protocol: z.enum(['tcp', 'udp']).default('tcp'),
      }),
    )
    .max(MAX_PORT_FORWARD_RULES)
    // id 唯一性：重复 id 会让执行白名单键语义歧义（findRule 只认第一条，第二条永远不可达）
    .superRefine((rules, ctx) => {
      const seen = new Set<string>()
      rules.forEach((r, idx) => {
        if (seen.has(r.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `转发规则 id 重复：${r.id}`,
            path: [idx, 'id'],
          })
        }
        seen.add(r.id)
      })
    })
    .default([]),
  proxy: z
    .object({
      useWindowsProxy: z.boolean().default(false),
      httpProxy: z.string().default(''),
      httpsProxy: z.string().default(''),
      noProxy: z.string().default('localhost,127.0.0.1'),
    })
    .prefault({}),
})

/**
 * 终端分屏布局树（0.1.3）：递归结构，叶子持有 pty 会话 id。
 * 与 `types.ts` 的 TerminalLayoutNode 对齐；解析失败由 sanitize 路径逐字段清理。
 */
const paneLayoutSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('leaf'), ptyId: z.string().min(1).max(200) }),
    z.object({
      kind: z.literal('split'),
      dir: z.enum(['row', 'col']),
      ratio: z.number().min(0).max(1),
      a: paneLayoutSchema,
      b: paneLayoutSchema,
    }),
  ]),
)

/** ui-state.jsonc（lastSelectedDistro/activeView/tableSort 为幽灵字段已根治：全仓无读写，旧文件中出现会被剥离） */
export const uiStateFileSchema = z.object({
  $schemaVersion: z.number().int().default(2),
  window: z
    .object({
      width: z.number().default(1440),
      height: z.number().default(900),
      x: z.number().default(120),
      y: z.number().default(80),
      maximized: z.boolean().default(false),
    })
    .prefault({}),
  sidebarCollapsed: z.boolean().default(false),
  recentCommands: z.array(z.string()).default([]),
  /** 0.2.0 工作台布局（新模型；旧 terminalLayout 仅迁移期读取） */
  workbench: z
    .object({
      activeTabId: z.string().max(200).default(''),
      sessionRailOpen: z.boolean().default(false),
      tabs: z
        .array(
          z.object({
            id: z.string().max(200).default(''),
            title: z.string().max(200).default(''),
            profileId: z.string().max(100).default(''),
            layout: paneLayoutSchema,
          }),
        )
        .default([]),
    })
    .prefault({}),
  /** @deprecated 0.1.x 终端分屏布局；仅迁移读取，不再写入 */
  terminalLayout: z
    .array(
      z.object({
        id: z.string().max(200).default(''),
        title: z.string().max(200).default(''),
        layout: paneLayoutSchema,
      }),
    )
    .default([]),
})

/** state.jsonc（机器缓存：仅最近任务结果；lastScanAt/lastMetrics 无消费方幽灵字段已移除 — 0.1.3 根治） */
export const stateFileSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  lastTaskResult: z
    .object({
      // 与 types.ts 联合类型对齐（review M8）：zod 是唯一运行时校验器
      type: z.enum([
        'install',
        'export',
        'import',
        'move',
        'convert',
        'action',
        'network',
        'device',
        'update',
        'manage',
        'clone',
        'unregister',
        'container-run',
        'container-start',
        'container-stop',
        'container-restart',
        'container-remove',
        'container-prune',
        'container-logs',
        'container-copy',
        'image-pull',
        'image-build',
        'image-remove',
        'image-prune',
        'network-create',
        'network-remove',
        'volume-create',
        'volume-remove',
        'wslc-session',
      ]),
      distro: z.string(),
      status: z.enum(['running', 'success', 'failed', 'canceled']),
      finishedAt: z.string(),
    })
    .optional(),
})

/** containers.jsonc — 容器运行配方（不保存实时状态） */
export const containerPortSchema = z.object({
  host: z.number().int().min(1).max(65535),
  container: z.number().int().min(1).max(65535),
  address: z
    .string()
    .max(255)
    .superRefine((s, ctx) => {
      try {
        assertPortAddress(s)
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: String(e) })
      }
    })
    .optional(),
})

export const containerMountSchema = z
  .object({
    host: z.string().min(1).max(1024),
    container: z.string().min(1).max(1024),
    readOnly: z.boolean().default(false),
  })
  .superRefine((m, ctx) => {
    try {
      assertHostMountPath(m.host)
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['host'],
        message: e instanceof Error ? e.message : '主机路径非法',
      })
    }
    try {
      assertLinuxContainerPath(m.container)
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['container'],
        message: e instanceof Error ? e.message : '容器路径非法',
      })
    }
  })

export const containerHealthSchema = z.object({
  cmd: z.string().max(1024).default(''),
  interval: z.string().max(32).optional(),
  timeout: z.string().max(32).optional(),
  retries: z.number().int().min(0).max(100).default(0),
  startPeriod: z.string().max(32).optional(),
})

export const containerRecipeSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  image: z
    .string()
    .min(1)
    .max(255)
    .superRefine((s, ctx) => {
      try {
        assertImageRef(s)
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: String(e) })
      }
    }),
  name: z
    .string()
    .max(63)
    .superRefine((s, ctx) => {
      try {
        assertContainerName(s)
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: String(e) })
      }
    })
    .optional(),
  command: z.array(z.string().max(8192)).max(200).default([]),
  ports: z.array(containerPortSchema).max(50).default([]),
  mounts: z.array(containerMountSchema).max(50).default([]),
  env: z
    .record(
      z
        .string()
        .min(1)
        .max(100)
        .superRefine((key, ctx) => {
          try {
            assertEnvKey(key)
          } catch (e) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: e instanceof Error ? e.message : '环境变量名非法',
            })
          }
        }),
      z
        .string()
        .max(8192)
        .superRefine((value, ctx) => {
          try {
            assertEnvValue(value)
          } catch (e) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: String(e) })
          }
        }),
    )
    .default({}),
  network: z
    .string()
    .max(63)
    .superRefine((s, ctx) => {
      try {
        assertContainerName(s)
      } catch (e) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: String(e) })
      }
    })
    .optional(),
  detach: z.boolean().default(true),
  rm: z.boolean().default(false),
  stopTimeoutSec: z.number().int().min(1).max(300).optional(),
  health: containerHealthSchema.optional(),
})

export const containersFileSchema = z.object({
  $schemaVersion: z.number().int().default(1),
  recipes: z.array(containerRecipeSchema).max(100).default([]),
  recentImages: z.array(z.string().max(255)).max(30).default([]),
})

export const CONFIG_SCHEMAS = {
  settings: appSettingsSchema,
  distros: distrosFileSchema,
  actions: actionsFileSchema,
  network: networkFileSchema,
  containers: containersFileSchema,
  uiState: uiStateFileSchema,
  state: stateFileSchema,
} as const

/**
 * 各配置文件当前 schema 版本 — 唯一事实源（review M8）。
 * constants / config-service 的目标版本一律引用此处，禁止另抄一份。
 */
export const SCHEMA_VERSIONS = {
  settings: 3,
  distros: 3,
  actions: 1,
  network: 2,
  containers: 1,
  uiState: 2,
  state: 1,
} as const satisfies Record<keyof typeof CONFIG_SCHEMAS, number>

export type ConfigKeyOf = keyof typeof CONFIG_SCHEMAS

/** 各配置文件的默认值（首次启动写入） */
export function defaultConfig<K extends ConfigKeyOf>(key: K): z.infer<(typeof CONFIG_SCHEMAS)[K]> {
  return CONFIG_SCHEMAS[key].parse({}) as z.infer<(typeof CONFIG_SCHEMAS)[K]>
}
