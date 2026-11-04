import { describe, it, expect, vi } from 'vitest'
import { createUtf8LineDecoder, spawnTool } from '@wslpilot/kit'

function runNode(script: string, opts: { signal?: AbortSignal } = {}) {
  const lines: string[] = []
  const errors: Error[] = []
  const exited = new Promise<number>((resolve) => {
    spawnTool(process.execPath, ['-e', script], {
      onLine: (l) => lines.push(l),
      onExit: resolve,
      onError: (e) => errors.push(e),
      ...opts,
    })
  })
  return { lines, errors, exited }
}

describe('createUtf8LineDecoder', () => {
  it('跨 chunk 的多字节字符与 CRLF 正确切分', () => {
    const lines: string[] = []
    const d = createUtf8LineDecoder((l) => lines.push(l))
    const buf = Buffer.from('你好\r\n世界\n尾行', 'utf8')
    // 故意在 UTF-8 多字节序列中间切开
    d.push(buf.subarray(0, 2))
    d.push(buf.subarray(2, 10))
    d.push(buf.subarray(10))
    d.flush()
    expect(lines).toEqual(['你好', '世界', '尾行'])
  })

  it('flush 不丢最后无换行残行；空输入不产生行', () => {
    const lines: string[] = []
    const d = createUtf8LineDecoder((l) => lines.push(l))
    d.push(Buffer.from('only', 'utf8'))
    d.flush()
    expect(lines).toEqual(['only'])

    const lines2: string[] = []
    const d2 = createUtf8LineDecoder((l) => lines2.push(l))
    d2.push(Buffer.alloc(0))
    d2.flush()
    expect(lines2).toEqual([])
  })
})

describe('spawnTool', () => {
  it('按行上报 stdout，并在退出后 flush 残行', async () => {
    const r = runNode('process.stdout.write("a\\nb\\ntail")')
    expect(await r.exited).toBe(0)
    expect(r.lines).toEqual(['a', 'b', 'tail'])
    expect(r.errors).toEqual([])
  })

  it('stderr 合并进同一行回调', async () => {
    const r = runNode('process.stderr.write("err-line\\n")')
    expect(await r.exited).toBe(0)
    expect(r.lines).toContain('err-line')
  })

  it('非 0 退出码原样上报', async () => {
    const r = runNode('process.exit(7)')
    expect(await r.exited).toBe(7)
  })

  it('可执行文件不存在：onError 收到错误且 onExit 仍结算（不挂死）', async () => {
    const errors: Error[] = []
    const code = await new Promise<number>((resolve) => {
      spawnTool('wslpilot-no-such-tool-xyz', [], {
        onLine: () => {},
        onExit: resolve,
        onError: (e) => errors.push(e),
      })
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]!.message).toMatch(/ENOENT|not found/i)
    expect(code).toBeLessThanOrEqual(-1)
  })

  it('kill 后退出回调仍触发', async () => {
    const onExit = vi.fn()
    const handle = spawnTool(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      onLine: () => {},
      onExit,
      onError: () => {},
    })
    handle.kill()
    await vi.waitFor(() => expect(onExit).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('AbortSignal 取消会终止子进程并结算', async () => {
    const ac = new AbortController()
    const r = runNode('setTimeout(() => {}, 60000)', { signal: ac.signal })
    ac.abort()
    await expect(r.exited).resolves.toBeTypeOf('number')
  })

  it('pid 暴露且 kill 幂等（重复 kill 不抛）', async () => {
    const handle = spawnTool(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      onLine: () => {},
      onExit: () => {},
      onError: () => {},
    })
    expect(handle.pid).toBeGreaterThan(0)
    handle.kill()
    expect(() => handle.kill()).not.toThrow()
  })
})
