import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import {
  CONFIG_FILE_NAMES,
  CONFIG_BACKUP_KEEP,
  createAppError,
  defaultConfig,
  migrateConfig,
  CONFIG_SCHEMAS,
  sanitizeWithSchema,
  type ConfigKey,
  type ConfigMap,
} from '@wslpilot/shared'
import {
  atomicWrite,
  applyPatchJsonc,
  modifyJsonc,
  parseJsoncSafe,
  stringifyJsonc,
  type Logger,
} from '@wslpilot/kit'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export type ConfigConflictAction = 'reload' | 'overwrite' | 'ignore'

export interface ConfigService {
  load<K extends ConfigKey>(key: K): Promise<ConfigMap[K]>
  patch<K extends ConfigKey>(key: K, patch: DeepPartial<ConfigMap[K]>): Promise<ConfigMap[K]>
  replace<K extends ConfigKey>(key: K, value: ConfigMap[K]): Promise<void>
  openInEditor(key: ConfigKey): Promise<void>
  onChange(key: ConfigKey, cb: () => void): () => void
  /** 外部修改冲突时的处理 */
  resolveConflict(key: ConfigKey, action: ConfigConflictAction): Promise<ConfigMap[ConfigKey]>
  /** 当前是否有外部冲突未处理 */
  getConflict(key: ConfigKey): { fileKey: ConfigKey; detail: string } | null
  readonly userDataDir: string
  dispose(): void
}

function deepMerge<T extends Record<string, any>>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, any>
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      typeof out[k] === 'object' &&
      out[k] !== null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k], v as any)
    } else {
      out[k] = v
    }
  }
  return out as T
}

const FILE_KEYS = Object.keys(CONFIG_FILE_NAMES) as ConfigKey[]
const TARGET_VERSIONS: Record<ConfigKey, number> = {
  settings: 2,
  distros: 1,
  actions: 1,
  network: 1,
  uiState: 1,
  state: 1,
}

export async function createConfigService(userDataDir: string, logger: Logger): Promise<ConfigService> {
  const cache = new Map<ConfigKey, ConfigMap[ConfigKey]>()
  const listeners = new Map<ConfigKey, Set<() => void>>()
  const conflicts = new Map<ConfigKey, { fileKey: ConfigKey; detail: string }>()
  /** 单写者原则：Promise 队列串行化写操作 */
  let writeQueue: Promise<unknown> = Promise.resolve()
  /** 自写标记：避免 chokidar 把自己的写入当成外部修改 */
  let selfWriting = 0
  const watchers: FSWatcher[] = []

  const filePath = (key: ConfigKey) => join(userDataDir, CONFIG_FILE_NAMES[key])

  async function ensureFile(key: ConfigKey): Promise<void> {
    const path = filePath(key)
    try {
      await fs.access(path)
    } catch {
      const defaults = defaultConfig(key as any)
      const header = `WSLPilot ${CONFIG_FILE_NAMES[key]} — 可手工编辑；写回时尽量保留注释`
      selfWriting++
      try {
        await atomicWrite(path, stringifyJsonc(defaults, header))
      } finally {
        selfWriting--
      }
      logger.info('config created', { key, path })
    }
  }

  async function readFromDisk<K extends ConfigKey>(key: K): Promise<ConfigMap[K]> {
    await ensureFile(key)
    const originalText = await fs.readFile(filePath(key), 'utf8')
    const parsed = parseJsoncSafe(originalText)
    if (parsed.errors.length > 0 || parsed.data === undefined) {
      throw createAppError('CONFIG_INVALID', {
        message: `${CONFIG_FILE_NAMES[key]} 解析失败`,
        detail: parsed.errorMessage,
      })
    }

    let data = parsed.data as Record<string, unknown>
    const target = TARGET_VERSIONS[key]
    const currentVersion = typeof data.$schemaVersion === 'number' ? data.$schemaVersion : 1
    if (currentVersion < target) {
      logger.info('config migrating', { key, from: currentVersion, to: target })
      await backupFile(key, `v${currentVersion}`)
      const before = parsed.data as Record<string, unknown>
      const migrated = migrateConfig(key, before, target)
      data = migrated
      // ★ 只最小编辑版本号及迁移新增键，保留用户注释
      let nextText = modifyJsonc(originalText, ['$schemaVersion'], target)
      for (const [k, v] of Object.entries(migrated)) {
        if (k === '$schemaVersion') continue
        if (!(k in before)) {
          nextText = modifyJsonc(nextText, [k], v)
        }
      }
      selfWriting++
      try {
        await atomicWrite(filePath(key), nextText)
      } finally {
        selfWriting--
      }
    }

    const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
    const result = schema.safeParse(data)
    if (!result.success) {
      // 逐字段清洗：非法字段回退默认，合法字段全部保留
      logger.warn('config schema mismatch, sanitizing fields', {
        key,
        issues: result.error.issues.slice(0, 3),
      })
      const defaults = defaultConfig(key as any) as Record<string, unknown>
      return sanitizeWithSchema(schema as any, data, defaults as any) as ConfigMap[K]
    }
    return result.data as ConfigMap[K]
  }

  async function backupFile(key: ConfigKey, suffix?: string): Promise<void> {
    try {
      const src = filePath(key)
      const backupDir = join(userDataDir, 'backups')
      await fs.mkdir(backupDir, { recursive: true })
      const name = CONFIG_FILE_NAMES[key].replace(/\.jsonc$/, '')
      const stamp = suffix ?? new Date().toISOString().replace(/[:.]/g, '-')
      const dest = join(backupDir, `${name}.bak.${stamp}.jsonc`)
      await fs.copyFile(src, dest)

      const files = (await fs.readdir(backupDir))
        .filter((f) => f.startsWith(`${name}.bak.`))
        .sort()
      while (files.length > CONFIG_BACKUP_KEEP) {
        const oldest = files.shift()
        if (oldest) await fs.unlink(join(backupDir, oldest)).catch(() => {})
      }
    } catch (e) {
      logger.warn('config backup failed', { key, error: String(e) })
    }
  }

  function notify(key: ConfigKey): void {
    const set = listeners.get(key)
    if (set) for (const cb of set) cb()
  }

  async function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeQueue.then(fn, fn)
    writeQueue = next.catch(() => {})
    return next
  }

  // 启动时加载全部配置到内存
  await fs.mkdir(userDataDir, { recursive: true })
  for (const key of FILE_KEYS) {
    try {
      cache.set(key, await readFromDisk(key))
    } catch (e) {
      logger.error('config load failed, using defaults', { key, error: String(e) })
      cache.set(key, defaultConfig(key as any) as ConfigMap[ConfigKey])
    }
  }

  // ── 外部修改监听（设计书 §6.10-3）────────────────────────
  const configWatcher = watch(
    FILE_KEYS.map((k) => filePath(k)),
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
    },
  )
  watchers.push(configWatcher)

  configWatcher.on('change', (changedPath: string) => {
    if (selfWriting > 0) return
    const key = FILE_KEYS.find((k) => filePath(k) === changedPath)
    if (!key) return

    void (async () => {
      try {
        const text = await fs.readFile(filePath(key), 'utf8')
        const parsed = parseJsoncSafe(text)
        if (parsed.errors.length > 0) {
          conflicts.set(key, {
            fileKey: key,
            detail: `外部修改后解析失败：${parsed.errorMessage ?? '未知错误'}`,
          })
          notify(key)
          return
        }
        const incoming = parsed.data as Record<string, unknown>
        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        const sanitized = sanitizeWithSchema(
          schema as any,
          incoming,
          defaultConfig(key as any) as any,
        ) as ConfigMap[ConfigKey]
        const current = cache.get(key)
        if (JSON.stringify(sanitized) === JSON.stringify(current)) {
          // 仅注释/格式变化，重载即可
          cache.set(key, sanitized)
          conflicts.delete(key)
          notify(key)
          return
        }
        // 内容有差异 → 标记冲突，等待用户选择
        conflicts.set(key, {
          fileKey: key,
          detail: '配置文件已被外部修改，与应用内状态不一致',
        })
        logger.info('config external conflict detected', { key })
        notify(key)
      } catch (e) {
        logger.warn('config watch handler failed', { key, error: String(e) })
      }
    })()
  })

  return {
    userDataDir,

    async load<K extends ConfigKey>(key: K): Promise<ConfigMap[K]> {
      return cache.get(key) as ConfigMap[K]
    },

    /**
     * 合并写回。对原文做最小叶子编辑（modifyJsonc），**完整保留用户注释**。
     */
    async patch<K extends ConfigKey>(key: K, patch: DeepPartial<ConfigMap[K]>): Promise<ConfigMap[K]> {
      return enqueueWrite(async () => {
        // 写前重读原文与磁盘数据，避免覆盖外部编辑
        await ensureFile(key)
        const originalText = await fs.readFile(filePath(key), 'utf8')
        const parsed = parseJsoncSafe(originalText)
        if (parsed.errors.length > 0 || parsed.data === undefined) {
          throw createAppError('CONFIG_INVALID', {
            message: `${CONFIG_FILE_NAMES[key]} 解析失败`,
            detail: parsed.errorMessage,
          })
        }

        const onDisk = parsed.data as Record<string, unknown>
        const merged = deepMerge(onDisk as any, patch as any)

        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        // 校验合并结果；非法字段不会写入（patch 只带合法叶子）
        const validated = schema.parse(merged) as ConfigMap[K]

        await backupFile(key)

        // ★ 注释保留：只对 patch 的叶子路径做 modify，不动其他内容
        const nextText = applyPatchJsonc(originalText, patch as Record<string, unknown>)
        // 若 patch 为空或 modify 失败导致空串，降级整写
        const writeText = nextText.trim() ? nextText : stringifyJsonc(validated)

        selfWriting++
        try {
          await atomicWrite(filePath(key), writeText)
        } finally {
          selfWriting--
        }

        cache.set(key, validated)
        conflicts.delete(key)
        notify(key)
        logger.info('config patched (comments preserved)', { key })
        return validated
      })
    },

    /** 整文件替换（不保留注释，按契约使用） */
    async replace<K extends ConfigKey>(key: K, value: ConfigMap[K]): Promise<void> {
      return enqueueWrite(async () => {
        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        const validated = schema.parse(value) as ConfigMap[K]
        await backupFile(key)
        selfWriting++
        try {
          await atomicWrite(filePath(key), stringifyJsonc(validated))
        } finally {
          selfWriting--
        }
        cache.set(key, validated)
        conflicts.delete(key)
        notify(key)
      })
    },

    async openInEditor(key: ConfigKey): Promise<void> {
      const { shell } = await import('electron')
      await shell.openPath(filePath(key))
    },

    onChange(key: ConfigKey, cb: () => void): () => void {
      let set = listeners.get(key)
      if (!set) {
        set = new Set()
        listeners.set(key, set)
      }
      set.add(cb)
      return () => set!.delete(cb)
    },

    getConflict(key: ConfigKey) {
      return conflicts.get(key) ?? null
    },

    async resolveConflict(key: ConfigKey, action: ConfigConflictAction) {
      return enqueueWrite(async () => {
        const text = await fs.readFile(filePath(key), 'utf8')
        const parsed = parseJsoncSafe(text)
        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        const defaults = defaultConfig(key as any) as Record<string, unknown>

        if (action === 'overwrite') {
          const current = cache.get(key) as ConfigMap[ConfigKey]
          await backupFile(key)
          selfWriting++
          try {
            await atomicWrite(filePath(key), stringifyJsonc(current))
          } finally {
            selfWriting--
          }
          conflicts.delete(key)
          notify(key)
          return current
        }

        // reload / ignore → 以磁盘为准（ignore 也先重载，避免脏写）
        const incoming = (parsed.data ?? defaults) as Record<string, unknown>
        const sanitized = sanitizeWithSchema(schema as any, incoming, defaults as any) as ConfigMap[ConfigKey]
        cache.set(key, sanitized)
        conflicts.delete(key)
        notify(key)
        logger.info('config conflict resolved', { key, action })
        return sanitized
      })
    },

    dispose() {
      for (const w of watchers) void w.close()
      watchers.length = 0
    },
  }
}
