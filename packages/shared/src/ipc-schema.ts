import { z } from 'zod'
import { CH, type ChannelName } from './channels'
import { assertSafeDistroName } from './errors'
import { assertSafeActionId } from './actions'
import { assertSafeRuleId } from './network'
import { assertSafeBusId } from './usbipd'
import {
  DEFAULT_BACKUP_KEEP,
  CONFIG_FILE_NAMES,
  FS_WRITE_LIMIT_BYTES,
  WSL_CONF_MAX_BYTES,
} from './constants'

/**
 * 各 IPC 通道入参 zod schema（设计书 §8.2）。
 * router 在调用 handler 前统一 parse，失败抛结构化 AppError。
 */
/**
 * 发行版名校验（与执行边界 assertSafeDistroName 同一规则 — review M3）。
 * IPC 边界与执行边界必须一致，否则元数据成为"孤儿"。
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .superRefine((s, ctx) => {
    try {
      assertSafeDistroName(s)
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : '非法的发行版名称',
      })
    }
  })

/** 会话/任务 id：非空 + 长度上限 */
export const idSchema = z.string().min(1).max(200)

/**
 * metrics:sample 单发行版名：在 nameSchema 基础上拒绝全局保留键 `*`。
 * 全局概览语义已拆到独立通道 `metrics:overview`，此处不再放行 `*`，
 * 否则单通道又会退回「双返回形状」（Metrics | OverviewMetrics）的歧义契约。
 */
export const metricsNameSchema = nameSchema.refine((s) => s !== '*', {
  message: 'metrics:sample 只接受发行版名，全局概览请走 metrics:overview',
})

/** 端口转发规则 id（network.jsonc 执行白名单的键）— IPC 边界与执行边界同一校验 */
export const ruleIdSchema = z
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
  })

/** usbipd BUSID（`1-2` / `2-1.3`） */
export const busIdSchema = z
  .string()
  .min(1)
  .max(40)
  .superRefine((s, ctx) => {
    try {
      assertSafeBusId(s)
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: e instanceof Error ? e.message : 'BUSID 非法',
      })
    }
  })

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function hasForbiddenKey(value: unknown, depth = 0): boolean {
  // 深度超限 fail-closed：无法在有限深度内证明干净的深嵌套对象按不可信拒绝
  // （此前返回 false 让深层 `__proto__` 绕过本层，依赖下游 deepMerge 兜底 — review 0.1.2 纵深防御）
  if (depth > 20) return true
  if (value === null || typeof value !== 'object') return false
  const keys = Object.getOwnPropertyNames(value)
  if (keys.some((k) => FORBIDDEN_KEYS.has(k))) return true
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (hasForbiddenKey(v, depth + 1)) return true
  }
  return false
}

/** configSet patch 序列化后长度上限（防 IPC 撑爆；单点事实源在本模块内） */
const CONFIG_PATCH_MAX_BYTES = 256 * 1024

/** 嵌套 patch：递归拒绝原型污染键（含数组元素 — review M2），序列化后超上限拒绝 */
export const patchSchema = z.custom<Record<string, unknown>>(
  (obj) => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false
    if (hasForbiddenKey(obj)) return false
    try {
      return utf8Bytes(JSON.stringify(obj)) <= CONFIG_PATCH_MAX_BYTES
    } catch {
      return false // 循环引用等不可序列化 → 拒绝
    }
  },
  { message: `patch 含非法键或序列化后超过 ${CONFIG_PATCH_MAX_BYTES} 字节上限` },
)

// 从 CONFIG_FILE_NAMES 派生（唯一事实源）：新增配置键只改一处，IPC 边界自动跟上 —
// 此前硬编码列表与 CONFIG_FILE_NAMES 是双事实源，新增键漏改即静默拒绝（review 0.1.2 根治）
export const configKeySchema = z.enum(
  Object.keys(CONFIG_FILE_NAMES) as [
    keyof typeof CONFIG_FILE_NAMES,
    ...(keyof typeof CONFIG_FILE_NAMES)[],
  ],
)

/** IO 路径：拒绝控制字符与 NUL，长度受限（设计书 §14.2 路径校验） */
export const ioPathSchema = z
  .string()
  .min(1)
  .max(1024)
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), { message: '路径包含非法控制字符' })
  .refine((s) => s.trim().length > 0, { message: '路径不能为空' })

export const fileFilterSchema = z.object({
  name: z.string().min(1).max(100),
  extensions: z.array(z.string().min(1).max(20)).min(1).max(20),
})

export const metaPayloadSchema = z.object({
  name: nameSchema,
  alias: z.string().default(''),
  tags: z.array(z.string().max(64)).max(20).default([]),
  color: z.string().default(''),
  icon: z.string().default(''),
  note: z.string().default(''),
  startupCwd: z.string().default('~'),
  pinned: z.boolean().default(false),
  quickActions: z.array(z.string().max(64)).max(20).default([]),
})

/** 拒绝控制字符的字符串（max 由调用方先约束，refine 后无链式方法） */
function noControl(maxLen: number) {
  return (
    z
      .string()
      .max(maxLen)
      // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
      .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), { message: '包含非法控制字符' })
  )
}

/**
 * 外链 URL（app:openExternal — review 0.1.2 审计修复）：
 * 协议白名单 http/https（大小写不敏感前缀），长度受限防 IPC 撑爆。
 * 用正则前缀而非 URL 解析：`JaVaScRiPt:` 等大小写变体天然不匹配白名单，直接拒绝。
 */
export const httpUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((s) => /^https?:\/\//i.test(s), { message: '仅允许打开 http/https 链接' })

/** UTF-8 字节长度（Node/渲染通用，不依赖 Buffer） */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * 文本类负载的控制字符校验：允许 \t \n \r（配置文本必需），
 * 其余 C0 控制字符与 DEL 拒绝（与执行边界一致）。
 */
function textNoControl(maxChars: number) {
  return (
    z
      .string()
      .max(maxChars)
      // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入（豁免 \t\n\r）
      .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), {
        message: '包含非法控制字符',
      })
  )
}

export const IPC_SCHEMAS: Partial<Record<ChannelName, z.ZodTypeAny>> = {
  [CH.distrosStart]: nameSchema,
  [CH.distrosTerminate]: nameSchema,
  [CH.distrosSetDefault]: nameSchema,
  // 契约先行：M5/M6/M7 通道也必须有 schema，实现 handler 前不留校验缺口
  [CH.distrosSetVersion]: z.object({
    name: nameSchema,
    version: z.union([z.literal(1), z.literal(2)]),
  }),
  [CH.distrosUnregister]: nameSchema,
  // 安装走 `wsl --install [-d name]`，无「安装源」参数（installSource 幽灵配置已删除）
  [CH.distrosInstall]: z.object({
    name: nameSchema.optional(),
  }),
  [CH.registryDetail]: nameSchema,
  [CH.metaGet]: nameSchema,
  // metrics:sample 只保留单发行版语义：概览键 `*` 已拆到 metrics:overview，此处显式拒绝，
  // 防止一通道双返回形状（Metrics | OverviewMetrics 联合）回归。发行版名规则仍由
  // nameSchema / assertSafeDistroName 统一（`*` 作为名字的合法字符不在此处收紧）。
  [CH.metricsSample]: metricsNameSchema,
  // 全局概览（OverviewMetrics）：无入参或空对象
  [CH.metricsOverview]: z.object({}).optional(),

  [CH.configGet]: configKeySchema,
  [CH.configSet]: z.object({
    fileKey: configKeySchema,
    patch: patchSchema,
  }),
  [CH.configOpenExternal]: configKeySchema,
  [CH.configResolveConflict]: z.object({
    fileKey: configKeySchema,
    action: z.enum(['reload', 'overwrite', 'ignore']),
  }),

  [CH.metaSet]: metaPayloadSchema,

  // PTY
  [CH.ptyCreate]: z.object({
    distro: nameSchema,
    shell: noControl(200).optional(),
    cwd: noControl(500).optional(),
    cols: z.number().int().min(2).max(500).default(80),
    rows: z.number().int().min(1).max(200).default(24),
  }),
  [CH.ptyInput]: z.object({
    ptyId: idSchema,
    // 大粘贴分片；256KB 足够，超过由渲染层分片
    data: z.string().max(1024 * 256),
  }),
  [CH.ptyResize]: z.object({
    ptyId: idSchema,
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(200),
  }),
  [CH.ptyKill]: idSchema,

  // IO（M4 备份迁移）
  [CH.ioExport]: z.object({
    name: nameSchema,
    path: ioPathSchema,
    format: z.enum(['tar', 'vhd']),
  }),
  [CH.ioImport]: z.object({
    name: nameSchema,
    // 就地导入（inPlace）时允许为空；归档导入由 IoService 再校验非空
    installPath: ioPathSchema.or(z.literal('')),
    archivePath: ioPathSchema,
    format: z.enum(['tar', 'vhd']),
    version: z.union([z.literal(1), z.literal(2)]).default(2),
    inPlace: z.boolean().default(false),
  }),
  [CH.ioMove]: z.object({
    name: nameSchema,
    path: ioPathSchema,
    terminateFirst: z.boolean().default(false),
  }),
  [CH.ioListBackups]: z
    .object({
      dir: ioPathSchema.optional(),
    })
    .default({}),
  [CH.ioCleanupBackups]: z
    .object({
      dir: ioPathSchema.optional(),
      keep: z.number().int().min(1).max(50).default(DEFAULT_BACKUP_KEEP),
    })
    .default({}),
  [CH.taskCancel]: idSchema,

  // 系统文件对话框
  [CH.appPickDirectory]: z
    .object({
      defaultPath: ioPathSchema.optional(),
    })
    .default({}),
  [CH.appPickSaveFile]: z
    .object({
      defaultPath: ioPathSchema.optional(),
      suggestedName: noControl(255).optional(),
      filters: z.array(fileFilterSchema).max(10).optional(),
    })
    .default({}),
  [CH.appPickOpenFile]: z
    .object({
      defaultPath: ioPathSchema.optional(),
      filters: z.array(fileFilterSchema).max(10).optional(),
    })
    .default({}),
  [CH.appOpenPath]: ioPathSchema,
  // 外链：只放行 http/https（review 0.1.2 审计修复），handler 侧再做二次协议校验（纵深防御）
  [CH.appOpenExternal]: httpUrlSchema,

  // 诊断包（M7）：可选默认保存目录，其余由主进程弹保存对话框
  [CH.diagnosticsExportPackage]: z
    .object({
      defaultPath: ioPathSchema.optional(),
    })
    .default({}),

  // wsl.conf（M5）
  [CH.wslconfRead]: nameSchema,
  [CH.wslconfWrite]: z.object({
    name: nameSchema,
    // 字符数与字节数双重约束：中文 65536 字 ≈ 196KB 不得穿透（执行边界 wslconf-service 同一常量）
    content: textNoControl(WSL_CONF_MAX_BYTES).refine((s) => utf8Bytes(s) <= WSL_CONF_MAX_BYTES, {
      message: `内容超过 ${WSL_CONF_MAX_BYTES} 字节上限`,
    }),
  }),

  // 发行版内文件（M5）：路径经 wsl.localhost 桥，一律拒绝控制字符
  [CH.fsReadDir]: z.object({
    distro: nameSchema,
    path: noControl(1024),
  }),
  [CH.fsRead]: z.object({
    distro: nameSchema,
    path: noControl(1024),
  }),
  [CH.fsWrite]: z.object({
    distro: nameSchema,
    path: noControl(1024),
    // 字符数与字节数双重约束（执行边界 fs-bridge 同一常量）
    data: textNoControl(FS_WRITE_LIMIT_BYTES).refine((s) => utf8Bytes(s) <= FS_WRITE_LIMIT_BYTES, {
      message: `内容超过 ${FS_WRITE_LIMIT_BYTES} 字节上限`,
    }),
  }),
  [CH.fsRevealInExplorer]: z.object({
    distro: nameSchema,
    path: noControl(1024),
  }),

  // 自定义动作（M5）：只允许执行配置中声明的 actionId；IPC 边界与执行边界同一校验
  [CH.actionRun]: z.object({
    actionId: z
      .string()
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
    distro: nameSchema.optional(),
  }),

  // 网络（M6）：id 一律来自 network.jsonc 声明（执行白名单），渲染层无法传任意命令
  [CH.networkApply]: ruleIdSchema,
  [CH.networkRemove]: ruleIdSchema,
  [CH.networkProxyApply]: z.object({ distro: nameSchema }),
  [CH.networkProxyClear]: z.object({ distro: nameSchema }),
  [CH.networkProxyState]: z.object({ distro: nameSchema }),

  // USB 设备（M6 usbipd）：BUSID 形如 `1-2` / `2-1.3`，严格白名单
  [CH.devicesBind]: busIdSchema,
  [CH.devicesUnbind]: busIdSchema,
  [CH.devicesDetach]: busIdSchema,
  [CH.devicesAttach]: z.object({
    busId: busIdSchema,
    distro: nameSchema.optional(),
  }),
}

/** 校验入参；通道约定：invoke 只传一个参数（对象或原始值） */
export function parseIpcArgs<T = unknown>(channel: string, args: unknown[]): T {
  const schema = IPC_SCHEMAS[channel as ChannelName]
  const value = args[0]
  // 多余参数静默丢弃会掩盖调用方 bug（review m2）——显式拒绝
  if (args.length > 1) {
    throw new Error(`通道 ${channel} 只接受 1 个参数，收到 ${args.length} 个`)
  }
  if (!schema) return value as T
  return schema.parse(value) as T
}
