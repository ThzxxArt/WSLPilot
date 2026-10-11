/**
 * 发行版内文件桥（M5）— FsBridge。
 * 通过 UNC `\\wsl.localhost\<distro>\<path>` 读写发行版内文件（9p IO），
 * 主根不可达（ENOENT/EACCES/UNC 类）时自动用备用根 `\\wsl$\<distro>` 重试一次。
 * 安全边界（设计书 §14.2）：
 * - 发行版名走 assertSafeDistroName
 * - Linux 路径拒绝控制字符 / `..` 逃逸 / Windows 非法字符
 * - 结果路径必须仍在实际使用的根内（防逃逸，两个根都各做一次根内校验）
 */
import { promises as fs } from 'node:fs'
import {
  createAppError,
  isAppError,
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
  /** 发行版 → 主根路径解析（默认 wsl.localhost UNC） */
  rootFor?: (distro: string) => string
  /**
   * 备用根（默认 wsl$ UNC）：主根操作失败且属 UNC 不可达类错误时回退一次。
   * 自定义 rootFor 时不再自动派生 wsl$ 备用根，需显式传入才启用回退；返回 null 表示禁用。
   */
  fallbackRootFor?: (distro: string) => string | null
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

/** UNC 主根解析：wsl.localhost（Win10 2004+）；不可达时经 defaultFallbackRootFor 回退 wsl$ */
export function defaultRootFor(distro: string): string {
  return `\\\\wsl.localhost\\${distro}`
}

/** 备用根：旧共享路径 `\\wsl$\<distro>`（主根失败时回退一次，两根都失败才抛错） */
export function defaultFallbackRootFor(distro: string): string {
  return `\\\\wsl$\\${distro}`
}

function isBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 8192))
  return sample.includes(0)
}

/** UNC 不可达类错误（主根失败时才值得换备用根重试；语义错误如 ENOTDIR 不在其列） */
function isRootUnreachable(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException
  const code = err?.code ?? ''
  if (
    ['ENOENT', 'EACCES', 'EPERM', 'ENOTCONN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes(
      code,
    )
  ) {
    return true
  }
  const msg = String(err?.message ?? '')
  return /UNC|network path|找不到网络|not reachable/i.test(msg)
}

interface RootAttempt {
  root: string
  error: unknown
}

/** 两根都试过时的失败说明（错误信息如实列出每个根与各自的失败原因） */
function attemptsDetail(tried: RootAttempt[]): string {
  return tried
    .map(({ root, error }) => {
      const msg = error instanceof Error ? error.message : String(error)
      return `已尝试 ${root} → ${msg}`
    })
    .join('\n')
}

/** 多根都失败时消息尾注（单根失败保持原消息，不谎报"两个根"） */
function triedSuffix(tried: RootAttempt[]): string {
  return tried.length > 1 ? `（已尝试 ${tried.map((t) => t.root).join(' 与 ')}）` : ''
}

export function createFsBridge(deps: FsBridgeDeps): FsBridge {
  const sep = deps.sep ?? '\\'
  const rootFor = deps.rootFor ?? defaultRootFor
  // 自定义 rootFor（测试/特殊环境）下 wsl$ 备用根不再适用：需显式传 fallbackRootFor 才启用回退
  const fallbackRootFor = deps.fallbackRootFor ?? (deps.rootFor ? null : defaultFallbackRootFor)
  const readDirLimit = deps.readDirLimit ?? READDIR_LIMIT

  /** 在指定根下解析 Linux 路径；根内校验按实际使用的根生效（两个根各校验一次） */
  function resolveIn(root: string, linuxPath: string): { abs: string; linux: string } {
    const abs = joinDistroPath(root, linuxPath, sep)
    // 根内校验：解析结果必须以根前缀开头（防 rootFor/sep 注入类逃逸）
    const normRoot = root.replace(/[/\\]+$/, '')
    if (abs !== normRoot && !abs.startsWith(normRoot + sep)) {
      throw createAppError('IO_ERROR', { message: '路径逃逸被拒绝', detail: abs })
    }
    return { abs, linux: parseLinuxPath(linuxPath).linuxPath }
  }

  /**
   * 主根操作失败且属 UNC 不可达类错误 → 用备用根重试一次；两根都失败由 mapError 生成合并错误。
   * 语义错误（路径逃逸 / 超限 / 不是文件等 AppError）原样抛出，绝不借回退绕过校验。
   */
  async function withFallback<T>(
    name: string,
    run: (root: string) => Promise<T>,
    mapError: (err: unknown, tried: RootAttempt[]) => ReturnType<typeof createAppError>,
  ): Promise<T> {
    const primary = rootFor(name)
    const tried: RootAttempt[] = []
    try {
      return await run(primary)
    } catch (e) {
      if (isAppError(e)) throw e
      tried.push({ root: primary, error: e })
      const fallback = fallbackRootFor ? fallbackRootFor(name) : null
      if (!isRootUnreachable(e) || !fallback || fallback === primary) {
        throw mapError(e, tried)
      }
      deps.logger.warn('fs root unreachable, retrying fallback root', {
        distro: name,
        primary,
        fallback,
      })
      try {
        return await run(fallback)
      } catch (e2) {
        if (isAppError(e2)) throw e2
        tried.push({ root: fallback, error: e2 })
        throw mapError(e2, tried)
      }
    }
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
      const name = assertSafeDistroName(distro)
      const linux = parseLinuxPath(linuxPath).linuxPath
      const { abs, dirents } = await withFallback(
        name,
        async (root) => {
          const r = resolveIn(root, linuxPath)
          return { abs: r.abs, dirents: await fs.readdir(r.abs, { withFileTypes: true }) }
        },
        (err, tried) => {
          const errno = (err as NodeJS.ErrnoException)?.code
          if (errno === 'ENOENT') {
            return createAppError('IO_ERROR', {
              message: `目录不存在：${linux}${triedSuffix(tried)}`,
              detail: attemptsDetail(tried),
              suggestion:
                tried.length > 1
                  ? '请确认发行版已启动（wsl.localhost 与 wsl$ 共享都需要发行版在运行）'
                  : '请确认发行版已启动（wsl.localhost 共享需要发行版在运行）',
            })
          }
          if (errno === 'ENOTDIR') {
            return createAppError('IO_ERROR', {
              message: `不是目录：${linux}${triedSuffix(tried)}`,
              detail: attemptsDetail(tried),
            })
          }
          return createAppError('IO_ERROR', {
            message: `无法读取目录：${linux}${triedSuffix(tried)}`,
            detail: attemptsDetail(tried),
          })
        },
      )

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
      const name = assertSafeDistroName(distro)
      const linux = parseLinuxPath(linuxPath).linuxPath
      return withFallback(
        name,
        async (root) => {
          const { abs } = resolveIn(root, linuxPath)
          const st = await fs.stat(abs)
          if (!st.isFile()) {
            throw createAppError('IO_ERROR', { message: `不是文件：${linux}`, detail: abs })
          }
          const truncated = st.size > READ_LIMIT
          const fh = await fs.open(abs, 'r')
          try {
            const size = Math.min(st.size, READ_LIMIT)
            const buf = Buffer.alloc(size)
            // 9p/UNC 会短读（stat 与 read 之间文件还可能被截断）：
            // 必须按 bytesRead 裁剪，否则尾部补零会把纯文本误判成二进制（review M-9）
            const bytesRead = size > 0 ? (await fh.read(buf, 0, size, 0)).bytesRead : 0
            const body = buf.subarray(0, bytesRead)
            if (isBinary(body)) {
              return { text: '', sizeBytes: st.size, truncated, binary: true }
            }
            return {
              text: body.toString('utf8'),
              sizeBytes: st.size,
              truncated,
              binary: false,
            }
          } finally {
            await fh.close()
          }
        },
        (err, tried) => {
          const errno = (err as NodeJS.ErrnoException)?.code
          return createAppError('IO_ERROR', {
            message: `${errno === 'ENOENT' ? '文件不存在' : '无法读取文件'}：${linux}${triedSuffix(tried)}`,
            detail: attemptsDetail(tried),
          })
        },
      )
    },

    async write(distro, linuxPath, data) {
      const name = assertSafeDistroName(distro)
      const linux = parseLinuxPath(linuxPath).linuxPath
      const body = String(data ?? '')
      await withFallback(
        name,
        async (root) => {
          const { abs } = resolveIn(root, linuxPath)
          if (Buffer.byteLength(body, 'utf8') > WRITE_LIMIT) {
            throw createAppError('IO_ERROR', { message: '文件超过 4MB 写入上限' })
          }
          await atomicWrite(abs, body)
        },
        (_err, tried) =>
          createAppError('IO_ERROR', {
            message: `写入失败：${linux}${triedSuffix(tried)}`,
            detail: attemptsDetail(tried),
            suggestion:
              tried.length > 1
                ? '请确认发行版已启动且两个共享根都可写（9p 共享）'
                : '请确认发行版已启动且目标目录可写（9p 共享）',
          }),
      )
      deps.logger.info('fs write', { distro, linux, bytes: Buffer.byteLength(body, 'utf8') })
    },

    async revealInExplorer(distro, linuxPath) {
      const name = assertSafeDistroName(distro)
      const abs = await withFallback(
        name,
        async (root) => {
          const r = resolveIn(root, linuxPath)
          await fs.stat(r.abs)
          return r.abs
        },
        (_err, tried) =>
          createAppError('IO_ERROR', {
            message: `路径不存在或不可访问${triedSuffix(tried)}`,
            detail: attemptsDetail(tried),
            suggestion: '请确认发行版已启动',
          }),
      )
      await reveal(abs)
    },
  }
}
