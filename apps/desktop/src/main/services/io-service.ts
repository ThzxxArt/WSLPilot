import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  assertSafeDistroName,
  createAppError,
  exportFileName,
  backupFileRegex,
  isBackupFileName,
  isElevationError,
  ELEVATION_OP_LABEL,
  ELEVATION_SUGGESTION,
  formatBytes,
  type BackupFileInfo,
  type BackupFormat,
  type ElevationOpResult,
  type ElevationRequest,
  type IoExportRequest,
  type IoImportRequest,
  type IoMoveRequest,
} from '@wslpilot/shared'
import { expandEnv, getRawCommand, runWsl, spawnWsl, type Logger } from '@wslpilot/kit'
import type { WslService } from './wsl-service'
import type { RegistryService } from './registry-service'
import type { TaskControl } from './task-runner'
import { spawnWslTask, type SpawnWslFn } from './spawn-task'

export type { SpawnWslFn }

export interface IoSettingsReader {
  loadSync(key: 'settings'): {
    backup: {
      defaultDir: string
      format: BackupFormat
      keepRecent: number
      autoBackupBeforeDestructive: boolean
    }
  }
}

export interface IoServiceDeps {
  logger: Logger
  wsl: Pick<WslService, 'list' | 'terminate'>
  registry: Pick<RegistryService, 'detail'>
  configService: IoSettingsReader
  spawnFn?: SpawnWslFn
  /** 递归目录统计的条目上限（防超大目录拖死） */
  dirWalkLimit?: number
  /** 提权助手（M7）：`wsl --manage --move` 权限不足时改由独立提权进程执行（§14.3） */
  elevation?: { runOne(req: ElevationRequest): Promise<ElevationOpResult> }
}

export interface IoService {
  runExport(req: IoExportRequest, ctl: TaskControl): Promise<BackupFileInfo>
  runImport(req: IoImportRequest, ctl: TaskControl): Promise<void>
  runMove(req: IoMoveRequest, ctl: TaskControl): Promise<void>
  listBackups(dir?: string): Promise<BackupFileInfo[]>
  /** 按保留份数清理全部旧备份（清理按钮 — 零半成品） */
  cleanupBackups(dir: string | undefined, keep: number): Promise<{ removed: number }>
  /** 解析备份默认目录（展开 %USERPROFILE% 等） */
  resolveBackupDir(): string
  /** 备份文件轮转：按命名规范保留最近 keep 份 */
  rotateBackups(dir: string, name: string, keep: number): Promise<number>
}

// ─────────────────────── 纯函数助手（可单测） ───────────────────────

/** 规范化目标文件路径：展开环境变量 → 绝对路径 → 纠正/补齐扩展名（review M12） */
export function resolveTargetFile(input: string, format: BackupFormat): string {
  const expanded = expandEnv(String(input ?? '').trim())
  let p = resolve(expanded)
  const want = format === 'vhd' ? '.vhdx' : '.tar'
  const lower = p.toLowerCase()
  if (format === 'vhd') {
    // `.vhd` 一并归一为 `.vhdx`：否则该备份永远不被 listBackups / 轮转识别（幽灵文件 — review 根治）
    if (lower.endsWith('.tar') || lower.endsWith('.vhd')) {
      return `${p.replace(/\.(tar|vhd)$/i, '')}${want}`
    }
    if (!lower.endsWith('.vhdx')) p = `${p}${want}`
    return p
  }
  if (lower.endsWith('.vhdx') || lower.endsWith('.vhd')) {
    return p.replace(/\.(vhdx|vhd)$/i, want)
  }
  if (!lower.endsWith('.tar')) p = `${p}${want}`
  return p
}

/** 字节进度 → 百分比；总量未知返回 null（设计书：无法估算时 percent = null） */
export function percentOf(current: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  if (!Number.isFinite(current) || current <= 0) return 0
  // 封顶 99：100% 只由任务成功给出，避免"假满格"
  return Math.min(99, Math.floor((current / total) * 100))
}

/** 路径安全校验：拒绝控制字符；返回展开后的绝对路径 */
export function assertSafeIoPath(input: string, label = '路径'): string {
  const s = String(input ?? '').trim()
  if (!s) {
    throw createAppError('IO_ERROR', { message: `${label}不能为空` })
  }
  // eslint-disable-next-line no-control-regex -- 有意匹配控制字符作为非法输入
  if (/[\u0000-\u001f\u007f]/.test(s)) {
    throw createAppError('IO_ERROR', { message: `${label}包含非法控制字符` })
  }
  return resolve(expandEnv(s))
}

/**
 * 生成一个**规范备份名**（`<name>_<YYYYMMDD-HHmmss>.<ext>`）且不与目录内现有文件冲突。
 * 覆盖保护的保留副本必须用这个命名，才能被 listBackups / rotateBackups / cleanupBackups 认出来；
 * 否则退化成永远删不掉也看不见的幽灵文件（review M-6 根治）。
 */
export function uniqueBackupName(
  dir: string,
  name: string,
  format: BackupFormat,
  at: Date = new Date(),
  exists: (p: string) => boolean = existsSync,
): string {
  for (let i = 0; i < 1000; i++) {
    const stamp = new Date(at.getTime() + i * 1000)
    const candidate = join(dir, exportFileName(name, format, stamp))
    if (!exists(candidate)) return candidate
  }
  // 理论不可达；兜底保证唯一（1000 秒内同名备份不现实）
  return join(dir, exportFileName(name, format, new Date(at.getTime() + 86_400_000)))
}

// ─────────────────────── 服务实现 ───────────────────────

export function createIoService(deps: IoServiceDeps): IoService {
  const { logger, wsl, registry, configService } = deps
  const spawnFn: SpawnWslFn = deps.spawnFn ?? spawnWsl
  const dirWalkLimit = deps.dirWalkLimit ?? 20_000

  function backupSettings() {
    return configService.loadSync('settings').backup
  }

  async function dirSizeBytes(dir: string): Promise<number> {
    let total = 0
    let walked = 0
    const walk = async (d: string): Promise<void> => {
      if (walked >= dirWalkLimit) return
      let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>
      try {
        entries = await fs.readdir(d, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (walked >= dirWalkLimit) return
        walked++
        const full = join(d, e.name)
        if (e.isDirectory()) {
          await walk(full)
        } else if (e.isFile()) {
          try {
            const st = await fs.stat(full)
            total += st.size
          } catch {
            /* 单文件失败忽略 */
          }
        }
      }
    }
    await walk(dir)
    return total
  }

  /** 源体量估算：WSL2 → ext4.vhdx；否则目录体积 */
  async function sourceSizeBytes(name: string, version: 1 | 2): Promise<number> {
    try {
      const detail = await registry.detail(name)
      const base = detail.basePath
      if (!base) return 0
      if (version === 2) {
        try {
          const st = await fs.stat(join(base, 'ext4.vhdx'))
          return st.size
        } catch {
          /* 回退目录统计 */
        }
      }
      return await dirSizeBytes(base)
    } catch {
      return 0
    }
  }

  /** 进度观察：定时取当前体量并上报 */
  function watchProgress(
    readCurrent: () => Promise<number>,
    expected: number,
    ctl: TaskControl,
    message: string,
  ): () => void {
    const timer = setInterval(() => {
      if (ctl.isCanceled()) return
      void readCurrent()
        .then((cur) => {
          if (ctl.isCanceled()) return
          const pct = percentOf(cur, expected)
          if (pct !== null) ctl.report(pct, message)
        })
        .catch(() => {
          /* stat 失败不影响任务 */
        })
    }, 500)
    // 不阻塞进程退出
    ;(timer as unknown as { unref?: () => void }).unref?.()
    return () => clearInterval(timer)
  }

  /**
   * spawn 一条 wsl.exe 长命令：流式日志 → ctl，支持取消（kill）与无输出看门狗。
   * 统一走 spawn-task 共享实现（取消语义 / 看门狗见 spawn-task.ts）。
   */
  function spawnTask(args: string[], ctl: TaskControl): Promise<void> {
    return spawnWslTask(args, ctl, logger, spawnFn)
  }

  /** 发行版名查找：WSL 名称不区分大小写（review M11） */
  async function findDistro(name: string) {
    const list = await wsl.list()
    const lower = name.toLowerCase()
    return list.find((d) => d.name.toLowerCase() === lower) ?? null
  }

  async function runExport(req: IoExportRequest, ctl: TaskControl): Promise<BackupFileInfo> {
    const name = assertSafeDistroName(req.name)
    const format: BackupFormat = req.format === 'vhd' ? 'vhd' : 'tar'
    ctl.throwIfCanceled()

    const target = await findDistro(name)
    if (!target) {
      throw createAppError('DISTRO_NOT_FOUND', { message: `找不到发行版 ${name}，无法导出` })
    }
    if (format === 'vhd' && target.version !== 2) {
      throw createAppError('TASK_FAILED', {
        message: 'vhd 格式仅支持 WSL2 发行版',
        suggestion: '请改用 tar 格式，或先把发行版转换为 WSL2',
      })
    }

    const outPath = assertSafeIoPath(req.path, '导出路径')
    const finalPath = resolveTargetFile(outPath, format)
    const parent = dirname(finalPath)
    if (parent && !existsSync(parent)) {
      await fs.mkdir(parent, { recursive: true })
    }
    // 已存在文件不静默覆盖：改名保留为**规范备份名**（安全网 — review M12）。
    // 命名必须落进 `<name>_<stamp>.<ext>` 族，否则 listBackups / rotateBackups 全都看不见它，
    // 磁盘会悄悄涨（review：`.bak-<ts>` 幽灵文件根治）。
    let preserved: string | null = null
    if (existsSync(finalPath)) {
      preserved = await uniqueBackupName(parent, name, format)
      try {
        await fs.rename(finalPath, preserved)
      } catch (e) {
        // rename 失败（文件被占用等）必须中止，绝不动原文件（核验修复）
        throw createAppError('IO_ERROR', {
          message: '目标文件存在且无法改名保留，导出已中止',
          detail: `${finalPath}: ${e instanceof Error ? e.message : String(e)}`,
          suggestion: '请关闭占用该文件的程序，或换一个导出路径',
        })
      }
      ctl.log(`目标已存在，原文件已保留为 ${basename(preserved)}`)
    }

    const args = ['--export', name, finalPath, ...(format === 'vhd' ? ['--vhd'] : [])]
    const expected = await sourceSizeBytes(name, target.version)
    ctl.log(`导出 ${name} → ${finalPath}（${format}）`)
    ctl.report(0, `正在导出 ${name}`)
    const stop = watchProgress(
      async () => {
        try {
          const st = await fs.stat(finalPath)
          return st.size
        } catch {
          return 0
        }
      },
      expected,
      ctl,
      `正在导出 ${name}`,
    )
    /**
     * 导出失败/取消的残局回滚：删掉半截归档、把保留的原文件还原回去。
     * 否则用户在规范文件名下拿到的是截断归档（后续 import 必失败），
     * 真备份被改名后还看不见 —— 静默毁数据（review C-2）。
     */
    const rollbackPartial = async (): Promise<void> => {
      await fs.unlink(finalPath).catch(() => {})
      if (preserved) {
        await fs.rename(preserved, finalPath).catch((e: unknown) => {
          logger.warn('restore preserved backup failed', {
            from: preserved,
            to: finalPath,
            error: String(e),
          })
        })
        preserved = null
      }
    }
    try {
      try {
        await spawnTask(args, ctl)
      } catch (e) {
        await rollbackPartial()
        throw e
      }
      // spawnTask 成功 = 任务成功（成功优先语义，取消信号不再改判 — 核验修复）
      const st = await fs.stat(finalPath).catch(() => null)
      if (!st) {
        await rollbackPartial()
        throw createAppError('IO_ERROR', {
          message: '导出结束但未找到输出文件',
          detail: finalPath,
          rawCommand: getRawCommand('wsl.exe', args),
        })
      }

      ctl.report(100, '导出完成')
      ctl.log(`导出完成：${finalPath}（${formatBytes(st.size)}）`)

      // 备份轮转（设计书 §12.7 保留数量）——保留副本已是规范名，自然进轮转
      const keep = backupSettings().keepRecent
      try {
        const removed = await rotateBackups(parent, name, keep)
        if (removed > 0) ctl.log(`备份轮转：已清理 ${removed} 份旧备份（保留最近 ${keep} 份）`)
      } catch (e) {
        logger.warn('rotate backups failed', { error: String(e) })
      }

      return {
        name: basename(finalPath),
        path: finalPath,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
        format,
      }
    } finally {
      stop()
    }
  }

  async function runImport(req: IoImportRequest, ctl: TaskControl): Promise<void> {
    const name = assertSafeDistroName(req.name)
    const format: BackupFormat = req.format === 'vhd' ? 'vhd' : 'tar'
    const inPlace = req.inPlace === true
    ctl.throwIfCanceled()

    const existing = await findDistro(name)
    if (existing) {
      throw createAppError('TASK_FAILED', {
        message: `已存在同名发行版 ${name}`,
        suggestion: '请换一个名称，或先注销（unregister）同名发行版',
      })
    }

    const archivePath = assertSafeIoPath(req.archivePath, '归档路径')
    const srcStat = await fs.stat(archivePath).catch(() => null)
    if (!srcStat || !srcStat.isFile()) {
      throw createAppError('IO_ERROR', {
        message: `找不到导入文件：${archivePath}`,
        suggestion: '请选择已导出的 .tar / .vhdx 备份文件',
      })
    }
    if (format === 'vhd' && !/\.(vhdx?|vhd)$/i.test(archivePath)) {
      throw createAppError('TASK_FAILED', {
        message: 'vhd 导入需要 .vhdx 文件',
        suggestion: '请改用 tar 格式导入 .tar 备份',
      })
    }

    let installPath = ''
    let createdInstallDir = false
    let args: string[]
    if (inPlace) {
      if (format !== 'vhd') {
        throw createAppError('TASK_FAILED', {
          message: '就地导入仅支持 vhd（.vhdx）文件',
          suggestion: 'tar 备份请使用「归档导入」',
        })
      }
      args = ['--import-in-place', name, archivePath]
      ctl.log(`就地导入 ${name} ← ${archivePath}`)
    } else {
      installPath = assertSafeIoPath(req.installPath, '安装位置')
      if (!existsSync(installPath)) {
        createdInstallDir = true
        await fs.mkdir(installPath, { recursive: true }).catch((e: unknown) => {
          throw createAppError('IO_ERROR', {
            message: `无法创建安装位置：${installPath}`,
            detail: e instanceof Error ? e.message : String(e),
          })
        })
      }
      args = [
        '--import',
        name,
        installPath,
        archivePath,
        ...(format === 'vhd' ? ['--vhd'] : []),
        ...(format === 'tar' ? ['--version', req.version === 1 ? '1' : '2'] : []),
      ]
      ctl.log(`导入 ${name} ← ${archivePath} → ${installPath}`)
    }

    const rawCommand = getRawCommand('wsl.exe', args)
    // 进度基数（review M19）：vhd 复制导入 1:1 可精确估算；
    // tar 解包大小未知 → 不估算（percent=null，UI 走不确定进度环）
    const expected = format === 'vhd' ? srcStat.size : 0
    ctl.report(0, `正在导入 ${name}`)
    // 导入进度：目标体量增长 ≈ 已解包体量
    const watchPath = inPlace ? '' : join(installPath, 'ext4.vhdx')
    const stop = watchProgress(
      async () => {
        if (!watchPath) return 0
        try {
          const st = await fs.stat(watchPath)
          return st.size
        } catch {
          // vhd 导入可能直接落 vhdx 以外的名字；用目录统计兜底
          return dirSizeBytes(installPath)
        }
      },
      expected,
      ctl,
      `正在导入 ${name}`,
    )
    try {
      await spawnTask(args, ctl)
    } catch (e) {
      stop()
      // 归档导入失败/取消：回滚不完整注册（就地导入绝不回滚，保护用户源 vhdx）
      if (!inPlace) {
        await rollbackImport(name, createdInstallDir ? installPath : '', ctl)
      } else {
        ctl.log('就地导入未自动回滚（保护源 vhdx）；如发行版残留请手动 wsl --unregister')
      }
      throw e
    }
    stop()
    // spawnTask 成功 = 任务成功（成功优先语义 — 核验修复）

    const after = await findDistro(name)
    if (!after) {
      throw createAppError('TASK_FAILED', {
        message: '导入命令结束但未检测到新发行版',
        rawCommand,
        suggestion: '请刷新发行版列表确认；若持续失败请查看日志抽屉中的原始输出',
      })
    }
    ctl.report(100, '导入完成')
    ctl.log(`导入完成：${name}（WSL${after.version}）`)
    void rawCommand
  }

  /** 归档导入失败回滚：注销不完整发行版 + 清理自建目录 */
  async function rollbackImport(name: string, createdDir: string, ctl: TaskControl): Promise<void> {
    try {
      const list = await wsl.list().catch(() => [])
      if (list.some((d) => d.name === name)) {
        ctl.log(`回滚：注销不完整的发行版 ${name}（wsl --unregister）`)
        const r = await runWsl(['--unregister', name])
        if (r.code !== 0) {
          ctl.log(`回滚警告：注销失败，请手动执行 wsl --unregister "${name}"`)
        }
      }
      if (createdDir) {
        const entries = await fs.readdir(createdDir).catch(() => null)
        if (entries && entries.length === 0) {
          await fs.rmdir(createdDir).catch(() => {})
          ctl.log(`回滚：已删除空的安装目录 ${createdDir}`)
        }
      }
    } catch (e) {
      logger.warn('import rollback failed', { name, error: String(e) })
    }
  }

  async function runMove(req: IoMoveRequest, ctl: TaskControl): Promise<void> {
    const name = assertSafeDistroName(req.name)
    ctl.throwIfCanceled()

    const target = await findDistro(name)
    if (!target) {
      throw createAppError('DISTRO_NOT_FOUND', { message: `找不到发行版 ${name}，无法迁移` })
    }
    if (target.state === 'Running') {
      if (!req.terminateFirst) {
        throw createAppError('DISTRO_RUNNING', {
          message: `发行版 ${name} 正在运行，无法迁移`,
          suggestion: '勾选「先终止再迁移」，或手动终止（wsl --terminate）后重试',
        })
      }
      ctl.log(`发行版运行中，先终止：wsl --terminate ${name}`)
      await wsl.terminate(name)
      ctl.report(5, '已终止发行版，准备迁移')
    }

    const newPath = assertSafeIoPath(req.path, '迁移目标位置')
    const parent = dirname(newPath)
    if (!existsSync(parent)) {
      throw createAppError('IO_ERROR', {
        message: `迁移目标的上级目录不存在：${parent}`,
        suggestion: '请先创建该目录，或选择已存在的位置',
      })
    }
    // 注册表读不到当前位置就**不能**做安全校验：静默跳过等于把破坏性操作当安全（review M-7）
    const detail = await registry.detail(name).catch((e: unknown) => {
      throw createAppError('IO_ERROR', {
        message: `无法读取 ${name} 的当前位置，迁移已中止`,
        detail: e instanceof Error ? e.message : String(e),
        suggestion: '请确认 WSL 服务（LxssManager）正常后重试',
      })
    })
    if (!detail.basePath) {
      throw createAppError('IO_ERROR', {
        message: `注册表中没有 ${name} 的安装位置，迁移已中止`,
        suggestion: '请先启动一次该发行版，或检查注册表 Lxss 项是否完整',
      })
    }
    // Windows 路径比较：大小写与分隔符归一（review M20）
    const norm = (s: string) => resolve(s).toLowerCase().replace(/\//g, '\\')
    const from = norm(detail.basePath)
    const to = norm(newPath)
    const isSame = from === to
    // 同样拒绝「包含关系」：把发行版移进自己的子目录（或反过来）会毁掉 vhdx
    const isNested = to.startsWith(`${from}\\`) || from.startsWith(`${to}\\`)
    if (isSame || isNested) {
      throw createAppError('IO_ERROR', {
        message: isSame ? '迁移目标与当前位置相同' : '迁移目标与当前位置存在包含关系，无法安全迁移',
        detail: `当前：${detail.basePath} → 目标：${newPath}`,
        suggestion: '请选择既不相同也不互为子目录的磁盘位置',
      })
    }

    // 安全兜底：破坏性操作执行前自动备份（设计书 §2.2）
    const settings = backupSettings()
    if (settings.autoBackupBeforeDestructive) {
      ctl.log('安全兜底：迁移前自动导出备份…')
      const backupPath = join(
        resolve(expandEnv(settings.defaultDir)),
        exportFileName(name, settings.format),
      )
      try {
        await runExport({ name, path: backupPath, format: settings.format }, ctl)
        ctl.log('迁移前备份完成')
      } catch (e) {
        if (ctl.isCanceled()) throw e
        throw createAppError('TASK_FAILED', {
          message: '迁移前自动备份失败，已中止迁移',
          detail: e instanceof Error ? e.message : String(e),
          suggestion: '请检查备份目录可写后重试；或在设置中关闭「破坏性操作前自动备份」',
        })
      }
      ctl.report(0, `正在迁移 ${name}`)
    }

    const args = ['--manage', name, '--move', newPath]
    const expected = await sourceSizeBytes(name, target.version)
    ctl.log(`迁移 ${name} → ${newPath}`)
    const stop = watchProgress(
      async () => {
        try {
          const st = await fs.stat(join(newPath, 'ext4.vhdx'))
          return st.size
        } catch {
          return dirSizeBytes(newPath)
        }
      },
      expected,
      ctl,
      `正在迁移 ${name}`,
    )
    try {
      await spawnTask(args, ctl)
    } catch (e) {
      stop()
      const detailText =
        e && typeof e === 'object' && 'detail' in e
          ? String((e as { detail?: string }).detail ?? '')
          : ''
      if (
        /--manage|manage/i.test(detailText) &&
        /invalid|unknown|not recognized|无效|无法识别/i.test(detailText)
      ) {
        throw createAppError('TASK_FAILED', {
          message: '当前 WSL 不支持 wsl --manage --move',
          detail: detailText,
          rawCommand: getRawCommand('wsl.exe', args),
          suggestion: '请将 WSL 更新到 2.0 及以上（wsl --update）后重试',
        })
      }
      // M7 提权接线：直接执行被拒 → 提权助手（一次 UAC；§14.3）
      if (isElevationError(detailText) && deps.elevation) {
        ctl.log(`权限不足，改由提权助手执行：${ELEVATION_OP_LABEL['wsl.move']}…`)
        deps.logger.info('wsl --move requires elevation, delegating', { name })
        const res = await deps.elevation.runOne({
          op: 'wsl.move',
          params: { name, path: newPath },
        })
        if (res.ok) {
          ctl.log('提权执行成功')
          ctl.report(100, '迁移完成')
          ctl.log(`迁移完成：${name} → ${newPath}`)
          ctl.log('提示：如需回退，可再次使用「迁移磁盘」把发行版移回原位置')
          return
        }
        throw createAppError('PERMISSION_DENIED', {
          message: `迁移 ${name} 失败：提权执行失败`,
          detail: `${res.stderr}\n${res.stdout}`.trim(),
          rawCommand: getRawCommand('wsl.exe', args),
          suggestion: ELEVATION_SUGGESTION,
        })
      }
      throw e
    }
    stop()
    // spawnTask 成功 = 任务成功（成功优先语义 — 核验修复）

    ctl.report(100, '迁移完成')
    ctl.log(`迁移完成：${name} → ${newPath}`)
    ctl.log('提示：如需回退，可再次使用「迁移磁盘」把发行版移回原位置')
  }

  function resolveBackupDir(): string {
    return resolve(expandEnv(backupSettings().defaultDir))
  }

  async function rotateBackups(dir: string, name: string, keep: number): Promise<number> {
    const re = backupFileRegex(name)
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return 0
    }
    const matched = entries
      .filter((f) => re.test(f))
      .sort()
      .reverse() // 文件名含时间戳，字典序 = 时间序
    const limit = Math.max(1, Math.floor(keep) || 1)
    const toRemove = matched.slice(limit)
    for (const f of toRemove) {
      await fs.unlink(join(dir, f)).catch(() => {})
    }
    return toRemove.length
  }

  async function listBackups(dir?: string): Promise<BackupFileInfo[]> {
    const targetDir = dir ? assertSafeIoPath(dir, '备份目录') : resolveBackupDir()
    let entries: Array<{ name: string; isFile(): boolean }>
    try {
      entries = await fs.readdir(targetDir, { withFileTypes: true })
    } catch {
      return []
    }
    const out: BackupFileInfo[] = []
    for (const e of entries) {
      if (!e.isFile()) continue
      if (!isBackupFileName(e.name) && !/\.(tar|vhdx)$/i.test(e.name)) continue
      const full = join(targetDir, e.name)
      try {
        const st = await fs.stat(full)
        out.push({
          name: e.name,
          path: full,
          sizeBytes: st.size,
          modifiedAt: st.mtime.toISOString(),
          format: /\.vhdx$/i.test(e.name) ? 'vhd' : 'tar',
        })
      } catch {
        /* 单条失败忽略 */
      }
    }
    return out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1)).slice(0, 50)
  }

  async function cleanupBackups(
    dir: string | undefined,
    keep: number,
  ): Promise<{ removed: number }> {
    const targetDir = dir ? assertSafeIoPath(dir, '备份目录') : resolveBackupDir()
    let entries: string[]
    try {
      entries = await fs.readdir(targetDir)
    } catch {
      return { removed: 0 }
    }
    // 按发行版名前缀分组（<name>_<stamp>.<ext>），逐组轮转
    const groups = new Map<string, string[]>()
    for (const f of entries) {
      if (!isBackupFileName(f)) continue
      const name = f.replace(/_[0-9]{8}-[0-9]{6}\.(tar|vhdx)$/i, '')
      const list = groups.get(name) ?? []
      list.push(f)
      groups.set(name, list)
    }
    let removed = 0
    const limit = Math.max(1, Math.floor(keep) || 1)
    for (const files of groups.values()) {
      files.sort().reverse()
      for (const f of files.slice(limit)) {
        try {
          await fs.unlink(join(targetDir, f))
          removed++
        } catch {
          /* 单文件失败忽略 */
        }
      }
    }
    return { removed }
  }

  return {
    runExport,
    runImport,
    runMove,
    listBackups,
    cleanupBackups,
    resolveBackupDir,
    rotateBackups,
  }
}
