import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
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
  /** 同步读缓存（close 等事件必须同步决策） */
  loadSync<K extends ConfigKey>(key: K): ConfigMap[K]
  patch<K extends ConfigKey>(key: K, patch: DeepPartial<ConfigMap[K]>): Promise<ConfigMap[K]>
  replace<K extends ConfigKey>(key: K, value: ConfigMap[K]): Promise<void>
  /** 在写队列内执行读-改-写，避免并发丢更新 */
  update<K extends ConfigKey>(
    key: K,
    fn: (current: ConfigMap[K]) => ConfigMap[K] | Promise<ConfigMap[K]>,
  ): Promise<ConfigMap[K]>
  openInEditor(key: ConfigKey): Promise<void>
  onChange(key: ConfigKey, cb: () => void): () => void
  resolveConflict(key: ConfigKey, action: ConfigConflictAction): Promise<ConfigMap[ConfigKey]>
  getConflict(key: ConfigKey): { fileKey: ConfigKey; detail: string } | null
  readonly userDataDir: string
  dispose(): void
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** 防原型污染的深度合并 */
export function deepMerge<T extends Record<string, unknown>>(base: T, patch: unknown): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  if (!isPlainObject(patch)) return out as T
  for (const [k, v] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(k)) continue
    if (v === undefined) continue
    const current = out[k]
    if (isPlainObject(v) && isPlainObject(current)) {
      out[k] = deepMerge(current, v)
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

function hashText(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

export async function createConfigService(userDataDir: string, logger: Logger): Promise<ConfigService> {
  const cache = new Map<ConfigKey, ConfigMap[ConfigKey]>()
  const listeners = new Map<ConfigKey, Set<() => void>>()
  const conflicts = new Map<ConfigKey, { fileKey: ConfigKey; detail: string }>()
  let writeQueue: Promise<unknown> = Promise.resolve()
  /** 最近一次自写内容哈希 —— 用内容识别 chokidar 事件是否为自写（比时间窗可靠） */
  const lastSelfWriteHash = new Map<ConfigKey, string>()
  const watchers: FSWatcher[] = []

  const filePath = (key: ConfigKey) => join(userDataDir, CONFIG_FILE_NAMES[key])

  async function ensureFile(key: ConfigKey): Promise<void> {
    const path = filePath(key)
    try {
      await fs.access(path)
    } catch {
      const defaults = defaultConfig(key as any)
      const header = `WSLPilot ${CONFIG_FILE_NAMES[key]} — 可手工编辑；写回时尽量保留注释`
      const content = stringifyJsonc(defaults, header)
      await atomicWrite(path, content)
      lastSelfWriteHash.set(key, hashText(content))
      logger.info('config created', { key, path })
    }
  }

  async function readRaw(key: ConfigKey): Promise<string> {
    await ensureFile(key)
    return fs.readFile(filePath(key), 'utf8')
  }

  async function readFromDisk<K extends ConfigKey>(key: K): Promise<ConfigMap[K]> {
    const originalText = await readRaw(key)
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
      const before = data
      const migrated = migrateConfig(key, before, target)
      data = migrated
      let nextText = modifyJsonc(originalText, ['$schemaVersion'], target)
      for (const [k, v] of Object.entries(migrated)) {
        if (k === '$schemaVersion') continue
        if (!(k in before) && !FORBIDDEN_KEYS.has(k)) {
          nextText = modifyJsonc(nextText, [k], v)
        }
      }
      await atomicWrite(filePath(key), nextText)
      lastSelfWriteHash.set(key, hashText(nextText))
    }

    const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
    const result = schema.safeParse(data)
    if (!result.success) {
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

  async function writeContent(key: ConfigKey, content: string): Promise<void> {
    await backupFile(key)
    await atomicWrite(filePath(key), content)
    lastSelfWriteHash.set(key, hashText(content))
    cache.set(key, await parseAndSanitize(key, content))
    conflicts.delete(key)
    notify(key)
  }

  async function parseAndSanitize<K extends ConfigKey>(key: K, text: string): Promise<ConfigMap[K]> {
    const parsed = parseJsoncSafe(text)
    const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
    const defaults = defaultConfig(key as any) as Record<string, unknown>
    const data = (parsed.data ?? defaults) as Record<string, unknown>
    const result = schema.safeParse(data)
    if (result.success) return result.data as ConfigMap[K]
    return sanitizeWithSchema(schema as any, data, defaults as any) as ConfigMap[K]
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
    const key = FILE_KEYS.find((k) => filePath(k) === changedPath)
    if (!key) return

    void (async () => {
      try {
        const text = await fs.readFile(filePath(key), 'utf8')
        const h = hashText(text)
        // 内容哈希等于最近一次自写 → 自写回环，忽略
        if (h === lastSelfWriteHash.get(key)) return

        const parsed = parseJsoncSafe(text)
        if (parsed.errors.length > 0) {
          conflicts.set(key, {
            fileKey: key,
            detail: `外部修改后解析失败：${parsed.errorMessage ?? '未知错误'}`,
          })
          notify(key)
          return
        }
        const sanitized = await parseAndSanitize(key, text)
        const current = cache.get(key)
        if (JSON.stringify(sanitized) === JSON.stringify(current)) {
          cache.set(key, sanitized)
          lastSelfWriteHash.set(key, h)
          conflicts.delete(key)
          notify(key)
          return
        }
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

    loadSync<K extends ConfigKey>(key: K): ConfigMap[K] {
      return cache.get(key) as ConfigMap[K]
    },

    /**
     * 合并写回。对原文做最小叶子编辑（modifyJsonc），保留用户注释。
     * 磁盘上非法字段先 sanitize，与读路径一致，避免 ZodError 锁死写回。
     */
    async patch<K extends ConfigKey>(key: K, patch: DeepPartial<ConfigMap[K]>): Promise<ConfigMap[K]> {
      return enqueueWrite(async () => {
        const originalText = await readRaw(key)
        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]

        // 读磁盘 → 清洗非法字段 → 再合并 patch（I3）
        const onDisk = await parseAndSanitize(key, originalText)
        const merged = deepMerge(onDisk as Record<string, unknown>, patch as Record<string, unknown>)

        const validated = schema.safeParse(merged)
        if (!validated.success) {
          throw createAppError('CONFIG_INVALID', {
            message: `${CONFIG_FILE_NAMES[key]} 校验失败`,
            detail: validated.error.issues
              .slice(0, 5)
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
          })
        }

        // 注释保留：只对 patch 叶子做 modify
        const cleanPatch = deepMerge({}, patch as Record<string, unknown>)
        const nextText = applyPatchJsonc(originalText, cleanPatch as Record<string, unknown>)
        const writeText = nextText.trim()
          ? nextText
          : stringifyJsonc(validated.data)
        await writeContent(key, writeText)
        // cache 用 validated
        cache.set(key, validated.data as ConfigMap[K])
        notify(key)
        logger.info('config patched (comments preserved)', { key })
        return validated.data as ConfigMap[K]
      })
    },

    async replace<K extends ConfigKey>(key: K, value: ConfigMap[K]): Promise<void> {
      return enqueueWrite(async () => {
        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        const validated = schema.safeParse(value)
        if (!validated.success) {
          throw createAppError('CONFIG_INVALID', {
            message: `${CONFIG_FILE_NAMES[key]} 校验失败`,
            detail: validated.error.issues.slice(0, 5).map((i) => i.message).join('; '),
          })
        }
        await writeContent(key, stringifyJsonc(validated.data))
        cache.set(key, validated.data as ConfigMap[K])
        notify(key)
      })
    },

    async update(key, fn) {
      return enqueueWrite(async () => {
        const current = cache.get(key) as ConfigMap[typeof key]
        const next = await fn(current)
        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        const validated = schema.safeParse(next)
        if (!validated.success) {
          throw createAppError('CONFIG_INVALID', {
            message: `${CONFIG_FILE_NAMES[key]} 校验失败`,
            detail: validated.error.issues.slice(0, 5).map((i) => i.message).join('; '),
          })
        }
        await writeContent(key, stringifyJsonc(validated.data))
        cache.set(key, validated.data as ConfigMap[typeof key])
        notify(key)
        return validated.data as ConfigMap[typeof key]
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

        if (action === 'overwrite') {
          const current = cache.get(key) as ConfigMap[ConfigKey]
          await writeContent(key, stringifyJsonc(current))
          return current
        }

        // reload / ignore → 以磁盘为准
        const sanitized = await parseAndSanitize(key, text)
        lastSelfWriteHash.set(key, hashText(text))
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
