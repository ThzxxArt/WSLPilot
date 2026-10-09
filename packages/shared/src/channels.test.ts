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
  CH.appGetVersion,
  CH.appOpenConfigDir,
  CH.appGetWslVersion,
  CH.appWindowMinimize,
  CH.appWindowMaximize,
  CH.appWindowClose,
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
    // 有意预留：有 schema + 入册 INVOKE_CHANNELS，但 handler/preload/renderer 未实现（M6 网络）
    const RESERVED = new Set<string>([CH.networkApply])
    // 清单即声明：新增预留必须改这里，否则本用例失败
    expect([...RESERVED].sort()).toEqual([CH.networkApply])
    for (const ch of RESERVED) {
      expect(IPC_SCHEMAS[ch as ChannelName], `预留通道缺 schema: ${ch}`).toBeTruthy()
      expect(INVOKE_CHANNELS).toContain(ch)
    }
    // 除预留清单外，其余 invoke 通道都必须有真实消费（由 preload-contract.test 守护）
  })
})
