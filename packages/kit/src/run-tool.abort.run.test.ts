import { describe, it, expect } from 'vitest'
import { runTool } from '../src/run-tool'

/**
 * 真实子进程中止（0.1.3，不收口历史遗留）：不 mock child_process ——
 * 用真实 `node` 挂起子进程验证 `signal` abort 会**真的终止进程**（Windows CI 上同验）。
 * 背景（0.1.2 遗留）：此前 abort 语义仅有 mock 透传用例，Windows 真机上
 * 「abort 是否真的杀掉子进程」无法本地完备验证；本用例以跨平台真实进程钉死。
 */
describe('runTool 真实进程中止（0.1.3 遗留收口）', () => {
  it('abort 后真实子进程被终止：aborted 标记 + 快速返回 + 非零退出', async () => {
    const ac = new AbortController()
    const started = Date.now()
    setTimeout(() => ac.abort(), 150)
    const r = await runTool(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], {
      signal: ac.signal,
      timeoutMs: 20_000,
    })
    const elapsed = Date.now() - started
    // 子进程被真正终止：不等待 30s 自然结束
    expect(elapsed).toBeLessThan(10_000)
    expect(r.aborted).toBe(true)
    expect(r.code).not.toBe(0)
  }, 20_000)

  it('未 abort 时不标记 aborted（真实正常退出）', async () => {
    const ac = new AbortController()
    const r = await runTool(process.execPath, ['-e', 'console.log("ok")'], {
      signal: ac.signal,
      timeoutMs: 10_000,
    })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('ok')
    expect(r.aborted).toBeUndefined()
  }, 15_000)
})
