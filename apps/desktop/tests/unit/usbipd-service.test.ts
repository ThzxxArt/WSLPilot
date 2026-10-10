import { describe, it, expect, vi } from 'vitest'
import {
  createUsbipdService,
  isToolMissing,
  isUnknownOptionError,
  USBIPD_INSTALL_HINT,
} from '../../src/main/services/usbipd-service'
import type { TaskControl } from '../../src/main/services/task-runner'
import { USBIPD_INSTALL_COMMAND } from '@wslpilot/shared'

function logger() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
  } as any
}

function makeCtl(): TaskControl {
  return {
    taskId: 't',
    type: 'device',
    report: vi.fn(),
    log: vi.fn(),
    isCanceled: () => false,
    throwIfCanceled: vi.fn(),
    onCancel: vi.fn(),
  }
}

type ToolResult = { code?: number; stdout?: string; stderr?: string }

function makeTool(results: ToolResult[] | ToolResult) {
  const list = Array.isArray(results) ? results : [results]
  const calls: Array<{ program: string; args: string[] }> = []
  let i = 0
  const fn = vi.fn(async (program: string, args: string[]) => {
    calls.push({ program, args })
    const r = list[Math.min(i, list.length - 1)] ?? { code: 0 }
    i++
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code ?? 0 }
  })
  return { fn, calls }
}

const LIST = [
  'Connected:',
  'BUSID  VID:PID    DEVICE                          STATE',
  '1-2    046d:c534  USB Receiver                    Not attached',
  '1-4    0bda:0129  Card Reader                     Shared',
  '2-1    0951:1666  Kingston                        Attached',
].join('\n')

describe('isToolMissing', () => {
  it('识别工具缺失报错', () => {
    expect(isToolMissing('spawn ENOENT')).toBe(true)
    expect(isToolMissing("'usbipd' is not recognized as an internal or external command")).toBe(
      true,
    )
    expect(isToolMissing('usbipd 不是内部或外部命令')).toBe(true)
    expect(isToolMissing('access denied')).toBe(false)
  })
})

describe('UsbipdService.status', () => {
  it('已安装并解析版本号', async () => {
    const tool = makeTool({ code: 0, stdout: 'usbipd-win 2.4.1' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    expect(await svc.status()).toEqual({ installed: true, version: '2.4.1' })
    expect(tool.calls[0]!.args).toEqual(['--version'])
  })

  it('未安装返回 installed=false', async () => {
    const tool = makeTool({ code: -1, stderr: 'spawn ENOENT usbipd' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    expect(await svc.status()).toEqual({ installed: false, version: '' })
  })

  it('其它失败如实报告「已安装但异常」，绝不误导重装（review 根治）', async () => {
    const tool = makeTool({ code: 1, stderr: 'weird' })
    const l = logger()
    const svc = createUsbipdService({ logger: l, runTool: tool.fn })
    const status = await svc.status()
    expect(status.installed).toBe(true)
    expect(status.version).toBe('')
    expect(status.error).toContain('weird')
    expect(l.warn).toHaveBeenCalled()
  })

  it('纯版本号输出也能解析', async () => {
    const tool = makeTool({ code: 0, stdout: '2.5.0' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    expect((await svc.status()).version).toBe('2.5.0')
  })
})

describe('UsbipdService.list', () => {
  it('解析设备清单', async () => {
    const tool = makeTool({ code: 0, stdout: LIST })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    const list = await svc.list()
    expect(list).toHaveLength(3)
    expect(list[0]!.busId).toBe('1-2')
    expect(list[1]!.state).toBe('shared')
    expect(tool.calls[0]!.args).toEqual(['list'])
  })

  it('未安装给出 winget 安装引导', async () => {
    const tool = makeTool({ code: -1, stderr: 'usbipd is not recognized' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await expect(svc.list()).rejects.toMatchObject({
      code: 'TASK_FAILED',
      suggestion: expect.stringContaining('winget install usbipd'),
    })
    expect(USBIPD_INSTALL_HINT).toBe(USBIPD_INSTALL_COMMAND)
  })

  it('其它失败映射 TASK_FAILED', async () => {
    const tool = makeTool({ code: 2, stderr: 'driver error' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await expect(svc.list()).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })
})

describe('UsbipdService 操作', () => {
  it('bind / unbind 生成参数数组并记录日志', async () => {
    const tool = makeTool({ code: 0 })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    const ctl = makeCtl()
    await svc.bind('1-4', ctl)
    await svc.unbind('1-4', ctl)
    expect(tool.calls[0]!.args).toEqual(['bind', '--busid', '1-4'])
    expect(tool.calls[1]!.args).toEqual(['unbind', '--busid', '1-4'])
    expect(ctl.log).toHaveBeenCalledWith(expect.stringContaining('usbipd.exe bind'))
    expect(ctl.report).toHaveBeenCalledWith(100, expect.stringContaining('1-4'))
  })

  it('attach 支持指定发行版', async () => {
    const tool = makeTool({ code: 0 })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await svc.attach('2-1', 'Ubuntu')
    await svc.detach('2-1')
    expect(tool.calls[0]!.args).toEqual([
      'attach',
      '--wsl',
      '--distribution',
      'Ubuntu',
      '--busid',
      '2-1',
    ])
    expect(tool.calls[1]!.args).toEqual(['detach', '--busid', '2-1'])
  })

  it('--distribution 不被识别时退回默认发行版（review M-14 根治）', async () => {
    const tool = makeTool([{ code: 1, stderr: 'unknown option --distribution' }, { code: 0 }])
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await svc.attach('2-1', 'Ubuntu')
    // 第一次带 --distribution，第二次退回默认发行版
    expect(tool.calls).toHaveLength(2)
    expect(tool.calls[0]!.args).toContain('--distribution')
    expect(tool.calls[1]!.args).toEqual(['attach', '--wsl', '--busid', '2-1'])
  })

  it('非「参数不识别」的 attach 失败不重试', async () => {
    const tool = makeTool([{ code: 1, stderr: 'device not shared' }, { code: 0 }])
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await expect(svc.attach('2-1', 'Ubuntu')).rejects.toMatchObject({ code: 'TASK_FAILED' })
    expect(tool.calls).toHaveLength(1)
  })

  it('isUnknownOptionError 识别参数错误', () => {
    expect(isUnknownOptionError({ detail: 'unknown option --distribution' })).toBe(true)
    expect(isUnknownOptionError(new Error('unrecognized argument'))).toBe(true)
    expect(isUnknownOptionError({ detail: 'device not shared' })).toBe(false)
    expect(isUnknownOptionError(null)).toBe(false)
  })

  it('提权失败映射 PERMISSION_DENIED', async () => {
    const tool = makeTool({ code: 5, stderr: 'requires elevation' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await expect(svc.bind('1-4', makeCtl())).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    })
  })

  it('attach 失败提示 usbipd 2.0+', async () => {
    const tool = makeTool({ code: 1, stderr: 'unknown option --wsl' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await expect(svc.attach('2-1')).rejects.toMatchObject({
      code: 'TASK_FAILED',
      suggestion: expect.stringContaining('usbipd 2.0+'),
    })
  })

  it('非法 busid 被拦截，不触发工具调用', async () => {
    const tool = makeTool({ code: 0 })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await expect(svc.attach('evil; rm -rf /')).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    })
    expect(tool.calls).toHaveLength(0)
  })

  it('未安装时操作给出安装引导', async () => {
    const tool = makeTool({ code: -1, stderr: 'ENOENT usbipd.exe' })
    const svc = createUsbipdService({ logger: logger(), runTool: tool.fn })
    await expect(svc.detach('1-2')).rejects.toMatchObject({
      suggestion: expect.stringContaining('winget install usbipd'),
    })
  })
})
