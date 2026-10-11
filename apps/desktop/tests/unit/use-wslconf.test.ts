import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWslConf, type WslConfApi } from '../../src/renderer/composables/useWslConf'

const SAMPLE = `# 主配置
[automount]
enabled = true
# 挂载选项
options = "metadata"

[network]
hostname = mybox

[custom]
keep = 1
`

function makeApi(over: Partial<WslConfApi> = {}) {
  return {
    read: vi.fn(async () => SAMPLE),
    write: vi.fn(async () => ({ terminated: false })),
    ...over,
  } as WslConfApi
}

describe('useWslConf', () => {
  beforeEach(() => vi.clearAllMocks())

  it('load 解析表单模型并保留未知键', async () => {
    const api = makeApi()
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    expect(conf.loading.value).toBe(false)
    expect(conf.model.value.automount.enabled).toBe(true)
    expect(conf.model.value.network.hostname).toBe('mybox')
    expect(conf.unknownKeys.value).toEqual([{ section: 'custom', key: 'keep', value: '1' }])
    expect(conf.isDirty.value).toBe(false)
  })

  it('load 无发行版名跳过；API 失败记录错误', async () => {
    const api = makeApi({ read: vi.fn(async () => '') })
    const conf = useWslConf(() => '', { api })
    await conf.load()
    expect(api.read).not.toHaveBeenCalled()

    const bad = makeApi({
      read: vi.fn(async () => {
        throw new Error('boom')
      }),
    })
    const conf2 = useWslConf('Ubuntu', { api: bad })
    await conf2.load()
    expect(conf2.error.value).toContain('boom')
  })

  it('form 编辑生成最小 diff 并保留注释', async () => {
    const api = makeApi()
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    conf.setField('network', 'hostname', 'newbox')
    expect(conf.isDirty.value).toBe(true)
    const text = conf.effectiveText()
    expect(text).toContain('hostname = newbox')
    expect(text).toContain('# 主配置')
    expect(text).toContain('# 挂载选项')
    expect(text).toContain('keep = 1')
    const d = conf.diff()
    expect(d.some((x) => x.type === 'add' && x.text.includes('newbox'))).toBe(true)
  })

  it('字符串置空 / clearField 触发删除', async () => {
    const api = makeApi()
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    conf.setField('network', 'hostname', '')
    expect(conf.effectiveText()).not.toContain('hostname')

    await conf.load()
    conf.clearField('automount', 'enabled')
    expect(conf.effectiveText()).not.toContain('enabled = true')
    expect(conf.pendingChanges().some((c) => c.kind === 'remove')).toBe(true)
  })

  it('setField undefined 删除键；未知 section 忽略', async () => {
    const api = makeApi()
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    conf.setField('network', 'hostname', undefined)
    expect(conf.model.value.network.hostname).toBeUndefined()
    conf.setField('nope', 'x', 1)
    expect((conf.model.value as unknown as Record<string, unknown>).nope).toBeUndefined()
  })

  it('模式切换：form→raw 带上表单改动；raw→form 并入基线', async () => {
    const api = makeApi()
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    conf.setField('network', 'hostname', 'renamed')
    conf.setMode('raw')
    expect(conf.raw.value).toContain('hostname = renamed')

    conf.setRaw(`${conf.raw.value}\n[extra]\nk = 2\n`)
    conf.setMode('form')
    expect(conf.effectiveText()).toContain('[extra]')
    expect(conf.unknownKeys.value).toContainEqual({ section: 'extra', key: 'k', value: '2' })
  })

  it('save 写盘并重置脏态；失败保留错误', async () => {
    const api = makeApi()
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    conf.setField('network', 'hostname', 'saved')
    const r = await conf.save()
    expect(r).toEqual({ terminated: false })
    expect(api.write).toHaveBeenCalledWith('Ubuntu', expect.stringContaining('hostname = saved'))
    expect(conf.isDirty.value).toBe(false)
    expect(conf.model.value.network.hostname).toBe('saved')

    const bad = makeApi({
      write: vi.fn(async () => {
        throw new Error('denied')
      }),
    })
    const conf2 = useWslConf('Ubuntu', { api: bad })
    await conf2.load()
    conf2.setField('network', 'hostname', 'x')
    await expect(conf2.save()).rejects.toThrow('denied')
    expect(conf2.error.value).toContain('denied')
    expect(conf2.saving.value).toBe(false)
    // 失败后脏态保留（绝不假装已保存）
    expect(conf2.isDirty.value).toBe(true)
  })

  it('setRaw 在 form 模式下重建模型', async () => {
    const api = makeApi()
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    conf.setRaw('[boot]\nsystemd = true\n')
    expect(conf.model.value.boot.systemd).toBe(true)
  })

  it('快速切换发行版：旧 load 响应晚到不得写入', async () => {
    const { ref } = await import('vue')
    let resolveFirst!: (v: string) => void
    const first = new Promise<string>((r) => (resolveFirst = r))
    const api = {
      read: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce('[network]\nhostname = newbox\n'),
      write: vi.fn(async () => ({ terminated: false })),
    } as unknown as WslConfApi
    const name = ref('Ubuntu')
    const conf = useWslConf(name, { api })
    const p1 = conf.load()
    name.value = 'Debian'
    const p2 = conf.load()
    await p2
    expect(conf.model.value.network.hostname).toBe('newbox')
    resolveFirst('[network]\nhostname = oldbox\n')
    await p1
    // 旧响应晚到：不得把 Debian 的内容覆盖回 Ubuntu 的
    expect(conf.model.value.network.hostname).toBe('newbox')
  })

  it('save 旧响应晚到不得覆盖新载入', async () => {
    let resolveWrite!: (v: { terminated: boolean }) => void
    const slowWrite = new Promise<{ terminated: boolean }>((r) => (resolveWrite = r))
    const api = {
      read: vi.fn(async () => '[network]\nhostname = disk\n'),
      write: vi.fn().mockReturnValueOnce(slowWrite),
    } as unknown as WslConfApi
    const conf = useWslConf('Ubuntu', { api })
    await conf.load()
    conf.setField('network', 'hostname', 'editing')
    const pSave = conf.save()
    // 保存在途时重新载入（如切换发行版后返回）：新载入先完成
    await conf.load()
    expect(conf.model.value.network.hostname).toBe('disk')
    resolveWrite({ terminated: false })
    await pSave
    // 慢保存晚到：不得把「已保存」的脏文本写回状态
    expect(conf.model.value.network.hostname).toBe('disk')
  })
})
