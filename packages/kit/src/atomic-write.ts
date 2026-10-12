import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 原子写文件：写临时文件 → fsync → rename。
 * 绝不原地截断写，防崩溃导致空文件；
 * 失败时清理 tmp 并重试 rename（Windows 目标被占用常见 EPERM — review M7）。
 * content 支持字符串（utf8）与二进制 Buffer（诊断包 zip 等产物）。
 */
export async function atomicWrite(filePath: string, content: string | Buffer): Promise<void> {
  const dir = dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  // review 0.1.2 根治：覆盖已有文件时保留其权限 mode（临时文件按默认 0o666&umask
  // 会把受限/可执行权限冲掉；stat 失败=新文件，走默认）
  let mode: number | undefined
  try {
    mode = (await fs.stat(filePath)).mode
  } catch {
    mode = undefined
  }
  try {
    const fh = await fs.open(tmp, 'w', mode)
    try {
      await fh.writeFile(content)
      await fh.sync()
    } finally {
      await fh.close()
    }
    await renameWithRetry(tmp, filePath)
    // POSIX：rename 后 fsync 父目录（目录项落盘）；Windows 不支持打开目录同步，尽力而为即可
    if (process.platform !== 'win32') {
      try {
        const dh = await fs.open(dir, 'r')
        try {
          await dh.sync()
        } finally {
          await dh.close()
        }
      } catch {
        /* 目录 fsync 失败不阻断（部分文件系统不支持） */
      }
    }
  } catch (e) {
    // 失败不留垃圾 tmp（review M7）
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}

/**
 * rename 重试（review 0.1.2 根治）：
 * Windows 下目标常被杀毒/编辑器短暂占用（EPERM/EACCES/EBUSY），
 * 改为 3 次指数退避（50/150/450ms）后仍失败才向上抛。
 */
async function renameWithRetry(tmp: string, dest: string): Promise<void> {
  const delays = [50, 150, 450]
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, dest)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code
      const retriable = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY'
      if (!retriable || attempt >= delays.length) throw e
      await new Promise((r) => setTimeout(r, delays[attempt]))
    }
  }
}
