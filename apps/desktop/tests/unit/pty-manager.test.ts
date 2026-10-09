import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  createPtyManager,
  type PtyProcessLike,
  type PtySpawnFn,
} from '../../src/main/services/pty-manager'
import { MAX_PTY_SESSIONS } from '@wslpilot/shared'

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

function makeProc() {
  const ee = new EventEmitter()
  const proc: PtyProcessLike = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
    onData: (l) => {
      ee.on('data', l)
      return { dispose: () => ee.off('data', l) }
    },
    onExit: (l) => {
      ee.on('exit', l)
      return { dispose: () => ee.off('exit', l) }
    },
  }
  return {
    proc,
    emitData: (s: string) => ee.emit('data', s),
    emitExit: (code: number) => ee.emit('exit', { exitCode: code }),
  }
}

describe('PtyManager', () => {
  let spawned: Array<{ file: string; args: string[]; opts: any }>
  let procs: ReturnType<typeof makeProc>[]
  let events: { onData: ReturnType<typeof vi.fn>; onExit: ReturnType<typeof vi.fn> }
  let pty: ReturnType<typeof createPtyManager>

  const spawnFn: PtySpawnFn = (file, args, opts) => {
    const p = makeProc()
    procs.push(p)
    spawned.push({ file, args, opts })
    return p.proc
  }

  beforeEach(() => {
    spawned = []
    procs = []
    events = { onData: vi.fn(), onExit: vi.fn() }
    pty = createPtyManager(logger(), events, spawnFn)
  })

  it('creates session with wsl.exe -d distro -e shell (array args)', () => {
    const info = pty.create({ distro: 'Ubuntu-22.04', cols: 80, rows: 24 })
    expect(info.ptyId).toBeTruthy()
    expect(info.distro).toBe('Ubuntu-22.04')
    expect(spawned[0]!.file).toBe('wsl.exe')
    expect(spawned[0]!.args).toEqual(['-d', 'Ubuntu-22.04', '-e', '/bin/bash'])
    expect(spawned[0]!.opts.useConpty).toBe(true)
    expect(spawned[0]!.opts.name).toBe('xterm-256color')
  })

  it('passes --cd and custom shell via arrays', () => {
    pty.create({
      distro: 'Debian',
      shell: '/bin/zsh',
      cwd: '/home/me',
      cols: 100,
      rows: 30,
    })
    expect(spawned[0]!.args).toEqual(['-d', 'Debian', '--cd', '/home/me', '-e', '/bin/zsh'])
  })

  it('rejects illegal distro name and shell', () => {
    expect(() => pty.create({ distro: '../evil', cols: 80, rows: 24 })).toThrow()
    expect(() =>
      pty.create({ distro: 'Ubuntu', shell: '../bin/bash', cols: 80, rows: 24 }),
    ).toThrow()
    expect(() => pty.create({ distro: '', cols: 80, rows: 24 })).toThrow()
  })

  it('enforces session limit', () => {
    for (let i = 0; i < MAX_PTY_SESSIONS; i++) {
      pty.create({ distro: 'U', cols: 80, rows: 24 })
    }
    expect(pty.count()).toBe(MAX_PTY_SESSIONS)
    expect(() => pty.create({ distro: 'U', cols: 80, rows: 24 })).toThrow(/上限/)
  })

  it('routes onData and onExit events', () => {
    const info = pty.create({ distro: 'U', cols: 80, rows: 24 })
    procs[0]!.emitData('hello')
    expect(events.onData).toHaveBeenCalledWith(info.ptyId, 'hello')

    procs[0]!.emitExit(3)
    expect(events.onExit).toHaveBeenCalledWith(info.ptyId, 3)
    expect(pty.count()).toBe(0)
    expect(procs[0]!.proc.kill).toHaveBeenCalled()
  })

  it('input / resize forward to process; unknown id throws', () => {
    const info = pty.create({ distro: 'U', cols: 80, rows: 24 })
    pty.input(info.ptyId, 'ls\n')
    expect(procs[0]!.proc.write).toHaveBeenCalledWith('ls\n')
    pty.resize(info.ptyId, 120, 40)
    expect(procs[0]!.proc.resize).toHaveBeenCalledWith(120, 40)

    expect(() => pty.input('nope', 'x')).toThrow()
    expect(() => pty.resize('nope', 10, 10)).toThrow()
  })

  it('clamps cols/rows to sane ranges', () => {
    const info = pty.create({ distro: 'U', cols: 1, rows: 9999 })
    // create 时已 clamp 进 spawn
    expect(spawned[0]!.opts.cols).toBe(2)
    expect(spawned[0]!.opts.rows).toBe(200)
    pty.resize(info.ptyId, 0, -5)
    expect(procs[0]!.proc.resize).toHaveBeenCalledWith(2, 1)
  })

  it('kill is idempotent and killAll clears', () => {
    pty.create({ distro: 'A', cols: 80, rows: 24 })
    pty.create({ distro: 'B', cols: 80, rows: 24 })
    const id = pty.list()[0]!.ptyId
    pty.kill(id)
    pty.kill(id) // 不抛
    expect(pty.count()).toBe(1)
    pty.killAll()
    expect(pty.count()).toBe(0)
  })

  it('list / get reflect sessions', () => {
    const a = pty.create({ distro: 'A', cols: 80, rows: 24 })
    expect(pty.list()).toHaveLength(1)
    expect(pty.get(a.ptyId)?.distro).toBe('A')
    expect(pty.get('missing')).toBeNull()
  })

  it('ignores empty input data', () => {
    const info = pty.create({ distro: 'U', cols: 80, rows: 24 })
    pty.input(info.ptyId, '')
    expect(procs[0]!.proc.write).not.toHaveBeenCalled()
  })

  it('throws on unknown ptyId for input/resize', () => {
    expect(() => pty.input('missing', 'x')).toThrow(/不存在/)
    expect(() => pty.resize('missing', 80, 24)).toThrow(/不存在/)
  })

  it('kill does not throw when already gone', () => {
    const info = pty.create({ distro: 'U', cols: 80, rows: 24 })
    procs[0]!.emitExit(0)
    expect(() => pty.kill(info.ptyId)).not.toThrow()
  })

  it('empty shell falls back to /bin/bash', () => {
    pty.create({ distro: 'U', shell: '   ', cols: 80, rows: 24 })
    expect(spawned[0]!.args).toContain('/bin/bash')
  })

  it('cwd empty skips --cd', () => {
    pty.create({ distro: 'U', cwd: '  ', cols: 80, rows: 24 })
    expect(spawned[0]!.args).toEqual(['-d', 'U', '-e', '/bin/bash'])
  })

  it('defaultShell 走配置函数 / 字符串（review M21）', () => {
    const fnPty = createPtyManager(logger(), events, spawnFn, { defaultShell: () => '/bin/sh' })
    fnPty.create({ distro: 'U', cols: 80, rows: 24 })
    expect(spawned[0]!.args).toContain('/bin/sh')

    const strPty = createPtyManager(logger(), events, spawnFn, { defaultShell: '/bin/zsh' })
    strPty.create({ distro: 'U', cols: 80, rows: 24 })
    expect(spawned[1]!.args).toContain('/bin/zsh')

    const emptyPty = createPtyManager(logger(), events, spawnFn, { defaultShell: () => '  ' })
    emptyPty.create({ distro: 'U', cols: 80, rows: 24 })
    expect(spawned[2]!.args).toContain('/bin/bash')
  })

  it('rejects shell 伪参数与控制字符（review M22）', () => {
    expect(() => pty.create({ distro: 'U', shell: '--evil', cols: 80, rows: 24 })).toThrow()
    expect(() => pty.create({ distro: 'U', shell: 'a\u0000b', cols: 80, rows: 24 })).toThrow()
  })

  // ── M5：createCommand（自定义动作临时 PTY）与 waitExit ──

  it('createCommand 以 -e 分界传程序与参数数组', () => {
    const info = pty.createCommand({
      distro: 'Ubuntu',
      program: '/usr/bin/bash',
      args: ['-lc', 'sudo apt update && sudo apt upgrade -y'],
      user: 'root',
      cwd: '/',
      cols: 90,
      rows: 30,
    })
    expect(info.distro).toBe('Ubuntu')
    expect(info.shell).toBe('/usr/bin/bash')
    expect(spawned[0]!.args).toEqual([
      '-d',
      'Ubuntu',
      '-u',
      'root',
      '--cd',
      '/',
      '-e',
      '/usr/bin/bash',
      '-lc',
      'sudo apt update && sudo apt upgrade -y',
    ])
  })

  it('createCommand 省略 user / ~ cwd', () => {
    pty.createCommand({ distro: 'U', program: '/bin/true', args: [], cwd: '~' })
    expect(spawned[0]!.args).toEqual(['-d', 'U', '-e', '/bin/true'])
  })

  it('createCommand 拒绝伪参数程序 / 非法用户 / 超长参数', () => {
    expect(() => pty.createCommand({ distro: 'U', program: '--evil', args: [] })).toThrow()
    expect(() =>
      pty.createCommand({ distro: 'U', program: '/bin/true', args: [], user: '-root' }),
    ).toThrow()
    expect(() =>
      pty.createCommand({ distro: 'U', program: '/bin/true', args: ['x'.repeat(10000)] }),
    ).toThrow()
    expect(() =>
      pty.createCommand({ distro: 'U', program: '/bin/true', args: Array(201).fill('a') }),
    ).toThrow()
    expect(() =>
      pty.createCommand({ distro: 'U', program: '/bin/true', args: ['a\u0000b'] }),
    ).toThrow()
  })

  it('createCommand 拒绝非法工作目录', () => {
    expect(() =>
      pty.createCommand({ distro: 'U', program: '/bin/true', args: [], cwd: '-evil' }),
    ).toThrow()
    expect(() =>
      pty.createCommand({ distro: 'U', program: '/bin/true', args: [], cwd: 'a\u0000b' }),
    ).toThrow()
  })

  it('createCommand 遵守会话上限', () => {
    for (let i = 0; i < MAX_PTY_SESSIONS; i++) {
      pty.createCommand({ distro: 'U', program: '/bin/true', args: [] })
    }
    expect(() => pty.createCommand({ distro: 'U', program: '/bin/true', args: [] })).toThrow(/上限/)
  })

  it('waitExit 解析退出码；未知会话 reject', async () => {
    const info = pty.createCommand({ distro: 'U', program: '/bin/true', args: [] })
    const p = pty.waitExit(info.ptyId)
    procs[0]!.emitExit(7)
    await expect(p).resolves.toBe(7)
    expect(events.onExit).toHaveBeenCalledWith(info.ptyId, 7)
    await expect(pty.waitExit('missing')).rejects.toMatchObject({ code: 'TASK_FAILED' })
  })

  it('kill 即使 onExit 不触发也结算等待者（取消卡死根治 — review M7）', async () => {
    const info = pty.createCommand({ distro: 'U', program: '/bin/true', args: [] })
    const p = pty.waitExit(info.ptyId)
    // kill 后不 emitExit（模拟进程已死、onExit 永不到达）
    pty.kill(info.ptyId)
    await expect(p).resolves.toBe(-1)
  })

  it('killAll 结算全部等待者；对已死会话 kill 幂等结算', async () => {
    const a = pty.createCommand({ distro: 'U', program: '/bin/true', args: [] })
    const b = pty.createCommand({ distro: 'U', program: '/bin/true', args: [] })
    const pa = pty.waitExit(a.ptyId)
    const pb = pty.waitExit(b.ptyId)
    pty.killAll()
    await expect(pa).resolves.toBe(-1)
    await expect(pb).resolves.toBe(-1)
    // 会话已不在表中：再次 kill 不抛且二次结算无副作用
    expect(() => pty.kill(a.ptyId)).not.toThrow()
    await expect(pa).resolves.toBe(-1)
  })

  it('onExit 缺省退出码归一为 0', async () => {
    const info = pty.createCommand({ distro: 'U', program: '/bin/true', args: [] })
    const p = pty.waitExit(info.ptyId)
    procs[0]!.emitExit(undefined as unknown as number)
    await expect(p).resolves.toBe(0)
    expect(events.onExit).toHaveBeenCalledWith(info.ptyId, 0)
  })
})
