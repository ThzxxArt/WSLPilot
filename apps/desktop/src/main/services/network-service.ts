/**
 * 网络服务（M6）— NetworkService（设计书 §9.6）。
 * 铁律：
 * - 端口转发是**声明式**的：规则只来自 network.jsonc（执行白名单），渲染层只传 id
 * - 应用时生成 `netsh interface portproxy` 参数数组并执行，绝不拼接 shell
 * - netsh / 提权失败映射为可行动错误（PERMISSION_DENIED + 等价命令行）
 * - 检测 `.wslconfig` 镜像网络模式并给出引导（mirrored 下端口转发通常不再需要）
 * - 代理配置落到发行版内 `/etc/profile.d/wslpilot-proxy.sh`（root tee + stdin，可逆）
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import {
  assertSafeDistroName,
  assertSafeRuleId,
  buildPortProxyAddArgs,
  buildPortProxyDeleteArgs,
  buildPortProxyShowArgs,
  buildProxyScript,
  canApplyRule,
  createAppError,
  entryListened,
  isElevationError,
  ELEVATION_OP_LABEL,
  ELEVATION_SUGGESTION,
  parsePortProxyShow,
  parseWslConfigMode,
  previewNetshCommand,
  PROXY_SCRIPT_PATH,
  resolveEffectiveProxy,
  ruleSummary,
  type ElevationOpResult,
  type ElevationRequest,
  type ElevationRunResult,
  type NetworkConfig,
  type NetworkStatus,
  type PortForwardRule,
  type PortProxyEntry,
  type PortProxyTarget,
  type ProxyScriptState,
  type WindowsProxyInfo,
} from '@wslpilot/shared'
import { runWsl, runWslWithStdin, runTool, type Logger, type RunToolFn } from '@wslpilot/kit'
import type { TaskControl } from './task-runner'
import { defaultRegQuery, parseRegDword, pickRegValue } from './registry-service'

export const WSL_CONFIG_FILE = '.wslconfig'

export type RunWslFn = (
  args: string[],
  opts?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>

export type RunWslStdinFn = (
  args: string[],
  input: string,
  opts?: { timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string; code: number }>

export interface NetworkConfigReader {
  loadSync(key: 'network'): NetworkConfig
}

export interface NetworkServiceDeps {
  logger: Logger
  configService: NetworkConfigReader
  /** `%UserProfile%\.wslconfig`；测试可注入 */
  wslconfigPath?: string
  readFile?: (path: string) => Promise<string>
  runTool?: RunToolFn
  runWsl?: RunWslFn
  runWslWithStdin?: RunWslStdinFn
  /** Windows 系统代理读取（默认走注册表） */
  readWindowsProxy?: () => Promise<WindowsProxyInfo | null>
  /** 提权助手（M7）：直接执行权限不足时改由独立提权进程执行（§14.3）；run 支持批量合并 UAC */
  elevation?: {
    runOne(req: ElevationRequest): Promise<ElevationOpResult>
    run(reqs: readonly ElevationRequest[]): Promise<ElevationRunResult>
  }
}

export interface NetworkService {
  /** 镜像模式 + 系统转发表 + Windows 代理（M6 面板状态来源） */
  status(): Promise<NetworkStatus>
  listPortProxy(): Promise<PortProxyEntry[]>
  /** 从 network.jsonc 解析规则（执行白名单）；不存在抛错 */
  findRule(id: string): PortForwardRule
  /** 应用单条规则（netsh add） */
  applyRule(id: string, ctl: TaskControl): Promise<void>
  /** 应用全部启用的 TCP 规则；udp 记录意图跳过 */
  applyAll(ctl: TaskControl): Promise<void>
  /** 从系统移除该监听（netsh delete；配置里的规则保留） */
  removeRule(id: string, ctl: TaskControl): Promise<void>
  proxyState(distro: string): Promise<ProxyScriptState>
  proxyApply(distro: string): Promise<void>
  proxyClear(distro: string): Promise<void>
}

/** 提权类失败识别（中英文 Windows 报错）— 唯一事实源在 shared/elevation（M7 提权助手共用） */
export { isElevationError } from '@wslpilot/shared'

const NOT_FOUND_RE = /no such file|not found|cannot open|没有那个文件|找不到/i

/** Windows 系统代理（HKCU Internet Settings）；读不到返回 null，不阻断主流程 */
export async function readWindowsProxyFromRegistry(
  regQuery: (args: string[]) => Promise<string> = defaultRegQuery,
): Promise<WindowsProxyInfo | null> {
  try {
    const out = await regQuery([
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet\\Settings',
    ])
    if (!out.trim()) return null
    const enable = parseRegDword(pickRegValue(out, 'ProxyEnable'))
    const server = pickRegValue(out, 'ProxyServer') ?? ''
    const override = pickRegValue(out, 'ProxyOverride') ?? ''
    return { enabled: enable === 1, server, override }
  } catch {
    return null
  }
}

export function createNetworkService(deps: NetworkServiceDeps): NetworkService {
  const logger = deps.logger
  const tool: RunToolFn = deps.runTool ?? runTool
  const run: RunWslFn = deps.runWsl ?? runWsl
  const runIn: RunWslStdinFn = deps.runWslWithStdin ?? runWslWithStdin
  const readFile = deps.readFile ?? ((p: string) => fs.readFile(p, 'utf8'))
  const readWinProxy = deps.readWindowsProxy ?? (() => readWindowsProxyFromRegistry())
  const wslconfigPath = deps.wslconfigPath ?? join(homedir(), WSL_CONFIG_FILE)

  function rules(): PortForwardRule[] {
    return deps.configService.loadSync('network').portForwarding ?? []
  }

  function findRule(id: string): PortForwardRule {
    const key = assertSafeRuleId(id)
    const rule = rules().find((r) => r.id === key)
    if (!rule) {
      throw createAppError('TASK_FAILED', {
        message: `转发规则不存在：${key}`,
        detail: 'network.jsonc 中未声明该 id（执行白名单）',
        suggestion: '请在 network.jsonc 中定义该规则，或刷新规则列表',
      })
    }
    return rule
  }

  function mapNetshFailure(
    r: { stdout: string; stderr: string; code: number },
    rawCommand: string,
    message: string,
  ): never {
    const text = `${r.stderr}\n${r.stdout}`
    if (isElevationError(text)) {
      throw createAppError('PERMISSION_DENIED', {
        message: `${message}：需要管理员权限`,
        detail: text.trim(),
        rawCommand,
        suggestion: '请以管理员身份运行 WSLPilot，或在管理员终端中执行上述命令',
      })
    }
    throw createAppError('TASK_FAILED', {
      message,
      detail: text.trim(),
      rawCommand,
      suggestion: '请确认「IP Helper」服务与「Internet 连接共享 (ICS)」服务可用后重试',
    })
  }

  /**
   * netsh portproxy 执行入口（M7 提权接线）：
   * 直接执行失败且属权限问题时，改由提权助手执行（§14.3）；
   * 用户取消授权 → PERMISSION_DENIED + 等价命令行（可复制到管理员终端）。
   * 传入 deferElevation 时**只登记**待提权请求（批量模式：applyAll 合并一次 UAC）。
   */
  async function netshRule(
    target: PortProxyTarget,
    op: 'add' | 'delete',
    message: string,
    log?: (line: string) => void,
    deferElevation?: (req: ElevationRequest) => void,
  ): Promise<void> {
    const args = op === 'add' ? buildPortProxyAddArgs(target) : buildPortProxyDeleteArgs(target)
    const rawCommand = previewNetshCommand(target, op)
    const r = await tool('netsh.exe', args, { timeoutMs: 20_000 })
    if (r.code === 0) return
    const text = `${r.stderr}\n${r.stdout}`
    if (isElevationError(text)) {
      const req: ElevationRequest = {
        op: op === 'add' ? 'netsh.portproxy.add' : 'netsh.portproxy.delete',
        params:
          op === 'add'
            ? {
                listenAddress: target.listenAddress,
                listenPort: target.listenPort,
                connectAddress: target.connectAddress,
                connectPort: target.connectPort,
              }
            : { listenAddress: target.listenAddress, listenPort: target.listenPort },
      }
      if (deferElevation) {
        deferElevation(req)
        return
      }
      if (deps.elevation) {
        log?.(`权限不足，改由提权助手执行：${ELEVATION_OP_LABEL[req.op]}…`)
        logger.info('netsh requires elevation, delegating', { op: req.op })
        const res = await deps.elevation.runOne(req)
        if (res.ok) {
          log?.('提权执行成功')
          return
        }
        throw createAppError('PERMISSION_DENIED', {
          message: `${message}：提权执行失败`,
          detail: `${res.stderr}\n${res.stdout}`.trim(),
          rawCommand,
          suggestion: ELEVATION_SUGGESTION,
        })
      }
      throw createAppError('PERMISSION_DENIED', {
        message: `${message}：需要管理员权限`,
        detail: text.trim(),
        rawCommand,
        suggestion: '请以管理员身份运行 WSLPilot，或在管理员终端中执行上述命令',
      })
    }
    mapNetshFailure(r, rawCommand, message)
  }

  /**
   * 批量提权（合并 UAC 会话，§14.3）：applyAll 收集全部待提权操作，一次授权完成。
   * 返回逐操作结果（ok 标志），由调用方统计成败；取消 UAC → 抛 PERMISSION_DENIED。
   */
  async function runElevationBatch(
    requests: ElevationRequest[],
    log?: (line: string) => void,
  ): Promise<ElevationOpResult[]> {
    if (!deps.elevation) {
      throw createAppError('PERMISSION_DENIED', {
        message: `需要管理员权限（${requests.length} 项操作）`,
        suggestion: '请以管理员身份运行 WSLPilot 后重新应用',
      })
    }
    log?.(`权限不足，改由提权助手合并执行 ${requests.length} 项（一次 UAC）…`)
    logger.info('netsh batch elevation', { ops: requests.map((x) => x.op) })
    const run = await deps.elevation.run(requests)
    if (run.canceled) {
      throw createAppError('PERMISSION_DENIED', {
        message: '已取消管理员授权，批量应用未完成',
        suggestion: ELEVATION_SUGGESTION,
      })
    }
    return run.results
  }

  async function listPortProxy(): Promise<PortProxyEntry[]> {
    try {
      const r = await tool('netsh.exe', buildPortProxyShowArgs(), { timeoutMs: 15_000 })
      if (r.code !== 0) {
        logger.warn('netsh portproxy show failed', { detail: `${r.stderr}\n${r.stdout}`.trim() })
        return []
      }
      return parsePortProxyShow(r.stdout)
    } catch (e) {
      logger.warn('netsh portproxy show failed', { error: String(e) })
      return []
    }
  }

  async function applyOne(
    rule: PortForwardRule,
    ctl: TaskControl,
    deferElevation?: (req: ElevationRequest) => void,
  ): Promise<void> {
    ctl.throwIfCanceled()
    const rawCommand = previewNetshCommand(rule, 'add')
    ctl.log(`$ ${rawCommand}`)
    ctl.report(null, `应用转发规则：${rule.id}`)
    // netsh 对已存在的监听是"报错"而不是覆盖；规则端口被编辑后旧条目也会残留。
    // 统一走 delete-then-add，保证"重新应用"幂等、改端口不残留（review M-13）
    const existing = entryListened(await listPortProxy(), rule.listenAddress, rule.listenPort)
    ctl.throwIfCanceled()
    if (existing) {
      const del = previewNetshCommand(rule, 'delete')
      ctl.log(`$ ${del}`)
      await netshRule(
        rule,
        'delete',
        `清理旧转发「${rule.id}」失败`,
        (l) => ctl.log(l),
        deferElevation,
      )
    }
    await netshRule(
      rule,
      'add',
      `应用转发规则「${rule.id}」失败`,
      (l) => ctl.log(l),
      deferElevation,
    )
    ctl.log(`已应用 ${ruleSummary(rule)}`)
  }

  return {
    async status(): Promise<NetworkStatus> {
      let content = ''
      let exists = false
      try {
        content = await readFile(wslconfigPath)
        exists = true
      } catch {
        exists = false
      }
      const { mode, raw } = parseWslConfigMode(content)
      const [portProxy, windowsProxy] = await Promise.all([listPortProxy(), readWinProxy()])
      return {
        wslconfigPath,
        wslconfigExists: exists,
        mode,
        modeRaw: raw,
        mirrorRecommended: mode !== 'mirrored',
        portProxy,
        windowsProxy,
      }
    },

    listPortProxy,

    findRule,

    async applyRule(id, ctl) {
      const rule = findRule(id)
      if (!canApplyRule(rule)) {
        throw createAppError('TASK_FAILED', {
          message: `规则「${rule.id}」是 UDP，无法应用到系统`,
          detail: 'netsh interface portproxy 仅支持 TCP（v4tov4）',
          rawCommand: previewNetshCommand(rule, 'add'),
          suggestion: 'udp 规则只在 network.jsonc 中记录意图，可改为 tcp 后再应用',
        })
      }
      await applyOne(rule, ctl)
      ctl.report(100, `转发规则已应用：${rule.id}`)
    },

    async applyAll(ctl) {
      const list = rules().filter((r) => r.enabled)
      if (list.length === 0) {
        ctl.report(100, '没有启用中的转发规则')
        ctl.log('没有启用中的转发规则，无需应用')
        return
      }
      const errors: string[] = []
      let applied = 0
      let skipped = 0
      // 批量提权收集器：直接执行权限不足的 op 登记于此，循环后**合并一次 UAC**（§14.3）
      const pending: Array<{ req: ElevationRequest; ruleId: string }> = []
      const deferredRuleIds = new Set<string>()
      // 任一环节（直接执行/提权）失败的规则都进此集：成败按规则去重计数（review 回验修复）
      const failedRuleIds = new Set<string>()

      for (let i = 0; i < list.length; i++) {
        const rule = list[i]!
        ctl.throwIfCanceled()
        if (!canApplyRule(rule)) {
          skipped++
          ctl.log(`跳过 UDP 规则 ${rule.id}（netsh portproxy 仅支持 TCP）`)
          continue
        }
        try {
          await applyOne(rule, ctl, (req) => {
            pending.push({ req, ruleId: rule.id })
            deferredRuleIds.add(rule.id)
          })
          if (!deferredRuleIds.has(rule.id)) applied++
        } catch (e) {
          failedRuleIds.add(rule.id)
          const msg = e instanceof Error ? e.message : String(e)
          errors.push(`${rule.id}: ${msg}`)
          ctl.log(`应用失败 ${rule.id}：${msg}`)
        }
        ctl.report(
          Math.round(((i + 1) / list.length) * 100),
          `应用转发规则 ${i + 1}/${list.length}`,
        )
      }

      // 合并提权（一次 UAC 完成全部待执行项）；无提权助手则全部记为权限失败
      if (pending.length > 0) {
        try {
          const results = await runElevationBatch(
            pending.map((p) => p.req),
            (l) => ctl.log(l),
          )
          results.forEach((res, idx) => {
            const ruleId = pending[idx]?.ruleId ?? ''
            if (res.ok) {
              ctl.log(`提权执行成功：${ruleId}`)
            } else {
              failedRuleIds.add(ruleId)
              errors.push(
                `${ruleId}: 提权执行失败${res.stderr || res.stdout ? `（${(res.stderr || res.stdout).trim().slice(0, 200)}）` : ''}`,
              )
            }
          })
        } catch (e) {
          // 取消 UAC / 提权助手不可用：全部待执行项记失败（消息含可执行建议）
          const msg = e instanceof Error ? e.message : String(e)
          for (const p of pending) failedRuleIds.add(p.ruleId)
          errors.push(msg)
          ctl.log(`批量提权未完成：${msg}`)
        }
        for (const ruleId of deferredRuleIds) {
          if (!failedRuleIds.has(ruleId)) applied++
        }
      }

      const summary = `应用完成：成功 ${applied} 条，跳过 ${skipped} 条，失败 ${errors.length} 条`
      ctl.log(summary)
      if (errors.length > 0) {
        throw createAppError('TASK_FAILED', {
          message: summary,
          detail: errors.join('\n'),
          suggestion: '失败项多为权限问题：请以管理员身份运行 WSLPilot 后重新应用',
        })
      }
      ctl.report(100, summary)
    },

    async removeRule(id, ctl) {
      const rule = findRule(id)
      // 幂等：系统里本来就没有这条监听时直接成功，
      // 否则「从系统移除」在已移除状态下必报错（review M-13）
      const listened = entryListened(await listPortProxy(), rule.listenAddress, rule.listenPort)
      if (!listened) {
        ctl.log(`系统中已无监听 ${rule.listenAddress}:${rule.listenPort}，无需移除`)
        ctl.report(100, `系统中已无该监听：${rule.id}`)
        return
      }
      const rawCommand = previewNetshCommand(rule, 'delete')
      ctl.log(`$ ${rawCommand}`)
      ctl.report(null, `从系统移除转发：${rule.id}`)
      await netshRule(rule, 'delete', `移除转发规则「${rule.id}」失败`, (l) => ctl.log(l))
      ctl.log(`已从系统移除 ${ruleSummary(rule)}`)
      ctl.report(100, `已从系统移除：${rule.id}`)
    },

    async proxyState(distro: string): Promise<ProxyScriptState> {
      const name = assertSafeDistroName(distro)
      const r = await run(['-d', name, '-e', 'cat', PROXY_SCRIPT_PATH], { timeoutMs: 15_000 })
      if (r.code === 0) {
        return { path: PROXY_SCRIPT_PATH, exists: true, content: r.stdout }
      }
      const text = `${r.stderr}\n${r.stdout}`
      if (NOT_FOUND_RE.test(text)) {
        return { path: PROXY_SCRIPT_PATH, exists: false, content: '' }
      }
      throw createAppError('IO_ERROR', {
        message: `读取 ${name} 的代理脚本失败`,
        detail: text.trim(),
        rawCommand: `wsl.exe -d ${name} -e cat ${PROXY_SCRIPT_PATH}`,
        suggestion: '请确认发行版可正常启动',
      })
    },

    async proxyApply(distro: string) {
      const name = assertSafeDistroName(distro)
      const proxy = deps.configService.loadSync('network').proxy
      const windows = proxy.useWindowsProxy ? await readWinProxy() : null
      const script = buildProxyScript(resolveEffectiveProxy(proxy, windows))
      logger.info('proxy apply', { distro: name, bytes: Buffer.byteLength(script, 'utf8') })
      const r = await runIn(['-d', name, '-u', 'root', '-e', 'tee', PROXY_SCRIPT_PATH], script, {
        timeoutMs: 20_000,
      })
      if (r.code !== 0) {
        const text = `${r.stderr}\n${r.stdout}`
        const denied = /permission|denied|root|sudo|不允许|权限/i.test(text)
        throw createAppError(denied ? 'PERMISSION_DENIED' : 'IO_ERROR', {
          message: `写入 ${name} 的代理脚本失败`,
          detail: text.trim(),
          rawCommand: `wsl.exe -d ${name} -u root -e tee ${PROXY_SCRIPT_PATH}`,
          suggestion: denied
            ? '需要发行版内 root 权限；请确认 wsl.exe 可以 -u root 执行'
            : '请查看原始输出并重试',
        })
      }
    },

    async proxyClear(distro: string) {
      const name = assertSafeDistroName(distro)
      const r = await run(['-d', name, '-u', 'root', '-e', 'rm', '-f', PROXY_SCRIPT_PATH], {
        timeoutMs: 15_000,
      })
      if (r.code !== 0) {
        const text = `${r.stderr}\n${r.stdout}`
        const denied = /permission|denied|root|sudo|不允许|权限/i.test(text)
        throw createAppError(denied ? 'PERMISSION_DENIED' : 'IO_ERROR', {
          message: `清除 ${name} 的代理脚本失败`,
          detail: text.trim(),
          rawCommand: `wsl.exe -d ${name} -u root -e rm -f ${PROXY_SCRIPT_PATH}`,
          suggestion: denied
            ? '需要发行版内 root 权限；请确认 wsl.exe 可以 -u root 执行'
            : '请查看原始输出并重试',
        })
      }
    },
  }
}
