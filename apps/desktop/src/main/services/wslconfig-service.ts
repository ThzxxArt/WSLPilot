/**
 * `%UserProfile%\.wslconfig` 读写服务（0.1.3）。
 *
 * - 读：宿主文件读取（不存在返回 `exists:false` + 空内容，视为默认配置）
 * - 写：语法守卫（只允许 blank/comment/section/entry 行）→ 备份轮转 → 原子写
 * - 「生效」：WSL 全局配置在 `wsl --shutdown` 后（约 8 秒）生效，由 UI 提供一键重启
 *
 * 与 `wslconf-service`（发行版内 /etc/wsl.conf）的差异：
 * 本文件是 **Windows 宿主侧文件**（纯 fs 操作，不需要 UAC，也不需要发行版运行）。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  WSL_CONFIG_MAX_BYTES,
  createAppError,
  parseIniLines,
  type WslConfigFileState,
} from '@wslpilot/shared'
import { atomicWrite, type Logger } from '@wslpilot/kit'

export const WSL_CONFIG_FILE = '.wslconfig'
/** 备份保留份数（与配置备份同口径） */
export const WSL_CONFIG_BACKUP_KEEP = 3

/**
 * 写入前的语法守卫：只允许 blank/comment/section/entry 行。
 * 「无法识别的行」意味着用户意图可能被原样写坏，直接拒绝并给出行号。
 */
export function assertParsableWslConfig(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > WSL_CONFIG_MAX_BYTES) {
    throw createAppError('CONFIG_INVALID', {
      message: `.wslconfig 超过 ${WSL_CONFIG_MAX_BYTES / 1024}KB 上限`,
    })
  }
  const lines = parseIniLines(content)
  const bad = lines.findIndex((l) => l.type === 'other')
  if (bad >= 0) {
    throw createAppError('CONFIG_INVALID', {
      message: `.wslconfig 第 ${bad + 1} 行无法识别，已拒绝写入`,
      detail: lines[bad]!.raw,
      suggestion: '每行应为 [section]、key = value 或以 # / ; 开头的注释',
    })
  }
}

export interface WslConfigService {
  /** 文件绝对路径 */
  path(): string
  /** 读取原文；不存在返回 exists:false（视为默认配置） */
  read(): Promise<WslConfigFileState>
  /** 写入原文（备份 → 原子写）；返回文件路径 */
  write(content: string): Promise<{ path: string }>
}

export interface WslConfigServiceDeps {
  logger: Logger
  userDataDir: string
  /** `%UserProfile%\.wslconfig`；测试可注入 */
  path?: string
}

export function createWslConfigService(deps: WslConfigServiceDeps): WslConfigService {
  const filePath = deps.path ?? join(homedir(), WSL_CONFIG_FILE)

  /** 写入前备份（保留最近 N 份；备份失败仅告警，不阻断写入） */
  async function backupFile(): Promise<void> {
    try {
      const src = await fs.readFile(filePath)
      const backupDir = join(deps.userDataDir, 'backups')
      await fs.mkdir(backupDir, { recursive: true })
      // 时间戳打头，字典序 = 时间序（与 config-service 备份同规则）
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dest = join(backupDir, `wslconfig.bak.${stamp}.wslconfig`)
      await fs.writeFile(dest, src)
      const files = (await fs.readdir(backupDir))
        .filter((f) => f.startsWith('wslconfig.bak.'))
        .sort()
      while (files.length > WSL_CONFIG_BACKUP_KEEP) {
        const oldest = files.shift()
        if (oldest) await fs.unlink(join(backupDir, oldest)).catch(() => {})
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        deps.logger.warn('wslconfig backup failed', { error: String(e) })
      }
    }
  }

  return {
    path: () => filePath,

    async read(): Promise<WslConfigFileState> {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        return { path: filePath, exists: true, content }
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
          return { path: filePath, exists: false, content: '' }
        }
        throw createAppError('IO_ERROR', {
          message: '读取 .wslconfig 失败',
          detail: e instanceof Error ? e.message : String(e),
          suggestion: '请检查用户目录的读取权限后重试',
        })
      }
    },

    async write(content: string): Promise<{ path: string }> {
      const body = String(content ?? '')
      assertParsableWslConfig(body)
      await backupFile()
      await atomicWrite(filePath, body)
      deps.logger.info('wslconfig written', {
        path: filePath,
        bytes: Buffer.byteLength(body, 'utf8'),
      })
      return { path: filePath }
    },
  }
}
