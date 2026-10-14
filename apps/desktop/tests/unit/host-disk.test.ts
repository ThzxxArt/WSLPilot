import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { createHostDiskReader, HOST_DISK_TTL_MS } from '../../src/main/services/host-disk'

describe('createHostDiskReader（0.1.3 宿主磁盘占用）', () => {
  it('命中 ext4.vhdx 返回字节数（读取的是 BasePath 下的 ext4.vhdx）', async () => {
    const stat = vi.fn(async () => ({ size: 123456789 }))
    const reader = createHostDiskReader({ stat })
    expect(await reader.read('C:\\WSL\\Ubuntu')).toBe(123456789)
    expect(stat).toHaveBeenCalledWith(join('C:\\WSL\\Ubuntu', 'ext4.vhdx'))
  })

  it('TTL 缓存：窗口内不重复 stat；过期后重新读取', async () => {
    let t = 0
    const stat = vi.fn(async () => ({ size: 100 }))
    const reader = createHostDiskReader({ stat, now: () => t })
    await reader.read('D:\\WSL\\U')
    await reader.read('D:\\WSL\\U')
    expect(stat).toHaveBeenCalledTimes(1)
    t += HOST_DISK_TTL_MS - 1
    await reader.read('D:\\WSL\\U')
    expect(stat).toHaveBeenCalledTimes(1)
    t += 2
    await reader.read('D:\\WSL\\U')
    expect(stat).toHaveBeenCalledTimes(2)
  })

  it('文件缺失/权限不足 → undefined 且缓存该结果（不阻断列表）', async () => {
    const stat = vi.fn(async () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    const reader = createHostDiskReader({ stat })
    expect(await reader.read('C:\\WSL\\WSL1')).toBeUndefined()
    expect(await reader.read('C:\\WSL\\WSL1')).toBeUndefined()
    // 失败结果同样进入缓存（窗口内不重复失败 IO）
    expect(stat).toHaveBeenCalledTimes(1)
  })

  it('basePath 缺失/空 → undefined 且不触碰文件系统', async () => {
    const stat = vi.fn(async () => ({ size: 1 }))
    const reader = createHostDiskReader({ stat })
    expect(await reader.read(undefined)).toBeUndefined()
    expect(await reader.read('   ')).toBeUndefined()
    expect(stat).not.toHaveBeenCalled()
  })
})
