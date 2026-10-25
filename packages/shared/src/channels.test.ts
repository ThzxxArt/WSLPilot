import { describe, it, expect } from 'vitest'
import { CH, INVOKE_CHANNELS, EVENT_CHANNELS, type ChannelName } from './channels'
import { IPC_SCHEMAS, parseIpcArgs } from './ipc-schema'

/** 无参（void）invoke 通道：允许没有 schema，其余带参通道必须登记 schema */
const VOID_INVOKE_CHANNELS = new Set<string>([
  CH.distrosList,
  CH.distrosShutdown,
  CH.distrosListOnline,
  CH.ptyList,
  CH.ptyMaxSessions,
  CH.ptyHostInfo,
  CH.appGetVersion,
  CH.appOpenConfigDir,
  CH.appGetWslVersion,
  CH.appWindowMinimize,
  CH.appWindowMaximize,
  CH.appWindowClose,
  // M6 网络 / 设备
  CH.networkStatus,
  CH.networkApplyAll,
  CH.devicesStatus,
  CH.devicesList,
  // M7 诊断 / 签名 / 更新
  CH.diagnosticsOpenLogsDir,
  CH.appSignatureStatus,
  CH.updateStatus,
  CH.updateCheck,
  CH.updateDownload,
  CH.updateInstall,
  // 0.1.3 WSL 本体 / 全局配置 / 剪贴板
  CH.appWslEnv,
  CH.wslconfigRead,
  CH.clipboardRead,
])

describe('IPC 契约一致性（review M1）', () => {
  it('INVOKE_CHANNELS 与 EVENT_CHANNELS 互斥且合集覆盖全部通道', () => {
    const all = Object.values(CH) as string[]
    const listed = [...INVOKE_CHANNELS, ...EVENT_CHANNELS] as string[]
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual([...all].sort())
  })

  it('带参 invoke 通道必须登记 schema（void 通道豁免）', () => {
    for (const ch of INVOKE_CHANNELS) {
      if (VOID_INVOKE_CHANNELS.has(ch)) {
        expect(IPC_SCHEMAS[ch], `void 通道不应有 schema: ${ch}`).toBeUndefined()
      } else {
        expect(IPC_SCHEMAS[ch], `缺少 schema: ${ch}`).toBeTruthy()
      }
    }
  })

  it('IPC_SCHEMAS 不得登记未声明的通道', () => {
    const known = new Set<string>(Object.values(CH))
    for (const ch of Object.keys(IPC_SCHEMAS)) {
      expect(known.has(ch), `schema 指向未知通道: ${ch}`).toBe(true)
    }
  })

  it('EVENT_CHANNELS 不得有 schema（事件无入参校验）', () => {
    for (const ch of EVENT_CHANNELS) {
      expect(IPC_SCHEMAS[ch as ChannelName], `事件通道不应有 schema: ${ch}`).toBeUndefined()
    }
  })

  it('parseIpcArgs 拒绝多余参数', () => {
    expect(() => parseIpcArgs(CH.distrosList, ['a', 'b'])).toThrow(/只接受 1 个参数/)
  })

  it('void 清单不得有陈旧条目（否则会把后来带参的通道错误豁免 schema 校验）', () => {
    // 预留通道说明：契约四方对账（ipc-router.test.ts「handler 注册表与 INVOKE_CHANNELS
    // 集合相等」+ preload-contract 全方法面）已强制「有契约必有实现」，
    // 「有契约但 handler/preload 未实现」的预留通道在结构上不再可能存在，
    // 故当前无预留清单；将来若确需契约先行预留，必须先在本清单显式登记并同步四方。
    const invoke = new Set<string>(INVOKE_CHANNELS as readonly string[])
    for (const ch of VOID_INVOKE_CHANNELS) {
      expect(invoke.has(ch), `void 清单包含不存在于 INVOKE_CHANNELS 的陈旧通道: ${ch}`).toBe(true)
    }
  })

  it('metrics 通道族 = sample（单发行版）+ overview（全局）两通道，禁止合并回单通道双返回形状', () => {
    const metricsChannels = (Object.values(CH) as string[]).filter((c) => c.startsWith('metrics:'))
    expect([...metricsChannels].sort()).toEqual(['metrics:overview', 'metrics:sample'])
    expect(INVOKE_CHANNELS).toContain(CH.metricsSample)
    expect(INVOKE_CHANNELS).toContain(CH.metricsOverview)
  })
})
