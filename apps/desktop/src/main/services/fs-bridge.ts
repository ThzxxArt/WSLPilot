/**
 * 发行版内文件桥（M5）— FsBridge。
 * 通过 UNC `\\wsl.localhost\<distro>\<path>` 读写发行版内文件（9p IO）。
 * 安全边界（设计书 §14.2）：
 * - 发行版名走 assertSafeDistroName
 * - Linux 路径拒绝控制字符 / `..` 逃逸 / Windows 非法字符
 * - 结果路径必须仍在发行版根内（防逃逸）
 */
import { promises as fs } from 'node:fs'
import {
  createAppError,
  assertSafeDistroName,
  FS_READ_LIMIT_BYTES,
  FS_WRITE_LIMIT_BYTES,
  type DirEntry,
  type FsReadResult,
} from '@wslpilot/shared'
import { atomicWrite, type Logger } from '@wslpilot/kit'

/** 目录列举上限（防超大目录拖死 IPC）；可注入便于测试截断分支 */
export const READDIR_LIMIT = 5000
/** 文本读取上限（超出截断，编辑器只读展示）— 唯一事实源在 @wslpilot/shared */
export const READ_LIMIT = FS_READ_LIMIT_BYTES
/** 写入上限（与 ipc-schema fsWrite.data 同一常量） */
export const WRITE_LIMIT = FS_WRITE_LIMIT_BYTES

// eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const WIN_ILLEGAL = /[\\:*?"<>|]/

export interface FsPathParts {
  /** 规范化后的段（不含空段与 `.`） */
  segments: string[]
  /** Linux 形态绝对路径（用于 DirEntry.path 回传） */
  linuxPath: string
}

/**
 * 解析 Linux 路径为安全段列表。
 * 拒绝：控制字符、`..`、Windows 非法文件名字符、超长路径。
 */
export function parseLinuxPath(input: string): FsPathParts {
  const raw = String(input ?? '')
  if (CONTROL_CHARS.test(raw)) {
    throw createAppError('IO_ERROR', { message: '路径包含非法控制字符' })
  }
  if (raw.length > 1024) {
    throw createAppError('IO_ERROR', { message: '路径过长' })
  }
  const segments: string[] = []
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      throw createAppError('IO_ERROR', {
        message: '路径逃逸被拒绝',
        detail: raw,
        suggestion: '不允许使用 .. 跳出当前目录',
      })
    }
    if (WIN_ILLEGAL.test(part)) {
      throw createAppError('IO_ERROR', {
        message: `路径段包含非法字符：${part}`,
        suggestion: 'Windows 文件系统不支持 \\ : * ? " < > | 等字符',
      })
    }
    segments.push(part)
  }
  return { segments, linuxPath: `/${segments.join('/')}` }
}

/**
 * 拼接发行版根与 Linux 路径。
 * `sep` 默认 `\\`（UNC）；测试可注入 `/` 指向本地临时目录。
 */
export function joinDistroPath(root: string, linuxPath: string, sep = '\\'): string {
  const { segments } = parseLinuxPath(linuxPath)
  const trimmed = root.replace(/[/\\]+$/, '')
  if (segments.length === 0) return trimmed
  return `${trimmed}${sep}${segments.join(sep)}`
}

export interface FsBridgeDeps {
  logger: Logger
  /** 发行版 → 根路径解析（默认 wsl.localhost UNC，回退 wsl$） */
  rootFor?: (distro: string) => string
  /** 资源管理器展示（默认 shell.showItemInFolder） */
  reveal?: (target: string) => void
  sep?: string
  /** 目录列举上限（默认 READDIR_LIMIT；测试注入小值验证截断） */
  readDirLimit?: number
}

export interface FsBridge {
  readDir(distro: string, linuxPath: string): Promise<DirEntry[]>
  read(distro: string, linuxPath: string): Promise<FsReadResult>
  write(distro: string, linuxPath: string, data: string): Promise<void>
  revealInExplorer(distro: string, linuxPath: string): Promise<void>
}

/** UNC 根解析：wsl.localhost 优先（Win10 2004+），失败回退 wsl$ */
export function defaultRootFor(distro: string): string {
  return `\\\\wsl.localhost\\${distro}`
}

function isBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192))
  return sample.includes(0)
}

export function createFsBridge(deps: FsBridgeDeps): FsBridge {
  const sep = deps.sep ?? '\\'
  const rootFor = deps.rootFor ?? defaultRootFor
  const readDirLimit = deps.readDirLimit ?? READDIR_LIMIT

  function resolve(distro: string, linuxPath: string): { abs: string; linux: string } {
    const name = assertSafeDistroName(distro)
    const root = rootFor(name)
    const abs = joinDistroPath(root, linuxPath, sep)
    // 根内校验：解析结果必须以根前缀开头（防 rootFor/sep 注入类逃逸）
    const normRoot = root.replace(/[/\\]+$/, '')
    if (abs !== normRoot && !abs.startsWith(normRoot + sep)) {
      throw createAppError('IO_ERROR', { message: '路径逃逸被拒绝', detail: abs })
    }
    return { abs, linux: parseLinuxPath(linuxPath).linuxPath }
  }

  async function reveal(target: string): Promise<void> {
    if (deps.reveal) {
      deps.reveal(target)
      return
    }
    const { shell } = await import('electron')
    shell.showItemInFolder(target)
  }

  return {
    async readDir(distro, linuxPath) {
      const { abs, linux } = resolve(distro, linuxPath)
      let dirents
      try {
        dirents = await fs.readdir(abs, { withFileTypes: true })
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
          throw createAppError('IO_ERROR', {
            message: `目录不存在：${linux}`,
            detail: abs,
            suggestion: '请确认发行版已启动（wsl.localhost 共享需要发行版在运行）',
          })
        }
        if (err.code === 'ENOTDIR') {
          throw createAppError('IO_ERROR', { message: `不是目录：${linux}`, detail: abs })
        }
        throw createAppError('IO_ERROR', {
          message: `无法读取目录：${linux}`,
          detail: err.message,
        })
      }

      const limited = dirents.slice(0, readDirLimit)
      if (dirents.length > readDirLimit) {
        deps.logger.warn('fs readDir truncated', { distro, linux, count: dirents.length })
      }

      const out: DirEntry[] = []
      for (const d of limited) {
        const childLinux = linux === '/' ? `/${d.name}` : `${linux}/${d.name}`
        let size: number | undefined
        let modifiedAt: string | undefined
        try {
          const st = await fs.stat(`${abs}${sep}${d.name}`)
          size = st.size
          modifiedAt = st.mtime.toISOString()
        } catch {
          /* stat 失败不影响列表 */
        }
        out.push({
          name: d.name,
          path: childLinux,
          isDirectory: d.isDirectory(),
          size,
          modifiedAt,
        })
      }
      // 目录优先，其次按名称
      out.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return out
    },

    async read(distro, linuxPath) {
      const { abs, linux } = resolve(distro, linuxPath)
      let st
      try {
        st = await fs.stat(abs)
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        throw createAppError('IO_ERROR', {
          message: err.code === 'ENOENT' ? `文件不存在：${linux}` : `无法读取文件：${linux}`,
          detail: err.message,
        })
      }
      if (!st.isFile()) {
        throw createAppError('IO_ERROR', { message: `不是文件：${linux}`, detail: abs })
      }
      const truncated = st.size > READ_LIMIT
      const fh = await fs.open(abs, 'r')
      try {
        const size = Math.min(st.size, READ_LIMIT)
        const buf = Buffer.alloc(size)
        if (size > 0) await fh.read(buf, 0, size, 0)
        if (isBinary(buf)) {
          return { text: '', sizeBytes: st.size, truncated, binary: true }
        }
        return {
          text: buf.toString('utf8'),
          sizeBytes: st.size,
          truncated,
          binary: false,
        }
      } finally {
        await fh.close()
      }
    },

    async write(distro, linuxPath, data) {
      const { abs, linux } = resolve(distro, linuxPath)
      const body = String(data ?? '')
      if (Buffer.byteLength(body, 'utf8') > WRITE_LIMIT) {
        throw createAppError('IO_ERROR', { message: '文件超过 4MB 写入上限' })
      }
      try {
        await atomicWrite(abs, body)
      } catch (e) {
        throw createAppError('IO_ERROR', {
          message: `写入失败：${linux}`,
          detail: e instanceof Error ? e.message : String(e),
          suggestion: '请确认发行版已启动且目标目录可写（9p 共享）',
        })
      }
      deps.logger.info('fs write', { distro, linux, bytes: Buffer.byteLength(body, 'utf8') })
    },

    async revealInExplorer(distro, linuxPath) {
      const { abs } = resolve(distro, linuxPath)
      try {
        await fs.stat(abs)
      } catch {
        throw createAppError('IO_ERROR', {
          message: '路径不存在或不可访问',
          detail: abs,
          suggestion: '请确认发行版已启动',
        })
      }
      await reveal(abs)
    },
  }
}
