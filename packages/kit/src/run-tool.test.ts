import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: vi.fn(),
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>()
  return {
    ...actual,
    // 与 exec-wsl.run.test 同一套路：promisify(execFile) 需要显式 promise 封装
    promisify: (fn: unknown) => {
      if (fn === mockExecFile) {
        return (cmd: string, args: string[], opts: unknown) =>
          new Promise((resolve, reject) => {
            mockExecFile(cmd, args, opts, (err: unknown, stdout: Buffer, stderr: Buffer) => {
              if (err) {
                const e = err as { stdout?: Buffer; stderr?: Buffer }
                e.stdout = stdout
                e.stderr = stderr
                reject(err)
              } else {
                resolve({ stdout, stderr })
              }
            })
          })
      }
      return actual.promisify(fn as never)
    },
  }
})

const { runTool } = await import('../src/run-tool')

describe('runTool', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  it('成功执行并解码输出', async () => {
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: unknown, cb: (e: unknown, o: Buffer, s: Buffer) => void) => {
        cb(null, Buffer.from('0.0.0.0 3000 127.0.0.1 3000', 'utf8'), Buffer.alloc(0))
      },
    )
    const r = await runTool('netsh.exe', ['interface', 'portproxy', 'show', 'all'])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('3000')
    expect(r.stderr).toBe('')
    expect(mockExecFile.mock.calls[0]![0]).toBe('netsh.exe')
    expect(mockExecFile.mock.calls[0]![1]).toEqual(['interface', 'portproxy', 'show', 'all'])
  })

  it('失败时返回 code 并解码 stderr（含 message 兜底）', async () => {
    const err: Error & { code?: number } = new Error('spawn ENOENT')
    err.code = -1
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(err, Buffer.alloc(0), Buffer.alloc(0))
    })
    const r = await runTool('missing.exe', ['x'])
    expect(r.code).toBe(-1)
    expect(r.stderr).toContain('spawn ENOENT')
  })

  it('stderr 缺失时保留 message（提权文案可被上层识别）', async () => {
    const err: Error & { code?: number } = new Error('请求的操作需要提升')
    err.code = 5
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(err, Buffer.alloc(0), Buffer.alloc(0))
    })
    const r = await runTool('netsh.exe', ['x'])
    expect(r.code).toBe(5)
    expect(r.stderr).toContain('需要提升')
  })

  it('超时选项透传', async () => {
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: { timeout?: number }, cb: any) => {
        cb(null, Buffer.alloc(0), Buffer.alloc(0))
      },
    )
    await runTool('usbipd.exe', ['--version'], { timeoutMs: 1234 })
    // Node execFile 的超时字段名为 timeout（runTool 的 RunToolOptions.timeoutMs 映射到它）
    expect(mockExecFile.mock.calls[0]![2]).toMatchObject({
      timeout: 1234,
      windowsHide: true,
      encoding: 'buffer',
    })
  })
})
