import type { DistroRuntime } from '@wslpilot/shared'
import type { Logger } from '@wslpilot/kit'

/**
 * Lxss 注册表只读查询。
 * 设计书 §9.2：一切变更走 wsl.exe，此处只补充深层信息。
 * 读取失败降级为 undefined，不阻断主流程。
 */
export interface RegistryService {
  detail(name: string): Promise<Partial<DistroRuntime>>
  listGuids(): Promise<Array<{ guid: string; distributionName: string }>>
}

const LXSS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'

export type RegQuery = (args: string[]) => Promise<string>

/** 从 reg query 输出中读取 REG_* 值 */
export function pickRegValue(out: string, name: string): string | undefined {
  const re = new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+)$`, 'im')
  return re.exec(out)?.[1]?.trim()
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
  return Buffer.isBuffer(stdout)
    ? stdout.toString('utf16le').replace(/\0/g, '')
    : String(stdout ?? '')
}

export function createRegistryService(logger: Logger, regQuery: RegQuery = defaultRegQuery): RegistryService {
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

  return {
    async detail(name) {
      const guids = await listGuids()
      for (const g of guids) {
        if (g.distributionName === name) {
          return readGuid(g.guid)
        }
      }
      return {}
    },

    listGuids,
  }
}
