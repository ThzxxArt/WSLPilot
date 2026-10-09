import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { runWsl, runWslWithStdin, parseDistroList, getRawCommand, spawnWsl } from '../src/exec-wsl'

const { mockExecFile, mockSpawn } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockSpawn: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
  spawn: mockSpawn,
}))

vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>()
  return {
    ...actual,
    // execFile 被 promisify 后走 custom；mock 后用默认 promisify 会丢 stdout/stderr 对，
    // 因此显式提供与 Node execFile 等价的 promise 封装。
    promisify: (fn: any) => {
      if (fn === mockExecFile) {
        return (cmd: string, args: string[], opts: any) =>
          new Promise((resolve, reject) => {
            mockExecFile(cmd, args, opts, (err: any, stdout: any, stderr: any) => {
              if (err) {
                err.stdout = stdout
                err.stderr = stderr
                reject(err)
              } else {
                resolve({ stdout, stderr })
              }
            })
          })
      }
      return actual.promisify(fn)
    },
  }
})

describe('runWsl', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    mockSpawn.mockReset()
  })

  it('decodes UTF-16LE stdout and strips nulls', async () => {
    const text = 'NAME STATE VERSION'
    const buf = Buffer.from(text, 'utf16le')
    mockExecFile.mockImplementation(
      (_c: string, _a: string[], _o: unknown, cb: (e: any, o: Buffer, s: Buffer) => void) => {
        cb(null, buf, Buffer.alloc(0))
      },
    )

    const r = await runWsl(['--list', '--verbose'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe(text)
    expect(r.stderr).toBe('')
    expect(mockExecFile.mock.calls[0][1]).toEqual(['--list', '--verbose'])
  })

  it('returns code from failure and decodes stderr', async () => {
    const err: any = new Error('fail')
    err.code = 42
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(err, Buffer.from('out', 'utf16le'), Buffer.from('bad thing', 'utf16le'))
    })

    const r = await runWsl(['x'])
    expect(r.code).toBe(42)
    expect(r.stderr).toBe('bad thing')
    expect(r.stdout).toBe('out')
  })

  it('supports utf8 encoding option', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(null, Buffer.from('plain utf8', 'utf8'), Buffer.alloc(0))
    })
    const r = await runWsl(['x'], { encoding: 'utf8' })
    expect(r.stdout).toBe('plain utf8')
  })

  it('handles missing stdout buffer as empty string', async () => {
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(null, undefined, undefined)
    })
    const r = await runWsl(['x'])
    expect(r.stdout).toBe('')
    expect(r.stderr).toBe('')
  })

  it('maps non-numeric code to -1', async () => {
    const err: any = new Error('x')
    err.code = 'ENOENT'
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(err, Buffer.alloc(0), Buffer.alloc(0))
    })
    const r = await runWsl(['x'])
    expect(r.code).toBe(-1)
  })
})

describe('parseDistroList', () => {
  it('parses English output with default marker', () => {
    const raw = [
      'NAME            STATE           VERSION',
      '* Ubuntu-22.04    Running         2',
      '  Debian          Stopped         2',
    ].join('\r\n')
    const list = parseDistroList(raw)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      isDefault: true,
      name: 'Ubuntu-22.04',
      state: 'Running',
      version: 2,
    })
  })

  it('handles Chinese names and multi-space', () => {
    const raw = '名称            状态           版本\n  测试发行版      正在运行       2'
    const list = parseDistroList(raw)
    expect(list[0]?.name).toBe('测试发行版')
  })

  it('skips blank lines', () => {
    const raw = 'NAME  STATE  VERSION\n* A  Running  2\n\n'
    expect(parseDistroList(raw)).toHaveLength(1)
  })

  it('keeps * inside name, only strips default marker', () => {
    const raw = 'NAME STATE VERSION\n* my*distro  Running  2\n  other*name  Stopped  1'
    const list = parseDistroList(raw)
    expect(list[0]!.name).toBe('my*distro')
    expect(list[0]!.isDefault).toBe(true)
    expect(list[1]!.name).toBe('other*name')
    expect(list[1]!.isDefault).toBe(false)
  })

  it('defaults version to 2 when missing', () => {
    const list = parseDistroList('NAME STATE VERSION\n  A  Running')
    expect(list[0]?.version).toBe(2)
  })
})

describe('getRawCommand', () => {
  it('quotes args with spaces', () => {
    expect(getRawCommand('wsl.exe', ['-d', 'Ubuntu 22.04'])).toBe('wsl.exe -d "Ubuntu 22.04"')
  })
  it('leaves simple args bare', () => {
    expect(getRawCommand('wsl.exe', ['-e', 'ls'])).toBe('wsl.exe -e ls')
  })
})

describe('spawnWsl', () => {
  beforeEach(() => {
    mockSpawn.mockReset()
  })

  it('streams UTF-16LE lines separately per stream and reports exit', () => {
    const fake: any = new EventEmitter()
    fake.stdout = new EventEmitter()
    fake.stderr = new EventEmitter()
    fake.kill = vi.fn()
    mockSpawn.mockReturnValue(fake)

    const lines: string[] = []
    const exits: number[] = []
    const handle = spawnWsl(['--list'], {
      onLine: (l) => lines.push(l),
      onExit: (c) => exits.push(c),
      onError: () => {},
    })

    fake.stdout.emit('data', Buffer.from('line1\nline2\npartial', 'utf16le'))
    fake.stderr.emit('data', Buffer.from('errline\n', 'utf16le'))
    fake.emit('close', 0)

    expect(lines).toContain('line1')
    expect(lines).toContain('line2')
    expect(lines).toContain('errline')
    expect(lines.join('|')).not.toContain('partialerrline')
    expect(exits).toEqual([0])

    handle.kill()
    expect(fake.kill).toHaveBeenCalled()
  })

  it('propagates spawn error and defaults exit code', () => {
    const fake: any = new EventEmitter()
    fake.stdout = new EventEmitter()
    fake.stderr = new EventEmitter()
    fake.kill = vi.fn()
    mockSpawn.mockReturnValue(fake)

    const errors: Error[] = []
    const exits: number[] = []
    spawnWsl([], {
      onLine: () => {},
      onExit: (c) => exits.push(c),
      onError: (e) => errors.push(e),
    })

    fake.emit('error', new Error('spawn fail'))
    fake.emit('close', null as any)

    expect(errors[0].message).toBe('spawn fail')
    expect(exits).toEqual([-1])
  })
})

describe('parseDistroList 边界（review M4 回归）', () => {
  it('名字以 * 开头但非默认：不误判、不吞字符', () => {
    const list = parseDistroList('NAME STATE VERSION\n  *mydistro  Running  2')
    expect(list[0]).toMatchObject({ name: '*mydistro', isDefault: false })
  })

  it('默认项名字含 *：只去掉标记列', () => {
    const list = parseDistroList('NAME STATE VERSION\n* *my*distro  Running  2')
    expect(list[0]).toMatchObject({ name: '*my*distro', isDefault: true })
  })

  it('非法版本号归一为 2，杜绝 NaN', () => {
    const list = parseDistroList('NAME STATE VERSION\n  A  Running  oops')
    expect(list[0]?.version).toBe(2)
    const list2 = parseDistroList('NAME STATE VERSION\n  A  Running  1')
    expect(list2[0]?.version).toBe(1)
  })
})

describe('runWsl 错误消息透传（review M6 回归）', () => {
  beforeEach(() => {
    mockExecFile.mockReset()
    mockSpawn.mockReset()
  })

  it('ENOENT 类 spawn 错误保留 message 到 stderr', async () => {
    const err: any = new Error('spawn wsl.exe ENOENT')
    err.code = 'ENOENT'
    mockExecFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: any) => {
      cb(err, undefined, undefined)
    })
    const r = await runWsl(['--list'])
    expect(r.stderr).toContain('ENOENT')
    expect(r.code).toBe(-1)
  })
})

describe('runWslWithStdin', () => {
  beforeEach(() => {
    mockSpawn.mockReset()
  })

  function fakeChild() {
    const fake: any = new EventEmitter()
    fake.stdout = new EventEmitter()
    fake.stderr = new EventEmitter()
    fake.stdin = new EventEmitter()
    fake.stdin.end = vi.fn()
    fake.kill = vi.fn()
    return fake
  }

  it('写入 UTF-8 stdin 并解码 UTF-16LE 输出', async () => {
    const fake = fakeChild()
    mockSpawn.mockReturnValue(fake)

    const p = runWslWithStdin(['-d', 'U', '-e', 'tee', '/etc/wsl.conf'], '[boot]\nsystemd = true')
    // stdin.end 必须收到 UTF-8 缓冲
    expect(fake.stdin.end).toHaveBeenCalled()
    const written = fake.stdin.end.mock.calls[0]![0] as Buffer
    expect(written.toString('utf8')).toBe('[boot]\nsystemd = true')

    fake.stdout.emit('data', Buffer.from('[boot]\nsystemd = true', 'utf16le'))
    fake.emit('close', 0)
    const r = await p
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('systemd = true')
    expect(mockSpawn.mock.calls[0]![1]).toEqual(['-d', 'U', '-e', 'tee', '/etc/wsl.conf'])
  })

  it('透传退出码与 stderr', async () => {
    const fake = fakeChild()
    mockSpawn.mockReturnValue(fake)
    const p = runWslWithStdin(['x'], 'body')
    fake.stderr.emit('data', Buffer.from('permission denied', 'utf16le'))
    fake.emit('close', 1)
    const r = await p
    expect(r.code).toBe(1)
    expect(r.stderr).toBe('permission denied')
  })

  it('spawn 错误返回 code -1 并保留 message', async () => {
    const fake = fakeChild()
    mockSpawn.mockReturnValue(fake)
    const p = runWslWithStdin(['x'], 'body')
    fake.emit('error', new Error('spawn wsl.exe ENOENT'))
    const r = await p
    expect(r.code).toBe(-1)
    expect(r.stderr).toContain('ENOENT')
  })

  it('拒绝超过 4MB 的输入', async () => {
    const r = await runWslWithStdin(['x'], 'x'.repeat(4 * 1024 * 1024 + 1))
    expect(r.code).toBe(-1)
    expect(r.stderr).toContain('4MB')
    expect(mockSpawn).not.toHaveBeenCalled()
  })
})
