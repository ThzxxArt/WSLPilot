import type { DistroRuntime, RegistryDetail } from '@wslpilot/shared'
import { decodeToolOutput, type Logger } from '@wslpilot/kit'

/**
 * Lxss 注册表只读查询。
 * 设计书 §9.2：一切变更走 wsl.exe，此处只补充深层信息。
 * 读取失败降级为 undefined，不阻断主流程。
 */
export interface RegistryService {
  detail(name: string): Promise<Partial<DistroRuntime>>
  /** 完整 Lxss 详情（M5 注册表详情：GUID / BasePath / Flags / 原始键值） */
  detailFull(name: string): Promise<RegistryDetail | null>
  listGuids(): Promise<Array<{ guid: string; distributionName: string }>>
  /**
   * 一次性读取全部发行版的深层信息（GUID / BasePath / DefaultUid / Version）。
   * `distros:list` 用它补齐 `DistroRuntime`，否则迁移向导永远显示「注册表信息不可用」。
   * 读取失败抛错，由调用方决定降级（§9.2：失败降级 undefined，不阻断主流程）。
   */
  listAll(): Promise<Array<Partial<DistroRuntime> & { name: string }>>
}

const LXSS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'

export type RegQuery = (args: string[]) => Promise<string>

/** 从 reg query 输出中读取 REG_* 值 */
export function pickRegValue(out: string, name: string): string | undefined {
  const re = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'im')
  const raw = re.exec(out)?.[1]?.trim()
  if (raw === undefined) return undefined
  // REG_SZ 可能带引号，统一剥掉
  return raw.replace(/^"(.*)"$/, '$1')
}

/** REG_DWORD 十六进制（0x…）或十进制 → number */
export function parseRegDword(value: string | undefined): number | undefined {
  if (!value) return undefined
  const v = value.trim()
  if (/^0x[0-9a-f]+$/i.test(v)) return Number.parseInt(v, 16)
  if (/^\d+$/.test(v)) return Number(v)
  return undefined
}

/** 从 reg query HKCU\...\Lxss 根输出提取 GUID 列表 */
export function extractGuids(out: string): string[] {
  const re = /Lxss\\(\{[0-9A-Fa-f-]+\})/g
  const ids = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(out))) ids.add(m[1]!)
  return [...ids]
}

export function parseGuidDetail(guid: string, out: string): Partial<DistroRuntime> {
  const distributionName = pickRegValue(out, 'DistributionName')
  if (!distributionName) return {}
  const versionNum = parseRegDword(pickRegValue(out, 'Version'))
  return {
    name: distributionName,
    basePath: pickRegValue(out, 'BasePath'),
    guid,
    version: versionNum === 1 ? 1 : 2,
    defaultUid: parseRegDword(pickRegValue(out, 'DefaultUid')),
  }
}

/** 收集 reg query 输出的全部键值（字符串形态，展示用） */
export function collectRegValues(out: string): Record<string, string> {
  const values: Record<string, string> = {}
  const re = /^\s*(\S+)\s+REG_\w+\s+(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(out))) {
    const key = m[1]!
    const raw = m[2]!.trim()
    values[key] = raw.replace(/^"(.*)"$/, '$1')
  }
  return values
}

/** 完整详情解析（M5）：Runtime 字段 + Flags + 原始键值 */
export function parseGuidFull(guid: string, out: string): RegistryDetail | null {
  const base = parseGuidDetail(guid, out)
  if (!base.name) return null
  return {
    guid,
    distributionName: base.name,
    basePath: base.basePath,
    version: base.version,
    defaultUid: base.defaultUid,
    flags: parseRegDword(pickRegValue(out, 'Flags')),
    values: collectRegValues(out),
  }
}

/** 默认实现：调用 reg.exe */
export async function defaultRegQuery(args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { stdout } = await execFileAsync('reg.exe', args, {
    encoding: 'buffer',
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  })
  // reg.exe 是控制台工具：重定向后按系统代码页输出，不是稳定 UTF-16LE。
  // 硬编码 utf16le 在中文/英文 Windows 上会乱码 → pickRegValue 全部失配 →
  // basePath/GUID 拿不到，连带迁移校验、进度估算一起失效（review M-8）。
  return decodeToolOutput(stdout as unknown as Buffer)
}

export function createRegistryService(
  logger: Logger,
  regQuery: RegQuery = defaultRegQuery,
): RegistryService {
  async function query(args: string[]): Promise<string> {
    try {
      return await regQuery(args)
    } catch (e) {
      logger.debug('registry query failed', { args, error: String(e) })
      return ''
    }
  }

  async function readGuid(guid: string): Promise<Partial<DistroRuntime>> {
    const out = await query(['query', `${LXSS}\\${guid}`, '/s'])
    return parseGuidDetail(guid, out)
  }

  async function readGuidFull(guid: string): Promise<RegistryDetail | null> {
    const out = await query(['query', `${LXSS}\\${guid}`, '/s'])
    return parseGuidFull(guid, out)
  }

  async function listGuids(): Promise<Array<{ guid: string; distributionName: string }>> {
    const out = await query(['query', LXSS])
    const ids = extractGuids(out)
    const guids: Array<{ guid: string; distributionName: string }> = []
    for (const guid of ids) {
      const info = await readGuid(guid)
      if (info.name) {
        guids.push({ guid, distributionName: info.name })
      }
    }
    return guids
  }

  async function listAll(): Promise<Array<Partial<DistroRuntime> & { name: string }>> {
    const guids = await listGuids()
    const out: Array<Partial<DistroRuntime> & { name: string }> = []
    for (const g of guids) {
      const info = await readGuid(g.guid)
      if (info.name) out.push({ ...info, name: info.name })
    }
    return out
  }

  return {
    async detail(name) {
      const lower = String(name ?? '').toLowerCase()
      const all = await listAll()
      return all.find((d) => d.name.toLowerCase() === lower) ?? {}
    },

    async detailFull(name) {
      const guids = await listGuids()
      const lower = name.toLowerCase()
      for (const g of guids) {
        if (g.distributionName.toLowerCase() === lower) {
          return readGuidFull(g.guid)
        }
      }
      return null
    },

    listGuids,
    listAll,
  }
}
