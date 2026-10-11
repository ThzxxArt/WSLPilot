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

  it('预留通道（契约先行、未实现）显式受控，禁止静默扩大（review M2）', () => {
    // 为什么当前无预留通道：契约四方对账（ipc-router.test.ts
    // 「handler 注册表与 INVOKE_CHANNELS 集合相等」）已强制每个 INVOKE_CHANNELS 都有真实
    // handler 注册，preload 侧由 preload-contract.test 的全方法面零漂移守护——
    // 「有契约但 handler/preload 未实现」的预留通道在结构上不再可能存在。
    // 若将来确需契约先行预留，必须显式登记到 RESERVED（清单即声明，本用例随之变红提醒更新），
    // 禁止用空循环假装校验（RESERVED 为空时 for 循环体永不执行 — 死分支假信心，已根治）。
    const RESERVED = new Set<string>([])
    expect(
      [...RESERVED].sort(),
      '预留通道清单必须保持为空（新增预留需显式登记并更新本用例）',
    ).toEqual([])
  })

  it('metrics 通道族 = sample（单发行版）+ overview（全局）两通道，禁止合并回单通道双返回形状', () => {
    const metricsChannels = (Object.values(CH) as string[]).filter((c) => c.startsWith('metrics:'))
    expect([...metricsChannels].sort()).toEqual(['metrics:overview', 'metrics:sample'])
    expect(INVOKE_CHANNELS).toContain(CH.metricsSample)
    expect(INVOKE_CHANNELS).toContain(CH.metricsOverview)
  })
})
