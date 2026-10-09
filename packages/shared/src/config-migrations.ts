import type { ConfigKeyOf } from './config-schema'

/** 配置版本迁移链：旧结构 → 新结构 */
export type MigrationFn = (old: Record<string, unknown>) => Record<string, unknown>

export const migrations: Record<string, MigrationFn[]> = {
  settings: [
    // v1 → v2: 增加 accent / launchAtLogin / reduceMotion
    (v1) => ({
      ...v1,
      $schemaVersion: 2,
      general: {
        accent: 'aurora',
        launchAtLogin: false,
        reduceMotion: false,
        ...(v1.general ?? {}),
      },
    }),
  ],
  distros: [],
  actions: [],
  network: [],
  uiState: [],
  state: [],
}

/**
 * 将配置从任意旧版本迁移到当前版本。
 * 迁移函数按索引顺序执行：migrations[key][i] 负责 version i → i+1。
 * 版本戳规则（review M5）：
 * - version ≤ 0 视为 1（旧文件缺省）
 * - version > toVersion 拒绝降级盖章，原样返回（避免"没迁移却说已迁移"）
 */
export function migrateConfig<K extends ConfigKeyOf>(
  key: K,
  data: Record<string, unknown>,
  toVersion: number,
): Record<string, unknown> {
  const chain = migrations[key] ?? []
  let current = { ...data }
  let version = typeof current.$schemaVersion === 'number' ? (current.$schemaVersion as number) : 1
  if (version <= 0) version = 1

  // 未来版本（高于当前支持）：拒绝改写版本戳
  if (version > toVersion) {
    return current
  }

  while (version < toVersion && version - 1 < chain.length) {
    const fn = chain[version - 1]
    if (!fn) break
    current = fn(current)
    const nextVersion =
      typeof current.$schemaVersion === 'number' ? (current.$schemaVersion as number) : version + 1
    // 迁移函数必须推进版本；原地踏步则中止且不盖章（核验修复：不给假盖章）
    if (nextVersion <= version) {
      delete current.$schemaVersion
      return current
    }
    version = nextVersion
  }

  // 未走到目标版本（链条不完整）不盖章（核验修复）
  if (version < toVersion) {
    delete current.$schemaVersion
    return current
  }

  current.$schemaVersion = toVersion
  return current
}
