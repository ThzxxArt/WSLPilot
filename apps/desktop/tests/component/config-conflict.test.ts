import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { createWslAPI, findBodyButton, bodyText, type WslAPIMock } from './support'

const { useDistrosStore } = await import('../../src/renderer/stores/distros')
/** 面板读取走运行状态门禁（review：读取绝不隐式启动发行版）——夹具默认 Running */
const RUNNING = {
  name: 'Ubuntu',
  state: 'Running',
  version: 2,
  isDefault: true,
  meta: null,
} as never

enableAutoUnmount(afterEach)

/**
 * ConflictResolver（外部配置冲突三选语义）+ WslConfPanel 保存/错误面。
 * 重点：reload / overwrite / ignore 三种动作各自落到 resolveConflict 的真实参数；
 * 失败路径必须有错误提示，绝不静默。
 */

const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
let dialogResult: 'positive' | 'negative' | 'close' = 'positive'
const dialog = {
  warning: vi.fn(
    (opts: {
      onPositiveClick?: () => void
      onNegativeClick?: () => void
      onClose?: () => void
    }) => {
      if (dialogResult === 'positive') opts.onPositiveClick?.()
      else if (dialogResult === 'negative') opts.onNegativeClick?.()
      else opts.onClose?.()
    },
  ),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}
const notification = { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }

vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => message,
    useDialog: () => dialog,
    useNotification: () => notification,
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const ConflictResolver = (await import('../../src/renderer/features/config/ConflictResolver.vue'))
  .default
const WslConfPanel = (await import('../../src/renderer/features/config/WslConfPanel.vue')).default

/** 捕获 onConflict 注册的回调 */
function captureConflictHandler(): (p: { fileKey: string; detail: string }) => void {
  const calls = wslAPI.config.onConflict.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1]![0] as (p: { fileKey: string; detail: string }) => void
}

beforeEach(() => {
  vi.clearAllMocks()
  dialogResult = 'positive'
  setActivePinia(createPinia())
  useDistrosStore().items = [RUNNING]
  document.body.innerHTML = ''
  wslAPI.config.resolveConflict.mockResolvedValue({})
  wslAPI.wslconf.read.mockResolvedValue('[automount]\nenabled = true\n')
  wslAPI.wslconf.write.mockResolvedValue({ terminated: false })
})

describe('ConflictResolver', () => {
  it('挂载即订阅冲突事件，卸载时解绑', async () => {
    const w = mount(ConflictResolver)
    expect(wslAPI.config.onConflict).toHaveBeenCalledTimes(1)
    const off = wslAPI.config.onConflict.mock.results[0]!.value as () => void
    w.unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('「重载」采用磁盘外部修改：resolveConflict(key, reload)', async () => {
    mount(ConflictResolver)
    dialogResult = 'positive'
    captureConflictHandler()({ fileKey: 'settings', detail: '被外部编辑器改过' })
    await flushPromises()

    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: '配置文件已被外部修改' }),
    )
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('settings', 'reload')
    expect(message.success).toHaveBeenCalledWith('已重载外部修改')
  })

  it('「覆盖」写回应用内状态：resolveConflict(key, overwrite)', async () => {
    mount(ConflictResolver)
    dialogResult = 'negative'
    captureConflictHandler()({ fileKey: 'network', detail: 'diff' })
    await flushPromises()
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('network', 'overwrite')
    expect(message.success).toHaveBeenCalledWith('已用应用内状态覆盖磁盘配置')
  })

  it('关闭（X/Esc）= 暂不处理：resolveConflict(key, ignore)', async () => {
    mount(ConflictResolver)
    dialogResult = 'close'
    captureConflictHandler()({ fileKey: 'distros', detail: 'diff' })
    await flushPromises()
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('distros', 'ignore')
    expect(message.success).toHaveBeenCalledWith(
      expect.stringContaining('已暂不处理：保留应用内状态'),
    )
  })

  it('Esc 与 Close 双回调只 resolve 一次（幂等守卫 — review 根治）', async () => {
    mount(ConflictResolver)
    let captured: { onEsc?: () => void; onClose?: () => void } | null = null
    dialog.warning.mockImplementationOnce((opts: unknown) => {
      captured = opts as { onEsc?: () => void; onClose?: () => void }
    })
    captureConflictHandler()({ fileKey: 'settings', detail: 'diff' })
    await flushPromises()
    expect(captured).toBeTruthy()
    // 真实 naive 一次关闭可能先后触发 onEsc 与 onClose：resolve 必须幂等
    captured!.onEsc?.()
    captured!.onClose?.()
    captured!.onEsc?.()
    await flushPromises()
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledTimes(1)
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('settings', 'ignore')
  })

  it('处理冲突失败必须报错提示（不静默）', async () => {
    mount(ConflictResolver)
    wslAPI.config.resolveConflict.mockRejectedValueOnce(new Error('写回失败'))
    dialogResult = 'positive'
    captureConflictHandler()({ fileKey: 'settings', detail: 'diff' })
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('写回失败'))
  })
})

describe('WslConfPanel 保存与错误面', () => {
  async function mountDirty() {
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    // 逐个点布尔开关直到脏态成立
    for (const el of Array.from(document.body.querySelectorAll('.n-switch'))) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      const save = findBodyButton('预览并保存')
      if (save && !save.hasAttribute('disabled')) return w
    }
    throw new Error('未能制造脏编辑')
  }

  it('读取失败展示错误文案（不伪装成空配置）', async () => {
    wslAPI.wslconf.read.mockRejectedValueOnce(new Error('sudo 不够'))
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(w.find('p.error').exists()).toBe(true)
    expect(w.text()).toContain('sudo 不够')
  })

  it('未运行发行版不发起读取（读取绝不隐式启动 — review 状态门禁）', async () => {
    useDistrosStore().items = [
      { name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: false, meta: null } as never,
    ]
    mount(WslConfPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    expect(wslAPI.wslconf.read).not.toHaveBeenCalled()
    expect(bodyText()).toContain('发行版未运行')
  })

  it('差异预览渲染 +/- 行内容（不只弹个框）', async () => {
    await mountDirty()
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    const modal = Array.from(document.body.querySelectorAll('.diff-line'))
    expect(modal.length).toBeGreaterThan(0)
    // 至少存在一条新增或删除行（首字段开关被翻转）
    const types = modal.map((el) =>
      el.classList.contains('add') ? 'add' : el.classList.contains('del') ? 'del' : 'same',
    )
    expect(types.some((t) => t === 'add' || t === 'del')).toBe(true)
    const changed = modal.find(
      (el) => el.classList.contains('add') || el.classList.contains('del'),
    )!
    expect(['+', '-']).toContain(changed.querySelector('.sign')!.textContent!.trim())
  })

  it('预览并保存 → 确认写入调用 wslconf.write 并提示已保存', async () => {
    const w = await mountDirty()
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    const confirm = findBodyButton('确认写入')
    expect(confirm, '差异预览应有确认写入按钮').toBeTruthy()
    confirm!.click()
    await flushPromises()
    expect(wslAPI.wslconf.write).toHaveBeenCalledWith('Ubuntu', expect.any(String))
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('wsl.conf 已保存'))
    expect(w.find('p.error').exists()).toBe(false)
  })

  it('写入失败走错误提示（错误态）', async () => {
    await mountDirty()
    wslAPI.wslconf.write.mockRejectedValueOnce(new Error('只读文件系统'))
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    findBodyButton('确认写入')!.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('只读文件系统'))
    expect(bodyText()).toContain('只读文件系统')
  })
})
