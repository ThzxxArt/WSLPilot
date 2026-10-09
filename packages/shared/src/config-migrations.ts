import type { ConfigKeyOf } from './config-schema'

/** 配置版本迁移链：旧结构 → 新结构 */
export type MigrationFn = (old: any) => any

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
 */
export function migrateConfig<K extends ConfigKeyOf>(
  key: K,
  data: Record<string, unknown>,
  toVersion: number,
): Record<string, unknown> {
  const chain = migrations[key] ?? []
  let current = { ...data }
  let version = typeof current.$schemaVersion === 'number' ? (current.$schemaVersion as number) : 1

  while (version < toVersion && version - 1 < chain.length) {
    const fn = chain[version - 1]
    if (!fn) break
    current = fn(current)
    version = typeof current.$schemaVersion === 'number' ? (current.$schemaVersion as number) : version + 1
  }

  current.$schemaVersion = toVersion
  return current
}
