import { describe, it, expect, vi } from 'vitest'
import { useWslConfig } from '../../src/renderer/composables/useWslConfig'
import { WSL_CONFIG_FIELDS } from '@wslpilot/shared'

const SAMPLE = '# 注释\n[wsl2]\nmemory=8GB\nprocessors=4\n'

function makeApi(initial = SAMPLE) {
  const state = { path: 'C:\\Users\\me\\.wslconfig', exists: true, content: initial }
  return {
    api: {
      read: vi.fn(async () => ({ ...state })),
      write: vi.fn(async (content: string) => {
        state.content = content
        return { path: state.path }
      }),
    },
    state,
  }
}

describe('useWslConfig（0.1.3 .wslconfig 编辑状态机）', () => {
  it('load：解析表单模型 + 未知键保留 + 不脏', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    expect(conf.filePath.value).toBe('C:\\Users\\me\\.wslconfig')
    expect(conf.exists.value).toBe(true)
    expect(conf.model.value.wsl2.memory).toBe('8GB')
    expect(conf.model.value.wsl2.processors).toBe(4)
    expect(conf.isDirty.value).toBe(false)
  })

  it('setField：最小编辑保留注释；isDirty 随内容判定；无变更不脏', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    conf.setField('wsl2', 'memory', '16GB')
    expect(conf.isDirty.value).toBe(true)
    const text = conf.effectiveText()
    expect(text).toContain('# 注释')
    expect(text).toContain('memory=16GB')

    // 改回原值 → 不脏（行级等价）
    conf.setField('wsl2', 'memory', '8GB')
    expect(conf.isDirty.value).toBe(false)
  })

  it('加载 dropcache/NAT 不因规范化被标记为 dirty（0.1.4 回归）', async () => {
    const { api } = makeApi(
      '[wsl2]\nnetworkingMode=NAT\n[experimental]\nautoMemoryReclaim=dropcache\n',
    )
    const conf = useWslConfig({ api })
    await conf.load()
    expect(conf.model.value.wsl2.networkingMode).toBe('nat')
    expect(conf.model.value.experimental.autoMemoryReclaim).toBe('dropCache')
    expect(conf.isDirty.value).toBe(false)
    expect(conf.pendingChanges()).toEqual([])
  })

  it('clearField：显式删除键（removeKeys 语义），变更清单可见', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    conf.clearField('wsl2', 'processors')
    expect(conf.pendingChanges()).toEqual([
      { section: 'wsl2', key: 'processors', before: '4', kind: 'remove' },
    ])
    expect(conf.effectiveText()).not.toContain('processors=4')
  })

  it('fieldError / hasFieldErrors：非法容量阻止保存（save 依赖调用方校验，状态可查）', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    conf.setField('wsl2', 'memory', '1.5GB')
    const field = WSL_CONFIG_FIELDS.find((f) => f.key === 'memory')!
    expect(conf.fieldError(field)).toMatch(/整数/)
    expect(conf.hasFieldErrors.value).toBe(true)
    conf.setField('wsl2', 'memory', '8GB')
    expect(conf.hasFieldErrors.value).toBe(false)
  })

  it('save：写入 effectiveText、刷新基线、脏标记复位；写入失败抛错并记 error', async () => {
    const { api, state } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    conf.setField('wsl2', 'networkingMode', 'mirrored')
    await conf.save()
    expect(state.content).toContain('networkingMode = mirrored')
    expect(state.content).toContain('# 注释')
    expect(conf.isDirty.value).toBe(false)

    api.write.mockRejectedValueOnce(
      Object.assign(new Error('磁盘只读'), { code: 'IO_ERROR', message: '磁盘只读' }),
    )
    conf.setField('wsl2', 'processors', 8)
    await expect(conf.save()).rejects.toBeTruthy()
    expect(conf.error.value).toContain('磁盘只读')
  })

  it('raw 模式：raw 编辑直写；切回 form 重建模型（保留未识别键）', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    conf.setMode('raw')
    conf.setRaw('# 手写\n[wsl2]\nmemory=4GB\ncustom=1\n')
    expect(conf.isDirty.value).toBe(true)
    conf.setMode('form')
    expect(conf.model.value.wsl2.memory).toBe('4GB')
    expect(conf.unknownKeys.value).toEqual([{ section: 'wsl2', key: 'custom', value: '1' }])
    // form 模式下改动不丢 raw 中手写的自定义键
    conf.setField('wsl2', 'memory', '8GB')
    expect(conf.effectiveText()).toContain('custom=1')
  })

  it('load 失败：降级错误态（不抛）', async () => {
    const api = {
      read: vi.fn(async () => {
        throw Object.assign(new Error('读失败'), { code: 'IO_ERROR', message: '读失败' })
      }),
      write: vi.fn(),
    }
    const conf = useWslConfig({ api })
    await conf.load()
    expect(conf.error.value).toContain('读失败')
    expect(conf.loading.value).toBe(false)
  })
})

describe('useWslConfig 边界/默认 API（0.2.0 覆盖率补强）', () => {
  it('setMode 同值幂等；raw→form 并入基线；setRaw 在 form 模式重建', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    const rawBefore = conf.raw.value
    conf.setMode('form')
    expect(conf.raw.value).toBe(rawBefore)
    conf.setField('wsl2', 'memory', '16GB')
    conf.setMode('raw')
    expect(conf.raw.value).toContain('memory=16GB')
    conf.setRaw('[wsl2]\nprocessors=2')
    conf.setMode('form')
    expect(conf.model.value.wsl2.processors).toBe(2)

    conf.setRaw('[wsl2]\nmemory=4GB')
    expect(conf.model.value.wsl2.memory).toBe('4GB')
    expect(conf.isDirty.value).toBe(true)
  })

  it('setField 未知 section / undefined 删除；clearField 未知 section 与重复 id', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    conf.setField('nope', 'x', 1)
    conf.setField('wsl2', 'memory', undefined)
    expect(conf.model.value.wsl2.memory).toBeUndefined()
    conf.clearField('nope', 'x')
    conf.clearField('wsl2', 'processors')
    conf.clearField('wsl2', 'processors')
    const changes = conf.pendingChanges()
    expect(changes.filter((c) => c.kind === 'remove' && c.key === 'processors')).toHaveLength(1)
    expect(conf.fieldError(WSL_CONFIG_FIELDS.find((f) => f.key === 'memory')!)).toBeNull()
  })

  it('save 并发：旧响应晚到不覆盖新状态；返回空路径时保留原路径', async () => {
    const { api } = makeApi()
    const conf = useWslConfig({ api })
    await conf.load()
    let resolveOld!: (v: { path: string }) => void
    api.write
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockImplementationOnce(async () => ({ path: '' }))
    conf.setField('wsl2', 'memory', '1GB')
    const p1 = conf.save()
    conf.setField('wsl2', 'memory', '2GB')
    const p2 = conf.save()
    await p2
    expect(conf.model.value.wsl2.memory).toBe('2GB')
    expect(conf.filePath.value).toBe('C:\\Users\\me\\.wslconfig')
    resolveOld({ path: 'old' })
    await p1
    expect(conf.filePath.value).toBe('C:\\Users\\me\\.wslconfig')
  })

  it('无 window.wslAPI 时默认 API 安全降级', async () => {
    const g = globalThis as { window?: unknown }
    const saved = g.window
    g.window = undefined
    try {
      const conf = useWslConfig()
      await conf.load()
      expect(conf.exists.value).toBe(false)
      await expect(conf.save()).resolves.toEqual({ path: '' })
    } finally {
      g.window = saved
    }
  })
})
