import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 原子写文件：写临时文件 → fsync → rename。
 * 绝不原地截断写，防崩溃导致空文件；
 * 失败时清理 tmp 并重试一次 rename（Windows 目标被占用常见 EPERM — review M7）。
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  try {
    const fh = await fs.open(tmp, 'w')
    try {
      await fh.writeFile(content, 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    try {
      await fs.rename(tmp, filePath)
    } catch (e) {
      // Windows：目标被编辑器/杀毒占用 → 稍候重试一次
      const code = (e as NodeJS.ErrnoException)?.code
      if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
        await new Promise((r) => setTimeout(r, 50))
        await fs.rename(tmp, filePath)
      } else {
        throw e
      }
    }
  } catch (e) {
    // 失败不留垃圾 tmp（review M7）
    await fs.unlink(tmp).catch(() => {})
    throw e
  }
}
