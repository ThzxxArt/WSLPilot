import { describe, it, expect } from 'vitest'
import {
  CommandBlockTracker,
  blockStatus,
  parseOsc7Cwd,
} from '../../src/renderer/features/terminal/command-blocks'

function trackerWith(lines: Record<number, string>) {
  return new CommandBlockTracker((line) => lines[line] ?? '')
}

describe('OSC 7 cwd 解析', () => {
  it('解析 file://host/path 并解码', () => {
    expect(parseOsc7Cwd('file://DESKTOP/home/me/项目')).toBe('/home/me/项目')
    expect(parseOsc7Cwd('file:///home/me/a%20b')).toBe('/home/me/a b')
  })

  it('非法/空输入返回空串（不抛异常）', () => {
    expect(parseOsc7Cwd('')).toBe('')
    expect(parseOsc7Cwd('DESKTOP')).toBe('')
    expect(parseOsc7Cwd('file://host')).toBe('')
    expect(parseOsc7Cwd('file://host/%E0%A4%A')).toBe('/%E0%A4%A')
  })
})

describe('CommandBlockTracker（OSC 133）', () => {
  it('A→B→C→D 完整序列：命令文本、退出码、耗时、cwd', () => {
    const t = trackerWith({ 0: '$ npm test', 1: 'PASS 12 tests', 2: '' })
    const a = t.handleOsc133('A', 0, 2)
    expect(a?.promptLine).toBe(0)
    t.handleOsc133('B', 0, 2)
    const c = t.handleOsc133('C', 1)
    expect(c?.command).toBe('npm test')
    expect(c?.outputStart).toBe(1)
    t.handleOsc7('file://host/home/me/project')
    const d = t.handleOsc133('D;0', 2)
    expect(d?.endLine).toBe(2)
    expect(d?.exitCode).toBe(0)
    expect(d?.cwd).toBe('/home/me/project')
    expect(d?.durationMs).toBeGreaterThanOrEqual(0)
    expect(blockStatus(d)).toBe('success')
    expect(t.lastCompleted()).toBe(d)
  })

  it('失败退出码 → failure；无退出码 → unknown', () => {
    const t = trackerWith({})
    t.handleOsc133('A', 0)
    t.handleOsc133('B', 0)
    t.handleOsc133('C', 1)
    const d = t.handleOsc133('D;127', 2)
    expect(blockStatus(d)).toBe('failure')

    t.handleOsc133('A', 3)
    t.handleOsc133('B', 3)
    t.handleOsc133('C', 4)
    const noCode = t.handleOsc133('D', 5)
    expect(noCode?.exitCode).toBeUndefined()
    expect(blockStatus(noCode)).toBe('unknown')
  })

  it('空回车（A 后直接 A）不会留下永久 running', () => {
    const t = trackerWith({})
    t.handleOsc133('A', 0)
    t.handleOsc133('A', 1)
    const first = t.blocks[0]!
    expect(first.endLine).toBe(1)
    expect(first.exitCode).toBe(0)
    expect(blockStatus(first)).toBe('success')
  })

  it('D 先于 A 到达（会话中途安装）也能建块', () => {
    const t = trackerWith({})
    const d = t.handleOsc133('D;1', 9)
    expect(d?.endLine).toBe(9)
    expect(d?.exitCode).toBe(1)
    expect(t.last()).toBe(d)
  })

  it('633;P;Cwd=… 与 633;E;… 兼容 VS Code', () => {
    const t = trackerWith({})
    t.handleOsc133('A', 0)
    const p = t.handleOsc133('P;Cwd=/tmp', 0)
    expect(p?.cwd).toBe('/tmp')
    const e = t.handleOsc133('E;echo hi', 0)
    expect(e?.command).toBe('echo hi')
  })

  it('多行命令按行拼接并剥离首行提示符列', () => {
    const t = trackerWith({
      0: 'me@host:~$ echo one \\',
      1: '  && echo two',
    })
    t.handleOsc133('A', 0, 11)
    t.handleOsc133('B', 0, 11)
    const c = t.handleOsc133('C', 2)
    expect(c?.command).toBe('echo one \\\n  && echo two')
  })

  it('lastCompleted 跳过运行中的块；clear 清空', () => {
    const t = trackerWith({})
    t.handleOsc133('A', 0)
    t.handleOsc133('B', 0)
    t.handleOsc133('C', 1)
    t.handleOsc133('D;0', 2)
    t.handleOsc133('A', 3)
    t.handleOsc133('B', 3)
    t.handleOsc133('C', 4)
    expect(t.lastCompleted()?.endLine).toBe(2)
    expect(blockStatus(t.last())).toBe('running')
    t.clear()
    expect(t.blocks).toHaveLength(0)
    expect(t.last()).toBeNull()
  })

  it('块数量有上限（长会话不无限增长）', () => {
    const t = trackerWith({})
    for (let i = 0; i < 520; i++) {
      t.handleOsc133('A', i)
      t.handleOsc133('D;0', i)
    }
    expect(t.blocks.length).toBeLessThanOrEqual(500)
  })

  it('未知事件忽略且没有当前块时 OSC 7 不抛错', () => {
    const t = trackerWith({})
    expect(t.handleOsc133('Z;1', 0)).toBeNull()
    expect(t.handleOsc7('file://host/tmp')).toBeNull()
  })

  it('负行号被夹紧为 0（防御性）', () => {
    const t = trackerWith({})
    const block = t.handleOsc133('A', -5)
    expect(block?.promptLine).toBe(0)
  })
})
