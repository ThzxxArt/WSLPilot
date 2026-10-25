import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

  it('结构化请求 → 命令行 base64 载荷 → 读取结果（成功路径）', async () => {
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

    // 载荷经命令行 base64 传入（UAC 期间临时文件不可信），绝不携带 program/args
    const [program, args] = runTool.mock.calls[0]!
    const command = String(args.at(-1))
    expect(command).toContain('-PayloadBase64')
    expect(command).not.toContain('request.json')
    const encoded = /-PayloadBase64 ''([A-Za-z0-9+/=]+)''/.exec(command)?.[1]
    expect(encoded).toBeTruthy()
    const payload = JSON.parse(Buffer.from(encoded!, 'base64').toString('utf8'))
    expect(payload.v).toBe(2)
    expect(payload.ops).toEqual([{ op: 'usbipd.bind', params: { busId: '1-2' } }])
    expect(JSON.stringify(payload)).not.toContain('"args"')
    // 启动器是 powershell Start-Process -Verb RunAs（UAC）
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
  it('脚本内嵌 op→program 白名单，argv 由 op+params 重建（不接受 payload program/args）', () => {
    const script = buildElevationHelperScript()
    for (const [op, program] of Object.entries(ELEVATION_PROGRAMS)) {
      expect(script).toContain(op)
      expect(script).toContain(program)
    }
    expect(script).toContain('op not allowed')
    expect(script).toContain('function Build-Args')
    expect(script).toContain('Assert-DistroName')
    // 明确不接受 program/args（UAC 期间临时文件不可信；载荷走命令行）
    expect(script).not.toContain('$item.program')
    expect(script).not.toContain('$item.args')
    expect(script).toContain('& $program @argList')
    expect(script).toContain('ConvertFrom-Json')
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

  it('wsl.exe 分支切换 OutputEncoding=Unicode（UTF-16LE 输出不再乱码）', () => {
    const script = buildElevationHelperScript()
    // wsl.exe 用 Unicode，其余程序恢复默认
    expect(script).toContain('[System.Text.Encoding]::Unicode')
    expect(script).toContain('[System.Text.Encoding]::Default')
    expect(script).toContain("[System.IO.Path]::GetFileName($program) -ieq 'wsl.exe'")
    // 保存/还原 $prevEnc，且还原在 finally 里
    expect(script).toContain('$prevEnc = [Console]::OutputEncoding')
    expect(script).toContain('[Console]::OutputEncoding = $prevEnc')
    // stderr 临时文件按同一编码读取
    expect(script).toContain('ReadAllText($errTmp, [Console]::OutputEncoding)')
    // 顺序：编码切换必须发生在命令执行之前，还原必须在执行之后
    const encAt = script.indexOf('[System.Text.Encoding]::Unicode')
    const invokeAt = script.indexOf('& $program @argList')
    const restoreAt = script.indexOf('[Console]::OutputEncoding = $prevEnc')
    expect(encAt).toBeGreaterThan(-1)
    expect(encAt).toBeLessThan(invokeAt)
    expect(restoreAt).toBeGreaterThan(invokeAt)
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
    // 提权进程只执行哈希匹配的脚本，避免 UAC 期间临时脚本被替换
    const expectedHash = createHash('sha256').update(String(scriptWrite![1]), 'utf8').digest('hex')
    expect(String(runTool.mock.calls[0]![1].at(-1))).toContain(expectedHash)
    expect(String(runTool.mock.calls[0]![1].at(-1))).toContain('ReadAllBytes')
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
    // 提权进程先校验脚本 SHA-256，再从内存执行；路径整体在 PS 单引号内，空格不被拆开
    expect(command).toMatch(/wslpilot elev [^']*helper\.ps1/)
    expect(command).toContain('ReadAllBytes')
    expect(command).toContain('SHA256')
    expect(command).toContain('ScriptBlock')
    expect(command).not.toMatch(/-File\s/)
    expect(command).toContain('-PayloadBase64')
    expect(command).not.toContain('request.json')
    expect(command).toMatch(/wslpilot elev [^']*result\.json/)
    // -FilePath 是参数值，只做 PS 单引号定界，**不得**内嵌双引号
    // （否则 FileName 为字面 `"powershell.exe"`，Start-Process 找不到文件 — 回验修复）
    expect(command).toContain("-FilePath 'powershell.exe'")
    expect(command).not.toContain('-FilePath \'"')
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
    // 真实 fs：临时文件真的落盘，才能观测「有物可清 → 清完为空」
    // （全 mock 下 readdir 恒空 — 此前断言捕获不到任何清理行为）
    const fsLike = {
      writeFile: vi.fn(async (path: string, content: string) => {
        writeFileSync(path, content)
      }),
      readFile: vi.fn(async (path: string) => readFileSync(path, 'utf8')),
      rm: vi.fn(async (path: string) => {
        rmSync(path, { force: true })
      }),
    }
    let duringRun: string[] = []
    const runTool = vi.fn(async () => {
      // 运行中途：提权工作目录真实存在且 helper/result 已落盘（载荷不再落盘）
      duringRun = readdirSync(spaceRoot).flatMap((d) => readdirSync(join(spaceRoot, d)))
      return { stdout: '', stderr: '', code: 0 }
    })
    const client = createElevationClient({ logger, runTool, tempRoot: spaceRoot }, fsLike)
    await client.run([bindReq])
    expect(duringRun.sort()).toEqual(['helper.ps1', 'result.json'])
    expect(readdirSync(spaceRoot)).toEqual([])

    // 失败路径（结果 JSON 损坏）同样清理
    fsLike.readFile.mockResolvedValueOnce('not-json{{')
    duringRun = []
    await client.run([bindReq])
    expect(duringRun.sort()).toEqual(['helper.ps1', 'result.json'])
    expect(readdirSync(spaceRoot)).toEqual([])
  })
})
