import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createElevationClient,
  isUacCanceled,
  parseResultJson,
  ELEVATION_TIMEOUT_MS,
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
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
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
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
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
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
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
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
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
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
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
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
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
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
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

  it('校验（白名单拒绝）必须发生在命令执行之前（纵深防御顺序）', () => {
    const script = buildElevationHelperScript()
    const guardAt = script.indexOf('op not allowed')
    const invokeAt = script.indexOf('& $program @argList')
    expect(guardAt).toBeGreaterThan(-1)
    expect(invokeAt).toBeGreaterThan(-1)
    expect(guardAt).toBeLessThan(invokeAt)
    // 白名单 JSON 与 shared 同源（禁止脚本内另抄一份）
    expect(script).toContain(JSON.stringify(ELEVATION_PROGRAMS))
  })
})

describe('提权客户端启动器细节（review 根治回归）', () => {
  const bindReq: ElevationRequest = { op: 'usbipd.bind', params: { busId: '1-2' } }
  let spaceRoot = ''

  beforeEach(() => {
    vi.clearAllMocks()
    spaceRoot = mkdtempSync(join(tmpdir(), 'wslpilot elev '))
  })

  afterEach(() => {
    rmSync(spaceRoot, { recursive: true, force: true })
  })

  function makeFs() {
    return {
      writeFile: vi.fn(async (_path: string, _content: string) => undefined),
      readFile: vi.fn(async (_path: string) =>
        JSON.stringify({
          canceled: false,
          results: [{ op: 'usbipd.bind', ok: true, code: 0, stdout: 'ok', stderr: '' }],
        }),
      ),
      rm: vi.fn(async (_path: string) => undefined),
    }
  }

  it('helper.ps1 带 UTF-8 BOM（PowerShell 5.1 否则按 ANSI 解码）', async () => {
    const fsLike = makeFs()
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool, tempRoot: spaceRoot }, fsLike)
    await client.run([bindReq])
    const scriptWrite = fsLike.writeFile.mock.calls.find((c) => String(c[0]).endsWith('helper.ps1'))
    expect(scriptWrite).toBeTruthy()
    expect(String(scriptWrite![1]).startsWith('\ufeff')).toBe(true)
  })

  it('含空格的临时目录：ArgumentList 元素自带双引号（空格路径不被拆开）', async () => {
    const fsLike = makeFs()
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool, tempRoot: spaceRoot }, fsLike)
    await client.run([bindReq])
    const command = String(runTool.mock.calls[0]![1].at(-1))
    // 双引号包住完整路径（含空格部分整体在引号内）— 此前单引号只定界 PS 源码，子进程拆路径
    expect(command).toMatch(/'"[^"]*wslpilot elev [^"]*helper\.ps1"'/)
    expect(command).toMatch(/'"[^"]*request\.json"'/)
    expect(command).toMatch(/'"[^"]*result\.json"'/)
  })

  it('UAC 超时按 ELEVATION_TIMEOUT_MS 透传', async () => {
    const fsLike = makeFs()
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool, tempRoot: spaceRoot }, fsLike)
    await client.run([bindReq])
    expect(runTool.mock.calls[0]![2]).toEqual({ timeoutMs: ELEVATION_TIMEOUT_MS })
  })

  it('run 结束后提权工作目录被清空（含失败路径 — 用完即焚）', async () => {
    const fsLike = makeFs()
    const runTool = vi.fn(async (_program: string, _args: string[], _opts?: unknown) => ({
      stdout: '',
      stderr: '',
      code: 0,
    }))
    const client = createElevationClient({ logger, runTool, tempRoot: spaceRoot }, fsLike)
    await client.run([bindReq])
    expect(readdirSync(spaceRoot)).toEqual([])

    // 失败路径（结果 JSON 损坏）同样清理
    fsLike.readFile.mockResolvedValueOnce('not-json{{')
    await client.run([bindReq])
    expect(readdirSync(spaceRoot)).toEqual([])
  })
})
