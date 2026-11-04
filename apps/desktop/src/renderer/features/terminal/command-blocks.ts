/**
 * OSC 133 / 633 命令块状态机（0.2.0）。
 *
 * 纯逻辑、无 xterm 依赖：XtermPane 只负责把 OSC 事件与「当前缓冲行号」喂进来，
 * 命令文本通过注入的 `readLine(absoluteLine)` 从 xterm buffer 读取。
 *
 * 序列（bash/zsh 模板，参考 VS Code）：
 *   A → 提示符开始
 *   B → 命令输入开始（提示符结束）
 *   C → 输出开始（命令已提交）
 *   D;exit → 命令结束
 * OSC 7 → 当前工作目录
 */

export interface CommandBlock {
  id: string
  /** 提示符所在绝对缓冲行 */
  promptLine: number
  commandLine?: number
  /** B 事件时的光标列（提示符末尾）；用于从首行剥离提示符 */
  commandColumn?: number
  outputStart?: number
  endLine?: number
  exitCode?: number
  cwd?: string
  startedAt?: number
  durationMs?: number
  /** 命令文本（从缓冲 B→C 行提取；可能为空） */
  command?: string
}

export type CommandBlockStatus = 'running' | 'success' | 'failure' | 'unknown'

export function blockStatus(block: CommandBlock | null | undefined): CommandBlockStatus {
  if (!block) return 'unknown'
  if (block.endLine === undefined && block.exitCode === undefined) return 'running'
  if (block.exitCode === undefined) return 'unknown'
  return block.exitCode === 0 ? 'success' : 'failure'
}

/** 解析 `file://host/path` → `/path`（解码 %xx；非法输入返回空串） */
export function parseOsc7Cwd(payload: string): string {
  const text = String(payload ?? '').trim()
  if (!text) return ''
  let rest = text
  if (rest.toLowerCase().startsWith('file://')) rest = rest.slice('file://'.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return ''
  const path = rest.slice(slash)
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

const MAX_BLOCKS = 500

export class CommandBlockTracker {
  readonly blocks: CommandBlock[] = []
  current: CommandBlock | null = null
  private seq = 0

  constructor(private readonly readLine?: (absoluteLine: number) => string) {}

  private nextId(): string {
    this.seq += 1
    return `block-${this.seq}`
  }

  private push(block: CommandBlock): CommandBlock {
    this.blocks.push(block)
    if (this.blocks.length > MAX_BLOCKS) this.blocks.splice(0, this.blocks.length - MAX_BLOCKS)
    return block
  }

  /** 处理 OSC 133 / 633 的 data 部分；返回受影响的块（无变化返回 null） */
  handleOsc133(payload: string, absoluteLine: number, column?: number): CommandBlock | null {
    const parts = String(payload ?? '').split(';')
    const kind = (parts[0] ?? '').toUpperCase()
    const line = Math.max(0, Math.floor(absoluteLine))
    const col =
      column === undefined || !Number.isFinite(column) ? undefined : Math.max(0, Math.floor(column))

    if (kind === 'A') {
      // 上一块还停在提示符（空回车）：补一个 0 退出码，避免永久 running
      if (
        this.current &&
        this.current.outputStart === undefined &&
        this.current.endLine === undefined
      ) {
        this.current.endLine = line
        this.current.exitCode ??= 0
      }
      const block: CommandBlock = {
        id: this.nextId(),
        promptLine: line,
        startedAt: Date.now(),
      }
      this.current = block
      return this.push(block)
    }

    if (kind === 'B') {
      const block =
        this.current ??
        this.push({
          id: this.nextId(),
          promptLine: line,
          startedAt: Date.now(),
        })
      this.current = block
      block.commandLine = line
      block.commandColumn = col
      return block
    }

    if (kind === 'C') {
      const block =
        this.current ??
        this.push({ id: this.nextId(), promptLine: line, commandLine: line, startedAt: Date.now() })
      this.current = block
      block.outputStart = line
      block.startedAt ??= Date.now()
      if (block.commandLine !== undefined && this.readLine) {
        const lines: string[] = []
        for (let i = block.commandLine; i < line; i++) {
          let text = this.readLine(i)
          if (i === block.commandLine && block.commandColumn !== undefined) {
            text = text.slice(block.commandColumn)
          }
          if (text) lines.push(text)
        }
        const command = lines.join('\n').trim()
        if (command) block.command = command
      }
      return block
    }

    if (kind === 'D') {
      const block =
        this.current ?? this.push({ id: this.nextId(), promptLine: line, startedAt: Date.now() })
      this.current = block
      block.endLine = line
      const raw = parts[1]
      if (raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
        block.exitCode = Number(raw)
      }
      if (block.startedAt !== undefined) {
        block.durationMs = Math.max(0, Date.now() - block.startedAt)
      }
      this.current = null
      return block
    }

    // 633;P;Cwd=... / 633;P;HasRichCommandDetection=True 等属性
    if (kind === 'P') {
      for (const part of parts.slice(1)) {
        if (part.startsWith('Cwd=')) return this.setCwd(part.slice(4))
      }
      return null
    }

    // VS Code 的 E;<command>：直接给出命令文本（base64 或纯文本）
    if (kind === 'E') {
      const block = this.current
      if (!block) return null
      const raw = parts.slice(1).join(';')
      if (raw) block.command = raw
      return block
    }

    return null
  }

  /** 处理 OSC 7（cwd）：写入当前块或最近一个块 */
  handleOsc7(payload: string): CommandBlock | null {
    return this.setCwd(parseOsc7Cwd(payload))
  }

  private setCwd(cwd: string): CommandBlock | null {
    if (!cwd) return null
    const block = this.current ?? this.blocks[this.blocks.length - 1]
    if (!block) return null
    block.cwd = cwd
    return block
  }

  last(): CommandBlock | null {
    return this.blocks[this.blocks.length - 1] ?? null
  }

  lastCompleted(): CommandBlock | null {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i]!
      if (b.endLine !== undefined) return b
    }
    return null
  }

  clear(): void {
    this.blocks.length = 0
    this.current = null
  }
}
