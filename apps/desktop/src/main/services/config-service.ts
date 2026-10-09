import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  CONFIG_FILE_NAMES,
  CONFIG_BACKUP_KEEP,
  createAppError,
  defaultConfig,
  migrateConfig,
  CONFIG_SCHEMAS,
  type ConfigKey,
  type ConfigMap,
} from '@wslpilot/shared'
import {
  atomicWrite,
  parseJsoncSafe,
  stringifyJsonc,
  type Logger,
} from '@wslpilot/kit'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export interface ConfigService {
  load<K extends ConfigKey>(key: K): Promise<ConfigMap[K]>
  patch<K extends ConfigKey>(key: K, patch: DeepPartial<ConfigMap[K]>): Promise<ConfigMap[K]>
  replace<K extends ConfigKey>(key: K, value: ConfigMap[K]): Promise<void>
  openInEditor(key: ConfigKey): Promise<void>
  onChange(key: ConfigKey, cb: () => void): () => void
  readonly userDataDir: string
}

function deepMerge<T extends Record<string, any>>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, any>
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null && !Array.isArray(out[k])) {
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
  /** 单写者原则：Promise 队列串行化写操作 */
  let writeQueue: Promise<unknown> = Promise.resolve()

  const filePath = (key: ConfigKey) => join(userDataDir, CONFIG_FILE_NAMES[key])

  async function ensureFile(key: ConfigKey): Promise<void> {
    const path = filePath(key)
    try {
      await fs.access(path)
    } catch {
      const defaults = defaultConfig(key as any)
      const header = `WSLPilot ${CONFIG_FILE_NAMES[key]} — 可手工编辑；写回时尽量保留注释`
      await atomicWrite(path, stringifyJsonc(defaults, header))
      logger.info('config created', { key, path })
    }
  }

  async function readFromDisk<K extends ConfigKey>(key: K): Promise<ConfigMap[K]> {
    await ensureFile(key)
    const text = await fs.readFile(filePath(key), 'utf8')
    const parsed = parseJsoncSafe(text)
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
      // 迁移前备份
      await backupFile(key, `v${currentVersion}`)
      data = migrateConfig(key, data, target)
      await atomicWrite(filePath(key), stringifyJsonc(data))
    }

    const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
    const result = schema.safeParse(data)
    if (!result.success) {
      logger.warn('config schema mismatch, falling back to defaults+merge', {
        key,
        issues: result.error.issues.slice(0, 3),
      })
      const fallback = deepMerge(defaultConfig(key as any) as any, data)
      return schema.parse(fallback) as ConfigMap[K]
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

      // 轮转：保留最近 N 份
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
    // 广播到渲染进程由 ipc 层负责
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

  return {
    userDataDir,

    async load<K extends ConfigKey>(key: K): Promise<ConfigMap[K]> {
      return cache.get(key) as ConfigMap[K]
    },

    async patch<K extends ConfigKey>(key: K, patch: DeepPartial<ConfigMap[K]>): Promise<ConfigMap[K]> {
      return enqueueWrite(async () => {
        // 写前重读，避免覆盖外部编辑
        const onDisk = await readFromDisk(key)
        const merged = deepMerge(onDisk as any, patch as any)

        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        const validated = schema.parse(merged) as ConfigMap[K]

        await backupFile(key)
        await atomicWrite(filePath(key), stringifyJsonc(validated))
        cache.set(key, validated)
        notify(key)
        logger.info('config patched', { key })
        return validated
      })
    },

    async replace<K extends ConfigKey>(key: K, value: ConfigMap[K]): Promise<void> {
      return enqueueWrite(async () => {
        const schema = CONFIG_SCHEMAS[key as keyof typeof CONFIG_SCHEMAS]
        const validated = schema.parse(value) as ConfigMap[K]
        await backupFile(key)
        await atomicWrite(filePath(key), stringifyJsonc(validated))
        cache.set(key, validated)
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
  }
}
