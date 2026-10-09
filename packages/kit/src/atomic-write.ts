import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * 原子写文件：写临时文件 → fsync → rename。
 * 绝不原地截断写，防崩溃导致空文件。
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, `.${randomUUID()}.tmp`)
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(content, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fs.rename(tmp, filePath)
}
