import type { ConfigKeyOf } from './config-schema'
import { repairDuplicateRuleIds } from './network'

/** 配置版本迁移链：旧结构 → 新结构（模块内类型，外部经 migrateConfig 消费） */
type MigrationFn = (old: Record<string, unknown>) => Record<string, unknown>

/** 迁移链表（模块内常量，外部经 migrateConfig 消费）。
 *  `Record<ConfigKeyOf, …>` 让新增配置键漏配迁移链在编译期即报错（此前 `?? []` 静默兜底）。 */
const migrations: Record<ConfigKeyOf, MigrationFn[]> = {
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
  distros: [
    // v1 → v2: tags 上限 64/20、quickActions 上限 100/20 在 0.1.4 收紧；
    // 旧文件超限项若直接交给 schema-sanitize 会被静默丢掉。迁移时截断/截取，
    // 保住可迁移数据；UI 仍会显示剩余项。
    (v1) => {
      const list = Array.isArray(v1.distros) ? (v1.distros as unknown[]) : []
      const distros = list.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
        const d = raw as Record<string, unknown>
        const out = { ...d }
        if (Array.isArray(d.tags)) {
          out.tags = d.tags
            .filter((t): t is string => typeof t === 'string')
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 20)
            .map((t) => t.slice(0, 64))
        }
        if (Array.isArray(d.quickActions)) {
          out.quickActions = d.quickActions
            .filter((a): a is string => typeof a === 'string')
            .map((a) => a.trim())
            .filter(Boolean)
            .slice(0, 20)
        }
        return out
      })
      return { ...v1, $schemaVersion: 2, distros }
    },
  ],
  actions: [],
  network: [
    // v1 → v2: 修复重复/空规则 id（旧版 sanitize 会保留重复项，导致整个文件永远无法保存）
    (v1) => {
      const rules = Array.isArray(v1.portForwarding)
        ? (v1.portForwarding as Array<Record<string, unknown>>)
        : []
      const repaired = repairDuplicateRuleIds(rules.map((r) => ({ ...r, id: String(r.id ?? '') })))
      return { ...v1, $schemaVersion: 2, portForwarding: repaired.rules }
    },
  ],
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
  const chain = migrations[key]
  let current = { ...data }
  const raw = typeof current.$schemaVersion === 'number' ? (current.$schemaVersion as number) : 1
  // 非整数版本（1.5 / 2.5）此前会让 while 永远卡在链外，deleting stamp 后每次启动重复迁移；
  // 归一为整数：向下取整（1.5 → 1 仍迁移；2.5 → 2 视为已到目标）。
  let version = Number.isFinite(raw) ? Math.trunc(raw) : 1
  if (version <= 0) version = 1

  // 未来版本（高于当前支持）：拒绝改写版本戳
  if (version > toVersion) {
    current.$schemaVersion = version
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
