import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createElevationClient,
  isUacCanceled,
  parseResultJson,
  type ElevationClientDeps,
} from '../../src/main/elevation/client'
import { buildElevationHelperScript } from '../../src/main/elevation/helper-script'
import { ELEVATION_PROGRAMS, type ElevationRequest } from '@wslpilot/shared'

const logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  setLevel: vi.fn(),
}

function makeFs() {
  return {
    writeFile: vi.fn(async (_path: string, _content: string) => undefined),
    readFile: vi.fn(async (_path: string) => ''),
    rm: vi.fn(async (_path: string) => undefined),
  }
}

const bindReq: ElevationRequest = { op: 'usbipd.bind', params: { busId: '1-2' } }

describe('提权客户端（ElevationHelper §14.3）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('结构化请求 → 临时请求文件 → 读取结果（成功路径）', async () => {
    const fsLike = makeFs()
    fsLike.readFile.mockResolvedValue(
      JSON.stringify({
        canceled: false,
        results: [{ op: 'usbipd.bind', ok: true, code: 0, stdout: 'bound', stderr: '' }],
      }),
    )
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool } as ElevationClientDeps, fsLike)
    const res = await client.run([bindReq])
    expect(res.canceled).toBe(false)
    expect(res.results[0]!.ok).toBe(true)
    expect(res.results[0]!.stdout).toBe('bound')

    // 请求文件必须是结构化载荷（op + program + args），不是任意命令行
    const requestWrite = fsLike.writeFile.mock.calls.find((c) =>
      String(c[0]).endsWith('request.json'),
    )
    expect(requestWrite).toBeTruthy()
    const payload = JSON.parse(String(requestWrite![1]))
    expect(payload.v).toBe(1)
    expect(payload.ops).toEqual([
      { op: 'usbipd.bind', program: 'usbipd.exe', args: ['bind', '--busid', '1-2'] },
    ])
    // 启动器是 powershell Start-Process -Verb RunAs（UAC）
    const [program, args] = runTool.mock.calls[0]!
    expect(program).toBe('powershell.exe')
    expect(String(args.join(' '))).toContain('-Verb RunAs')
    expect(String(args.join(' '))).toContain('-Wait')
  })

  it('UAC 取消 → canceled（非错误）', async () => {
    const fsLike = makeFs()
    fsLike.readFile.mockResolvedValue('')
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: '',
      stderr: 'The operation was canceled by the user.',
      code: 1,
    }))
    const client = createElevationClient({ logger, runTool } as ElevationClientDeps, fsLike)
    const res = await client.run([bindReq])
    expect(res.canceled).toBe(true)
    expect(res.results).toEqual([])
  })

  it('无结果且非取消 → error 结果', async () => {
    const fsLike = makeFs()
    fsLike.readFile.mockResolvedValue('')
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: '',
      stderr: 'powershell missing',
      code: -1,
    }))
    const client = createElevationClient({ logger, runTool } as ElevationClientDeps, fsLike)
    const res = await client.run([bindReq])
    expect(res.canceled).toBe(false)
    expect(res.error).toContain('powershell missing')
  })

  it('结果 JSON 损坏 → 解析失败错误（不吞错）', async () => {
    const fsLike = makeFs()
    fsLike.readFile.mockResolvedValue('not-json{{')
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool } as ElevationClientDeps, fsLike)
    const res = await client.run([bindReq])
    expect(res.error).toBe('提权结果解析失败')
  })

  it('runOne：取消 UAC → PERMISSION_DENIED', async () => {
    const fsLike = makeFs()
    fsLike.readFile.mockResolvedValue('')
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: '',
      stderr: '已取消',
      code: 1,
    }))
    const client = createElevationClient({ logger, runTool } as ElevationClientDeps, fsLike)
    await expect(client.runOne(bindReq)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  })

  it('runOne：执行失败 → 返回逐操作结果（调用方映射错误）', async () => {
    const fsLike = makeFs()
    fsLike.readFile.mockResolvedValue(
      JSON.stringify({
        canceled: false,
        results: [{ op: 'usbipd.bind', ok: false, code: 1, stdout: '', stderr: 'denied' }],
      }),
    )
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool } as ElevationClientDeps, fsLike)
    const r = await client.runOne(bindReq)
    expect(r.ok).toBe(false)
    expect(r.stderr).toBe('denied')
  })

  it('非法请求在提权前被拒（白名单先于 UAC）', async () => {
    const fsLike = makeFs()
    const runTool = vi.fn(async (_program: string, _args: string[]) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool } as ElevationClientDeps, fsLike)
    await expect(client.run([{ op: 'exec' as never, params: {} }])).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
    expect(runTool).not.toHaveBeenCalled()
  })

  it('parseResultJson 形状容错', () => {
    const reqs = [bindReq]
    const ok = parseResultJson(
      JSON.stringify({
        canceled: true,
        results: [{ op: 'usbipd.bind', ok: true, code: 0, stdout: 'a', stderr: '' }],
      }),
      reqs,
    )
    expect(ok.canceled).toBe(true)
    expect(ok.results[0]!.op).toBe('usbipd.bind')

    // 缺项 → 按失败填充
    const partial = parseResultJson(JSON.stringify({ canceled: false, results: [] }), reqs)
    expect(partial.results[0]!.ok).toBe(false)
    expect(partial.results[0]!.code).toBe(-1)

    expect(parseResultJson('x', reqs).error).toBe('提权结果解析失败')
  })

  it('isUacCanceled 识别中英文', () => {
    expect(isUacCanceled('The operation was canceled by the user')).toBe(true)
    expect(isUacCanceled('操作被用户取消')).toBe(true)
    expect(isUacCanceled('other')).toBe(false)
  })
})

describe('提权 Helper 脚本（纵深防御）', () => {
  it('脚本内嵌 op→program 白名单且拒绝未知 op / program 不匹配', () => {
    const script = buildElevationHelperScript()
    for (const [op, program] of Object.entries(ELEVATION_PROGRAMS)) {
      expect(script).toContain(op)
      expect(script).toContain(program)
    }
    expect(script).toContain('op not allowed')
    expect(script).toContain('program mismatch')
    // 参数数组 splat 调用，不经 shell 拼接
    expect(script).toContain('& $program @argList')
    expect(script).toContain('ConvertFrom-Json')
    // 结果落盘供主进程读取
    expect(script).toContain('$ResultFile')
  })
})
